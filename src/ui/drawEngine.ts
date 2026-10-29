import { liftFraction, type EngineConfig } from '../sim/config';
import type { CycleTrace } from '../sim/core';
import type { EngineSnapshot } from '../sim/snapshot';
import { INK, STEEL, blackbody } from './palette';

/** Height of the tallest engine the build sheet allows, mm; sets the common scale. */
const SCENE_MM = 330;

export interface EngineFrame {
  config: EngineConfig;
  /** Visual cycle angle, degrees from firing TDC. */
  deg: number;
  trace: CycleTrace | null;
  snapshot: EngineSnapshot | null;
  /** Wall-clock seconds, for flicker. */
  time: number;
  /** Positions of gas parcels along runner (0-1) and header (0-1). */
  intakeFlow: number;
  exhaustFlow: number;
}

export function drawEngine(ctx: CanvasRenderingContext2D, w: number, h: number, f: EngineFrame): void {
  const c = f.config;
  const s = f.snapshot;
  ctx.clearRect(0, 0, w, h);

  const area = (Math.PI / 4) * c.bore * c.bore;
  const vc = (area * c.stroke) / (c.compressionRatio - 1);
  const totalMm = c.bore * 0.86 + (vc / area) * 0.7 + c.rodLength + (c.stroke / 2) * 2.75;
  const k = Math.min((h * 0.9) / Math.max(SCENE_MM, totalMm), (w * 0.55) / 190);
  const B = c.bore * k;
  const r = (c.stroke / 2) * k;
  const L = c.rodLength * k;
  const compHeight = c.bore * 0.34 * k;
  const chamber = Math.max(2, (vc / area) * k * 0.7);
  const wall = Math.max(6, B * 0.14);
  const headH = B * 0.52;

  const cx = w * 0.46;
  const top = (h - totalMm * k) / 2;
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
  const failure = s?.failure ?? null;

  // ---- intake runner & throttle body ---------------------------------------
  const portY = deck - headH * 0.45;
  const runnerD = Math.max(8, c.intakeRunnerDiameter * k * 0.9);
  const runnerX0 = cx - B / 2 - wall;
  const runnerLen = Math.min(runnerX0 - 24, (c.intakeRunnerLength * k) * 0.55 + 30);
  const runnerX1 = runnerX0 - runnerLen;
  ctx.fillStyle = '#20262b';
  ctx.fillRect(runnerX1, portY - runnerD / 2, runnerLen, runnerD);
  drawParcels(ctx, runnerX1, runnerX0, portY, runnerD, f.intakeFlow, 'rgba(111,168,220,0.55)');
  ctx.strokeStyle = STEEL;
  ctx.lineWidth = 1.5;
  ctx.strokeRect(runnerX1, portY - runnerD / 2, runnerLen, runnerD);
  // Throttle body with its butterfly.
  const tbD = Math.max(runnerD, c.throttleDiameter * k * 0.9);
  const tbX = runnerX1 - 16;
  ctx.fillStyle = '#2b3136';
  ctx.fillRect(tbX, portY - tbD / 2 - 3, 16, tbD + 6);
  const open = s?.throttle ?? 0;
  const phi = ((6 + open * 84) * Math.PI) / 180;
  ctx.strokeStyle = INK;
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.moveTo(tbX + 8 - Math.sin(phi) * 2, portY - Math.cos(phi) * (tbD / 2));
  ctx.lineTo(tbX + 8 + Math.sin(phi) * 2, portY + Math.cos(phi) * (tbD / 2));
  ctx.stroke();

  // ---- exhaust header --------------------------------------------------------
  const headerD = Math.max(8, c.exhaustHeaderDiameter * k * 0.9);
  const hx0 = cx + B / 2 + wall;
  const glow = blackbody(s?.headerWallC ?? 25);
  const bend = Math.min(w - hx0 - headerD - 8, B * 0.9);
  const header = new Path2D();
  header.moveTo(hx0, portY);
  header.lineTo(hx0 + bend * 0.35, portY);
  header.quadraticCurveTo(hx0 + bend, portY, hx0 + bend, portY + bend * 0.65);
  header.lineTo(hx0 + bend, h + 10);
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
  ctx.save();
  ctx.lineCap = 'round';
  ctx.setLineDash([0.1, headerD * 1.1]);
  ctx.lineDashOffset = -f.exhaustFlow * headerD * 14;
  ctx.strokeStyle = `rgba(255,122,26,${0.15 + 0.45 * Math.min(1, (s?.egtC ?? 0) / 800)})`;
  ctx.lineWidth = headerD * 0.28;
  ctx.stroke(header);
  ctx.restore();

  // ---- block & head ----------------------------------------------------------
  const blockBottom = crankY - r * 0.2;
  ctx.fillStyle = '#2a3035';
  ctx.fillRect(cx - B / 2 - wall, deck, wall, blockBottom - deck);
  ctx.fillRect(cx + B / 2, deck, wall, blockBottom - deck);
  // Water jacket hint: colour follows coolant temperature.
  const cool = Math.min(1, Math.max(0, ((s?.coolantC ?? 25) - 25) / 100));
  ctx.fillStyle = `rgba(${Math.round(70 + 150 * cool)},${Math.round(110 - 40 * cool)},${Math.round(160 - 120 * cool)},0.35)`;
  ctx.fillRect(cx - B / 2 - wall * 0.7, deck + 6, wall * 0.35, (blockBottom - deck) * 0.45);
  ctx.fillRect(cx + B / 2 + wall * 0.35, deck + 6, wall * 0.35, (blockBottom - deck) * 0.45);

  // Head with combustion chamber cut-out.
  ctx.fillStyle = '#30373d';
  ctx.fillRect(cx - B / 2 - wall, top, B + wall * 2, headH);
  ctx.fillStyle = '#20262b';
  ctx.fillRect(runnerX0 - 2, portY - runnerD / 2, cx - B * 0.2 - runnerX0 + 2, runnerD);
  ctx.fillRect(cx + B * 0.2, portY - headerD / 2, hx0 - cx - B * 0.2 + 2, headerD);

  // ---- gas in the cylinder -----------------------------------------------------
  const gasTop = deck - chamber;
  const fresh = f.trace?.fresh[bin] ?? 1;
  const temp = f.trace?.temperature[bin] ?? 300;
  const flame = f.trace?.flame[bin] ?? 0;
  const pBar = f.trace?.pressure[bin] ?? 1;
  ctx.save();
  ctx.beginPath();
  ctx.rect(cx - B / 2, gasTop, B, crown - gasTop);
  ctx.clip();
  const hot = Math.min(1, Math.max(0, (temp - 500) / 1800));
  ctx.fillStyle = `rgb(${Math.round(40 + 40 * (1 - fresh) + 160 * hot)},${Math.round(60 + 40 * fresh + 50 * hot)},${Math.round(70 + 90 * fresh * (1 - hot))})`;
  ctx.fillRect(cx - B / 2, gasTop, B, crown - gasTop);
  if (flame > 0 && !failure) {
    const xb = Math.min(1, (1 - flame) / 0.7);
    const fr = B * (0.08 + 1.05 * Math.sqrt(xb));
    const g = ctx.createRadialGradient(cx, gasTop, 0, cx, gasTop, fr);
    g.addColorStop(0, 'rgba(255,240,200,0.95)');
    g.addColorStop(0.55, 'rgba(255,150,40,0.85)');
    g.addColorStop(1, 'rgba(255,90,20,0)');
    ctx.fillStyle = g;
    ctx.fillRect(cx - B / 2, gasTop, B, crown - gasTop);
    const knock = s?.cycle?.knock ?? 0;
    if (knock > 0.04 && xb > 0.5) {
      ctx.strokeStyle = `rgba(255,61,127,${Math.min(1, knock * 4)})`;
      ctx.lineWidth = 2;
      for (let i = 0; i < 3; i++) {
        const rr = B * (0.25 + 0.22 * i + 0.1 * Math.sin(f.time * 90 + i));
        ctx.beginPath();
        ctx.arc(cx, gasTop, rr, 0, Math.PI);
        ctx.stroke();
      }
    }
  }
  ctx.restore();

  // Spark.
  const adv = s?.advance ?? 10;
  const sparkDeg = (720 - adv) % 720;
  const sinceSpark = (deg - sparkDeg + 720) % 720;
  ctx.fillStyle = '#8a8f93';
  ctx.fillRect(cx - 3, top + 4, 6, headH - chamber - 2);
  if (sinceSpark < 10 && s?.status !== 'off' && !failure) {
    ctx.save();
    ctx.shadowColor = '#bfe0ff';
    ctx.shadowBlur = 16;
    ctx.fillStyle = '#eaf4ff';
    ctx.beginPath();
    ctx.arc(cx, gasTop + 1, 4, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }

  // ---- valves --------------------------------------------------------------------
  const drawValve = (side: 'intake' | 'exhaust'): void => {
    const dir = side === 'intake' ? -1 : 1;
    const dia = (side === 'intake' ? c.intakeValveDiameter : c.exhaustValveDiameter) * k;
    const lift = (side === 'intake' ? c.intakeLift : c.exhaustLift) * k * 1.4;
    const frac = liftFraction(c, deg, side);
    const seatX = cx + dir * B * 0.26;
    const seatY = gasTop;
    const tilt = dir * 0.2;
    const down = lift * frac;
    const bx = seatX + Math.sin(tilt) * -down;
    const by = seatY + Math.cos(tilt) * down;
    const bent = failure?.kind === 'valve';
    ctx.strokeStyle = bent ? '#ff3d7f' : '#c9c3b7';
    ctx.lineWidth = Math.max(2, dia * 0.12);
    ctx.beginPath();
    ctx.moveTo(bx, by);
    ctx.lineTo(bx + Math.sin(tilt) * headH * 0.9 + (bent ? dir * 6 : 0), by - Math.cos(tilt) * headH * 0.9);
    ctx.stroke();
    ctx.fillStyle = bent ? '#ff3d7f' : '#d8d2c6';
    ctx.beginPath();
    ctx.moveTo(bx - (dia / 2) * Math.cos(tilt), by - (dia / 2) * Math.sin(tilt));
    ctx.lineTo(bx + (dia / 2) * Math.cos(tilt), by + (dia / 2) * Math.sin(tilt));
    ctx.lineTo(bx + dia * 0.12, by - dia * 0.2);
    ctx.lineTo(bx - dia * 0.12, by - dia * 0.2);
    ctx.closePath();
    ctx.fill();
  };
  drawValve('intake');
  drawValve('exhaust');

  // ---- crank, rod, piston ---------------------------------------------------------
  const rodBroken = failure?.kind === 'rod';
  ctx.fillStyle = '#262c31';
  ctx.beginPath();
  ctx.arc(cx, crankY, r * 1.75, 0, Math.PI * 2);
  ctx.fill();
  // Counterweight opposite the pin.
  ctx.fillStyle = '#3a4147';
  ctx.beginPath();
  const cwA = th + Math.PI / 2 + Math.PI;
  ctx.moveTo(cx, crankY);
  ctx.arc(cx, crankY, r * 1.55, cwA - 1.1 - Math.PI / 2, cwA + 1.1 - Math.PI / 2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = '#4a5258';
  ctx.beginPath();
  ctx.arc(cx, crankY, r * 0.35, 0, Math.PI * 2);
  ctx.fill();

  if (!rodBroken) {
    const rodW0 = Math.max(5, B * 0.16);
    const rodW1 = Math.max(4, B * 0.1);
    const ang = Math.atan2(pinY - crankPin.y, cx - crankPin.x);
    const nx = -Math.sin(ang);
    const ny = Math.cos(ang);
    ctx.fillStyle = '#9aa1a6';
    ctx.beginPath();
    ctx.moveTo(crankPin.x + nx * rodW0, crankPin.y + ny * rodW0);
    ctx.lineTo(cx + nx * rodW1, pinY + ny * rodW1);
    ctx.lineTo(cx - nx * rodW1, pinY - ny * rodW1);
    ctx.lineTo(crankPin.x - nx * rodW0, crankPin.y - ny * rodW0);
    ctx.closePath();
    ctx.fill();
  } else {
    ctx.strokeStyle = '#ff3d7f';
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

  // Piston.
  const pistonH = compHeight * 1.9;
  ctx.fillStyle = failure?.kind === 'piston' ? '#5a2a30' : '#b8b2a6';
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

  // Bore liner edges.
  ctx.strokeStyle = STEEL;
  ctx.lineWidth = 1.5;
  ctx.beginPath();
  ctx.moveTo(cx - B / 2, deck);
  ctx.lineTo(cx - B / 2, blockBottom);
  ctx.moveTo(cx + B / 2, deck);
  ctx.lineTo(cx + B / 2, blockBottom);
  ctx.stroke();

  if (!f.trace || pBar < 0.05) return;
  ctx.fillStyle = INK;
  ctx.font = '600 15px "Barlow Condensed", sans-serif';
  ctx.textAlign = 'left';
  ctx.fillText(`${pBar.toFixed(pBar < 10 ? 2 : 0)} bar`, cx + B / 2 + wall + 6, deck + 18);
  ctx.fillStyle = 'rgba(232,226,214,0.55)';
  ctx.font = '500 13px "Barlow Condensed", sans-serif';
  ctx.fillText(`${Math.round(temp)} K`, cx + B / 2 + wall + 6, deck + 34);
}

function drawParcels(
  ctx: CanvasRenderingContext2D,
  x0: number,
  x1: number,
  y: number,
  d: number,
  phase: number,
  color: string,
): void {
  const n = 6;
  const span = x1 - x0;
  ctx.fillStyle = color;
  for (let i = 0; i < n; i++) {
    const t = (((i / n + phase) % 1) + 1) % 1;
    ctx.beginPath();
    ctx.arc(x0 + t * span, y + Math.sin(i * 2.1) * d * 0.18, d * 0.12, 0, Math.PI * 2);
    ctx.fill();
  }
}
