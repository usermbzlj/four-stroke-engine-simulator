/**
 * 老周 minding the bench by himself. When the engine stalls, he does not
 * argue with what happened: he reproduces it under the bench's own
 * conditions (and a few other days, warm and cold), tries the usual cures
 * on private engines, fits the smallest one that holds in every case, and
 * starts it again.
 */

import { useGame } from '../game/store';
import type { EcuConfig, EngineConfig } from '../sim/config';
import { useBench } from '../state/benchStore';
import { useLive } from '../state/liveStore';
import { applyFix, crankForMe, mentorEdit } from './actions';
import { stallVariants } from './engineer/engineer';
import { idleVerdict, stressSpecs, verdictText, type IdleVerdict } from './engineer/idle';
import { openPool } from './pool';
import { say, useMentor } from './store';

let busy = false;

export function isRescuing(): boolean {
  return busy;
}

interface Cure {
  text: string;
  patch: Partial<EcuConfig>;
  config?: Partial<EngineConfig>;
}

export async function rescueStall(reason = '熄火了'): Promise<void> {
  if (busy) return;
  busy = true;
  const { config, ecu, bench } = useBench.getState();
  const coolant = useLive.getState().snapshot?.coolantC ?? 88;
  say('stall', 'warn', `${reason}。我照你台架现在的样子（水温 ${Math.round(coolant)} °C${bench.coolantConditioner ? '' : '，没接水温机'}）在后面复现，再换几个日子、冷车热车、轻轰猛轰都试一遍……`, {
    cooldown: 0,
    head: '老周接手：',
  });
  const pool = openPool();
  try {
    const specs = stressSpecs({ bench, coolants: [...new Set([Math.round(coolant), 88, 50])] });
    const base = await idleVerdict(pool.tasks, config, ecu, specs);
    const fly = config.flywheelInertia;
    const cures: Cure[] = [
      ...stallVariants(ecu),
      { text: `飞轮加重到 ${(fly + 0.006).toFixed(3)}（要换零件）`, patch: {}, config: { flywheelInertia: fly + 0.006 } },
    ];
    const verdicts: IdleVerdict[] = await Promise.all(cures.map((c) => idleVerdict(pool.tasks, { ...config, ...c.config }, { ...ecu, ...c.patch }, specs)));
    // ECU-only cures first, smallest first; a part only if nothing else holds.
    const holds = cures.map((c, i) => ({ c, v: verdicts[i]! })).filter(({ v }) => v.ok);
    const pick = holds.find(({ c }) => !c.config) ?? holds[0];
    const intro = base.ok
      ? `后台 ${verdictText(base)}，可台架上确实熄了：说明它就在熄火的边上，留的余量不够。`
      : `复现出来了：${verdictText(base)}。`;
    if (!pick) {
      const best = cures
        .map((c, i) => ({ c, v: verdicts[i]! }))
        .filter(({ c }) => !c.config)
        .sort((a, b) => a.v.stalls - b.v.stalls || b.v.worstDip - a.v.worstDip)[0]!;
      applyFix({ label: best.c.text, ecu: best.c.patch });
      say('stall', 'danger', `${intro}试了 ${cures.length} 种改法，没有一种在所有情况下都压得住。先装上最好的（${best.c.text}，${verdictText(best.v)}）。要彻底稳，得换重一点的飞轮或者温和点的凸轮。`, { cooldown: 0 });
      await crankForMe();
      return;
    }
    const before = { config, ecu };
    if (pick.c.config) mentorEdit(() => useBench.getState().setConfig({ ...pick.c.config }));
    applyFix({ label: pick.c.text, ecu: pick.c.patch });
    const ok = await crankForMe();
    say('stall', 'good', `${intro}改法：${pick.c.text}。改完${verdictText(pick.v)}。已经装上${ok ? '，也重新打着了' : ''}。`, {
      cooldown: 0,
      head: '熄火治好了。',
      actions: [
        {
          label: '改回去',
          run: () =>
            mentorEdit(() => {
              const b = useBench.getState();
              b.setConfig(before.config);
              b.setEcu(before.ecu);
            }),
        },
      ],
    });
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
