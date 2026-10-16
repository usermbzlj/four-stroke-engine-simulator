/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Balance probe: runs headless dyno pulls over a progression of realistic builds
 * and prints what each one measures, so the career's HP targets can be checked
 * against what the physics actually delivers. Not part of the test suite —
 * this is a tuning instrument for whoever is balancing the game.
 *
 *   npx tsx scripts/balance-report.mts
 */

import type { EngineBuild, EngineParameters } from '../src/types';
import { CONTRACTS } from '../src/engine/career';
import { runDynoHeadless } from '../src/engine/dyno';
import { defaultBuild, displacementCc, resolveBuild, buildValue, ENGINE_BLOCKS } from '../src/engine/parts';
import { autoTune } from '../src/engine/tune';

const params: EngineParameters = {
  throttle: 1,
  load: 0,
  oilLevel: 100,
  hasLimiter: false,
  limiterRpm: 99999,
  hasNitrous: false,
  coolantPump: 1,
  choke: 0,
};

const build = (patch: Partial<EngineBuild['installed']>, blockId?: string): EngineBuild => {
  const base = defaultBuild();
  return { blockId: blockId ?? base.blockId, installed: { ...base.installed, ...patch } };
};

const STAGES: { label: string; build: EngineBuild }[] = [
  { label: '250 全原厂', build: build({}) },
  { label: '250 + 进排气', build: build({ intake: 'intake-velocity', exhaust: 'exhaust-header' }) },
  {
    label: '250 一阶（街道凸轮+缸盖+散热）',
    build: build({
      intake: 'intake-velocity',
      exhaust: 'exhaust-header',
      cam: 'cam-street',
      head: 'head-ported',
      cooling: 'cool-rad',
      ecu: 'ecu-tuner',
    }),
  },
  {
    label: '250 二阶（CR11.5 + 赛用凸轮）',
    build: build({
      piston: 'piston-hc-115',
      cam: 'cam-race',
      head: 'head-ported',
      intake: 'intake-ram',
      exhaust: 'exhaust-race',
      cooling: 'cool-oilcooler',
      ecu: 'ecu-standalone',
      ignition: 'ign-cdi',
    }),
  },
  {
    label: '250 三阶（CR12.8 全套）',
    build: build({
      piston: 'piston-race-128',
      cam: 'cam-race',
      head: 'head-race',
      intake: 'intake-ram',
      exhaust: 'exhaust-race',
      cooling: 'cool-race',
      ecu: 'ecu-standalone',
      ignition: 'ign-cdi',
      rod: 'rod-forged',
      crank: 'crank-light',
      oil: 'oil-sump',
    }),
  },
  {
    label: '250 涡轮（低压缩）',
    build: build({
      piston: 'piston-boost-90',
      boost: 'boost-turbo',
      cam: 'cam-street',
      head: 'head-race',
      intake: 'intake-velocity',
      exhaust: 'exhaust-race',
      cooling: 'cool-race',
      ecu: 'ecu-standalone',
      ignition: 'ign-cdi',
      rod: 'rod-forged',
      oil: 'oil-drysump',
    }),
  },
  { label: '450 全原厂', build: build({}, 'block-450') },
  {
    label: '450 全套改装',
    build: build(
      {
        cam: 'cam-race',
        head: 'head-race',
        intake: 'intake-ram',
        exhaust: 'exhaust-race',
        cooling: 'cool-race',
        ecu: 'ecu-standalone',
        ignition: 'ign-cdi',
        rod: 'rod-ti',
        crank: 'crank-light',
        oil: 'oil-drysump',
      },
      'block-450'
    ),
  },
  { label: '650 全原厂', build: build({}, 'block-650') },
  {
    label: '650 全套 + 机械增压',
    build: build(
      {
        piston: 'piston-boost-90',
        boost: 'boost-super',
        cam: 'cam-street',
        head: 'head-race',
        intake: 'intake-ram',
        exhaust: 'exhaust-race',
        cooling: 'cool-race',
        ecu: 'ecu-standalone',
        ignition: 'ign-cdi',
        rod: 'rod-ti',
        oil: 'oil-drysump',
      },
      'block-650'
    ),
  },
];

const pad = (s: string, n: number) => s + ' '.repeat(Math.max(0, n - [...s].reduce((w, c) => w + (c.charCodeAt(0) > 255 ? 2 : 1), 0)));

console.log('\n=== 缸体 ===');
for (const b of ENGINE_BLOCKS) {
  const spec = resolveBuild({ blockId: b.id, installed: defaultBuild().installed });
  console.log(
    `${pad(b.name, 24)} ${Math.round(displacementCc(spec))}cc  CR${spec.compressionRatio}  ` +
      `峰扭${spec.peakTorque.toFixed(1)}Nm@${spec.torquePeakRpm}  红线${spec.redlineRpm}  售价${b.cost}CR`
  );
}

console.log('\n=== 改装阶段实测（headless dyno，确定性 RNG）===');
console.log(pad('构型', 34) + pad('排量', 8) + pad('峰值HP', 10) + pad('峰扭Nm', 10) + pad('最高水温', 10) + pad('峰值爆震', 10) + pad('改装花费', 10));

const results: { label: string; hp: number }[] = [];
for (const stage of STAGES) {
  const spec = resolveBuild(stage.build);
  const result = runDynoHeadless({ spec, tune: autoTune(spec), params, rng: () => 0.99 });
  results.push({ label: stage.label, hp: result.peakPowerHp });
  console.log(
    pad(stage.label, 34) +
      pad(`${Math.round(displacementCc(spec))}cc`, 8) +
      pad(result.peakPowerHp.toFixed(1), 10) +
      pad(result.peakTorqueNm.toFixed(1), 10) +
      pad(`${result.maxTemp.toFixed(0)}°C`, 10) +
      pad(`${(result.maxKnock * 100).toFixed(0)}%`, 10) +
      pad(`${buildValue(stage.build)}CR`, 10) +
      (result.aborted ? `  ⚠ ${result.aborted}` : '')
  );
}

console.log('\n=== 生涯马力目标 vs 可达成构型 ===');
for (const c of CONTRACTS.filter((x) => x.kind === 'dyno')) {
  const first = results.find((r) => r.hp >= c.target);
  const stretch = results.find((r) => r.hp >= c.stretch);
  console.log(
    `T${c.tier} ${pad(c.name, 22)} 目标${pad(String(c.target) + 'HP', 8)} ` +
      `最早达成: ${pad(first?.label ?? '❌ 无构型可达成', 34)} 满星(${c.stretch}HP): ${stretch?.label ?? '❌ 不可达成'}`
  );
}
console.log();
