import { valveEvents, type EngineConfig } from '../sim/config';
import { CYCLE_BINS, type CycleTrace } from '../sim/core';
import { HEAT, INK, INTAKE, STEEL } from './palette';

const GRID = 'rgba(232,226,214,0.08)';
const LABEL = 'rgba(232,226,214,0.5)';

/** Map a cycle bin (firing TDC = 0) to −360…360 so combustion sits in the middle. */
const centred = (deg: number): number => ((deg + 360) % 720) - 360;

export function scopeScale(traces: CycleTrace[]): number {
  let peak = 10;
  for (const t of traces.slice(0, 4)) for (const p of t.pressure) if (p > peak) peak = p;
  return Math.ceil((peak * 1.1) / 20) * 20;
}

export function drawPressureAngle(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  traces: CycleTrace[],
  config: EngineConfig,
  advance: number,
  pMax: number,
): void {
  ctx.clearRect(0, 0, w, h);
  const padL = 34;
  const padB = 22;
  const pw = w - padL - 8;
  const ph = h - padB - 8;
  const x = (deg: number): number => padL + ((centred(deg) + 360) / 720) * pw;
  const y = (p: number): number => 8 + ph - (p / pMax) * ph;

  ctx.font = '500 12px "Barlow Condensed", sans-serif';
  ctx.lineWidth = 1;
  ctx.strokeStyle = GRID;
  ctx.fillStyle = LABEL;
  ctx.textAlign = 'right';
  for (let p = 0; p <= pMax; p += pMax > 100 ? 40 : 20) {
    ctx.beginPath();
    ctx.moveTo(padL, y(p));
    ctx.lineTo(w - 8, y(p));
    ctx.stroke();
    ctx.fillText(String(p), padL - 6, y(p) + 4);
  }
  ctx.textAlign = 'center';
  const marks: [number, string][] = [
    [360, '换气上止点'],
    [540, '下止点'],
    [0, '点火上止点'],
    [180, '下止点'],
  ];
  for (const [d, label] of marks) {
    ctx.beginPath();
    ctx.moveTo(x(d), 8);
    ctx.lineTo(x(d), 8 + ph);
    ctx.stroke();
    ctx.fillText(label, x(d), h - 6);
  }

  // Valve events along the floor.
  const ev = valveEvents(config);
  const band = (from: number, to: number, color: string, row: number): void => {
    ctx.fillStyle = color;
    const yy = 8 + ph - 4 - row * 5;
    for (let d = from; d < to; d += 2) ctx.fillRect(x(d), yy, Math.max(1, (pw / 720) * 2), 3);
  };
  band(ev.ivo, ev.ivc, INTAKE, 0);
  band(ev.evo, ev.evc, HEAT, 1);

  // Spark.
  ctx.strokeStyle = 'rgba(191,224,255,0.7)';
  ctx.setLineDash([3, 3]);
  ctx.beginPath();
  ctx.moveTo(x(720 - advance), 8);
  ctx.lineTo(x(720 - advance), 8 + ph);
  ctx.stroke();
  ctx.setLineDash([]);

  // Phosphor: older cycles fade.
  for (let i = traces.length - 1; i >= 0; i--) {
    const t = traces[i]!;
    const a = i === 0 ? 1 : 0.35 * Math.pow(0.65, i - 1);
    ctx.strokeStyle = i === 0 ? HEAT : `rgba(255,122,26,${a})`;
    ctx.lineWidth = i === 0 ? 2 : 1.2;
    ctx.beginPath();
    for (let k = 0; k < CYCLE_BINS; k++) {
      const d = (k + 360) % 720;
      const px = x(d);
      const py = y(t.pressure[d] ?? 0);
      if (k === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  ctx.fillStyle = LABEL;
  ctx.textAlign = 'left';
  ctx.fillText('bar', 4, 14);
}

export function drawPressureVolume(
  ctx: CanvasRenderingContext2D,
  w: number,
  h: number,
  traces: CycleTrace[],
  config: EngineConfig,
  pMax: number,
): void {
  ctx.clearRect(0, 0, w, h);
  const padL = 34;
  const padB = 22;
  const pw = w - padL - 8;
  const ph = h - padB - 8;
  const cr = config.compressionRatio;
  const r = config.stroke / 2;
  const l = config.rodLength;
  // Volume relative to clearance volume for every bin.
  const vRel = new Float32Array(CYCLE_BINS);
  for (let d = 0; d < CYCLE_BINS; d++) {
    const th = (d * Math.PI) / 180;
    const s = Math.sin(th);
    const xPos = r + l - (r * Math.cos(th) + Math.sqrt(l * l - r * r * s * s));
    vRel[d] = 1 + ((cr - 1) * xPos) / config.stroke;
  }
  const pLo = 0.2;
  const lx = (v: number): number => padL + (Math.log(v) / Math.log(cr)) * pw;
  const ly = (p: number): number => 8 + ph - (Math.log(Math.max(pLo, p) / pLo) / Math.log(pMax / pLo)) * ph;

  ctx.font = '500 12px "Barlow Condensed", sans-serif';
  ctx.lineWidth = 1;
  ctx.strokeStyle = GRID;
  ctx.fillStyle = LABEL;
  ctx.textAlign = 'right';
  for (const p of [0.5, 1, 2, 5, 10, 20, 50, 100]) {
    if (p > pMax) break;
    ctx.beginPath();
    ctx.moveTo(padL, ly(p));
    ctx.lineTo(w - 8, ly(p));
    ctx.stroke();
    ctx.fillText(String(p), padL - 6, ly(p) + 4);
  }
  ctx.strokeStyle = STEEL;
  ctx.setLineDash([2, 4]);
  ctx.beginPath();
  ctx.moveTo(padL, ly(1));
  ctx.lineTo(w - 8, ly(1));
  ctx.stroke();
  ctx.setLineDash([]);
  ctx.textAlign = 'center';
  ctx.fillText('上止点', lx(1) + 16, h - 6);
  ctx.fillText('下止点', lx(cr) - 16, h - 6);
  ctx.fillText('容积（对数）', padL + pw / 2, h - 6);

  for (let i = traces.length - 1; i >= 0; i--) {
    const t = traces[i]!;
    const a = i === 0 ? 1 : 0.35 * Math.pow(0.65, i - 1);
    ctx.strokeStyle = i === 0 ? INK : `rgba(232,226,214,${a})`;
    ctx.lineWidth = i === 0 ? 1.8 : 1;
    ctx.beginPath();
    for (let d = 0; d <= CYCLE_BINS; d++) {
      const k = d % CYCLE_BINS;
      const px = lx(vRel[k] ?? 1);
      const py = ly(t.pressure[k] ?? 1);
      if (d === 0) ctx.moveTo(px, py);
      else ctx.lineTo(px, py);
    }
    ctx.stroke();
  }

  ctx.fillStyle = LABEL;
  ctx.textAlign = 'left';
  ctx.fillText('bar', 4, 14);
}
