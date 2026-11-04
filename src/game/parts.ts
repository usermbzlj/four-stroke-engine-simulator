/**
 * The build sheet as a parts catalogue. Every config key belongs to exactly
 * one part; touching any of its keys means buying that part. Going back to
 * the original value hands the part back for free.
 */

import type { EngineConfig } from '../sim/config';

export type PartId =
  | 'intake'
  | 'throttle'
  | 'header'
  | 'muffler'
  | 'cam'
  | 'springs'
  | 'flywheel'
  | 'piston'
  | 'rod'
  | 'head'
  | 'bore'
  | 'crank'
  | 'radiator'
  | 'fuel'
  | 'airbox'
  | 'injector'
  | 'vvt'
  | 'turbo'
  | 'intercooler';

export interface Part {
  id: PartId;
  name: string;
  price: number;
  keys: (keyof EngineConfig)[];
  /** One line on what the part is for. */
  pitch: string;
  /** Needs the engine stopped to fit. */
  block?: boolean;
}

export const PARTS: Part[] = [
  {
    id: 'intake',
    name: '进气道',
    price: 350,
    keys: ['intakeRunnerLength', 'intakeRunnerDiameter'],
    pitch: '管里的气柱有惯性。长管把扭矩峰推向低转，短管推向高转。',
  },
  {
    id: 'throttle',
    name: '节气门体',
    price: 450,
    keys: ['throttleDiameter'],
    pitch: '全油门时的最后一道门。太小会在高转卡脖子，太大低转油门很冲。',
  },
  {
    id: 'header',
    name: '排气头段',
    price: 600,
    keys: ['exhaustHeaderLength', 'exhaustHeaderDiameter'],
    pitch: '排气压力波来回一趟的时间决定它在哪个转速帮你把废气抽干净。',
  },
  {
    id: 'muffler',
    name: '消音器',
    price: 400,
    keys: ['muffler'],
    pitch: '背压越小越有劲，也越吵。',
  },
  {
    id: 'cam',
    name: '凸轮轴',
    price: 800,
    keys: ['intakeDuration', 'exhaustDuration', 'intakeLift', 'exhaustLift', 'lobeSeparation', 'intakeCenterline'],
    pitch: '气门开多久、开多大、什么时候开。最直接决定发动机在哪个转速“醒”。',
  },
  {
    id: 'springs',
    name: '气门弹簧',
    price: 250,
    keys: ['valveSpringForce'],
    pitch: '弹簧不够硬，高转时气门跟不上凸轮，开始飘浮，严重时撞活塞。',
  },
  {
    id: 'flywheel',
    name: '飞轮',
    price: 500,
    keys: ['flywheelInertia'],
    pitch: '轻飞轮升速快、油门跟脚，但怠速更难稳住。',
  },
  {
    id: 'piston',
    name: '活塞',
    price: 700,
    keys: ['compressionRatio', 'reciprocatingMass'],
    pitch: '定压缩比，也决定往复质量。高压缩更有劲也更怕爆震；轻活塞让连杆轻松。',
    block: true,
  },
  {
    id: 'rod',
    name: '连杆',
    price: 900,
    keys: ['rodLength', 'rodStrength'],
    pitch: '锻造连杆更结实，能顶更高的转速。',
    block: true,
  },
  {
    id: 'head',
    name: '缸头（气门）',
    price: 2200,
    keys: ['intakeValves', 'exhaustValves', 'intakeValveDiameter', 'exhaustValveDiameter'],
    pitch: '气门越大越多，高转越能喘气。贵，但赛机都换。',
  },
  {
    id: 'bore',
    name: '大缸套件',
    price: 1800,
    keys: ['bore'],
    pitch: '加大缸径，排量直接上去。',
    block: true,
  },
  {
    id: 'crank',
    name: '曲轴（行程）',
    price: 2400,
    keys: ['stroke'],
    pitch: '长行程扭矩厚、转不高；短行程转得高、低转虚。',
    block: true,
  },
  {
    id: 'radiator',
    name: '散热器',
    price: 500,
    keys: ['radiatorCapacity'],
    pitch: '没有台架水温机的时候，全靠它。',
  },
  {
    id: 'airbox',
    name: '稳压腔',
    price: 300,
    keys: ['plenumVolume'],
    pitch: '单缸一个循环只吸一口，稳压腔就是那口气的蓄水池。大了扭矩稳，油门变钝。',
  },
  {
    id: 'injector',
    name: '喷油嘴',
    price: 380,
    keys: ['injectorFlow'],
    pitch: '喷不够油，空燃比到高转、高增压就自己变稀。上涡轮几乎一定要换。',
  },
  {
    id: 'vvt',
    name: '可变气门正时',
    price: 1600,
    keys: ['vvtRange'],
    pitch: '进气凸轮装上相位器，ECU 按转速和负荷提前或推后。低转要扭矩、高转要功率，两头都要。',
  },
  {
    id: 'turbo',
    name: '涡轮增压',
    price: 3800,
    keys: ['turboSize'],
    pitch: '用排气的余热把空气压进去。动力能翻倍，也带来迟滞、爆震、高排温和更多的油。',
  },
  {
    id: 'intercooler',
    name: '中冷器',
    price: 1100,
    keys: ['intercooler'],
    pitch: '压过的空气很热。冷下来更密、更不爆。没有涡轮装它没用。',
  },
  {
    id: 'fuel',
    name: '燃油',
    price: 0,
    keys: ['fuelOctane'],
    pitch: '辛烷值越高越抗爆震。不算零件钱，但客户不一定买得到。',
  },
];

export const PART_OF: Record<keyof EngineConfig, Part> = Object.fromEntries(
  PARTS.flatMap((p) => p.keys.map((k) => [k, p])),
) as Record<keyof EngineConfig, Part>;

const same = (a: unknown, b: unknown): boolean =>
  typeof a === 'number' && typeof b === 'number' ? Math.abs(a - b) < 1e-6 : a === b;

export function partChanged(part: Part, from: EngineConfig, to: EngineConfig): boolean {
  return part.keys.some((k) => !same(from[k], to[k]));
}

export function changedParts(from: EngineConfig, to: EngineConfig): Part[] {
  return PARTS.filter((p) => partChanged(p, from, to));
}

export function buildCost(from: EngineConfig, to: EngineConfig): number {
  return changedParts(from, to).reduce((sum, p) => sum + p.price, 0);
}

export const money = (v: number): string => `¥${Math.round(v).toLocaleString('en-US')}`;
