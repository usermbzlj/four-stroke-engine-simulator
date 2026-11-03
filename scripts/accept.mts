import { PRESETS } from '../src/sim/config.ts';
import { runAcceptance } from '../src/game/acceptance.ts';
for (const p of PRESETS) {
  const t0 = performance.now();
  const r = runAcceptance(p.engine, p.ecu, { freeRev: true, overrun: true, endurance: { seconds: 5 } });
  const ms = performance.now() - t0;
  console.log(p.name, `${ms.toFixed(0)}ms sim ${r.simTime.toFixed(1)}s`, 'started', r.started, 'idle', r.idle && [r.idle.mean, r.idle.min, r.idle.max].map(Math.round));
  console.log(' peak', r.peakTorque.toFixed(1), '@', r.peakTorqueRpm, ' hp', r.peakHp.toFixed(1), '@', r.peakHpRpm, 'freeRev', r.freeRevTime?.toFixed(2), 'pops', r.pops, 'knock', r.knockMax.toFixed(2), r.knockEvents, 'dmg', r.pistonDamage.toFixed(3), 'rod', r.rodFatigue.toFixed(3), 'fail', r.failure?.title, r.failedIn);
  console.log(' curve', r.curve.map(([a, b]) => `${a}:${b.toFixed(1)}`).join(' '));
}
