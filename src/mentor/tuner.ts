/**
 * The calibration 老周 does on the dyno: hold speed at full throttle, walk
 * the spark until torque stops rising or the engine starts to knock, then
 * find the richest mixture that still makes best power.
 *
 * It only talks to a {@link TunerPort}, so the same procedure runs against
 * the live bench and against a headless solver in tests.
 */

import type { EcuConfig } from '../sim/config';

export interface Sample {
  /** Mean absorber torque, Nm. */
  torque: number;
  /** Worst knock intensity seen. */
  knock: number;
  /** Cycles averaged. */
  cycles: number;
}

export interface TunerPort {
  ecu(): EcuConfig;
  setEcu(patch: Partial<EcuConfig>): void;
  /** Full throttle with the brake holding `rpm`. */
  hold(rpm: number): void;
  /** Wait `settle` seconds, then average over `window` seconds. */
  measure(settle: number, window: number): Promise<Sample>;
  /** True once the user stopped it or the engine is no longer running. */
  stopped(): boolean;
}

export type Say = (text: string) => void;

/** Knock the piston shrugs off; trace knock at the limit is normal. */
export const KNOCK_OK = 0.08;
const STEP = 2;
const MAX_STEPS = 6;
/** Torque differences smaller than this are measurement noise. */
const NOISE = 0.004;

export class Stopped extends Error {}

const nm = (v: number): string => `${v.toFixed(1)} Nm`;

/** Two hold points: around peak torque, and high in the range. */
export function tunePoints(ecu: EcuConfig, limiter = ecu.limiterRpm): [number, number] {
  const lo = Math.max(ecu.idleRpm + 1000, 2500);
  const hi = limiter - 400;
  const r = (v: number): number => Math.round(v / 100) * 100;
  return [r(lo + (hi - lo) * 0.4), r(lo + (hi - lo) * 0.85)];
}

interface Point {
  offset: number;
  torque: number;
  knock: number;
}

async function score(port: TunerPort, points: [number, number], offset: number, flip: boolean): Promise<Point> {
  port.setEcu({ advanceOffset: offset });
  let torque = 0;
  let knock = 0;
  const order = flip ? [points[1], points[0]] : points;
  for (const [i, rpm] of order.entries()) {
    port.hold(rpm);
    const s = await port.measure(i === 0 ? 0.35 : 0.7, 0.45);
    if (port.stopped()) throw new Stopped();
    torque += s.torque;
    knock = Math.max(knock, s.knock);
  }
  return { offset, torque: torque / 2, knock };
}

export interface SparkResult {
  from: number;
  to: number;
  before: number;
  after: number;
  knockLimited: boolean;
}

/**
 * Hill-climb the spark offset on the mean torque of two hold points, with
 * the knock sensor ignored so the real limit shows; back off 1° from it.
 */
export async function tuneSpark(port: TunerPort, say: Say): Promise<SparkResult> {
  const start = port.ecu();
  const points = tunePoints(start);
  port.setEcu({ knockControl: false });
  try {
    port.hold(points[0]);
    await port.measure(1, 0);
    if (port.stopped()) throw new Stopped();

    let flip = false;
    const at = async (offset: number): Promise<Point> => {
      const p = await score(port, points, offset, flip);
      flip = !flip;
      return p;
    };
    const base = await at(start.advanceOffset);
    say(`起点：点火修正 ${fmt(base.offset)}，两个转速平均 ${nm(base.torque)}${base.knock > KNOCK_OK ? '，已经在爆震' : ''}。`);

    let best = base.knock > KNOCK_OK ? null : base;
    let knockAt: number | null = base.knock > KNOCK_OK ? base.offset : null;

    // Already knocking: walk back until it is clean.
    let o = base.offset;
    while (knockAt !== null && best === null && o > -20) {
      o = Math.max(-20, o - STEP);
      const p = await at(o);
      say(`退到 ${fmt(o)}：${nm(p.torque)}${p.knock > KNOCK_OK ? '，还在爆' : '，干净了'}。`);
      if (p.knock <= KNOCK_OK) best = p;
      else knockAt = o;
    }
    if (!best) return { from: start.advanceOffset, to: o, before: base.torque, after: base.torque, knockLimited: true };

    // Try more advance, unless we already know where knock starts.
    if (knockAt === null) {
      let prev = best;
      for (let i = 0; i < MAX_STEPS && prev.offset < 20; i++) {
        const p = await at(Math.min(20, prev.offset + STEP));
        if (p.knock > KNOCK_OK) {
          say(`加到 ${fmt(p.offset)} 开始爆震（${Math.round(p.knock * 100)}%），这就是边界。`);
          knockAt = p.offset;
          break;
        }
        const gain = p.torque / prev.torque - 1;
        say(`加到 ${fmt(p.offset)}：${nm(p.torque)}，${gain > NOISE ? '还在涨' : gain < -NOISE ? '开始掉了' : '基本不动'}。`);
        if (p.torque > best.torque) best = p;
        if (gain <= NOISE) break;
        prev = p;
      }
    }

    // Nothing gained going up: maybe it was over-advanced.
    if (best.offset === base.offset && knockAt === null) {
      let prev = best;
      for (let i = 0; i < MAX_STEPS && prev.offset > -20; i++) {
        const p = await at(Math.max(-20, prev.offset - STEP));
        const gain = p.torque / prev.torque - 1;
        say(`退到 ${fmt(p.offset)}：${nm(p.torque)}，${gain > NOISE ? '反而涨了' : '在掉'}。`);
        if (p.torque > best.torque && p.knock <= KNOCK_OK) best = p;
        if (gain <= NOISE) break;
        prev = p;
      }
    }

    let to = best.offset;
    if (knockAt !== null && to > knockAt - STEP) to = knockAt - STEP;
    // A step's worth of torque is not worth sitting right on the knock line.
    if (knockAt !== null && to === knockAt - STEP) to = Math.max(-20, to - 1);
    port.setEcu({ advanceOffset: to });
    return { from: start.advanceOffset, to, before: base.torque, after: best.torque, knockLimited: knockAt !== null };
  } finally {
    port.setEcu({ knockControl: start.knockControl });
  }
}

export interface LambdaResult {
  from: number;
  to: number;
}

/** Richest WOT mixture within noise of best torque: same power, cooler charge. */
export async function tuneLambda(port: TunerPort, say: Say): Promise<LambdaResult> {
  const start = port.ecu();
  const [rpm] = tunePoints(start);
  port.hold(rpm);
  const candidates = [0.82, 0.86, 0.9, 0.94];
  const results: { lambda: number; torque: number; knock: number }[] = [];
  for (const lambda of candidates) {
    port.setEcu({ wotLambda: lambda });
    const s = await port.measure(0.5, 0.5);
    if (port.stopped()) {
      port.setEcu({ wotLambda: start.wotLambda });
      throw new Stopped();
    }
    results.push({ lambda, torque: s.torque, knock: s.knock });
    say(`全油门 λ ${lambda.toFixed(2)}：${nm(s.torque)}${s.knock > KNOCK_OK ? '，爆震' : ''}。`);
  }
  const clean = results.filter((r) => r.knock <= KNOCK_OK);
  const pool = clean.length > 0 ? clean : results;
  const top = Math.max(...pool.map((r) => r.torque));
  const to = pool.filter((r) => r.torque >= top * (1 - 2 * NOISE)).sort((a, b) => a.lambda - b.lambda)[0]!.lambda;
  port.setEcu({ wotLambda: to });
  return { from: start.wotLambda, to };
}

function fmt(offset: number): string {
  return `${offset > 0 ? '+' : ''}${offset}°`;
}
