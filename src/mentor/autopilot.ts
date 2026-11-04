/**
 * 老周 minding the bench by himself. When the engine stalls with 保护 on,
 * he does not just say so: he tries the usual cures on private engines,
 * fits the smallest one that holds, and starts it again.
 */

import { useBench } from '../state/benchStore';
import { applyFix, crankForMe } from './actions';
import { stallVariants } from './engineer/engineer';
import { openPool } from './pool';
import { say, useMentor } from './store';
import type { EcuConfig } from '../sim/config';
import { useGame } from '../game/store';

let busy = false;

export function isRescuing(): boolean {
  return busy;
}

export async function rescueStall(reason = '熄火了'): Promise<void> {
  if (busy) return;
  busy = true;
  const { config, ecu } = useBench.getState();
  say('stall', 'warn', `${reason}。我在后面的台架上把几种治熄火的改法同时试一遍……`, { cooldown: 0, head: '老周接手：' });
  const pool = openPool();
  try {
    const variants = [{ text: '原样', patch: {} as Partial<EcuConfig> }, ...stallVariants(ecu)];
    const outs = await Promise.all(variants.map((v) => pool.tasks(config, { ...ecu, ...v.patch }, [{ kind: 'idle' }])));
    const rows = outs.map((o, i) => {
      const r = o[0]!;
      const e = { ...ecu, ...variants[i]!.patch };
      const ok = r.kind === 'idle' && !r.stalled && r.blipMin >= Math.max(500, e.idleRpm * 0.55) && r.idleMin >= e.idleRpm * 0.7;
      return { i, ok, r };
    });
    const base = rows[0]!;
    if (base.ok) {
      say('stall', 'say', '原样在后台跑是稳的，刚才多半是你操作太猛。我给你重新打着。', { cooldown: 0 });
      await crankForMe();
      return;
    }
    const pick = rows.slice(1).find((x) => x.ok);
    if (!pick) {
      const best = rows.slice(1).reduce((a, b) => ((b.r.kind === 'idle' ? b.r.blipMin : 0) > (a.r.kind === 'idle' ? a.r.blipMin : 0) ? b : a));
      say('stall', 'danger', `试了 ${variants.length - 1} 种改法都压不住。光调 ECU 不够，这台得换重一点的飞轮，或者凸轮别那么野。先按最好的那种（${variants[best.i]!.text}）装上。`, {
        cooldown: 0,
      });
      applyFix({ label: variants[best.i]!.text, ecu: variants[best.i]!.patch });
      await crankForMe();
      return;
    }
    const v = variants[pick.i]!;
    const r = pick.r.kind === 'idle' ? pick.r : null;
    const before = ecu;
    applyFix({ label: v.text, ecu: v.patch });
    const ok = await crankForMe();
    say(
      'stall',
      'good',
      `找到了：${v.text}。后台轰油门再松，最低 ${Math.round(r?.blipMin ?? 0).toLocaleString('en-US')} 转，怠速稳在 ${Math.round(r?.idleMin ?? 0).toLocaleString('en-US')} 以上。已经改上${ok ? '，也重新打着了' : ''}。`,
      {
        cooldown: 0,
        head: '熄火治好了。',
        actions: [{ label: '改回去', run: () => applyFix({ label: '', ecu: Object.fromEntries(Object.keys(v.patch).map((k) => [k, before[k as keyof EcuConfig]])) as Partial<EcuConfig> }) }],
      },
    );
  } catch {
    // Pool closed or the page went away: nothing to do.
  } finally {
    pool.close();
    busy = false;
  }
}

/** On under 保护 on the player's own bike; on a job the work is the player's, so he only offers. */
export function autopilotOn(): boolean {
  return useMentor.getState().protect && useGame.getState().mode === 'sandbox';
}
