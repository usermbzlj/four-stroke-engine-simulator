/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Headless playtest.
 *
 * Drives the real `EngineRuntime` and the real garage store — the same objects
 * the UI uses — through starter, idle circuit, dyno controller and contracts,
 * and reports what actually happens. This is how you check the thing is
 * *playable* without clicking through it.
 *
 *   npm run playtest
 */

import { EngineState, type DynoResult, type PartSlot } from '../src/types';
import { autoTune, defaultBuild, defaultProgress, getContract, resolveBuild } from '../src/engine';
import { EngineRuntime } from '../src/runtime/engineRuntime';
import type { ControlIntent } from '../src/runtime/intent';
import { createGarageStore } from '../src/store/garageStore';

const FRAME = 1 / 60;

interface Rig {
  rt: EngineRuntime;
  events: string[];
  dynoResult: DynoResult | null;
  /** Simulated clock (ms) at which the last dyno pull finished. */
  dynoDoneMs: number;
  spec: ReturnType<EngineRuntime['getSnapshot']>['spec'];
}

function makeRig(blockId = 'block-250', installed: Partial<Record<PartSlot, string>> = {}): Rig {
  const base = defaultBuild();
  const build = { blockId, installed: { ...base.installed, ...installed } };
  const spec = resolveBuild(build);
  const rt = new EngineRuntime({ build, tune: autoTune(spec) });
  const rig: Rig = { rt, events: [], dynoResult: null, dynoDoneMs: 0, spec };
  rt.onEvent((e) => {
    if (e.type === 'catastrophe') rig.events.push(`FAILURE ${e.state}`);
    if (e.type === 'dynoComplete') {
      rig.dynoResult = e.result;
      rig.dynoDoneMs = rt.getClockMs();
    }
  });
  return rig;
}

/** Advance the rig for `seconds` of simulated time while holding the given controls. */
function run(rig: Rig, seconds: number, intent: Partial<ControlIntent> = {}): void {
  rig.rt.input.set('keyboard', {
    throttle: false,
    stab: false,
    starter: false,
    nitrous: false,
    ...intent,
  });
  const frames = Math.round(seconds / FRAME);
  for (let i = 0; i < frames; i++) rig.rt.advance(FRAME);
}

const phys = (rig: Rig) => rig.rt.getPhysicsState();

const ok = (pass: boolean) => (pass ? '✅' : '❌');
let failures = 0;
const check = (pass: boolean, label: string, detail: string) => {
  if (!pass) failures++;
  console.log(`  ${ok(pass)} ${label} — ${detail}`);
};

// ---------------------------------------------------------------------------
console.log('\n【1】冷车起动 → 松手自持怠速（不踩油门）');
{
  const rig = makeRig();
  rig.rt.setControls({ choke: 0.8 });
  run(rig, 1.5, { starter: true });
  const crankRpm = phys(rig).rpm;
  run(rig, 8);

  check(phys(rig).engineState === EngineState.RUNNING, '起动成功', `状态 ${phys(rig).engineState}，起动机拖动至 ${crankRpm.toFixed(0)} rpm`);
  check(
    Math.abs(phys(rig).rpm - rig.spec.idleRpm) < 220,
    '怠速稳定在目标附近',
    `${phys(rig).rpm.toFixed(0)} rpm（目标 ${rig.spec.idleRpm}）`
  );
  check(phys(rig).coolantTemp > 40, '开始暖机', `水温 ${phys(rig).coolantTemp.toFixed(1)}°C`);
}

// ---------------------------------------------------------------------------
console.log('\n【2】轰油门 → 松手回落怠速 / 油门响应速度');
{
  const rig = makeRig();
  rig.rt.setControls({ load: 0 });
  run(rig, 1.5, { starter: true });
  run(rig, 10);
  const idle = phys(rig).rpm;

  // Time from idle to redline at wide-open throttle — the "does it feel alive" number.
  let toRedline = 0;
  while (phys(rig).rpm < rig.spec.redlineRpm - 200 && toRedline < 20) {
    run(rig, FRAME, { throttle: true, stab: true });
    toRedline += FRAME;
  }
  const peak = phys(rig).rpm;

  run(rig, 6);
  const settled = phys(rig).rpm;

  check(toRedline > 1 && toRedline < 8, '怠速→红线用时手感合适', `${toRedline.toFixed(2)}s（${idle.toFixed(0)} → ${peak.toFixed(0)} rpm）`);
  check(
    phys(rig).engineState === EngineState.RUNNING && Math.abs(settled - rig.spec.idleRpm) < 220,
    '收油后回落到怠速且不熄火',
    `回落至 ${settled.toFixed(0)} rpm（目标 ${rig.spec.idleRpm}）`
  );
}

// ---------------------------------------------------------------------------
console.log('\n【3】暖机时长（怠速 40°C → 88°C 恒温器开启）');
{
  const rig = makeRig();
  run(rig, 1.5, { starter: true });
  let seconds = 0;
  while (phys(rig).coolantTemp < 88 && seconds < 400) {
    run(rig, 2);
    seconds += 2;
  }
  check(seconds < 260, '怠速暖机时间可接受', `${seconds}s 到 88°C`);
}

// ---------------------------------------------------------------------------
console.log('\n【4】散热是否是个真实约束（测功台拉力全程最高水温）');
{
  // Unloaded WOT just bounces off the spark-cut limiter, which genuinely makes
  // little heat. The condition where cooling actually decides things is a loaded
  // sweep — which is exactly what the thermal contracts are scored on.
  const pull = (blockId: string, installed: Partial<Record<PartSlot, string>>) => {
    const rig = makeRig(blockId, installed);
    rig.rt.setControls({ coolantPump: 1 });
    // A warmed-up engine, as the player would have.
    rig.rt.patchPhysics({ coolantTemp: 90, oilTemp: 95, engineState: EngineState.RUNNING, rpm: 1500 });
    rig.rt.startDyno();
    run(rig, 60);
    const r = rig.dynoResult;
    return {
      temp: r?.maxTemp ?? 0,
      hp: r?.peakPowerHp ?? 0,
      aborted: r === null ? 'no result' : r.aborted,
    };
  };

  const race = { piston: 'piston-hc-115', cam: 'cam-race', head: 'head-ported', exhaust: 'exhaust-race' } as const;
  const rows = [
    { label: '250 原厂散热', ...pull('block-250', {}) },
    { label: '250 加大散热', ...pull('block-250', { cooling: 'cool-rad' }) },
    { label: '250 二阶 原厂散热', ...pull('block-250', race) },
    { label: '250 二阶 赛用散热', ...pull('block-250', { ...race, cooling: 'cool-race' }) },
    { label: '450 原厂散热', ...pull('block-450', {}) },
    { label: '450 赛用散热', ...pull('block-450', { cooling: 'cool-race' }) },
  ];

  for (const r of rows) {
    console.log(
      `  ℹ ${r.label.padEnd(22)} 最高水温 ${r.temp.toFixed(0).padStart(3)}°C  ${r.hp.toFixed(1).padStart(5)} HP` +
        (r.aborted ? `  ⚠ ${r.aborted}` : '')
    );
  }

  const [stock, radiator, hot, cooled, big, bigCooled] = rows;
  // A stock 250 makes so little heat that the thermostat handles it alone, so a
  // bigger radiator barely moves the needle. It just must never be *worse*.
  check(!!stock && !!radiator && radiator.temp <= stock.temp, '加大散热不会更热（原厂功率下差异本就很小）', `${radiator?.temp.toFixed(0)}°C vs ${stock?.temp.toFixed(0)}°C`);
  check(!!hot && !!cooled && hot.temp > cooled.temp + 8, '高输出构型必须配散热', `二阶原厂散热 ${hot?.temp.toFixed(0)}°C vs 赛用散热 ${cooled?.temp.toFixed(0)}°C`);
  check(
    !!big && !!bigCooled && big.aborted !== null && bigCooled.aborted === null,
    '450 缸体不配散热会在测功台上烧掉，配了就能跑完',
    `原厂散热：${big?.aborted ?? '跑完'} / 赛用散热：${bigCooled?.aborted ?? '跑完'}`
  );
}

// ---------------------------------------------------------------------------
console.log('\n【5】实时测功台拉力（走 tickDyno 控制器）');
{
  const rig = makeRig();
  rig.rt.setControls({ coolantPump: 1 });
  run(rig, 1.5, { starter: true });
  run(rig, 6);

  const before = rig.rt.getClockMs();
  rig.rt.startDyno();
  run(rig, 60);
  const elapsed = (rig.dynoDoneMs - before) / 1000;

  const result = rig.dynoResult;
  check((result?.curve.length ?? 0) > 15, '曲线采样充足', `${result?.curve.length ?? 0} 个采样点，耗时 ${elapsed.toFixed(1)}s`);
  check(
    !!result && result.peakPowerHp > 9 && result.peakPowerHp < 18,
    '峰值马力合理',
    `${result?.peakPowerHp.toFixed(1)} HP @ ${Math.round(result?.peakPowerRpm ?? 0)} rpm`
  );
  check(elapsed > 8 && elapsed < 30, '拉力时长适合观看', `${elapsed.toFixed(1)}s`);
  check(result?.aborted === null, '完整跑完未中止', result?.aborted ?? '正常完成');
}

// ---------------------------------------------------------------------------
console.log('\n【6】关掉限速器长时间超转 → 是否真的会自毁');
{
  const rig = makeRig('block-250', { crank: 'crank-race' });
  rig.rt.setControls({ hasLimiter: false, load: 0, coolantPump: 1 });
  run(rig, 1.5, { starter: true });
  run(rig, 5);

  let held = 0;
  let peakRpm = 0;
  while (phys(rig).engineState === EngineState.RUNNING && held < 150) {
    run(rig, 1, { throttle: true, stab: true });
    peakRpm = Math.max(peakRpm, phys(rig).rpm);
    held += 1;
  }

  check(
    phys(rig).engineState === EngineState.EXPLODED || phys(rig).engineState === EngineState.SEIZED,
    '无限速器持续超转最终自毁',
    `${held}s 后 ${phys(rig).engineState}（${rig.events.at(-1) ?? '—'}）`
  );
  check(
    held > 20 && peakRpm > rig.spec.redlineRpm,
    '确实超过红线，且自毁不是瞬间的',
    `峰值 ${peakRpm.toFixed(0)} rpm（红线 ${rig.spec.redlineRpm}），存活 ${held}s`
  );
}

// ---------------------------------------------------------------------------
console.log('\n【7】限速器是否真的护得住');
{
  const rig = makeRig();
  rig.rt.setControls({ hasLimiter: true, limiterRpm: rig.spec.redlineRpm, load: 0, coolantPump: 1 });
  run(rig, 1.5, { starter: true });
  run(rig, 5);
  run(rig, 20, { throttle: true, stab: true });
  check(
    phys(rig).engineState === EngineState.RUNNING && phys(rig).rpm < rig.spec.destructRpm,
    '开启限速器后长时间全油门仍存活',
    `${phys(rig).rpm.toFixed(0)} rpm，状态 ${phys(rig).engineState}`
  );
}

// ---------------------------------------------------------------------------
console.log('\n【8】「首次点火」合约是否可用油门完成（真实 garage store）');
{
  const rig = makeRig();
  const garage = createGarageStore(defaultProgress(), {
    log: () => {},
    onPartInstalled: () => {},
    onRebuild: () => {},
    now: () => rig.rt.getClockMs(),
  });
  rig.rt.onEvent((e) => {
    if (e.type === 'tick') garage.getState().tick(e.ctx);
  });

  const contract = getContract('first-fire');
  run(rig, 1.5, { starter: true });
  run(rig, 6);
  garage.getState().startContract('first-fire');
  for (let i = 0; i < 60 && garage.getState().contract.status === 'running'; i++) run(rig, 1);

  const { contract: finalRun, garage: career } = garage.getState();
  check(
    finalRun.status === 'passed',
    '纯靠怠速旁通即可达成',
    `${finalRun.status}，累计 ${finalRun.metricValue.toFixed(1)}s / 需要 ${contract?.target}s，奖励后信用点 ${Math.floor(career.credits)}`
  );
}

// ---------------------------------------------------------------------------
console.log('\n【9】赛用曲轴（超轻飞轮）怠速是否明显更难');
{
  const stock = makeRig();
  run(stock, 1.5, { starter: true });
  run(stock, 10);

  const light = makeRig('block-250', { crank: 'crank-race' });
  run(light, 1.5, { starter: true });
  run(light, 10);

  console.log(
    `  ℹ 原厂飞轮怠速 ${phys(stock).rpm.toFixed(0)} rpm / 超轻曲轴 ${phys(light).rpm.toFixed(0)} rpm ` +
      `(状态 ${phys(light).engineState})`
  );
  check(
    phys(light).engineState === EngineState.RUNNING || phys(light).engineState === EngineState.STALLED,
    '超轻曲轴仍是可玩状态（能怠速或会失速，但不会卡死）',
    `状态 ${phys(light).engineState}`
  );
}

console.log(`\n${failures === 0 ? '✅ 全部通过' : `❌ ${failures} 项未通过`}\n`);
process.exit(failures === 0 ? 0 : 1);
