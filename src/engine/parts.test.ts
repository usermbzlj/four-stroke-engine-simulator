/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import assert from 'node:assert/strict';
import { it } from 'vitest';
import {
  BLAST_DAMAGE_SLOTS,
  ENGINE_BLOCKS,
  STARTER_BLOCK,
  PARTS,
  PART_SLOTS,
  buildValue,
  compressionEfficiencyFactor,
  defaultBuild,
  displacementCc,
  getBlock,
  partsInSlot,
  resolveBuild,
  starterOwned,
  stockPartFor,
  torqueFromBmep,
} from './parts';
import { knockLimitAdvance } from './physics';
import type { EngineBuild } from '../types';

const near = (actual: number, expected: number, tolerance: number, what: string) => {
  assert.ok(Math.abs(actual - expected) <= tolerance, `${what}: expected ${actual.toFixed(3)} ≈ ${expected} (±${tolerance})`);
};

const withParts = (patch: Partial<EngineBuild['installed']>, blockId?: string): EngineBuild => {
  const base = defaultBuild();
  return { blockId: blockId ?? base.blockId, installed: { ...base.installed, ...patch } };
};

it("Catalogue integrity: every slot has exactly one zero-cost stock entry, and every part id is unique.", () => {
  const ids = new Set<string>();
  for (const part of PARTS) {
    assert.ok(!ids.has(part.id), `duplicate part id ${part.id}`);
    ids.add(part.id);
  }
  for (const slot of PART_SLOTS) {
    const free = PARTS.filter((p) => p.slot === slot && p.cost === 0);
    assert.equal(free.length, 1, `slot ${slot} must have exactly one stock part, found ${free.length}`);
    assert.equal(stockPartFor(slot).slot, slot);
    assert.ok(partsInSlot(slot, STARTER_BLOCK.id).length >= 1, `slot ${slot} should offer at least the stock part`);
  }
});

it("A fresh career owns the starter block and every stock part, nothing else.", () => {
  const owned = new Set(starterOwned());
  assert.ok(owned.has(STARTER_BLOCK.id), 'the starter block must be owned');
  for (const slot of PART_SLOTS) assert.ok(owned.has(stockPartFor(slot).id), `stock ${slot} must be owned`);
  assert.ok(!owned.has('boost-turbo'), 'paid parts must not be owned at the start');
  assert.equal(buildValue(defaultBuild()), 0, 'an all-stock starter build is worth nothing');
});

it("The BMEP calibration reproduces the hand-tuned specs the simulator shipped with.", () => {
  const stock = resolveBuild(defaultBuild());
  near(displacementCc(stock), 244.3, 0.5, '250cc displacement');
  near(stock.peakTorque, 24, 0.3, '250cc peak torque');
  assert.equal(stock.redlineRpm, 6800);
  assert.equal(stock.destructRpm, 8200);

  const race = resolveBuild(withParts({}, 'block-450'));
  near(displacementCc(race), 448.7, 0.5, '450cc displacement');
  near(race.peakTorque, 41, 0.3, '450cc peak torque');

  const big = resolveBuild(withParts({}, 'block-650'));
  near(displacementCc(big), 651.9, 0.5, '650cc displacement');
  near(big.peakTorque, 62, 0.3, '650cc peak torque');
});

it("Compression ratio efficiency is normalised at the reference CR and monotonic.", () => {
  near(compressionEfficiencyFactor(9.5), 1, 1e-9, 'reference CR');
  assert.ok(compressionEfficiencyFactor(12.8) > compressionEfficiencyFactor(9.5));
  assert.ok(compressionEfficiencyFactor(8.0) < compressionEfficiencyFactor(9.5));
});

it("Torque from BMEP is the standard four-stroke relation.", () => {
  near(torqueFromBmep(12.35, 244.29), 24, 0.05, 'BMEP → torque');
  near(torqueFromBmep(0, 500), 0, 1e-9, 'no pressure, no torque');
});

it("Every paid part must change something, and must declare a drawback.", () => {
  for (const part of PARTS.filter((p) => p.cost > 0)) {
    assert.ok(Object.keys(part.mods).length > 0, `${part.id} costs credits but modifies nothing`);
    assert.ok(part.drawback.length > 0, `${part.id} must state a drawback`);
    assert.ok(part.tier >= 1, `${part.id} is paid so it should be gated behind a tier`);
  }
});

it("Parts compose the way the shop copy promises.", () => {
  const stock = resolveBuild(defaultBuild());

  const highComp = resolveBuild(withParts({ piston: 'piston-race-128' }));
  assert.ok(highComp.peakTorque > stock.peakTorque, 'more compression should make more torque');
  const knockPoint = { lambda: 0.9, rpm: 5000, cylinderTemp: 100 };
  assert.ok(
    knockLimitAdvance({ spec: highComp, ...knockPoint }) < knockLimitAdvance({ spec: stock, ...knockPoint }),
    'and should cost knock margin'
  );

  const light = resolveBuild(withParts({ crank: 'crank-race' }));
  assert.ok(light.rotatingInertia < stock.rotatingInertia * 0.6, 'a race crank should halve inertia');

  const rods = resolveBuild(withParts({ rod: 'rod-ti' }));
  assert.ok(rods.destructRpm > stock.destructRpm, 'better rods should raise the destruct ceiling');

  const cooled = resolveBuild(withParts({ cooling: 'cool-race' }));
  assert.ok(cooled.coolingFactor > stock.coolingFactor, 'a race radiator should cool harder');

  const ecu = resolveBuild(withParts({ ecu: 'ecu-standalone' }));
  assert.equal(ecu.ecuTier, 2, 'a standalone ECU unlocks the full map');

  const turbo = resolveBuild(withParts({ boost: 'boost-turbo' }));
  assert.ok(turbo.boostBar > 0 && turbo.peakTorque > stock.peakTorque * 1.3, 'boost should add serious torque');
});

it("Destruct RPM can never fall below redline, however the parts combine.", () => {
  for (const block of ENGINE_BLOCKS) {
    for (const cam of ['cam-stock', 'cam-race']) {
      for (const head of ['head-stock', 'head-race']) {
        const spec = resolveBuild(withParts({ cam, head }, block.id));
        assert.ok(
          spec.destructRpm > spec.redlineRpm,
          `${block.id}/${cam}/${head}: destruct ${spec.destructRpm} must exceed redline ${spec.redlineRpm}`
        );
      }
    }
  }
});

it("Fully built starter engine should be worth chasing: a large, but not absurd, gain.", () => {
  const stock = resolveBuild(defaultBuild());
  const built = resolveBuild(
    withParts({
      piston: 'piston-race-128',
      cam: 'cam-race',
      head: 'head-race',
      intake: 'intake-ram',
      exhaust: 'exhaust-race',
      ecu: 'ecu-standalone',
    })
  );
  const gain = built.peakTorque / stock.peakTorque;
  assert.ok(gain > 1.2 && gain < 1.8, `full build torque gain should be meaningful but bounded, got ${gain.toFixed(2)}×`);
  assert.ok(built.torquePeakRpm > stock.torquePeakRpm, 'a race cam should move the peak up the range');
});

it("An unknown block or part id degrades to stock rather than throwing.", () => {
  assert.equal(getBlock('nope').id, STARTER_BLOCK.id);
  const spec = resolveBuild({ blockId: 'nope', installed: { piston: 'does-not-exist' } });
  assert.ok(Number.isFinite(spec.peakTorque) && spec.peakTorque > 0, 'a corrupt build must still resolve');
});

it("The blast damage list must reference real slots.", () => {
  for (const slot of BLAST_DAMAGE_SLOTS) {
    assert.ok(PART_SLOTS.includes(slot), `${slot} is not a real slot`);
  }
});
