/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Tiny cross-platform test runner: discovers every `*.test.ts` under `src/`
 * and executes it with tsx. Each test file uses plain `node:assert` blocks
 * that throw on failure, so a non-zero exit from any file fails the suite.
 */

import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));
const srcDir = join(root, 'src');

/** @param {string} dir */
function findTests(dir) {
  /** @type {string[]} */
  const out = [];
  for (const entry of readdirSync(dir, { withFileTypes: true })) {
    const full = join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === 'node_modules') continue;
      out.push(...findTests(full));
    } else if (entry.isFile() && entry.name.endsWith('.test.ts')) {
      out.push(full);
    }
  }
  return out;
}

const tests = findTests(srcDir).sort();
if (tests.length === 0) {
  console.error('No test files found.');
  process.exit(1);
}

const tsxBin = join(root, 'node_modules', '.bin', process.platform === 'win32' ? 'tsx.cmd' : 'tsx');

let failures = 0;
for (const file of tests) {
  const rel = relative(root, file);
  process.stdout.write(`\n▶ ${rel}\n`);
  const result = spawnSync(tsxBin, [file], { stdio: 'inherit', shell: process.platform === 'win32' });
  if (result.status !== 0) {
    failures++;
    process.stdout.write(`✖ FAILED: ${rel}\n`);
  } else {
    process.stdout.write(`✓ ok: ${rel}\n`);
  }
}

process.stdout.write(`\n${tests.length - failures}/${tests.length} test files passed.\n`);
process.exit(failures === 0 ? 0 : 1);
