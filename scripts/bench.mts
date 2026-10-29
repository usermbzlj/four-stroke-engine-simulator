/**
 * Headless bench report: drives the real solver at audio rate and prints how
 * each preset starts, idles, revs and what its torque curve looks like.
 *
 *   npm run bench            all presets
 *   npm run bench -- 450     presets whose id contains "450"
 */

import { PRESETS, type EnginePreset } from '../src/sim/config.ts';
import { EngineCore } from '../src/sim/core.ts';

const FS = 48000;
const DT = 1 / FS;

function run(core: EngineCore, seconds: number, each?: (t: number) => void): void {
  const n = Math.round(seconds * FS);
  for (let i = 0; i < n; i++) {
    core.step(DT);
    if (each && i % 480 === 0) each(i / FS);
  }
}

function startEngine(core: EngineCore): { caught: boolean; crankRpm: number; t: number } {
  core.controls.starter = true;
  let t = 0;
  let crankRpm = 0;
  let caught = false;
  while (t < 3) {
    run(core, 0.02);
    t += 0.02;
    if (t > 0.06 && t < 0.16) crankRpm = Math.max(crankRpm, core.rpm);
    if (core.rpm > 1100) {
      caught = true;
      break;
    }
  }
  core.controls.starter = false;
  return { caught, crankRpm, t };
}

function idleStats(core: EngineCore, seconds: number): { mean: number; min: number; max: number } {
  let sum = 0;
  let n = 0;
  let min = Infinity;
  let max = -Infinity;
  run(core, seconds, () => {
    const r = core.rpm;
    sum += r;
    n++;
    min = Math.min(min, r);
    max = Math.max(max, r);
  });
  return { mean: sum / n, min, max };
}

function report(preset: EnginePreset): void {
  console.log(`\n================ ${preset.name} ================`);
  const core = new EngineCore(preset.engine, preset.ecu);

  const start = startEngine(core);
  console.log(`起动: ${start.caught ? '着车' : '未着车'}  用时 ${start.t.toFixed(2)}s  拖动转速 ≈ ${start.crankRpm.toFixed(0)} rpm`);
  run(core, 2);
  const idle = idleStats(core, 4);
  console.log(
    `怠速: 均值 ${idle.mean.toFixed(0)} rpm (目标 ${preset.ecu.idleRpm})  波动 ${idle.min.toFixed(0)}–${idle.max.toFixed(0)}  MAP ${core.mapKpa.toFixed(0)} kPa  λ ${core.lastCycle?.lambda.toFixed(2)}  点火 ${core.advance.toFixed(1)}°  状态 ${core.status}`
  );

  // Free rev
  core.controls.throttle = 1;
  const target = preset.ecu.limiterRpm * 0.95;
  let t = 0;
  const from = core.rpm;
  while (core.rpm < target && t < 8) {
    run(core, 0.01);
    t += 0.01;
  }
  console.log(`空转全油门: ${from.toFixed(0)} → ${target.toFixed(0)} rpm 用时 ${t.toFixed(2)}s`);
  run(core, 1);
  const pops: number[] = [];
  core.controls.throttle = 0;
  let back = 0;
  const events: { kind: string }[] = [];
  while (core.rpm > preset.ecu.idleRpm + 300 && back < 8) {
    run(core, 0.01);
    back += 0.01;
    core.drainEvents(events as never);
  }
  for (const e of events) if (e.kind === 'afterfire') pops.push(1);
  run(core, 2);
  console.log(`收油回落: ${back.toFixed(2)}s 回到怠速附近，后燃 ${pops.length} 次，之后 ${core.rpm.toFixed(0)} rpm (${core.status})`);

  // WOT torque curve, speed-held
  console.log(' rpm    扭矩Nm  功率hp  VE    Pmax bar @°   点火°  λ     燃烧°  爆震  排温°C');
  const top = Math.min(preset.ecu.limiterRpm - 200, 13000);
  core.controls.brakeMode = 'speed';
  core.controls.throttle = 1;
  for (let rpm = 2000; rpm <= top; rpm += 1000) {
    core.controls.brakeRpm = rpm;
    run(core, 1.6);
    let tq = 0;
    let n = 0;
    let knock = 0;
    const c0 = core.lastCycle;
    run(core, 0.6, () => {
      const c = core.lastCycle;
      if (c) {
        tq += c.brakeTorque;
        knock = Math.max(knock, c.knock);
        n++;
      }
    });
    const c = core.lastCycle ?? c0;
    if (!c) continue;
    const torque = tq / Math.max(1, n);
    const hp = (torque * rpm) / 7121;
    console.log(
      `${String(rpm).padStart(6)} ${torque.toFixed(1).padStart(8)} ${hp.toFixed(1).padStart(7)}  ${c.ve.toFixed(2)}  ${c.pmax
        .toFixed(0)
        .padStart(5)} @${c.pmaxDeg.toFixed(0).padStart(3)}  ${c.advance.toFixed(1).padStart(6)}  ${c.lambda.toFixed(2)}  ${c.burnDeg
        .toFixed(0)
        .padStart(4)}  ${knock.toFixed(2)}  ${(core.egtK - 273).toFixed(0)}`
    );
    if (core.failure) {
      console.log(`  失效: ${core.failure.title}`);
      break;
    }
  }

  if (!core.failure) {
    console.log('点火角扫描 @ 6000 rpm 全油门（关闭爆震控制）:');
    const knockControl = core.ecu.knockControl;
    core.setEcu({ ...core.ecu, knockControl: false });
    core.controls.brakeRpm = Math.min(6000, preset.ecu.limiterRpm - 500);
    for (const off of [-12, -6, 0, 6, 12]) {
      core.setEcu({ ...core.ecu, advanceOffset: off });
      run(core, 1.2);
      let tq = 0;
      let n = 0;
      let knock = 0;
      run(core, 0.5, () => {
        const c = core.lastCycle;
        if (c) {
          tq += c.brakeTorque;
          knock = Math.max(knock, c.knock);
          n++;
        }
      });
      console.log(
        `  偏移 ${String(off).padStart(3)}° → 点火 ${core.lastCycle?.advance.toFixed(1)}°  扭矩 ${(tq / n).toFixed(1)} Nm  爆震 ${knock.toFixed(2)}  活塞损伤 ${(core.pistonDamage * 100).toFixed(1)}%`
      );
    }
    core.setEcu({ ...core.ecu, advanceOffset: 0, knockControl });
  }
  core.controls.brakeMode = 'off';
  core.controls.throttle = 0;
}

const filter = process.argv[2];
for (const p of PRESETS) if (!filter || p.id.includes(filter)) report(p);

{
  const core = new EngineCore(PRESETS[0]!.engine, PRESETS[0]!.ecu);
  core.controls.brakeMode = 'speed';
  core.controls.brakeRpm = 9000;
  core.omega = (8000 * 2 * Math.PI) / 60;
  core.controls.throttle = 1;
  const t0 = performance.now();
  run(core, 5);
  const ms = performance.now() - t0;
  console.log(`\n性能: 8000 rpm 下 5 秒仿真耗时 ${ms.toFixed(0)} ms（实时倍率 ${(5000 / ms).toFixed(1)}×）`);
}
