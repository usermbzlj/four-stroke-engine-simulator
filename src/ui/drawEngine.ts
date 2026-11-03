import { liftFraction, valveEvents, type EngineConfig } from '../sim/config';
import type { CycleTrace } from '../sim/core';
import type { EngineSnapshot } from '../sim/snapshot';
import { HEAT, INK, INTAKE, KNOCK, STEEL, blackbody } from './palette';

/** Height of the tallest engine the build sheet allows, mm; sets the common scale. */
const SCENE_MM = 330;

const NUM = '"Barlow Condensed", "Barlow", sans-serif';
const TEXT = '"Barlow", "PingFang SC", "Microsoft YaHei", "Noto Sans SC", sans-serif';
const MUTED = 'rgba(232,226,214,0.58)';
const FAINT = 'rgba(232,226,214,0.35)';
const LINE = 'rgba(232,226,214,0.12)';
const FLOAT = '#b7a5ff';
const GOOD = '#8fd48a';

export interface EngineFrame {
  config: EngineConfig;
  /** Visual cycle angle, degrees from firing TDC. */
  deg: number;
  trace: CycleTrace | null;
  snapshot: EngineSnapshot | null;
  /** Wall-clock seconds, for flicker. */
  time: number;
  /** Positions of gas parcels along runner and header (signed, wraps). */
  intakeFlow: number;
  exhaustFlow: number;
  /** Name tags on the parts. */
  labels: boolean;
  /** 0-1, a recent exhaust pop. */
  pop: number;
  /** Real crank speed over picture speed; 0 when paused. */
  slow: number;
  paused: boolean;
}

// ---------------------------------------------------------------------------
// What a recorded cycle looks like as a whole
// ---------------------------------------------------------------------------

export interface TraceStats {
  pMax: number;
  pMaxDeg: number;
  ivMax: number;
  evMax: number;
  /** Cycle angles where 10% and 90% of the charge had burned, or -1. */
  burn10: number;
  burn90: number;
  /** Most negative intake flow (reversion), g/s, as a positive number. */
  reversion: number;
}

const statsCache = new WeakMap<CycleTrace, TraceStats>();

export function traceStats(t: CycleTrace): TraceStats {
  const hit = statsCache.get(t);
  if (hit) return hit;
  let pMax = 0;
  let pMaxDeg = 0;
  let ivMax = 1;
  let evMax = 1;
  let reversion = 0;
  let burn10 = -1;
  let burn90 = -1;
  for (let i = 0; i < t.pressure.length; i++) {
    const p = t.pressure[i]!;
    if (p > pMax) {
      pMax = p;
      pMaxDeg = i;
    }
    ivMax = Math.max(ivMax, Math.abs(t.ivFlow[i]!));
    evMax = Math.max(evMax, Math.abs(t.evFlow[i]!));
    reversion = Math.max(reversion, -t.ivFlow[i]!);
  }
  // Burn starts near the spark, before TDC (late in the array) and runs past it.
  const order = (i: number): number => (i + 360) % 720;
  for (let j = 0; j < 720; j++) {
    const i = (j + 360) % 720;
    const prev = t.burn[(i + 719) % 720]!;
    const b = t.burn[i]!;
    if (burn10 < 0 && prev < 0.1 && b >= 0.1) burn10 = i;
    if (burn90 < 0 && prev < 0.9 && b >= 0.9) burn90 = i;
  }
  if (burn10 >= 0 && burn90 >= 0 && order(burn90) < order(burn10)) burn90 = -1;
  const s = { pMax, pMaxDeg, ivMax, evMax, burn10, burn90, reversion };
  statsCache.set(t, s);
  return s;
}

/** Rod axial force at a cycle angle, N; positive = compression, negative = tension. */
export function rodForce(c: EngineConfig, deg: number, pBar: number, rpm: number): number {
  const r = c.stroke / 2000;
  const l = c.rodLength / 1000;
  const omega = (rpm * 2 * Math.PI) / 60;
  const th = (deg * Math.PI) / 180;
  const area = (Math.PI / 4) * (c.bore / 1000) ** 2;
  const gas = (pBar - 1) * 1e5 * area;
  const inertia = c.reciprocatingMass * r * omega * omega * (Math.cos(th) + (r / l) * Math.cos(2 * th));
  return gas - inertia;
}

export function pistonSpeed(c: EngineConfig, deg: number, rpm: number): number {
  const r = c.stroke / 2000;
  const l = c.rodLength / 1000;
  const omega = (rpm * 2 * Math.PI) / 60;
  const th = (deg * Math.PI) / 180;
  return r * omega * (Math.sin(th) + (r / (2 * l)) * Math.sin(2 * th));
}

const STROKES = [
  { from: 0, name: '做功', color: 'rgba(255,122,26,0.55)' },
  { from: 180, name: '排气', color: 'rgba(150,130,115,0.5)' },
  { from: 360, name: '进气', color: 'rgba(111,168,220,0.55)' },
  { from: 540, name: '压缩', color: 'rgba(127,209,185,0.45)' },
];

export function strokeName(deg: number): string {
  return STROKES[Math.floor((((deg % 720) + 720) % 720) / 180)]!.name;
}

/** "上止点后 12°" style position relative to the nearest dead centre. */
export function crankWords(deg: number): string {
  const d = ((deg % 720) + 720) % 720;
  const points = [0, 180, 360, 540, 720];
  let best = 0;
  for (const p of points) if (Math.abs(d - p) < Math.abs(d - best)) best = p;
  const off = Math.round(d - best);
  const name = best % 360 === 0 ? '上止点' : '下止点';
  if (off === 0) return name;
  return `${name}${off < 0 ? '前' : '后'} ${Math.abs(off)}°`;
}

// ---------------------------------------------------------------------------
// Colours
// ---------------------------------------------------------------------------

type RGB = [number, number, number];
const lerp = (a: number, b: number, t: number): number => a + (b - a) * t;
const mixRgb = (a: RGB, b: RGB, t: number): RGB => [lerp(a[0], b[0], t), lerp(a[1], b[1], t), lerp(a[2], b[2], t)];
const css = (c: RGB, a = 1): string => `rgba(${Math.round(c[0])},${Math.round(c[1])},${Math.round(c[2])},${a})`;
const clamp01 = (x: number): number => Math.min(1, Math.max(0, x));

function burnedColor(tK: number): RGB {
  const stops: [number, RGB][] = [
    [300, [62, 58, 56]],
    [700, [96, 68, 56]],
    [1200, [176, 70, 32]],
    [1800, [245, 130, 40]],
    [2500, [255, 222, 160]],
  ];
  if (tK <= stops[0]![0]) return stops[0]![1];
  for (let i = 0; i < stops.length - 1; i++) {
    const a = stops[i]!;
    const b = stops[i + 1]!;
    if (tK <= b[0]) return mixRgb(a[1], b[1], (tK - a[0]) / (b[0] - a[0]));
  }
  return stops[stops.length - 1]![1];
}

function freshColor(tK: number): RGB {
  return mixRgb([52, 104, 160], [96, 150, 196], clamp01((tK - 300) / 500));
}

/** Port tint: blue under atmospheric, warm over it. */
function pressureTint(pBar: number): string {
  const d = Math.max(-1, Math.min(1, (pBar - 1) / 0.45));
  return d < 0 ? css([111, 168, 220], -d * 0.45) : css([255, 150, 60], d * 0.45);
}

// ---------------------------------------------------------------------------
// The picture
// ---------------------------------------------------------------------------

export function drawEngine(ctx: CanvasRenderingContext2D, w: number, h: number, f: EngineFrame): void {
  ctx.clearRect(0, 0, w, h);
  const wide = w >= 600 && h >= 300;
  const panelW = wide ? Math.min(280, Math.max(210, w * 0.3)) : 0;
  const sceneW = w - panelW;
  const geo = drawScene(ctx, sceneW, h, f);
  if (wide) drawPanel(ctx, sceneW, 0, panelW, h, f);
  else {
    const R = Math.max(26, Math.min(w, h) * 0.1);
    drawDial(ctx, R + 16, h - R - 34, R, f, false);
  }
  if (f.labels) drawLabels(ctx, geo, sceneW);

  // Footer: what the picture is.
  ctx.font = `500 12px ${TEXT}`;
  ctx.fillStyle = FAINT;
  ctx.textAlign = 'left';
  ctx.textBaseline = 'alphabetic';
  const foot = f.paused
    ? '已暂停 · 拖动画面或按 ← → 转曲轴'
    : f.slow > 1
      ? `画面慢放 1/${f.slow} · 回放上一个完整循环`
      : f.trace
        ? '回放上一个完整循环'
        : '';
  if (foot) ctx.fillText(foot, 14, h - 12);
}

interface SceneGeo {
  airbox: { x: number; y: number };
  throttle: { x: number; y: number };
  runner: { x: number; y: number };
  intakeValve: { x: number; y: number };
  exhaustValve: { x: number; y: number };
  plug: { x: number; y: number };
  header: { x: number; y: number };
  muffler: { x: number; y: number };
  piston: { x: number; y: number };
  rod: { x: number; y: number };
  crank: { x: number; y: number };
  jacket: { x: number; y: number };
  springs: { x: number; y: number };
}

function drawScene(ctx: CanvasRenderingContext2D, w: number, h: number, f: EngineFrame): SceneGeo {
  const c = f.config;
  const s = f.snapshot;
  const t = f.trace;
  const failure = s?.failure ?? null;
  const rpm = Math.max(0, s?.rpm ?? 0);

  const area = (Math.PI / 4) * c.bore * c.bore;
  const vc = (area * c.stroke) / (c.compressionRatio - 1);
  const chamberMm = (vc / area) * 0.7;
  const plugMm = c.bore * 0.22;
  const totalMm = plugMm + c.bore * 0.86 + chamberMm + c.rodLength + (c.stroke / 2) * 2.75;
  const TOP = 44;
  const BOTTOM = 26;
  const usable = Math.max(120, h - TOP - BOTTOM);
  const k = Math.min(usable / Math.max(SCENE_MM, totalMm), (w * 0.5) / 190);
  const B = c.bore * k;
  const r = (c.stroke / 2) * k;
  const L = c.rodLength * k;
  const compHeight = c.bore * 0.34 * k;
  const chamber = Math.max(2, chamberMm * k);
  const wall = Math.max(6, B * 0.14);
  const headH = B * 0.52;

  const cx = w * 0.48;
  const top = TOP + Math.max(0, (usable - totalMm * k) / 2) + plugMm * k;
  const deck = top + headH;
  const crankY = deck + chamber + compHeight + L + r;

  const deg = ((f.deg % 720) + 720) % 720;
  const th = (deg * Math.PI) / 180;
  const sin = Math.sin(th);
  const cos = Math.cos(th);
  const pinY = crankY - (r * cos + Math.sqrt(L * L - r * r * sin * sin));
  const crown = pinY - compHeight;
  const crankPin = { x: cx + r * sin, y: crankY - r * cos };
  const bin = Math.min(719, Math.floor(deg));
  const stats = t ? traceStats(t) : null;

  const pBar = t?.pressure[bin] ?? 1;
  const temp = t?.temperature[bin] ?? 300;
  const fresh = t?.fresh[bin] ?? 1;
  const flame = t?.flame[bin] ?? 0;
  const burn = t?.burn[bin] ?? 0;
  const ivFlow = t?.ivFlow[bin] ?? 0;
  const evFlow = t?.evFlow[bin] ?? 0;
  const ipP = t?.ipP[bin] ?? 1;
  const epP = t?.epP[bin] ?? 1;
  const floating = rpm > (s?.floatRpm ?? Infinity);

  // ---- intake: airbox → throttle → runner → port --------------------------------
  const portY = deck - headH * 0.45;
  const runnerD = Math.max(8, c.intakeRunnerDiameter * k * 0.9);
  const runnerX0 = cx - B / 2 - wall;
  const tbD = Math.max(runnerD, c.throttleDiameter * k * 0.9);
  const boxW = Math.max(26, B * 0.55);
  const runnerLen = Math.max(30, Math.min(runnerX0 - boxW - 30, c.intakeRunnerLength * k * 0.55 + 30));
  const runnerX1 = runnerX0 - runnerLen;
  const tbX = runnerX1 - 16;
  const boxX = tbX - boxW;
  const boxH = tbD * 2.4;

  // Airbox with its filter element.
  ctx.fillStyle = '#262c31';
  roundRect(ctx, boxX, portY - boxH / 2, boxW, boxH, 4);
  ctx.fill();
  ctx.strokeStyle = STEEL;
  ctx.lineWidth = 1;
  ctx.stroke();
  ctx.strokeStyle = 'rgba(232,226,214,0.16)';
  for (let i = 1; i < 6; i++) {
    const x = boxX + (boxW * i) / 6;
    ctx.beginPath();
    ctx.moveTo(x, portY - boxH / 2 + 4);
    ctx.lineTo(x, portY + boxH / 2 - 4);
    ctx.stroke();
  }

  // Runner gas tinted by port pressure: the tuned wave shows as the colour swings.
  ctx.fillStyle = '#20262b';
  ctx.fillRect(runnerX1, portY - runnerD / 2, runnerLen, runnerD);
  ctx.fillStyle = pressureTint(ipP);
  ctx.fillRect(runnerX1, portY - runnerD / 2, runnerLen, runnerD);
  drawParcels(ctx, runnerX1, runnerX0, portY, runnerD, f.intakeFlow, ivFlow < -1 ? 'rgba(255,61,127,0.8)' : 'rgba(111,168,220,0.75)', 7);
  ctx.strokeStyle = STEEL;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(runnerX1, portY - runnerD / 2, runnerLen, runnerD);

  // Throttle body and its butterfly.
  ctx.fillStyle = '#2b3136';
  ctx.fillRect(tbX, portY - tbD / 2 - 3, 16, tbD + 6);
  const open = s?.throttle ?? 0;
  const phi = ((6 + open * 84) * Math.PI) / 180;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2.5;
  ctx.beginPath();
  ctx.moveTo(tbX + 8 - Math.sin(phi) * 3, portY - Math.cos(phi) * (tbD / 2));
  ctx.lineTo(tbX + 8 + Math.sin(phi) * 3, portY + Math.cos(phi) * (tbD / 2));
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(tbX + 8, portY, 2, 0, Math.PI * 2);
  ctx.fill();

  // ---- exhaust: port → header → muffler → tip -----------------------------------
  const headerD = Math.max(8, c.exhaustHeaderDiameter * k * 0.9);
  const hx0 = cx + B / 2 + wall;
  const bend = Math.max(headerD * 1.5, Math.min(w - hx0 - headerD * 3 - 30, B * 0.9));
  const hxDown = hx0 + bend;
  const mufW = c.muffler === 'open' ? 0 : headerD * (c.muffler === 'stock' ? 2.6 : 1.9);
  const mufH = c.muffler === 'open' ? 0 : Math.min(h * 0.24, headerD * (c.muffler === 'stock' ? 6 : 4.5));
  const mufTop = Math.max(portY + bend * 0.65 + 30, h - mufH - 46);
  const pipeEnd = c.muffler === 'open' ? h - 40 : mufTop;
  const glow = blackbody(s?.headerWallC ?? 25);
  const header = new Path2D();
  header.moveTo(hx0, portY);
  header.lineTo(hx0 + bend * 0.35, portY);
  header.quadraticCurveTo(hxDown, portY, hxDown, portY + bend * 0.65);
  header.lineTo(hxDown, pipeEnd);
  ctx.save();
  ctx.lineCap = 'butt';
  if (glow.glow > 0) {
    ctx.shadowColor = glow.color;
    ctx.shadowBlur = 24 * glow.glow;
  }
  ctx.strokeStyle = glow.color;
  ctx.lineWidth = headerD + 4;
  ctx.stroke(header);
  ctx.restore();
  ctx.strokeStyle = '#1b1f22';
  ctx.lineWidth = headerD - 4;
  ctx.stroke(header);
  ctx.strokeStyle = pressureTint(epP);
  ctx.stroke(header);
  ctx.save();
  ctx.lineCap = 'round';
  ctx.setLineDash([0.1, headerD * 1.1]);
  ctx.lineDashOffset = -f.exhaustFlow * headerD * 14;
  ctx.strokeStyle = evFlow < -1 ? 'rgba(111,168,220,0.75)' : `rgba(255,122,26,${0.25 + 0.5 * Math.min(1, (s?.egtC ?? 0) / 800)})`;
  ctx.lineWidth = headerD * 0.3;
  ctx.stroke(header);
  ctx.restore();

  // Muffler (or an open pipe) and the tip, where pops come out.
  let tipX: number;
  let tipY: number;
  if (c.muffler === 'open') {
    tipX = hxDown;
    ctx.fillStyle = glow.color;
    ctx.beginPath();
    ctx.moveTo(hxDown - headerD / 2 - 2, pipeEnd - 6);
    ctx.lineTo(hxDown + headerD / 2 + 2, pipeEnd - 6);
    ctx.lineTo(hxDown + headerD / 2 + 6, pipeEnd + 4);
    ctx.lineTo(hxDown - headerD / 2 - 6, pipeEnd + 4);
    ctx.closePath();
    ctx.fill();
    tipY = pipeEnd + 4;
  } else {
    const mx = hxDown - mufW / 2;
    ctx.fillStyle = '#2a3035';
    roundRect(ctx, mx, mufTop, mufW, mufH, mufW * 0.3);
    ctx.fill();
    ctx.strokeStyle = STEEL;
    ctx.lineWidth = 1.5;
    ctx.stroke();
    // Baffles / perforated core.
    ctx.strokeStyle = 'rgba(232,226,214,0.14)';
    ctx.lineWidth = 1;
    const n = c.muffler === 'stock' ? 4 : 2;
    for (let i = 1; i <= n; i++) {
      const y = mufTop + (mufH * i) / (n + 1);
      ctx.beginPath();
      ctx.moveTo(mx + 3, y);
      ctx.lineTo(mx + mufW - 3, y);
      ctx.stroke();
    }
    const tipLen = Math.max(14, headerD * 1.4);
    ctx.fillStyle = '#3a4147';
    ctx.fillRect(hxDown - headerD * 0.3, mufTop + mufH, headerD * 0.6, tipLen);
    tipX = hxDown;
    tipY = mufTop + mufH + tipLen;
  }
  if (f.pop > 0.02) {
    const len = (18 + 50 * f.pop) * Math.max(0.6, headerD / 20);
    const g = ctx.createRadialGradient(tipX, tipY, 0, tipX, tipY + len * 0.4, len);
    g.addColorStop(0, `rgba(255,245,210,${f.pop})`);
    g.addColorStop(0.35, `rgba(255,150,40,${0.9 * f.pop})`);
    g.addColorStop(1, 'rgba(255,60,20,0)');
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.ellipse(tipX, tipY + len * 0.45, len * 0.38, len * 0.6, 0, 0, Math.PI * 2);
    ctx.fill();
  }

  // ---- block & head ----------------------------------------------------------------
  const blockBottom = crankY - r * 0.2;
  ctx.fillStyle = '#2a3035';
  ctx.fillRect(cx - B / 2 - wall, deck, wall, blockBottom - deck);
  ctx.fillRect(cx + B / 2, deck, wall, blockBottom - deck);
  const cool = clamp01(((s?.coolantC ?? 25) - 25) / 100);
  const jacket = `rgba(${Math.round(70 + 150 * cool)},${Math.round(110 - 40 * cool)},${Math.round(160 - 120 * cool)},0.45)`;
  ctx.fillStyle = jacket;
  ctx.fillRect(cx - B / 2 - wall * 0.7, deck + 6, wall * 0.35, (blockBottom - deck) * 0.45);
  ctx.fillRect(cx + B / 2 + wall * 0.35, deck + 6, wall * 0.35, (blockBottom - deck) * 0.45);

  ctx.fillStyle = '#30373d';
  ctx.fillRect(cx - B / 2 - wall, top, B + wall * 2, headH);
  // Ports through the head, tinted like their runners.
  ctx.fillStyle = '#20262b';
  ctx.fillRect(runnerX0 - 2, portY - runnerD / 2, cx - B * 0.2 - runnerX0 + 2, runnerD);
  ctx.fillRect(cx + B * 0.2, portY - headerD / 2, hx0 - cx - B * 0.2 + 2, headerD);
  ctx.fillStyle = pressureTint(ipP);
  ctx.fillRect(runnerX0 - 2, portY - runnerD / 2, cx - B * 0.2 - runnerX0 + 2, runnerD);
  ctx.fillStyle = pressureTint(epP);
  ctx.fillRect(cx + B * 0.2, portY - headerD / 2, hx0 - cx - B * 0.2 + 2, headerD);

  // ---- gas in the cylinder ------------------------------------------------------------
  const gasTop = deck - chamber;
  const gasH = crown - gasTop;
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - B / 2, gasTop, B, gasH);
  ctx.clip();
  const misfired = s?.cycle?.misfire === true;
  if (flame > 0 && !failure) {
    // Unburned charge ahead of the flame, burned gas behind it.
    ctx.fillStyle = css(mixRgb([88, 84, 80], freshColor(temp * 0.8), clamp01(fresh)));
    ctx.fillRect(cx - B / 2, gasTop, B, gasH);
    const reach = Math.hypot(B / 2, gasH) * 1.02;
    const fr = reach * Math.sqrt(clamp01(burn));
    const g = ctx.createRadialGradient(cx, gasTop, 0, cx, gasTop, Math.max(1, fr));
    const hot = burnedColor(temp * 1.15);
    g.addColorStop(0, css(burnedColor(temp * 1.25)));
    g.addColorStop(0.85, css(hot));
    g.addColorStop(1, css(hot, 0.9));
    ctx.fillStyle = g;
    ctx.beginPath();
    ctx.arc(cx, gasTop, Math.max(1, fr), 0, Math.PI * 2);
    ctx.fill();
    // Flame front.
    ctx.save();
    ctx.shadowColor = 'rgba(255,200,90,0.9)';
    ctx.shadowBlur = 12;
    ctx.strokeStyle = 'rgba(255,236,170,0.95)';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.arc(cx, gasTop, Math.max(2, fr), 0, Math.PI * 2);
    ctx.stroke();
    ctx.restore();
    const knock = s?.cycle?.knock ?? 0;
    if (knock > 0.04 && burn > 0.55) {
      // End gas auto-igniting at the far edges, ahead of the flame.
      ctx.fillStyle = css([255, 61, 127], Math.min(1, knock * 5));
      for (let i = 0; i < 7; i++) {
        const side = i % 2 === 0 ? -1 : 1;
        const x = cx + side * (B * 0.42 - ((i * 7) % 5));
        const y = gasTop + gasH * (0.25 + 0.1 * i) + Math.sin(f.time * 70 + i) * 3;
        ctx.beginPath();
        ctx.arc(x, Math.min(crown - 3, y), 2 + 3 * Math.abs(Math.sin(f.time * 90 + i * 1.7)), 0, Math.PI * 2);
        ctx.fill();
      }
    }
  } else {
    const col = mixRgb(burnedColor(temp), freshColor(temp), clamp01(fresh));
    ctx.fillStyle = css(col);
    ctx.fillRect(cx - B / 2, gasTop, B, gasH);
    // Fresh charge swirling in while the intake is open.
    if (ivFlow > 1 && stats) {
      const a = clamp01(ivFlow / stats.ivMax);
      const g = ctx.createRadialGradient(cx - B * 0.26, gasTop, 0, cx - B * 0.26, gasTop, B * 0.9);
      g.addColorStop(0, css([140, 190, 235], 0.55 * a));
      g.addColorStop(1, css([111, 168, 220], 0));
      ctx.fillStyle = g;
      ctx.fillRect(cx - B / 2, gasTop, B, gasH);
    }
  }
  ctx.restore();
  if (misfired && deg < 200 && !failure && s?.status === 'running') {
    tag(ctx, cx, gasTop + gasH * 0.5, '失火', KNOCK);
  }

  // ---- spark plug ------------------------------------------------------------------
  const plugW = Math.max(6, B * 0.13);
  ctx.fillStyle = '#d9d5cc';
  ctx.fillRect(cx - plugW * 0.35, top - plugMm * k, plugW * 0.7, plugMm * k * 0.55);
  ctx.fillStyle = '#8a8f93';
  ctx.fillRect(cx - plugW / 2, top - plugMm * k * 0.45, plugW, plugMm * k * 0.45 + 4);
  ctx.fillRect(cx - plugW * 0.3, top + 4, plugW * 0.6, headH - chamber - 2);
  const adv = s?.advance ?? 10;
  const sparkDeg = (720 - adv) % 720;
  const sinceSpark = (deg - sparkDeg + 720) % 720;
  if (sinceSpark < 8 && s?.status !== 'off' && s?.limiterCut !== true && !failure) {
    ctx.save();
    ctx.shadowColor = '#bfe0ff';
    ctx.shadowBlur = 18;
    ctx.fillStyle = '#eaf4ff';
    ctx.beginPath();
    ctx.arc(cx, gasTop + 1, 4.5, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---- valves, springs and flow at the seats ---------------------------------------------
  const valveGeo = (side: 'intake' | 'exhaust'): { x: number; y: number } => {
    const dir = side === 'intake' ? -1 : 1;
    const dia = (side === 'intake' ? c.intakeValveDiameter : c.exhaustValveDiameter) * k;
    const lift = (side === 'intake' ? c.intakeLift : c.exhaustLift) * k * 1.4;
    let frac = liftFraction(c, deg, side);
    if (floating && !f.paused) frac = Math.max(frac, 0.12 * Math.abs(Math.sin(f.time * 47 + dir)));
    const seatX = cx + dir * B * 0.26;
    const seatY = gasTop;
    const tilt = dir * 0.2;
    const down = lift * frac;
    const bx = seatX + Math.sin(tilt) * -down;
    const by = seatY + Math.cos(tilt) * down;
    const bent = failure?.kind === 'valve';
    const stemLen = headH * 0.95;
    const tipX = bx + Math.sin(tilt) * stemLen + (bent ? dir * 6 : 0);
    const tipY = by - Math.cos(tilt) * stemLen;
    // Spring from the head boss up to the retainer at the stem tip; squeezes as the valve opens.
    const ux = Math.sin(tilt);
    const uy = -Math.cos(tilt);
    const px = Math.cos(tilt);
    const py = Math.sin(tilt);
    const springW = Math.max(5, dia * 0.42);
    const sb = { x: seatX + ux * headH * 0.42, y: seatY + uy * headH * 0.42 };
    const st = { x: tipX - ux * 3, y: tipY - uy * 3 };
    ctx.strokeStyle = floating ? FLOAT : 'rgba(201,195,183,0.55)';
    ctx.lineWidth = 1.2;
    ctx.beginPath();
    const coils = 12;
    for (let i = 0; i <= coils; i++) {
      const u = i / coils;
      const side = i === 0 || i === coils ? 0 : i % 2 === 0 ? -1 : 1;
      const x = sb.x + (st.x - sb.x) * u + px * side * springW * 0.5;
      const y = sb.y + (st.y - sb.y) * u + py * side * springW * 0.5;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.stroke();
    ctx.fillStyle = '#9aa1a6';
    ctx.fillRect(st.x - springW * 0.6, st.y - 1.5, springW * 1.2, 3);
    ctx.strokeStyle = bent ? KNOCK : '#c9c3b7';
    ctx.lineWidth = Math.max(2, dia * 0.12);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(tipX, tipY);
    ctx.stroke();
    ctx.fillStyle = bent ? KNOCK : '#d8d2c6';
    ctx.beginPath();
    ctx.moveTo(bx - (dia / 2) * Math.cos(tilt), by - (dia / 2) * Math.sin(tilt));
    ctx.lineTo(bx + (dia / 2) * Math.cos(tilt), by + (dia / 2) * Math.sin(tilt));
    ctx.lineTo(bx + dia * 0.12, by - dia * 0.2);
    ctx.lineTo(bx - dia * 0.12, by - dia * 0.2);
    ctx.closePath();
    ctx.fill();

    // Flow through the curtain: arrows into or out of the cylinder.
    const flow = side === 'intake' ? ivFlow : evFlow;
    const max = side === 'intake' ? (stats?.ivMax ?? 1) : (stats?.evMax ?? 1);
    const a = Math.min(1, Math.abs(flow) / max);
    if (a > 0.04 && frac > 0.02) {
      // Positive intake flow goes into the cylinder (down); positive exhaust flow goes out (up).
      const intoCyl = side === 'intake' ? flow > 0 : flow < 0;
      const reverse = side === 'intake' ? flow < 0 : flow < 0;
      const color = reverse ? KNOCK : side === 'intake' ? INTAKE : HEAT;
      const size = 4 + 8 * Math.sqrt(a);
      const ax = bx + dir * dia * 0.62;
      const ay = by + (intoCyl ? 4 : -2);
      arrow(ctx, ax, ay, intoCyl ? -dir * 0.6 : dir * 0.6, intoCyl ? 1 : -1, size, color);
    }
    return { x: bx, y: by };
  };
  const ivPos = valveGeo('intake');
  const evPos = valveGeo('exhaust');

  // ---- crank, rod, piston ---------------------------------------------------------
  const rodBroken = failure?.kind === 'rod';
  ctx.fillStyle = '#262c31';
  ctx.beginPath();
  ctx.arc(cx, crankY, r * 1.75, 0, Math.PI * 2);
  ctx.fill();
  // TDC mark on the case.
  ctx.strokeStyle = FAINT;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(cx, crankY - r * 1.75 - 2);
  ctx.lineTo(cx, crankY - r * 1.75 + 6);
  ctx.stroke();
  ctx.fillStyle = '#3a4147';
  ctx.beginPath();
  const cwA = th + Math.PI;
  ctx.moveTo(cx, crankY);
  ctx.arc(cx, crankY, r * 1.55, cwA - 1.1 - Math.PI / 2, cwA + 1.1 - Math.PI / 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#4a5258';
  ctx.beginPath();
  ctx.arc(cx, crankY, r * 0.35, 0, Math.PI * 2);
  ctx.fill();

  const force = t ? rodForce(c, deg, pBar, rpm) : 0;
  const ratio = force / c.rodStrength;
  if (!rodBroken) {
    const rodW0 = Math.max(5, B * 0.16);
    const rodW1 = Math.max(4, B * 0.1);
    const ang = Math.atan2(pinY - crankPin.y, cx - crankPin.x);
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    // Compression warms the rod orange; tension cools it blue and turns pink near its limit.
    const load = Math.min(1, Math.abs(ratio) * 1.6);
    const base: RGB = [154, 161, 166];
    const tint: RGB = ratio >= 0 ? [255, 150, 70] : -ratio > 0.8 ? [255, 61, 127] : [111, 168, 220];
    ctx.fillStyle = css(mixRgb(base, tint, load));
    ctx.beginPath();
    ctx.moveTo(crankPin.x + nx * rodW0, crankPin.y + ny * rodW0);
    ctx.lineTo(cx + nx * rodW1, pinY + ny * rodW1);
    ctx.lineTo(cx - nx * rodW1, pinY - ny * rodW1);
    ctx.lineTo(crankPin.x - nx * rodW0, crankPin.y - ny * rodW0);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.strokeStyle = KNOCK;
    ctx.lineWidth = 3;
    ctx.beginPath();
    ctx.moveTo(crankPin.x, crankPin.y);
    ctx.lineTo(crankPin.x + B * 0.3, crankPin.y - L * 0.4);
    ctx.stroke();
  }
  ctx.fillStyle = '#c9c3b7';
  ctx.beginPath();
  ctx.arc(crankPin.x, crankPin.y, Math.max(3, B * 0.1), 0, Math.PI * 2);
  ctx.fill();

  const pistonH = compHeight * 1.9;
  const dmg = clamp01(s?.pistonDamage ?? 0);
  ctx.fillStyle = failure?.kind === 'piston' ? '#5a2a30' : css(mixRgb([184, 178, 166], [150, 60, 50], dmg));
  ctx.fillRect(cx - B / 2 + 1, crown, B - 2, pistonH);
  ctx.fillStyle = '#7d786f';
  for (let i = 0; i < 3; i++) ctx.fillRect(cx - B / 2 + 1, crown + 3 + i * 4, B - 2, 1.5);
  if (failure?.kind === 'piston') {
    ctx.fillStyle = '#12100f';
    ctx.beginPath();
    ctx.ellipse(cx + B * 0.12, crown + 2, B * 0.12, 3, 0, 0, Math.PI * 2);
    ctx.fill();
  }
  ctx.fillStyle = '#5a5f63';
  ctx.beginPath();
  ctx.arc(cx, pinY, Math.max(3, B * 0.09), 0, Math.PI * 2);
  ctx.fill();

  // Gas force pushing on the crown.
  if (t && pBar > 3 && !failure) {
    const gasN = (pBar - 1) * 1e5 * (Math.PI / 4) * (c.bore / 1000) ** 2;
    const len = Math.min(B * 0.9, 8 + (gasN / c.rodStrength) * B * 0.9);
    ctx.strokeStyle = 'rgba(255,236,170,0.8)';
    ctx.fillStyle = 'rgba(255,236,170,0.8)';
    arrow(ctx, cx - B * 0.3, crown - 2 - len * 0.2, 0, 1, Math.max(5, len * 0.25), 'rgba(255,236,170,0.8)');
    arrow(ctx, cx + B * 0.3, crown - 2 - len * 0.2, 0, 1, Math.max(5, len * 0.25), 'rgba(255,236,170,0.8)');
  }

  ctx.strokeStyle = STEEL;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - B / 2, deck);
  ctx.lineTo(cx - B / 2, blockBottom);
  ctx.moveTo(cx + B / 2, deck);
  ctx.lineTo(cx + B / 2, blockBottom);
  ctx.stroke();

  // Pressure and temperature beside the chamber.
  if (t) {
    ctx.textAlign = 'left';
    ctx.textBaseline = 'alphabetic';
    ctx.fillStyle = INK;
    ctx.font = `600 16px ${NUM}`;
    ctx.fillText(`${pBar.toFixed(pBar < 10 ? 2 : 0)} bar`, hx0 + headerD * 0.2, deck + headerD + 22);
    ctx.fillStyle = MUTED;
    ctx.font = `500 13px ${NUM}`;
    ctx.fillText(`${Math.round(temp)} K`, hx0 + headerD * 0.2, deck + headerD + 38);
  }

  return {
    airbox: { x: boxX + boxW / 2, y: portY - boxH / 2 },
    throttle: { x: tbX + 8, y: portY + tbD / 2 + 3 },
    runner: { x: (runnerX1 + runnerX0) / 2, y: portY - runnerD / 2 },
    intakeValve: ivPos,
    exhaustValve: evPos,
    plug: { x: cx + plugW * 0.5, y: top - plugMm * k * 0.7 },
    header: { x: hx0 + bend * 0.5, y: portY - headerD / 2 },
    muffler: { x: hxDown + mufW / 2, y: c.muffler === 'open' ? pipeEnd : mufTop + mufH * 0.5 },
    piston: { x: cx - B / 2, y: crown + pistonH * 0.5 },
    rod: { x: (cx + crankPin.x) / 2, y: (pinY + crankPin.y) / 2 },
    crank: { x: cx - r * 1.75, y: crankY },
    jacket: { x: cx - B / 2 - wall * 0.5, y: deck + (blockBottom - deck) * 0.3 },
    springs: { x: cx - B * 0.26, y: top + headH * 0.15 },
  };
}

// ---------------------------------------------------------------------------
// Side panel: where in the cycle, and what the gas and the rod are doing
// ---------------------------------------------------------------------------

function drawPanel(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, f: EngineFrame): void {
  ctx.fillStyle = 'rgba(15,18,20,0.35)';
  ctx.fillRect(x, y, w, h);
  ctx.strokeStyle = LINE;
  ctx.lineWidth = 1;
  ctx.beginPath();
  ctx.moveTo(x + 0.5, y);
  ctx.lineTo(x + 0.5, y + h);
  ctx.stroke();

  const R = Math.min(w * 0.34, h * 0.15, 88);
  const dialY = y + 16 + R + 6;
  drawDial(ctx, x + w / 2, dialY, R, f, true);

  const c = f.config;
  const t = f.trace;
  const s = f.snapshot;
  const deg = ((f.deg % 720) + 720) % 720;
  const bin = Math.min(719, Math.floor(deg));
  const stats = t ? traceStats(t) : null;
  const rpm = Math.max(0, s?.rpm ?? 0);
  const pad = 14;
  const x0 = x + pad;
  const x1 = x + w - pad;
  let ry = dialY + R + 44;

  // Status tags for the cycle being replayed.
  const tags: [string, string][] = [];
  if (s?.cycle?.misfire) tags.push(['失火', KNOCK]);
  if ((s?.cycle?.knock ?? 0) > 0.04) tags.push(['爆震', KNOCK]);
  if (s?.overrunCut) tags.push(['收油断油', INTAKE]);
  if (s?.limiterCut) tags.push(['撞断火', HEAT]);
  if (rpm > (s?.floatRpm ?? Infinity)) tags.push(['气门飘浮', FLOAT]);
  if (stats && stats.reversion > stats.ivMax * 0.15) tags.push(['进气倒流', KNOCK]);
  let tx = x0;
  ctx.font = `600 11px ${TEXT}`;
  for (const [text, color] of tags) {
    const tw = ctx.measureText(text).width + 10;
    if (tx + tw > x1) break;
    ctx.fillStyle = css(hexRgb(color), 0.16);
    roundRect(ctx, tx, ry - 13, tw, 17, 3);
    ctx.fill();
    ctx.fillStyle = color;
    ctx.textAlign = 'left';
    ctx.fillText(text, tx + 5, ry);
    tx += tw + 5;
  }
  if (tags.length === 0) {
    ctx.fillStyle = FAINT;
    ctx.textAlign = 'left';
    ctx.fillText(t ? '这个循环一切正常' : '发动机没转', x0, ry);
  }
  ry += 16;

  const rowH = 28;
  const rows: (() => void)[] = [];
  if (t && stats) {
    const p = t.pressure[bin]!;
    const T = t.temperature[bin]!;
    const fresh = t.fresh[bin]!;
    const burn = t.burn[bin]!;
    const flame = t.flame[bin]!;
    const iv = t.ivFlow[bin]!;
    const ev = t.evFlow[bin]!;
    const ip = t.ipP[bin]!;
    const ep = t.epP[bin]!;
    const force = rodForce(c, deg, p, rpm);
    const v = pistonSpeed(c, deg, rpm);

    rows.push(() => row(ctx, x0, x1, ry, '缸压', `${p.toFixed(p < 10 ? 2 : 1)} bar`, INK, { kind: 'fill', v: p / Math.max(1, stats.pMax), color: HEAT, note: `峰值 ${stats.pMax.toFixed(0)}` }));
    rows.push(() =>
      row(ctx, x0, x1, ry, '缸内气体', flame > 0 ? `已烧 ${Math.round(burn * 100)}%` : `新鲜 ${Math.round(fresh * 100)}%`, flame > 0 ? HEAT : INK, {
        kind: 'split',
        v: flame > 0 ? 1 - burn : fresh,
        color: INTAKE,
        color2: flame > 0 ? HEAT : 'rgba(150,130,115,0.9)',
      }),
    );
    rows.push(() =>
      row(ctx, x0, x1, ry, '进气门', iv < -1 ? `倒流 ${Math.abs(iv).toFixed(0)} g/s` : `${Math.max(0, iv).toFixed(0)} g/s`, iv < -1 ? KNOCK : INK, {
        kind: 'center',
        v: iv / stats.ivMax,
        color: iv < 0 ? KNOCK : INTAKE,
      }),
    );
    rows.push(() =>
      row(ctx, x0, x1, ry, '排气门', ev < -1 ? `回流 ${Math.abs(ev).toFixed(0)} g/s` : `${Math.max(0, ev).toFixed(0)} g/s`, ev < -1 ? INTAKE : INK, {
        kind: 'center',
        v: ev / stats.evMax,
        color: ev < 0 ? INTAKE : HEAT,
      }),
    );
    rows.push(() =>
      row(ctx, x0, x1, ry, '连杆', `${force >= 0 ? '压' : '拉'} ${(Math.abs(force) / 1000).toFixed(1)} kN`, force < 0 && -force > c.rodStrength * 0.8 ? KNOCK : INK, {
        kind: 'center',
        v: force / c.rodStrength,
        color: force >= 0 ? HEAT : -force > c.rodStrength * 0.8 ? KNOCK : INTAKE,
        marks: [-0.8, -1],
        note: `拉断 ${(c.rodStrength / 1000).toFixed(1)}`,
      }),
    );
    rows.push(() => row(ctx, x0, x1, ry, '缸温', `${Math.round(T)} K`, INK, { kind: 'fill', v: (T - 300) / 2400, color: css(burnedColor(T)) }));
    rows.push(() => row(ctx, x0, x1, ry, '进气口压力', `${ip.toFixed(2)} bar`, ip > 1.02 ? HEAT : ip < 0.9 ? INTAKE : INK, { kind: 'center', v: (ip - 1) / 0.5, color: ip > 1 ? HEAT : INTAKE }));
    rows.push(() => row(ctx, x0, x1, ry, '排气口压力', `${ep.toFixed(2)} bar`, ep < 0.98 ? GOOD : INK, { kind: 'center', v: (ep - 1) / 0.5, color: ep > 1 ? HEAT : GOOD }));
    rows.push(() => row(ctx, x0, x1, ry, '活塞速度', `${Math.abs(v).toFixed(1)} m/s`, INK, { kind: 'fill', v: Math.abs(v) / 40, color: MUTED }));
  }
  for (const draw of rows) {
    if (ry + rowH > y + h - 8) break;
    draw();
    ry += rowH;
  }
}

interface Bar {
  kind: 'fill' | 'center' | 'split';
  v: number;
  color: string;
  color2?: string;
  marks?: number[];
  note?: string;
}

function row(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, label: string, value: string, color: string, bar: Bar): void {
  ctx.textBaseline = 'alphabetic';
  ctx.textAlign = 'left';
  ctx.font = `500 12px ${TEXT}`;
  ctx.fillStyle = MUTED;
  ctx.fillText(label, x0, y + 10);
  if (bar.note) {
    const lw = ctx.measureText(label).width;
    ctx.font = `500 11px ${NUM}`;
    ctx.fillStyle = FAINT;
    ctx.fillText(bar.note, x0 + lw + 6, y + 10);
  }
  ctx.textAlign = 'right';
  ctx.font = `600 15px ${NUM}`;
  ctx.fillStyle = color;
  ctx.fillText(value, x1, y + 11);

  const by = y + 16;
  const bw = x1 - x0;
  ctx.fillStyle = 'rgba(232,226,214,0.08)';
  ctx.fillRect(x0, by, bw, 4);
  if (bar.kind === 'fill') {
    ctx.fillStyle = bar.color;
    ctx.fillRect(x0, by, bw * clamp01(bar.v), 4);
  } else if (bar.kind === 'split') {
    const a = clamp01(bar.v);
    ctx.fillStyle = bar.color;
    ctx.fillRect(x0, by, bw * a, 4);
    ctx.fillStyle = bar.color2 ?? MUTED;
    ctx.fillRect(x0 + bw * a, by, bw * (1 - a), 4);
  } else {
    const mid = x0 + bw / 2;
    const v = Math.max(-1, Math.min(1, bar.v));
    ctx.fillStyle = bar.color;
    ctx.fillRect(Math.min(mid, mid + (v * bw) / 2), by, Math.abs((v * bw) / 2), 4);
    ctx.fillStyle = FAINT;
    ctx.fillRect(mid - 0.5, by - 2, 1, 8);
    for (const m of bar.marks ?? []) {
      ctx.fillStyle = m <= -1 || m >= 1 ? KNOCK : 'rgba(255,61,127,0.5)';
      ctx.fillRect(mid + (Math.max(-1, Math.min(1, m)) * bw) / 2 - 0.5 + (m <= -1 ? 0.5 : 0), by - 2, 1, 8);
    }
  }
}

// ---------------------------------------------------------------------------
// The cycle dial: 720° on one turn, firing TDC at the top
// ---------------------------------------------------------------------------

function drawDial(ctx: CanvasRenderingContext2D, x: number, y: number, R: number, f: EngineFrame, full: boolean): void {
  const c = f.config;
  const s = f.snapshot;
  const t = f.trace;
  const deg = ((f.deg % 720) + 720) % 720;
  const A = (d: number): number => -Math.PI / 2 + (d / 720) * Math.PI * 2;
  const ring = Math.max(6, R * 0.16);

  ctx.save();
  if (!full) {
    ctx.fillStyle = 'rgba(15,18,20,0.6)';
    ctx.beginPath();
    ctx.arc(x, y, R + 6, 0, Math.PI * 2);
    ctx.fill();
  }
  // Strokes.
  for (const st of STROKES) {
    ctx.strokeStyle = st.color;
    ctx.lineWidth = ring;
    ctx.beginPath();
    ctx.arc(x, y, R - ring / 2, A(st.from) + 0.01, A(st.from + 180) - 0.01);
    ctx.stroke();
    if (full) {
      const mid = A(st.from + 90);
      ctx.fillStyle = INK;
      ctx.font = `600 ${Math.max(10, Math.round(ring * 0.75))}px ${TEXT}`;
      ctx.textAlign = 'center';
      ctx.textBaseline = 'middle';
      ctx.fillText(st.name, x + Math.cos(mid) * (R - ring / 2), y + Math.sin(mid) * (R - ring / 2));
    }
  }

  // Valve events inside the ring.
  const ev = valveEvents(c);
  const arc = (from: number, to: number, rad: number, color: string, width: number): void => {
    ctx.strokeStyle = color;
    ctx.lineWidth = width;
    ctx.beginPath();
    ctx.arc(x, y, rad, A(from), A(to));
    ctx.stroke();
  };
  const ri = R - ring - 5;
  arc(ev.ivo, ev.ivc, ri, INTAKE, 3);
  arc(ev.evo, ev.evc, ri - 5, HEAT, 3);
  // Overlap shading.
  if (ev.evc > ev.ivo) arc(ev.ivo, ev.evc, ri - 10, 'rgba(255,61,127,0.7)', 2);

  // Burn window from the recorded cycle.
  if (t) {
    const st = traceStats(t);
    if (st.burn10 >= 0 && st.burn90 >= 0) {
      const b10 = st.burn10 > 360 ? st.burn10 - 720 : st.burn10;
      arc(b10, st.burn90, R + 3, 'rgba(255,236,170,0.9)', 3);
    }
    tick(ctx, x, y, A(st.pMaxDeg), R + 1, R + 8, HEAT, 2);
  }
  // Spark.
  const sparkDeg = 720 - (s?.advance ?? 10);
  tick(ctx, x, y, A(sparkDeg), R - ring - 2, R + 8, '#eaf4ff', 2);
  // TDC/BDC marks.
  for (const d of [0, 180, 360, 540]) tick(ctx, x, y, A(d), R - ring, R, 'rgba(15,18,20,0.9)', 2);

  // Needle.
  const a = A(deg);
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(a) * R * 0.18, y + Math.sin(a) * R * 0.18);
  ctx.lineTo(x + Math.cos(a) * (R + 4), y + Math.sin(a) * (R + 4));
  ctx.stroke();
  ctx.fillStyle = INK;
  ctx.beginPath();
  ctx.arc(x + Math.cos(a) * (R - ring / 2), y + Math.sin(a) * (R - ring / 2), 3.5, 0, Math.PI * 2);
  ctx.fill();

  // Centre.
  ctx.textAlign = 'center';
  ctx.textBaseline = 'alphabetic';
  if (full) {
    ctx.fillStyle = INK;
    ctx.font = `700 ${Math.round(R * 0.3)}px ${TEXT}`;
    ctx.fillText(strokeName(deg), x, y + R * 0.06);
    ctx.fillStyle = MUTED;
    ctx.font = `500 ${Math.max(11, Math.round(R * 0.15))}px ${TEXT}`;
    ctx.fillText(crankWords(deg), x, y + R * 0.3);
    ctx.fillStyle = FAINT;
    ctx.font = `500 ${Math.max(10, Math.round(R * 0.13))}px ${NUM}`;
    ctx.fillText(`${Math.round(deg)}°`, x, y - R * 0.3);
    // Legend.
    ctx.font = `500 11px ${TEXT}`;
    const ly = y + R + 18;
    const items: [string, string][] = [
      ['进气门', INTAKE],
      ['排气门', HEAT],
      ['重叠', KNOCK],
      ['点火', '#eaf4ff'],
      ['燃烧', 'rgba(255,236,170,0.9)'],
    ];
    let total = 0;
    for (const [n] of items) total += ctx.measureText(n).width + 14;
    let lx = x - total / 2;
    ctx.textAlign = 'left';
    for (const [n, col] of items) {
      ctx.fillStyle = col;
      ctx.fillRect(lx, ly - 7, 8, 3);
      ctx.fillStyle = FAINT;
      ctx.fillText(n, lx + 10, ly - 2);
      lx += ctx.measureText(n).width + 14;
    }
  } else {
    ctx.fillStyle = INK;
    ctx.font = `700 ${Math.round(R * 0.36)}px ${TEXT}`;
    ctx.textBaseline = 'middle';
    ctx.fillText(strokeName(deg), x, y);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Part names
// ---------------------------------------------------------------------------

function drawLabels(ctx: CanvasRenderingContext2D, g: SceneGeo, w: number): void {
  const items: [keyof SceneGeo, string, number, number][] = [
    ['airbox', '空滤箱', 0, -26],
    ['throttle', '节气门', -10, 30],
    ['runner', '进气道', 6, 34],
    ['springs', '气门弹簧', -40, -34],
    ['intakeValve', '进气门', -56, 26],
    ['plug', '火花塞', 44, -8],
    ['exhaustValve', '排气门', 56, 30],
    ['header', '排气头段', 20, -30],
    ['muffler', '消音器', 40, 0],
    ['piston', '活塞', -56, 0],
    ['rod', '连杆', -64, 10],
    ['crank', '曲轴', -40, 24],
    ['jacket', '水套', -60, -10],
  ];
  ctx.save();
  ctx.font = `600 12px ${TEXT}`;
  ctx.textBaseline = 'middle';
  for (const [key, name, dx, dy] of items) {
    const p = g[key];
    const tx = Math.max(30, Math.min(w - 30, p.x + dx));
    const ty = p.y + dy;
    ctx.strokeStyle = 'rgba(127,209,185,0.6)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    ctx.moveTo(p.x, p.y);
    ctx.lineTo(tx, ty);
    ctx.stroke();
    ctx.fillStyle = '#7fd1b9';
    ctx.beginPath();
    ctx.arc(p.x, p.y, 2, 0, Math.PI * 2);
    ctx.fill();
    const tw = ctx.measureText(name).width;
    const left = dx < 0;
    ctx.fillStyle = 'rgba(15,18,20,0.8)';
    roundRect(ctx, left ? tx - tw - 8 : tx, ty - 9, tw + 8, 18, 3);
    ctx.fill();
    ctx.fillStyle = '#7fd1b9';
    ctx.textAlign = left ? 'right' : 'left';
    ctx.fillText(name, left ? tx - 4 : tx + 4, ty);
  }
  ctx.restore();
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function tag(ctx: CanvasRenderingContext2D, x: number, y: number, text: string, color: string): void {
  ctx.save();
  ctx.font = `700 13px ${TEXT}`;
  const tw = ctx.measureText(text).width + 12;
  ctx.fillStyle = 'rgba(15,18,20,0.75)';
  roundRect(ctx, x - tw / 2, y - 10, tw, 20, 4);
  ctx.fill();
  ctx.fillStyle = color;
  ctx.textAlign = 'center';
  ctx.textBaseline = 'middle';
  ctx.fillText(text, x, y);
  ctx.restore();
}

function tick(ctx: CanvasRenderingContext2D, x: number, y: number, a: number, r0: number, r1: number, color: string, width: number): void {
  ctx.strokeStyle = color;
  ctx.lineWidth = width;
  ctx.beginPath();
  ctx.moveTo(x + Math.cos(a) * r0, y + Math.sin(a) * r0);
  ctx.lineTo(x + Math.cos(a) * r1, y + Math.sin(a) * r1);
  ctx.stroke();
}

function arrow(ctx: CanvasRenderingContext2D, x: number, y: number, dx: number, dy: number, size: number, color: string): void {
  const len = Math.hypot(dx, dy) || 1;
  const ux = dx / len;
  const uy = dy / len;
  ctx.fillStyle = color;
  ctx.beginPath();
  ctx.moveTo(x + ux * size, y + uy * size);
  ctx.lineTo(x - uy * size * 0.55, y + ux * size * 0.55);
  ctx.lineTo(x + uy * size * 0.55, y - ux * size * 0.55);
  ctx.closePath();
  ctx.fill();
}

function roundRect(ctx: CanvasRenderingContext2D, x: number, y: number, w: number, h: number, r: number): void {
  ctx.beginPath();
  ctx.moveTo(x + r, y);
  ctx.arcTo(x + w, y, x + w, y + h, r);
  ctx.arcTo(x + w, y + h, x, y + h, r);
  ctx.arcTo(x, y + h, x, y, r);
  ctx.arcTo(x, y, x + w, y, r);
  ctx.closePath();
}

function hexRgb(color: string): RGB {
  if (color.startsWith('#') && color.length === 7) {
    return [parseInt(color.slice(1, 3), 16), parseInt(color.slice(3, 5), 16), parseInt(color.slice(5, 7), 16)];
  }
  return [232, 226, 214];
}

function drawParcels(ctx: CanvasRenderingContext2D, x0: number, x1: number, y: number, d: number, phase: number, color: string, n: number): void {
  const span = x1 - x0;
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const t = (((i / n + phase) % 1) + 1) % 1;
    ctx.beginPath();
    ctx.arc(x0 + t * span, y + Math.sin(i * 2.1) * d * 0.2, Math.max(1.5, d * 0.12), 0, Math.PI * 2);
    ctx.fill();
  }
}
