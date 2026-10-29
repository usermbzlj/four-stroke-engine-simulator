/**
 * Reading a build sheet the way someone who has broken a few engines would.
 * Everything is derived from the same formulas the solver uses, so a warning
 * here is a prediction, not a guess.
 */

import {
  meanPistonSpeed,
  overlapDeg,
  rodBreakRpm,
  valveFloatRpm,
  type BenchConfig,
  type EcuConfig,
  type EngineConfig,
  type EnginePreset,
} from '../sim/config';
import type { Failure } from '../sim/core';

export type IssueLevel = 'info' | 'warn' | 'danger';

/** A change the mentor can apply with one click. Never touches block parts, so it works with the engine running. */
export interface Fix {
  label: string;
  config?: Partial<EngineConfig>;
  ecu?: Partial<EcuConfig>;
  bench?: Partial<BenchConfig>;
}

export interface Issue {
  id: string;
  level: IssueLevel;
  text: string;
  fixes: Fix[];
}

/** Force ratio above which every rev adds rod fatigue, expressed as a speed ratio. */
export const ROD_FATIGUE_SPEED = Math.sqrt(0.8);
/** Margin kept under fatigue onset and valve float when picking a limiter. */
const ROD_MARGIN = 0.98;
const FLOAT_MARGIN = 0.97;

const down100 = (v: number): number => Math.floor(v / 100) * 100;
const up = (v: number, step: number): number => Math.ceil(v / step) * step;
const fmt = (rpm: number): string => Math.round(rpm).toLocaleString('en-US');

/** Highest limiter that neither floats the valves nor tires the rod. */
export function safeLimiter(c: EngineConfig): number {
  return down100(Math.min(valveFloatRpm(c) * FLOAT_MARGIN, rodBreakRpm(c) * ROD_FATIGUE_SPEED * ROD_MARGIN));
}

/** Seconds a fresh rod survives held at `rpm`, from the solver's fatigue law. */
export function rodLifeAt(c: EngineConfig, rpm: number): number {
  const ratio = Math.pow(rpm / rodBreakRpm(c), 2);
  if (ratio <= 0.8) return Infinity;
  const perCycle = Math.pow((ratio - 0.8) / 0.2, 3) * 0.003;
  return 1 / (perCycle * (rpm / 120));
}

/** Spring force that keeps the valves seated up to `rpm`. Float speed goes with √force. */
export function springFor(c: EngineConfig, rpm: number): number {
  return up(c.valveSpringForce * Math.pow(rpm / valveFloatRpm(c), 2), 10);
}

/** Rod strength that keeps `rpm` under fatigue onset. Break speed goes with √strength. */
export function rodStrengthFor(c: EngineConfig, rpm: number): number {
  return up(c.rodStrength * Math.pow(rpm / (rodBreakRpm(c) * ROD_FATIGUE_SPEED * ROD_MARGIN), 2), 100);
}

function limiterFixes(c: EngineConfig, e: EcuConfig, kind: 'rod' | 'float'): Fix[] {
  const fixes: Fix[] = [{ label: `断火降到 ${fmt(safeLimiter(c))}`, ecu: { limiterRpm: safeLimiter(c) } }];
  if (kind === 'float') {
    const f = springFor(c, e.limiterRpm * 1.04);
    if (f <= 1500) fixes.push({ label: `弹簧加到 ${f} N`, config: { valveSpringForce: f } });
  } else {
    const s = rodStrengthFor(c, e.limiterRpm * 1.03);
    if (s <= 26000) fixes.push({ label: `连杆换 ${(s / 1000).toFixed(1)} kN 的`, config: { rodStrength: s } });
  }
  return fixes;
}

export function assessBuild(c: EngineConfig, e: EcuConfig, b: BenchConfig, base: EnginePreset): Issue[] {
  const out: Issue[] = [];
  const lim = e.limiterRpm;

  const rodBreak = rodBreakRpm(c);
  const fatigue = rodBreak * ROD_FATIGUE_SPEED;
  if (lim >= rodBreak * 0.98) {
    out.push({
      id: 'rod-break',
      level: 'danger',
      text: `断火转速 ${fmt(lim)} 已经碰到连杆的拉断线 ${fmt(rodBreak)}。转到那一圈，连杆会被活塞直接拽断，没有预兆，也没有第二次机会。`,
      fixes: limiterFixes(c, e, 'rod'),
    });
  } else if (lim > fatigue) {
    const life = rodLifeAt(c, lim);
    out.push({
      id: 'rod-fatigue',
      level: life < 15 ? 'warn' : 'info',
      text: `断火转速高过连杆的疲劳线（约 ${fmt(fatigue)} rpm）。不会马上断，但每一圈都在记账：一直顶着断火，大约 ${Math.round(life)} 秒账就满了。`,
      fixes: limiterFixes(c, e, 'rod'),
    });
  }

  const float = valveFloatRpm(c);
  if (lim > float * 1.12) {
    out.push({
      id: 'float-crash',
      level: 'danger',
      text: `断火转速比气门飘浮转速 ${fmt(float)} 高出 ${Math.round((lim / float - 1) * 100)}%。转过去气门关不回来，会被活塞顶弯。`,
      fixes: limiterFixes(c, e, 'float'),
    });
  } else if (lim > float) {
    out.push({
      id: 'float',
      level: 'warn',
      text: `气门在 ${fmt(float)} rpm 就开始飘浮，比断火转速低。高转会掉劲，再往上就是气门撞活塞。`,
      fixes: limiterFixes(c, e, 'float'),
    });
  }

  const sp = meanPistonSpeed(c, lim);
  if (sp > 25) {
    out.push({
      id: 'piston-speed',
      level: 'info',
      text: `断火时活塞均速 ${sp.toFixed(1)} m/s，已经是赛车的地盘了。缸壁和活塞环都在加班。`,
      fixes: [],
    });
  }

  if (e.wotLambda > 1.0) {
    out.push({
      id: 'wot-lean',
      level: 'warn',
      text: `全油门 λ ${e.wotLambda.toFixed(2)} 偏稀：烧得慢、排温高、更容易爆震，扭矩还更少。全油门要稍浓。`,
      fixes: [{ label: '全油门 λ 改回 0.88', ecu: { wotLambda: 0.88 } }],
    });
  } else if (e.wotLambda < 0.8) {
    out.push({
      id: 'wot-rich',
      level: 'info',
      text: `全油门 λ ${e.wotLambda.toFixed(2)} 浓过头了。多出来的油没地方烧，扭矩往下掉，排气管冒黑烟。`,
      fixes: [{ label: '全油门 λ 改回 0.88', ecu: { wotLambda: 0.88 } }],
    });
  }
  if (e.cruiseLambda > 1.25) {
    out.push({
      id: 'cruise-lean',
      level: 'warn',
      text: `部分负荷 λ ${e.cruiseLambda.toFixed(2)}，稀到点不着了，会一阵一阵地失火。`,
      fixes: [{ label: '部分负荷 λ 改回 1.00', ecu: { cruiseLambda: 1 } }],
    });
  } else if (e.cruiseLambda < 0.85) {
    out.push({
      id: 'cruise-rich',
      level: 'info',
      text: `部分负荷 λ ${e.cruiseLambda.toFixed(2)}，平时也这么浓，纯属浪费油。`,
      fixes: [{ label: '部分负荷 λ 改回 1.00', ecu: { cruiseLambda: 1 } }],
    });
  }

  const knockLean =
    c.compressionRatio - base.engine.compressionRatio +
    (e.advanceOffset - base.ecu.advanceOffset) * 0.25 -
    (c.fuelOctane - base.engine.fuelOctane) * 0.4;
  if (knockLean > 1 && !e.knockControl) {
    out.push({
      id: 'knock-hot',
      level: 'warn',
      text: '压缩比、点火角、油号这三样加起来比出厂激进，而爆震控制是关的。全油门一上去就会爆震，活塞撑不了多久。',
      fixes: [
        { label: '打开爆震控制', ecu: { knockControl: true } },
        ...(c.fuelOctane < 102 ? [{ label: `换 ${Math.min(102, c.fuelOctane + 3)} 号油`, config: { fuelOctane: Math.min(102, c.fuelOctane + 3) } }] : []),
      ],
    });
  } else if (knockLean > 1.5) {
    out.push({
      id: 'knock-busy',
      level: 'info',
      text: '这套压缩比、点火角和油号比出厂激进。爆震控制会一直忙着退角，你以为加了劲，其实被它悄悄收回去了。',
      fixes: c.fuelOctane < 102 ? [{ label: `换 ${Math.min(102, c.fuelOctane + 3)} 号油`, config: { fuelOctane: Math.min(102, c.fuelOctane + 3) } }] : [],
    });
  } else if (!e.knockControl) {
    out.push({
      id: 'knock-off',
      level: 'info',
      text: '爆震控制关了，保险丝已经拔掉。想找爆震边界可以，但要盯着活塞损伤。',
      fixes: [{ label: '打开爆震控制', ecu: { knockControl: true } }],
    });
  }

  const overlap = overlapDeg(c);
  if (e.idleRpm < 1300 && (c.flywheelInertia < 0.015 || overlap > 55)) {
    out.push({
      id: 'idle-stall',
      level: 'warn',
      text: `${c.flywheelInertia < 0.015 ? '飞轮这么轻' : `重叠角 ${overlap.toFixed(0)}°`}，怠速还压在 ${fmt(e.idleRpm)}，一松油门它多半要熄火。`,
      fixes: [{ label: '怠速提到 1,600', ecu: { idleRpm: 1600 } }],
    });
  } else if (overlap > 65) {
    out.push({
      id: 'overlap',
      level: 'info',
      text: `重叠角 ${overlap.toFixed(0)}°，怠速会像打摆子。高转倒是会很凶。`,
      fixes: [],
    });
  }

  if (lim < e.idleRpm + 1500) {
    const to = Math.min(safeLimiter(c), e.idleRpm + 4000);
    out.push({
      id: 'limiter-low',
      level: 'warn',
      text: `断火转速 ${fmt(lim)} 离怠速 ${fmt(e.idleRpm)} 太近，一给油就撞断火。`,
      fixes: to > lim ? [{ label: `断火提到 ${fmt(to)}`, ecu: { limiterRpm: to } }] : [],
    });
  }

  if (!b.coolantConditioner && c.radiatorCapacity < 1) {
    out.push({
      id: 'cooling',
      level: 'warn',
      text: `水温机断开，散热器又只有原厂的 ${Math.round(c.radiatorCapacity * 100)}%。长时间大负荷，水温会一路往缸垫的极限爬。`,
      fixes: [
        { label: '接上水温机', bench: { coolantConditioner: true } },
        { label: '散热器换 1.4×', config: { radiatorCapacity: 1.4 } },
      ],
    });
  }

  return out;
}

export interface Review {
  /** What actually happened, in plain words. */
  cause: string;
  fixes: Fix[];
}

/** Teardown: why it broke and what to change before the next one. */
export function reviewFailure(f: Failure, c: EngineConfig, e: EcuConfig, b: BenchConfig): Review {
  switch (f.kind) {
    case 'piston': {
      const fixes: Fix[] = [{ label: '点火角退 4°', ecu: { advanceOffset: Math.max(-20, e.advanceOffset - 4) } }];
      if (!e.knockControl) fixes.unshift({ label: '打开爆震控制', ecu: { knockControl: true } });
      if (c.fuelOctane < 102) fixes.push({ label: `换 ${Math.min(102, c.fuelOctane + 3)} 号油`, config: { fuelOctane: Math.min(102, c.fuelOctane + 3) } });
      if (e.wotLambda > 0.9) fixes.push({ label: '全油门 λ 加浓到 0.86', ecu: { wotLambda: 0.86 } });
      return {
        cause: `末端混合气在火焰到达之前自己炸了，压力波一下一下砸在活塞顶上。${e.knockControl ? '爆震控制开着都没压住，说明点火角、压缩比和油号的组合太激进。' : '爆震控制是关的，没人替它退角。'}`,
        fixes,
      };
    }
    case 'rod':
      return {
        cause: `连杆是在排气上止点被拉断的：那一刻没有燃烧压力顶着，活塞组全靠连杆往回拽。拽力和转速的平方成正比，${fmt(f.rpm)} rpm 时超过了它的极限。`,
        fixes: limiterFixes(c, { ...e, limiterRpm: Math.max(e.limiterRpm, f.rpm) }, 'rod'),
      };
    case 'valve':
      return {
        cause: `转速超过了气门飘浮转速 ${fmt(valveFloatRpm(c))}，弹簧压不住，气门在重叠上止点没关回去，被上来的活塞顶弯。`,
        fixes: limiterFixes(c, { ...e, limiterRpm: Math.max(e.limiterRpm, f.rpm) }, 'float'),
      };
    case 'headGasket':
      return {
        cause: '水温冲过 135 °C，缸盖受热变形，燃烧气体从缸垫窜进了水道。',
        fixes: [
          ...(b.coolantConditioner ? [] : [{ label: '接上水温机', bench: { coolantConditioner: true } } as Fix]),
          { label: `散热器换 ${Math.min(2, c.radiatorCapacity + 0.5).toFixed(1)}×`, config: { radiatorCapacity: Math.min(2, c.radiatorCapacity + 0.5) } },
        ],
      };
  }
}
