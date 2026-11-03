import { mkdirSync, writeFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { boot, formatSession, type SessionResult } from './harness';
import { SESSIONS } from './scripts';

/**
 * Runs the scripted sessions in ./scripts.ts against the real mentor and solver.
 *   $env:REPLAY=1; npx vitest run src/mentor/replay
 * REPLAY_ONLY=s1,s3  run a subset · REPLAY_OUT=dir  output folder (default logs/laozhou-replay)
 * REPLAY_STRICT=1    fail the test when a session's checks fail
 */

const only = process.env.REPLAY_ONLY?.split(',').map((s) => s.trim());
const out = resolve(process.cwd(), process.env.REPLAY_OUT ?? 'logs/laozhou-replay');
const results: SessionResult[] = [];

describe.skipIf(!process.env.REPLAY)('老周回放', () => {
  for (const s of SESSIONS) {
    it.skipIf(!!only && !only.includes(s.id))(`${s.id} ${s.title}`, async () => {
      const h = await boot({ id: s.id, title: s.title, ...s.opts });
      const wall = Date.now();
      let res: SessionResult;
      try {
        await s.run(h);
      } finally {
        res = h.finish();
        results.push(res);
      }
      console.log(`${s.id}: ${res.stats.seconds.toFixed(0)} s simulated in ${((Date.now() - wall) / 1000).toFixed(1)} s`);
      if (process.env.REPLAY_STRICT) for (const c of res.checks) expect(c.ok, c.text).toBe(true);
    }, 600_000);
  }

  afterAll(() => {
    if (results.length === 0) return;
    mkdirSync(out, { recursive: true });
    results.sort((a, b) => SESSIONS.findIndex((s) => s.id === a.id) - SESSIONS.findIndex((s) => s.id === b.id));
    const md = [`# 老周回放实录（${new Date().toISOString()}）`, '', ...results.map(formatSession)].join('\n');
    writeFileSync(resolve(out, only ? `transcripts-${only.join('-')}.md` : 'transcripts.md'), md);
    for (const r of results) writeFileSync(resolve(out, `${r.id}.json`), JSON.stringify(r, null, 1));
  });
});
