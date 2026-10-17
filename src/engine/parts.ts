/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Build & parts system.
 *
 * An {@link EngineSpec} is never hand-written any more: it is *derived* from a
 * block plus the parts bolted to it. That means every number the physics reads
 * traces back to something the player bought, and every purchase has a visible
 * consequence in the torque curve, the thermals or the failure thresholds.
 *
 * Calibration note: with only stock parts fitted, the three blocks resolve to
 * exactly the hand-tuned specs the simulator shipped with (250cc/24Nm,
 * 450cc/41Nm, 650cc/62Nm), so the established feel is preserved.
 */

import type { ComponentWear, EngineBlock, EngineBuild, EngineSpec, Part, PartMods, PartSlot } from '../types';

/** Brake mean effective pressure (bar) of the reference build at its torque peak. */
const BASE_BMEP_BAR = 12.35;
/** Reference compression ratio the CR efficiency term is normalised against. */
const REFERENCE_CR = 9.5;
/** Polytropic exponent term for the Otto-cycle efficiency ratio. */
const CR_EFFICIENCY_EXP = 0.3;

export const PART_SLOTS: PartSlot[] = [
  'piston',
  'cam',
  'head',
  'intake',
  'exhaust',
  'crank',
  'rod',
  'ignition',
  'cooling',
  'oil',
  'ecu',
  'boost',
];

export const SLOT_LABELS: Record<PartSlot, string> = {
  piston: '活塞 / 压缩比',
  cam: '凸轮轴',
  head: '缸盖',
  intake: '进气',
  exhaust: '排气',
  crank: '曲轴 / 飞轮',
  rod: '连杆',
  ignition: '点火系统',
  cooling: '冷却',
  oil: '润滑',
  ecu: 'ECU',
  boost: '增压',
};

// ---------------------------------------------------------------------------
// Blocks
// ---------------------------------------------------------------------------

export const ENGINE_BLOCKS: EngineBlock[] = [
  {
    id: 'block-250',
    name: '原厂单缸 250cc',
    desc: '均衡耐用的街车心脏。怠速稳定、低扭充沛，容错率高，适合摸清每个参数的脾气。',
    cost: 0,
    tier: 0,
    bore: 72,
    stroke: 60,
    baseCompression: 9.5,
    baseBmepMult: 1.0,
    baseInertia: 0.14,
    baseRedline: 6800,
    baseDestruct: 8200,
    baseTorquePeakRpm: 4200,
    baseThermalMass: 1.0,
    idleRpm: 1100,
  },
  {
    id: 'block-450',
    name: '赛用短行程 450cc',
    desc: '轻量化飞轮 + 高压缩短行程，转速攀升极快。怠速暴躁、极易爆震 —— 换上它之前先把散热做好。',
    cost: 2400,
    tier: 2,
    bore: 96,
    stroke: 62,
    baseCompression: 12.8,
    baseBmepMult: 0.855,
    baseInertia: 0.085,
    baseRedline: 9500,
    baseDestruct: 11000,
    baseTorquePeakRpm: 7200,
    baseThermalMass: 0.82,
    idleRpm: 1400,
  },
  {
    id: 'block-650',
    name: '大排量长行程 650cc',
    desc: '沉重飞轮 + 长行程，低转扭矩巨大、极其耐造，但反应迟钝、红线很低。发热量也是 250 的两倍半。',
    cost: 3200,
    tier: 3,
    bore: 100,
    stroke: 83,
    baseCompression: 10.5,
    baseBmepMult: 0.94,
    baseInertia: 0.22,
    baseRedline: 6200,
    baseDestruct: 7400,
    baseTorquePeakRpm: 3600,
    baseThermalMass: 1.35,
    idleRpm: 950,
  },
];

/** The platform every career starts on; also the fallback for unknown ids. */
export const STARTER_BLOCK: EngineBlock = (() => {
  const first = ENGINE_BLOCKS[0];
  if (!first) throw new Error('ENGINE_BLOCKS must not be empty');
  return first;
})();

export function getBlock(id: string): EngineBlock {
  return ENGINE_BLOCKS.find((b) => b.id === id) ?? STARTER_BLOCK;
}

// ---------------------------------------------------------------------------
// Parts catalogue
// ---------------------------------------------------------------------------

/**
 * Every slot has a zero-cost stock entry so "what am I running?" always has an
 * answer, and so removing a part is just re-installing stock.
 */
export const PARTS: Part[] = [
  // --- pistons: compression ratio vs knock margin -------------------------
  {
    id: 'piston-stock',
    slot: 'piston',
    name: '原厂铸造活塞',
    desc: '出厂压缩比，宽容好养。',
    drawback: '动力平平。',
    cost: 0,
    tier: 0,
    mods: {},
  },
  {
    id: 'piston-forged-105',
    slot: 'piston',
    name: '锻造活塞 CR 10.5',
    desc: '压缩比 10.5，热效率上升约 3%。',
    drawback: '每提高一点压缩比，就少约 1.8° 的抗爆震余量。',
    cost: 420,
    tier: 1,
    mods: { compressionRatio: 10.5 },
  },
  {
    id: 'piston-hc-115',
    slot: 'piston',
    name: '高压缩活塞 CR 11.5',
    desc: '压缩比 11.5，中高转明显更有劲。',
    drawback: '爆震余量少约 3.6°，水温一高就必须退点火角。',
    cost: 980,
    tier: 2,
    mods: { compressionRatio: 11.5 },
  },
  {
    id: 'piston-race-128',
    slot: 'piston',
    name: '赛用活塞 CR 12.8',
    desc: '极限压缩比，热效率比原厂高约 9%。',
    drawback: '爆震余量少约 6°，必须配足散热，否则高转必爆。',
    cost: 1850,
    tier: 3,
    mods: { compressionRatio: 12.8 },
  },
  {
    id: 'piston-boost-90',
    slot: 'piston',
    name: '低压缩增压活塞 CR 9.0',
    desc: '为增压准备的低压缩锻件，额外换回约 3° 抗爆震余量。',
    drawback: '自吸状态下动力反而下降 —— 只在装了增压器时才划算。',
    cost: 860,
    tier: 3,
    mods: { compressionRatio: 9.0, knockResistance: 0.15 },
  },

  // --- camshafts: where the power lives -----------------------------------
  { id: 'cam-stock', slot: 'cam', name: '原厂凸轮轴', desc: '保守正时，低扭与怠速都很稳。', drawback: '高转乏力。', cost: 0, tier: 0, mods: {} },
  {
    id: 'cam-street',
    slot: 'cam',
    name: '街道运动凸轮',
    desc: '扭矩峰后移 400rpm，高转呼吸更顺。',
    drawback: '极低转稍有损失。',
    cost: 380,
    tier: 1,
    mods: { torquePeakShift: 400, veHighMult: 1.05, veLowMult: 0.98, bmepMult: 1.02 },
  },
  {
    id: 'cam-torque',
    slot: 'cam',
    name: '低扭凸轮',
    desc: '扭矩峰前移 700rpm，中低转推背感强烈。',
    drawback: '高转掉得很快，红线区没有意义。',
    cost: 700,
    tier: 2,
    mods: { torquePeakShift: -700, veLowMult: 1.12, veHighMult: 0.86, bmepMult: 1.04 },
  },
  {
    id: 'cam-race',
    slot: 'cam',
    name: '赛用高角度凸轮',
    desc: '扭矩峰后移 1500rpm，红线上限 +10%，顶端持续供力。',
    drawback: '低转严重掉扭，怠速抖动、极易失速。',
    cost: 1250,
    tier: 2,
    mods: { torquePeakShift: 1500, veHighMult: 1.14, veLowMult: 0.76, bmepMult: 0.94, redlineMult: 1.1 },
  },

  // --- cylinder head -------------------------------------------------------
  { id: 'head-stock', slot: 'head', name: '原厂缸盖', desc: '铸造气道。', drawback: '流量一般。', cost: 0, tier: 0, mods: {} },
  {
    id: 'head-ported',
    slot: 'head',
    name: '气道打磨缸盖',
    desc: '手工扩孔抛光，全域流量 +6%。',
    drawback: '无明显缺点，只是贵。',
    cost: 620,
    tier: 1,
    mods: { bmepMult: 1.06 },
  },
  {
    id: 'head-race',
    slot: 'head',
    name: '赛用四气门缸盖',
    desc: '大流量燃烧室，挤流更好因此更抗爆震，红线 +8%。',
    drawback: '低转气流速度不足，起步偏软。',
    cost: 1600,
    tier: 3,
    mods: { bmepMult: 1.12, veHighMult: 1.05, veLowMult: 0.96, knockResistance: 0.1, redlineMult: 1.08 },
  },

  // --- intake / exhaust ----------------------------------------------------
  { id: 'intake-stock', slot: 'intake', name: '原厂进气', desc: '带消音的原厂进气箱。', drawback: '高转有节流。', cost: 0, tier: 0, mods: {} },
  {
    id: 'intake-velocity',
    slot: 'intake',
    name: '喇叭口直通进气',
    desc: '去掉进气箱，高转进气阻力下降。',
    drawback: '进气温度略高。',
    cost: 260,
    tier: 1,
    mods: { veHighMult: 1.02, bmepMult: 1.02, knockResistance: -0.03 },
  },
  {
    id: 'intake-ram',
    slot: 'intake',
    name: '可变长度冲压进气',
    desc: '高转惯性增压效果显著。',
    drawback: '低转进气脉冲被破坏。',
    cost: 720,
    tier: 2,
    mods: { veHighMult: 1.05, veLowMult: 0.96, bmepMult: 1.03 },
  },
  { id: 'exhaust-stock', slot: 'exhaust', name: '原厂排气', desc: '带催化与消音。', drawback: '背压高。', cost: 0, tier: 0, mods: {} },
  {
    id: 'exhaust-header',
    slot: 'exhaust',
    name: '等长头段排气',
    desc: '降低背压，全域 +5%。',
    drawback: '很吵。',
    cost: 340,
    tier: 1,
    mods: { bmepMult: 1.05 },
  },
  {
    id: 'exhaust-race',
    slot: 'exhaust',
    name: '赛用大口径排气',
    desc: '为高转调谐的大口径系统。',
    drawback: '低转扫气变差，低速掉扭。',
    cost: 860,
    tier: 2,
    mods: { bmepMult: 1.09, veHighMult: 1.05, veLowMult: 0.95 },
  },

  // --- rotating assembly ---------------------------------------------------
  { id: 'crank-stock', slot: 'crank', name: '原厂曲轴飞轮', desc: '出厂转动惯量。', drawback: '—', cost: 0, tier: 0, mods: {} },
  {
    id: 'crank-heavy',
    slot: 'crank',
    name: '加重飞轮',
    desc: '转动惯量 +35%，怠速极稳、几乎不会失速。',
    drawback: '升转迟钝，冲红线慢得多。',
    cost: 380,
    tier: 1,
    mods: { inertiaMult: 1.35 },
  },
  {
    id: 'crank-light',
    slot: 'crank',
    name: '轻量化飞轮',
    desc: '转动惯量 -30%，补油响应干脆。',
    drawback: '怠速容易掉速失速，收油也掉得快。',
    cost: 560,
    tier: 1,
    mods: { inertiaMult: 0.7 },
  },
  {
    id: 'crank-race',
    slot: 'crank',
    name: '赛用超轻曲轴组',
    desc: '转动惯量 -50%，转速像开关一样窜。',
    drawback: '怠速几乎无法自持，必须靠油门吊住。',
    cost: 1450,
    tier: 3,
    mods: { inertiaMult: 0.5 },
  },
  { id: 'rod-stock', slot: 'rod', name: '原厂连杆', desc: '铸造连杆。', drawback: '超转即断。', cost: 0, tier: 0, mods: {} },
  {
    id: 'rod-forged',
    slot: 'rod',
    name: '锻造连杆',
    desc: '机械崩溃转速 +12%，超转容错更高。',
    drawback: '略重。',
    cost: 680,
    tier: 2,
    mods: { destructMult: 1.12, inertiaMult: 1.02 },
  },
  {
    id: 'rod-ti',
    slot: 'rod',
    name: '钛合金连杆',
    desc: '机械崩溃转速 +28%，同时更轻。',
    drawback: '贵得离谱。',
    cost: 2100,
    tier: 4,
    mods: { destructMult: 1.28, inertiaMult: 0.95 },
  },

  // --- ignition ------------------------------------------------------------
  { id: 'ign-stock', slot: 'ignition', name: '原厂点火线圈', desc: '标准点火能量。', drawback: '稀薄时容易缺火。', cost: 0, tier: 0, mods: {} },
  {
    id: 'ign-coil',
    slot: 'ignition',
    name: '强化点火线圈',
    desc: '点火能量提升，稀薄与高压下更不容易缺火。',
    drawback: '火花塞损耗略快。',
    cost: 240,
    tier: 1,
    mods: { sparkEnergy: 0.35 },
  },
  {
    id: 'ign-cdi',
    slot: 'ignition',
    name: 'CDI 电容放电点火',
    desc: '强火花 + 更快燃烧，抗爆震略有改善。',
    drawback: '无。',
    cost: 660,
    tier: 2,
    mods: { sparkEnergy: 0.7, knockResistance: 0.05 },
  },

  // --- cooling / oil -------------------------------------------------------
  { id: 'cool-stock', slot: 'cooling', name: '原厂散热器', desc: '够用的街车散热。', drawback: '持续高转会热。', cost: 0, tier: 0, mods: {} },
  {
    id: 'cool-rad',
    slot: 'cooling',
    name: '加大铝制散热器',
    desc: '散热能力 +35%。',
    drawback: '暖机更慢。',
    cost: 300,
    tier: 1,
    mods: { coolingMult: 1.35, thermalMassMult: 1.05 },
  },
  {
    id: 'cool-oilcooler',
    slot: 'cooling',
    name: '机油冷却器',
    desc: '散热 +20%，热容更大，缸温更稳因此更抗爆震。',
    drawback: '冷车需要更久才进入工作温度。',
    cost: 560,
    tier: 2,
    mods: { coolingMult: 1.2, thermalMassMult: 1.18, knockResistance: 0.08 },
  },
  {
    id: 'cool-race',
    slot: 'cooling',
    name: '赛用双芯散热总成',
    desc: '散热 +75%，长时间高负载也压得住。',
    drawback: '很贵，且冷车阶段动力偏弱。',
    cost: 1350,
    tier: 3,
    mods: { coolingMult: 1.75, thermalMassMult: 1.12, knockResistance: 0.12 },
  },
  { id: 'oil-stock', slot: 'oil', name: '原厂油底壳', desc: '标准容量。', drawback: '低油位很快见底。', cost: 0, tier: 0, mods: {} },
  {
    id: 'oil-sump',
    slot: 'oil',
    name: '加深油底壳',
    desc: '机油容量 +40%，低油位下的油压更稳。',
    drawback: '略重。',
    cost: 300,
    tier: 1,
    mods: { oilCapacityMult: 1.4 },
  },
  {
    id: 'oil-drysump',
    slot: 'oil',
    name: '干式油底壳',
    desc: '机油容量 +90%，同时降低搅油损失。',
    drawback: '结构复杂、价格高。',
    cost: 1050,
    tier: 3,
    mods: { oilCapacityMult: 1.9, frictionMult: 0.95 },
  },

  // --- ECU: unlocks tuning resolution --------------------------------------
  {
    id: 'ecu-stock',
    slot: 'ecu',
    name: '原厂 ECU（固定值）',
    desc: '点火角与空燃比只能整条曲线一起调。',
    drawback: '无法针对转速段单独优化。',
    cost: 0,
    tier: 0,
    mods: { ecuTier: 0 },
  },
  {
    id: 'ecu-tuner',
    slot: 'ecu',
    name: '可编程 ECU（三段）',
    desc: '低 / 中 / 高三个转速区间可以分别标定。',
    drawback: '过渡段仍然是插值，不够精细。',
    cost: 480,
    tier: 1,
    mods: { ecuTier: 1 },
  },
  {
    id: 'ecu-standalone',
    slot: 'ecu',
    name: '独立 ECU（全图）',
    desc: '七个转速断点全部可调，真正意义上的标定自由。',
    drawback: '调坏了也全是你自己的责任。',
    cost: 1350,
    tier: 2,
    mods: { ecuTier: 2 },
  },

  // --- forced induction ----------------------------------------------------
  { id: 'boost-none', slot: 'boost', name: '自然吸气', desc: '没有增压器。', drawback: '—', cost: 0, tier: 0, mods: {} },
  {
    id: 'boost-super',
    slot: 'boost',
    name: '机械增压器 0.42 bar',
    desc: '全转速域线性增压，低转就有推背，扭矩约 +34%。',
    drawback: '增压本身吃掉约 9° 抗爆震余量，还增加转动惯量。',
    cost: 1900,
    tier: 4,
    mods: { boostBar: 0.42, inertiaMult: 1.08, thermalMassMult: 0.96 },
  },
  {
    id: 'boost-turbo',
    slot: 'boost',
    name: '涡轮增压器 0.55 bar',
    desc: '扭矩约 +44%，高转爆发力惊人。',
    drawback: '进气被排气加热，吃掉约 14° 抗爆震余量 —— 必须配低压缩活塞。',
    cost: 2600,
    tier: 4,
    mods: { boostBar: 0.55, knockResistance: -0.08, coolingMult: 0.9 },
  },
];

export function getPart(id: string): Part | undefined {
  return PARTS.find((p) => p.id === id);
}

/** The zero-cost part occupying a slot when the player has bought nothing. */
export function stockPartFor(slot: PartSlot): Part {
  const stock = PARTS.find((p) => p.slot === slot && p.cost === 0);
  if (!stock) throw new Error(`no stock part defined for slot ${slot}`);
  return stock;
}

export function partsInSlot(slot: PartSlot, blockId: string): Part[] {
  return PARTS.filter((p) => p.slot === slot && (!p.blocks || p.blocks.includes(blockId)));
}

/** Every id the player owns for free at the very start of a career. */
export function starterOwned(): string[] {
  return [STARTER_BLOCK.id, ...PARTS.filter((p) => p.cost === 0).map((p) => p.id)];
}

export function defaultBuild(): EngineBuild {
  const installed: Partial<Record<PartSlot, string>> = {};
  for (const slot of PART_SLOTS) installed[slot] = stockPartFor(slot).id;
  return { blockId: STARTER_BLOCK.id, installed };
}

// ---------------------------------------------------------------------------
// Resolution
// ---------------------------------------------------------------------------

/** Displacement of a single cylinder in cc. */
export function displacementCc(spec: { bore: number; stroke: number }): number {
  return (Math.PI * Math.pow(spec.bore / 2, 2) * spec.stroke) / 1000;
}

/**
 * Otto-cycle thermal efficiency of a compression ratio, normalised so the
 * reference CR returns exactly 1.
 */
export function compressionEfficiencyFactor(cr: number): number {
  const eta = 1 - Math.pow(cr, -CR_EFFICIENCY_EXP);
  const reference = 1 - Math.pow(REFERENCE_CR, -CR_EFFICIENCY_EXP);
  return eta / reference;
}

/** Peak brake torque (Nm) implied by a BMEP and a displacement. */
export function torqueFromBmep(bmepBar: number, displacementCubicCm: number): number {
  return (bmepBar * 1e5 * (displacementCubicCm / 1e6)) / (4 * Math.PI);
}

function resolvePartsOf(build: EngineBuild): Part[] {
  return PART_SLOTS.map((slot) => {
    const id = build.installed[slot];
    return (id ? getPart(id) : undefined) ?? stockPartFor(slot);
  });
}

/** Sum/product-accumulate every installed part's modifiers. */
function accumulate(parts: Part[]): Required<Omit<PartMods, 'compressionRatio'>> & { compressionRatio?: number } {
  const acc = {
    boreDelta: 0,
    strokeDelta: 0,
    inertiaMult: 1,
    redlineMult: 1,
    destructMult: 1,
    bmepMult: 1,
    torquePeakShift: 0,
    veLowMult: 1,
    veHighMult: 1,
    thermalMassMult: 1,
    coolingMult: 1,
    knockResistance: 0,
    frictionMult: 1,
    sparkEnergy: 0,
    oilCapacityMult: 1,
    boostBar: 0,
    ecuTier: 0,
    compressionRatio: undefined as number | undefined,
  };

  for (const part of parts) {
    const m = part.mods;
    acc.boreDelta += m.boreDelta ?? 0;
    acc.strokeDelta += m.strokeDelta ?? 0;
    acc.inertiaMult *= m.inertiaMult ?? 1;
    acc.redlineMult *= m.redlineMult ?? 1;
    acc.destructMult *= m.destructMult ?? 1;
    acc.bmepMult *= m.bmepMult ?? 1;
    acc.torquePeakShift += m.torquePeakShift ?? 0;
    acc.veLowMult *= m.veLowMult ?? 1;
    acc.veHighMult *= m.veHighMult ?? 1;
    acc.thermalMassMult *= m.thermalMassMult ?? 1;
    acc.coolingMult *= m.coolingMult ?? 1;
    acc.knockResistance += m.knockResistance ?? 0;
    acc.frictionMult *= m.frictionMult ?? 1;
    acc.sparkEnergy += m.sparkEnergy ?? 0;
    acc.oilCapacityMult *= m.oilCapacityMult ?? 1;
    acc.boostBar += m.boostBar ?? 0;
    acc.ecuTier = Math.max(acc.ecuTier, m.ecuTier ?? 0);
    if (m.compressionRatio !== undefined) acc.compressionRatio = m.compressionRatio;
  }

  return acc;
}

/**
 * Turn a build into the {@link EngineSpec} the physics consumes.
 *
 * Peak torque comes from BMEP × displacement rather than a magic number, so a
 * bore kit, a higher compression ratio and a turbo all raise it for the right
 * physical reason and compound the way you would expect.
 */
export function resolveBuild(build: EngineBuild): EngineSpec {
  const block = getBlock(build.blockId);
  const parts = resolvePartsOf(build);
  const mods = accumulate(parts);

  const bore = block.bore + mods.boreDelta;
  const stroke = block.stroke + mods.strokeDelta;
  const compressionRatio = mods.compressionRatio ?? block.baseCompression;
  const cc = displacementCc({ bore, stroke });

  // Forced induction stuffs more charge in: treat the pressure ratio as a
  // near-linear BMEP gain, discounted for charge heating and drive losses.
  const boostGain = 1 + mods.boostBar * 0.8;
  const bmepBar =
    BASE_BMEP_BAR * compressionEfficiencyFactor(compressionRatio) * block.baseBmepMult * mods.bmepMult * boostGain;

  const redlineRpm = Math.round(block.baseRedline * mods.redlineMult);
  // A rod package can never be so weak that the engine grenades below redline.
  const destructRpm = Math.max(redlineRpm + 400, Math.round(block.baseDestruct * mods.destructMult));

  const notable = parts.filter((p) => p.cost > 0);
  const description =
    notable.length === 0
      ? `${block.desc}（全原厂状态）`
      : `${block.desc} 已加装：${notable.map((p) => p.name).join(' · ')}`;

  return {
    id: `${block.id}:${PART_SLOTS.map((s) => build.installed[s] ?? '').join(',')}`,
    name: block.name,
    bore,
    stroke,
    compressionRatio,
    rotatingInertia: block.baseInertia * mods.inertiaMult,
    redlineRpm,
    destructRpm,
    peakTorque: torqueFromBmep(bmepBar, cc),
    torquePeakRpm: Math.max(1800, block.baseTorquePeakRpm + mods.torquePeakShift),
    thermalMass: block.baseThermalMass * mods.thermalMassMult,
    idleRpm: block.idleRpm,
    description,
    coolingFactor: mods.coolingMult,
    knockResistance: mods.knockResistance,
    frictionMult: mods.frictionMult,
    veLowMult: mods.veLowMult,
    veHighMult: mods.veHighMult,
    sparkEnergy: mods.sparkEnergy,
    oilCapacity: mods.oilCapacityMult,
    boostBar: mods.boostBar,
    ecuTier: mods.ecuTier,
  };
}

/** Total credits sunk into a build (block + non-stock parts). */
export function buildValue(build: EngineBuild): number {
  const block = getBlock(build.blockId);
  return resolvePartsOf(build).reduce((sum, p) => sum + p.cost, block.cost);
}

/**
 * Parts a catastrophic failure destroys. A grenaded engine takes the rotating
 * assembly with it, which is what makes over-revving genuinely expensive.
 */
export const BLAST_DAMAGE_SLOTS: PartSlot[] = ['piston', 'rod', 'crank'];

/**
 * Components that come back to full health when a slot is re-fitted — you can't
 * install a new camshaft without also fitting fresh valves. Cylinder bores are
 * absent on purpose: only a full rebuild or a new block restores those.
 */
export const SLOT_REFRESHES: Partial<Record<PartSlot, (keyof ComponentWear)[]>> = {
  piston: ['pistonRings'],
  cam: ['valves'],
  head: ['valves'],
  crank: ['crankshaftJournal'],
  rod: ['conrodBearings'],
  ignition: ['sparkPlug'],
};
