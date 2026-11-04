/**
 * The strip, side on: road, distance boards, start lights, finish, the bike
 * (with its wheelie and wheelspin) and the ghost of the best run.
 */

import type { RaceEvent, RideState } from '../sim/race';
import type { ChassisId } from '../sim/vehicle';
import { HEAT, INK, INTAKE, KNOCK } from './palette';

export interface TrackFrame {
  ride: RideState;
  event: RaceEvent | null;
  chassis: ChassisId;
  tireRadius: number;
  wheelbase: number;
  rpm: number;
  limiter: number;
  shiftRpm: number;
  boostKpa: number;
  turbo: boolean;
  /** Ghost position, m (null: none). */
  ghostX: number | null;
  ghostDelta: number | null;
  now: number;
}

interface Puff {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
}

const puffs: Puff[] = [];

function bikeShape(ctx: CanvasRenderingContext2D, chassis: ChassisId, r: number, wb: number, wheelAngle: number, alpha: number, cut: boolean): void {
  // Origin at the rear tyre's contact patch, x forward, y up (negative screen y).
  ctx.globalAlpha = alpha;
  const wheel = (cx: number, rr: number): void => {
    ctx.beginPath();
    ctx.arc(cx, -rr, rr, 0, Math.PI * 2);
    ctx.fillStyle = '#111416';
    ctx.fill();
    ctx.lineWidth = Math.max(1, rr * 0.18);
    ctx.strokeStyle = '#2d3338';
    ctx.stroke();
    ctx.beginPath();
    ctx.arc(cx, -rr, rr * 0.55, 0, Math.PI * 2);
    ctx.strokeStyle = '#6a737a';
    ctx.lineWidth = 1.2;
    ctx.stroke();
    for (let k = 0; k < 3; k++) {
      const a = wheelAngle + (k * Math.PI * 2) / 3;
      ctx.beginPath();
      ctx.moveTo(cx, -rr);
      ctx.lineTo(cx + Math.cos(a) * rr * 0.55, -rr + Math.sin(a) * rr * 0.55);
      ctx.stroke();
    }
  };
  if (chassis === 'kart') {
    const rr = r;
    const L = wb;
    wheel(0, rr);
    wheel(L, rr * 0.85);
    ctx.fillStyle = '#c84b1f';
    ctx.beginPath();
    ctx.moveTo(-rr * 0.6, -rr * 1.1);
    ctx.lineTo(L + rr, -rr * 1.0);
    ctx.lineTo(L + rr * 1.2, -rr * 1.6);
    ctx.lineTo(L * 0.55, -rr * 1.9);
    ctx.lineTo(-rr * 0.3, -rr * 2.2);
    ctx.closePath();
    ctx.fill();
    // Driver.
    ctx.fillStyle = '#d9d2c4';
    ctx.beginPath();
    ctx.arc(L * 0.25, -rr * 4.2, rr * 0.75, 0, Math.PI * 2);
    ctx.fill();
    ctx.fillStyle = '#2f5e8a';
    ctx.fillRect(L * 0.08, -rr * 3.6, L * 0.32, rr * 1.8);
    ctx.globalAlpha = 1;
    return;
  }
  const rr = r;
  const L = wb;
  wheel(0, rr);
  wheel(L, rr);
  const race = chassis === 'race';
  // Swingarm, frame, tank, seat, fairing.
  ctx.strokeStyle = '#8a9298';
  ctx.lineWidth = Math.max(2, rr * 0.16);
  ctx.beginPath();
  ctx.moveTo(0, -rr);
  ctx.lineTo(L * 0.38, -rr * 1.35);
  ctx.lineTo(L, -rr);
  ctx.stroke();
  ctx.fillStyle = race ? '#c8361f' : '#3d6f99';
  ctx.beginPath();
  ctx.moveTo(L * 0.12, -rr * 2.05);
  ctx.lineTo(L * 0.5, -rr * 2.25);
  ctx.lineTo(L * 0.78, -rr * (race ? 2.55 : 2.3));
  ctx.lineTo(L * 0.95, -rr * (race ? 2.2 : 1.7));
  ctx.lineTo(L * 0.62, -rr * 1.35);
  ctx.lineTo(L * 0.3, -rr * 1.4);
  ctx.closePath();
  ctx.fill();
  // Engine block.
  ctx.fillStyle = '#4a5157';
  ctx.fillRect(L * 0.32, -rr * 1.75, L * 0.3, rr * 0.7);
  // Exhaust and its flame on a cut.
  ctx.strokeStyle = '#b9b2a6';
  ctx.lineWidth = Math.max(2, rr * 0.14);
  ctx.beginPath();
  ctx.moveTo(L * 0.38, -rr * 1.15);
  ctx.lineTo(-rr * 0.35, -rr * 1.45);
  ctx.stroke();
  if (cut) {
    ctx.fillStyle = HEAT;
    ctx.beginPath();
    ctx.moveTo(-rr * 0.35, -rr * 1.55);
    ctx.lineTo(-rr * 1.1, -rr * 1.45);
    ctx.lineTo(-rr * 0.35, -rr * 1.35);
    ctx.fill();
  }
  // Rider.
  const tuck = race ? 0.35 : 0;
  ctx.fillStyle = '#20262b';
  ctx.beginPath();
  ctx.moveTo(L * 0.22, -rr * 2.2);
  ctx.lineTo(L * (0.45 + tuck * 0.3), -rr * (3.9 - tuck * 1.3));
  ctx.lineTo(L * (0.62 + tuck * 0.25), -rr * (3.7 - tuck * 1.2));
  ctx.lineTo(L * 0.5, -rr * 2.2);
  ctx.closePath();
  ctx.fill();
  ctx.fillStyle = race ? '#e8e2d6' : '#ffb347';
  ctx.beginPath();
  ctx.arc(L * (0.6 + tuck * 0.32), -rr * (4.2 - tuck * 1.35), rr * 0.42, 0, Math.PI * 2);
  ctx.fill();
  ctx.globalAlpha = 1;
}

export function drawTrack(ctx: CanvasRenderingContext2D, w: number, h: number, dt: number, f: TrackFrame): void {
  const ride = f.ride;
  const ppm = Math.max(22, Math.min(80, w / 13));
  const groundY = h * 0.74;
  const bikeX = w * 0.34;
  const camX = ride.x;
  const sx = (m: number): number => bikeX + (m - camX) * ppm;
  const slope = Math.atan(ride.grade);

  // Sky.
  const sky = ctx.createLinearGradient(0, 0, 0, groundY);
  sky.addColorStop(0, '#141a20');
  sky.addColorStop(1, '#2a3238');
  ctx.fillStyle = sky;
  ctx.fillRect(0, 0, w, h);

  ctx.save();
  ctx.translate(bikeX, groundY);
  ctx.rotate(-slope);
  ctx.translate(-bikeX, -groundY);

  // Far hills, parallax.
  ctx.fillStyle = '#20272c';
  ctx.beginPath();
  ctx.moveTo(-w, groundY);
  for (let x = -w; x <= w * 2; x += 24) {
    const wx = x + camX * ppm * 0.08;
    ctx.lineTo(x, groundY - 40 - Math.sin(wx * 0.004) * 26 - Math.sin(wx * 0.011) * 12);
  }
  ctx.lineTo(w * 2, groundY);
  ctx.closePath();
  ctx.fill();

  // Road.
  ctx.fillStyle = '#2e3337';
  ctx.fillRect(-w, groundY, w * 3, h);
  ctx.fillStyle = '#3a4045';
  ctx.fillRect(-w, groundY, w * 3, 6);
  ctx.fillStyle = 'rgba(232,226,214,0.35)';
  const dash = 4;
  const first = Math.floor((camX - bikeX / ppm - 2) / dash) * dash;
  for (let m = first; m < camX + w / ppm + 4; m += dash) {
    ctx.fillRect(sx(m), groundY + 18, ppm * 2, 3);
  }

  // Distance boards.
  ctx.font = '600 12px Barlow Condensed, sans-serif';
  ctx.textAlign = 'center';
  const board = 50;
  for (let m = Math.max(0, Math.floor((camX - bikeX / ppm) / board) * board); m < camX + w / ppm + board; m += board) {
    const x = sx(m);
    ctx.fillStyle = '#596168';
    ctx.fillRect(x - 1, groundY - 46, 2, 46);
    ctx.fillStyle = m === 0 ? '#8fd48a' : '#e8e2d6';
    ctx.fillRect(x - 16, groundY - 62, 32, 18);
    ctx.fillStyle = '#1b1f22';
    ctx.fillText(m === 0 ? '起点' : `${m}`, x, groundY - 49);
  }

  // Finish line.
  if (f.event && f.event.stopKmh === undefined && f.event.measure === 'time') {
    const x = sx(f.event.distance);
    for (let i = 0; i < 8; i++) {
      ctx.fillStyle = i % 2 ? '#e8e2d6' : '#111';
      ctx.fillRect(x - 4, groundY + i * 6, 8, 6);
    }
    ctx.fillStyle = INK;
    ctx.fillText('终点', x, groundY - 70);
  }

  // Ghost.
  if (f.ghostX !== null) {
    ctx.save();
    ctx.translate(sx(f.ghostX), groundY);
    bikeShape(ctx, f.chassis, f.tireRadius * ppm, f.wheelbase * ppm, f.ghostX / f.tireRadius, 0.28, false);
    ctx.restore();
  }

  // Tyre smoke.
  const r = f.tireRadius * ppm;
  if (Math.abs(ride.slip) > 0.3 && ride.kmh > 1 && ride.phase === 'run') {
    for (let i = 0; i < 3; i++) puffs.push({ x: bikeX, y: groundY - 2, vx: -40 - Math.random() * 80, vy: -10 - Math.random() * 30, life: 1 });
  }
  for (let i = puffs.length - 1; i >= 0; i--) {
    const p = puffs[i]!;
    p.life -= dt * 0.9;
    p.x += (p.vx - ride.kmh / 3.6 * ppm) * dt;
    p.y += p.vy * dt;
    if (p.life <= 0 || p.x < -50) {
      puffs.splice(i, 1);
      continue;
    }
    ctx.fillStyle = `rgba(200,200,200,${p.life * 0.25})`;
    ctx.beginPath();
    ctx.arc(p.x, p.y, 8 + (1 - p.life) * 22, 0, Math.PI * 2);
    ctx.fill();
  }

  // The bike, pitched about its rear contact.
  ctx.save();
  ctx.translate(bikeX, groundY);
  ctx.rotate(-ride.pitch);
  bikeShape(ctx, f.chassis, r, f.wheelbase * ppm, ride.x / f.tireRadius + ride.slip * f.now * 30, 1, ride.cut);
  ctx.restore();

  ctx.restore();

  // Speed streaks.
  if (ride.kmh > 40) {
    ctx.strokeStyle = `rgba(232,226,214,${Math.min(0.18, (ride.kmh - 40) / 600)})`;
    ctx.lineWidth = 1;
    for (let i = 0; i < 10; i++) {
      const y = (i * 53 + ((f.now * 300) % 53)) % (groundY - 20);
      const x = (w - ((f.now * ride.kmh * 9 + i * 211) % (w + 200))) | 0;
      ctx.beginPath();
      ctx.moveTo(x, y);
      ctx.lineTo(x + 40 + ride.kmh * 0.4, y);
      ctx.stroke();
    }
  }

  drawHud(ctx, w, h, f);
}

function drawHud(ctx: CanvasRenderingContext2D, w: number, _h: number, f: TrackFrame): void {
  const ride = f.ride;
  // Start lights.
  if (ride.phase === 'stage') {
    const left = -ride.t;
    const lit = left > 2 ? 1 : left > 1 ? 2 : 3;
    for (let i = 0; i < 3; i++) {
      ctx.beginPath();
      ctx.arc(w / 2 - 36 + i * 36, 46, 13, 0, Math.PI * 2);
      ctx.fillStyle = i < lit ? '#ff3b2f' : '#3a1512';
      ctx.fill();
    }
    ctx.fillStyle = INK;
    ctx.font = '600 14px Barlow, PingFang SC, sans-serif';
    ctx.textAlign = 'center';
    ctx.fillText(f.ride.rider === 'manual' ? '准备：空格拧油门，灯灭放离合' : '准备……', w / 2, 82);
  }

  // Speed, gear, time.
  ctx.textAlign = 'right';
  ctx.fillStyle = INK;
  ctx.font = '700 46px Barlow Condensed, sans-serif';
  ctx.fillText(ride.kmh.toFixed(0), w - 70, 56);
  ctx.font = '500 14px Barlow Condensed, sans-serif';
  ctx.fillStyle = 'rgba(232,226,214,0.6)';
  ctx.fillText('km/h', w - 24, 56);
  ctx.font = '700 34px Barlow Condensed, sans-serif';
  ctx.fillStyle = HEAT;
  ctx.fillText(ride.gear === 0 ? 'N' : String(ride.gear), w - 24, 100);

  if (ride.phase !== 'free') {
    ctx.textAlign = 'left';
    ctx.fillStyle = INK;
    ctx.font = '700 30px Barlow Condensed, sans-serif';
    ctx.fillText(ride.t > 0 ? ride.t.toFixed(2) : '0.00', 20, 44);
    ctx.font = '500 13px Barlow Condensed, sans-serif';
    ctx.fillStyle = 'rgba(232,226,214,0.6)';
    ctx.fillText(`${ride.x.toFixed(0)} m${f.event?.stopKmh ? ` · 目标 ${f.event.stopKmh} km/h` : f.event ? ` / ${f.event.distance} m` : ''}`, 20, 64);
    if (f.ghostDelta !== null && ride.phase === 'run') {
      const d = f.ghostDelta;
      ctx.fillStyle = d >= 0 ? '#8fd48a' : KNOCK;
      ctx.font = '600 15px Barlow Condensed, sans-serif';
      ctx.fillText(`${d >= 0 ? '领先' : '落后'}最佳 ${Math.abs(d).toFixed(1)} m`, 20, 86);
    }
  }

  // Rev bar with shift light.
  const bw = Math.min(360, w * 0.5);
  const bx = (w - bw) / 2;
  const by = 14;
  const frac = Math.max(0, Math.min(1, f.rpm / f.limiter));
  const shiftNow = f.rpm >= f.shiftRpm - 150;
  ctx.fillStyle = 'rgba(0,0,0,0.35)';
  ctx.fillRect(bx, by, bw, 8);
  ctx.fillStyle = shiftNow ? (Math.floor(f.now * 12) % 2 ? KNOCK : '#ffffff') : frac > 0.85 ? HEAT : INTAKE;
  ctx.fillRect(bx, by, bw * frac, 8);
  ctx.fillStyle = 'rgba(232,226,214,0.6)';
  ctx.fillRect(bx + bw * Math.min(1, f.shiftRpm / f.limiter) - 1, by - 2, 2, 12);

  // Flags: traction, wheelie, boost.
  const flags: [string, boolean, string][] = [
    ['打滑', Math.abs(ride.slip) > 0.25 && ride.phase === 'run', KNOCK],
    ['抬头', ride.pitch > 0.02, HEAT],
    ['断火', ride.cut, '#ffd166'],
  ];
  ctx.font = '600 13px Barlow, PingFang SC, sans-serif';
  ctx.textAlign = 'left';
  let fx = 20;
  for (const [t, on, c] of flags) {
    if (!on) continue;
    ctx.fillStyle = c;
    ctx.fillRect(fx, 100, 44, 22);
    ctx.fillStyle = '#111';
    ctx.fillText(t, fx + 8, 116);
    fx += 52;
  }
  if (f.turbo) {
    ctx.textAlign = 'right';
    ctx.fillStyle = 'rgba(232,226,214,0.7)';
    ctx.font = '500 13px Barlow Condensed, sans-serif';
    ctx.fillText(`增压 ${f.boostKpa.toFixed(0)} kPa`, w - 24, 122);
  }
}

/** Position of a recorded run at time t, m. */
export function traceX(trace: number[][], t: number): number {
  if (trace.length === 0) return 0;
  if (t <= trace[0]![0]!) return trace[0]![1]!;
  for (let i = 1; i < trace.length; i++) {
    const b = trace[i]!;
    if (t <= b[0]!) {
      const a = trace[i - 1]!;
      const k = (t - a[0]!) / Math.max(1e-6, b[0]! - a[0]!);
      return a[1]! + (b[1]! - a[1]!) * k;
    }
  }
  return trace[trace.length - 1]![1]!;
}
