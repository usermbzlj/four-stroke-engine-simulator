/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Pure 2D drawing routines for the engine cross-section canvas.
 *
 * Each `draw*` function takes the rendering context plus a fully-resolved
 * {@link EngineScene} (geometry + live props for this frame) and paints one
 * layer. Keeping these as free functions makes `EngineCanvas.tsx` a thin shell
 * (refs, rAF scheduling, pointer input) and the drawing logic legible & ordered.
 */

import type { ComponentWear} from '../types';
import { EngineState, StrokeType } from '../types';

/** Fixed canvas geometry (drawing-space pixels). */
export const CANVAS_GEOMETRY = {
  W_WIDTH: 400,
  W_HEIGHT: 480,
  CX: 200,
  CRANK_Y: 370,
  R_RADIUS: 48,
  CONROD_LEN: 135,
  pistonWidth: 84,
  pistonHeight: 52,
} as const;

const { W_WIDTH, W_HEIGHT, CX, CRANK_Y, R_RADIUS, CONROD_LEN, pistonWidth, pistonHeight } = CANVAS_GEOMETRY;

const isRunningOrStarting = (s: EngineState): boolean =>
  s === EngineState.RUNNING || s === EngineState.STARTING;

/** Per-frame scene: live props + the crank-slider geometry derived from them. */
export interface EngineScene {
  state: EngineState;
  stroke: StrokeType;
  crankAngle: number;
  throttle: number;
  oilLevel: number;
  temperature: number;
  oilPressure: number;
  wear: ComponentWear;
  nosActive: boolean;
  redlineRpm: number;
  rpm: number;
  highRpmReadable: boolean;
  sparkActive: boolean;

  // Derived crank-slider coordinates.
  crankpinX: number;
  crankpinY: number;
  pistonPinY: number;
  pistonTopY: number;
}

/** Resolve the crank-slider geometry for a given crank angle. */
export function resolveSceneGeometry(crankAngle: number): {
  crankpinX: number;
  crankpinY: number;
  pistonPinY: number;
  pistonTopY: number;
} {
  const crankpinX = CX + R_RADIUS * Math.sin(crankAngle);
  const crankpinY = CRANK_Y - R_RADIUS * Math.cos(crankAngle);
  const dy = crankpinX - CX;
  const pistonPinY = crankpinY - Math.sqrt(Math.max(0.1, CONROD_LEN * CONROD_LEN - dy * dy));
  const pistonTopY = pistonPinY - 32;
  return { crankpinX, crankpinY, pistonPinY, pistonTopY };
}

/** Clear + paint the dark backdrop. */
export function drawBackdrop(ctx: CanvasRenderingContext2D): void {
  ctx.clearRect(0, 0, W_WIDTH, W_HEIGHT);
  ctx.fillStyle = '#0f172a';
  ctx.fillRect(0, 0, W_WIDTH, W_HEIGHT);
}

/** Intake/exhaust manifolds with a heat glow on the exhaust runner when hot. */
export function drawManifolds(ctx: CanvasRenderingContext2D, scene: EngineScene): void {
  // Exhaust pipeline (Right, metallic grey out)
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#374151';
  ctx.beginPath();
  ctx.moveTo(240, 95);
  ctx.quadraticCurveTo(340, 95, 340, 60);
  ctx.stroke();

  if (scene.temperature > 90) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.7, (scene.temperature - 90) / 100);
    ctx.strokeStyle = '#ef4444';
    ctx.stroke();
    ctx.restore();
  }

  // Intake manifold (Left, metallic blue-grey)
  ctx.lineWidth = 14;
  ctx.strokeStyle = '#4b5563';
  ctx.beginPath();
  ctx.moveTo(160, 95);
  ctx.quadraticCurveTo(60, 95, 60, 60);
  ctx.stroke();
}

/** Crankcase basement + oil bath. */
export function drawCrankcase(ctx: CanvasRenderingContext2D, scene: EngineScene): void {
  ctx.lineWidth = 2;
  ctx.strokeStyle = '#1e293b';
  ctx.fillStyle = '#111827';
  ctx.beginPath();
  ctx.arc(CX, CRANK_Y, R_RADIUS + 35, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  const minWearFactor = scene.wear.pistonRings / 100;
  const oilY = CRANK_Y + R_RADIUS + 25 - scene.oilLevel * 0.15;
  ctx.fillStyle = minWearFactor < 0.4 ? '#4a3f35' : 'rgba(234, 179, 8, 0.45)';
  ctx.beginPath();
  ctx.arc(CX, CRANK_Y, R_RADIUS + 33, Math.PI * 0.1, Math.PI * 0.9);
  ctx.lineTo(CX - (R_RADIUS + 32) * Math.sin(Math.PI * 0.4), oilY);
  ctx.fill();
}

/** Cylinder block, cooling fins, thermal glow, inner walls, wear scratches. */
export function drawCylinderBlock(ctx: CanvasRenderingContext2D, scene: EngineScene): void {
  const wallLeft = CX - pistonWidth / 2 - 10;
  const wallRight = CX + pistonWidth / 2 + 10;

  ctx.lineWidth = 6;
  ctx.strokeStyle = '#1e293b';
  for (let h = 100; h <= 280; h += 24) {
    ctx.beginPath();
    ctx.moveTo(wallLeft - 18, h);
    ctx.lineTo(wallLeft, h);
    ctx.moveTo(wallRight, h);
    ctx.lineTo(wallRight + 18, h);
    ctx.stroke();
  }

  if (scene.temperature > 40) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.5, (scene.temperature - 40) / 150);
    ctx.fillStyle = '#f87171';
    for (let h = 100; h <= 280; h += 24) {
      ctx.beginPath();
      ctx.arc(wallLeft - 10, h, 6, 0, Math.PI * 2);
      ctx.arc(wallRight + 10, h, 6, 0, Math.PI * 2);
      ctx.fill();
    }
    ctx.restore();
  }

  ctx.lineWidth = 4;
  ctx.strokeStyle = scene.state === EngineState.EXPLODED ? '#7f1d1d' : '#4b5563';
  ctx.beginPath();
  ctx.moveTo(wallLeft, 80);
  ctx.lineTo(wallLeft, 305);
  ctx.moveTo(wallRight, 80);
  ctx.lineTo(wallRight, 305);
  ctx.stroke();

  if (scene.wear.cylinderWall < 70) {
    ctx.strokeStyle = 'rgba(224, 242, 254, 0.25)';
    ctx.lineWidth = 1;
    ctx.beginPath();
    for (let wIndex = 0; wIndex < 5; wIndex++) {
      const rx = wallLeft + 3 + ((wIndex * 15) % 15);
      ctx.moveTo(rx, 110);
      ctx.lineTo(rx, 260);

      const rx2 = wallRight - 3 - ((wIndex * 17) % 15);
      ctx.moveTo(rx2, 120);
      ctx.lineTo(rx2, 250);
    }
    ctx.stroke();
  }
}

/** Stroke-coloured gas wash inside the bore (clipped to the chamber). */
export function drawChamberWash(ctx: CanvasRenderingContext2D, scene: EngineScene): void {
  if (scene.state === EngineState.EXPLODED) return;
  const wallLeft = CX - pistonWidth / 2 - 10;
  const wallRight = CX + pistonWidth / 2 + 10;
  const { pistonTopY, stroke, state, nosActive } = scene;

  ctx.save();
  const pathMaxY = Math.max(120, pistonTopY);
  ctx.beginPath();
  ctx.moveTo(wallLeft + 2, 95);
  ctx.lineTo(wallLeft + 2, pathMaxY);
  ctx.lineTo(wallRight - 2, pathMaxY);
  ctx.lineTo(wallRight - 2, 95);
  ctx.closePath();
  ctx.clip();

  if (stroke === StrokeType.INTAKE && isRunningOrStarting(state)) {
    ctx.fillStyle = 'rgba(59, 130, 246, 0.18)';
    ctx.fill();
  } else if (stroke === StrokeType.COMPRESSION) {
    ctx.fillStyle = `rgba(254, 243, 199, ${0.1 + 0.15 * (1 - (pistonTopY - 100) / 100)})`;
    ctx.fill();
  } else if (stroke === StrokeType.POWER && state === EngineState.RUNNING) {
    const grad = ctx.createLinearGradient(CX, 95, CX, pistonTopY);
    grad.addColorStop(0, nosActive ? 'rgba(168, 85, 247, 0.55)' : 'rgba(239, 68, 68, 0.55)');
    grad.addColorStop(0.3, nosActive ? 'rgba(192, 132, 252, 0.45)' : 'rgba(249, 115, 22, 0.45)');
    grad.addColorStop(1, 'rgba(245, 158, 11, 0.1)');
    ctx.fillStyle = grad;
    ctx.fill();
  } else if (stroke === StrokeType.EXHAUST && isRunningOrStarting(state)) {
    ctx.fillStyle = 'rgba(156, 163, 175, 0.14)';
    ctx.fill();
  }
  ctx.restore();
}

/** Crankshaft, counterweight, crankpin (+ high-rpm motion-blur ghosts). */
export function drawCrankshaft(ctx: CanvasRenderingContext2D, scene: EngineScene): void {
  const { crankAngle, crankpinX: C_x, crankpinY: C_y, highRpmReadable } = scene;

  if (highRpmReadable) {
    ctx.save();
    ctx.setLineDash([4, 5]);
    ctx.lineWidth = 1.5;
    ctx.strokeStyle = 'rgba(125, 211, 252, 0.28)';
    ctx.beginPath();
    ctx.arc(CX, CRANK_Y, R_RADIUS, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    [-0.55, -1.1].forEach((offset, index) => {
      const ghostAngle = crankAngle + offset;
      const gx = CX + R_RADIUS * Math.sin(ghostAngle);
      const gy = CRANK_Y - R_RADIUS * Math.cos(ghostAngle);
      const gdx = gx - CX;
      const gPinY = gy - Math.sqrt(Math.max(0.1, CONROD_LEN * CONROD_LEN - gdx * gdx));
      const gTopY = gPinY - 32;
      ctx.globalAlpha = index === 0 ? 0.26 : 0.14;
      ctx.strokeStyle = '#67e8f9';
      ctx.lineWidth = 2;
      ctx.strokeRect(CX - pistonWidth / 2, gTopY, pistonWidth, pistonHeight);
      ctx.beginPath();
      ctx.moveTo(CX, gPinY);
      ctx.lineTo(gx, gy);
      ctx.stroke();
      ctx.fillStyle = '#67e8f9';
      ctx.beginPath();
      ctx.arc(gx, gy, 5, 0, Math.PI * 2);
      ctx.fill();
    });
    ctx.restore();
  }

  ctx.lineWidth = 4;
  ctx.strokeStyle = '#475569';
  ctx.fillStyle = '#334155';

  const counterWeightAngle = crankAngle + Math.PI;
  const cw_x = CX + (R_RADIUS + 12) * Math.sin(counterWeightAngle);
  const cw_y = CRANK_Y - (R_RADIUS + 12) * Math.cos(counterWeightAngle);

  ctx.beginPath();
  ctx.arc(CX, CRANK_Y, 20, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  ctx.lineWidth = 14;
  ctx.strokeStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(CX, CRANK_Y);
  ctx.lineTo(cw_x, cw_y);
  ctx.stroke();

  ctx.lineWidth = 16;
  ctx.strokeStyle = '#475569';
  ctx.beginPath();
  ctx.moveTo(CX, CRANK_Y);
  ctx.lineTo(C_x, C_y);
  ctx.stroke();

  ctx.fillStyle = '#64748b';
  ctx.lineWidth = 2;
  ctx.beginPath();
  ctx.arc(C_x, C_y, 11, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();
}

/** Connecting rod — intact beam, or shattered fragments when exploded. */
export function drawConnectingRod(ctx: CanvasRenderingContext2D, scene: EngineScene): void {
  const { crankAngle, crankpinX: C_x, crankpinY: C_y, pistonPinY, state } = scene;

  if (state !== EngineState.EXPLODED) {
    ctx.save();
    ctx.lineWidth = 10;
    ctx.strokeStyle = '#64748b';
    ctx.beginPath();
    ctx.moveTo(CX, pistonPinY);
    ctx.lineTo(C_x, C_y);
    ctx.stroke();

    ctx.lineWidth = 3;
    ctx.strokeStyle = '#94a3b8';
    ctx.beginPath();
    ctx.moveTo(CX - 2, pistonPinY + 15);
    ctx.lineTo(C_x - 2, C_y - 12);
    ctx.stroke();

    ctx.fillStyle = '#475569';
    ctx.lineWidth = 2;
    ctx.strokeStyle = '#1e293b';
    ctx.beginPath();
    ctx.arc(C_x, C_y, 15, crankAngle - Math.PI / 2, crankAngle + Math.PI / 2);
    ctx.stroke();

    ctx.beginPath();
    ctx.arc(CX, pistonPinY, 11, 0, Math.PI * 2);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  } else {
    ctx.save();
    ctx.lineWidth = 8;
    ctx.strokeStyle = '#450a0a';
    ctx.beginPath();
    ctx.moveTo(CX, pistonPinY);
    ctx.lineTo(CX - 15, pistonPinY + 45);
    ctx.lineTo(CX - 18, pistonPinY + 40);
    ctx.stroke();

    ctx.lineWidth = 10;
    ctx.strokeStyle = '#311005';
    ctx.beginPath();
    ctx.moveTo(C_x, C_y);
    ctx.lineTo(C_x + 18, C_y - 30);
    ctx.lineTo(C_x + 22, C_y - 25);
    ctx.stroke();

    ctx.fillStyle = '#1e293b';
    ctx.strokeStyle = '#020617';
    ctx.beginPath();
    ctx.arc(CX - 45, CRANK_Y + 15, 6, 0, Math.PI * 2);
    ctx.rect(CX + 50, CRANK_Y + 28, 8, 4);
    ctx.fill();
    ctx.stroke();
    ctx.restore();
  }
}

/** Piston body, rings, wrist pin, hot-crown discoloration. */
export function drawPiston(ctx: CanvasRenderingContext2D, scene: EngineScene): void {
  const { pistonPinY, pistonTopY, temperature, state } = scene;

  ctx.save();
  ctx.fillStyle = state === EngineState.EXPLODED ? '#450a0a' : '#94a3b8';
  ctx.strokeStyle = '#334155';
  ctx.lineWidth = 2.5;

  ctx.beginPath();
  ctx.moveTo(CX - pistonWidth / 2, pistonTopY);
  ctx.lineTo(CX + pistonWidth / 2, pistonTopY);
  ctx.lineTo(CX + pistonWidth / 2, pistonTopY + pistonHeight);
  ctx.lineTo(CX + pistonWidth / 2 - 8, pistonTopY + pistonHeight - 6);
  ctx.lineTo(CX + pistonWidth / 2 - 8, pistonTopY + pistonHeight - 20);
  ctx.lineTo(CX - pistonWidth / 2 + 8, pistonTopY + pistonHeight - 20);
  ctx.lineTo(CX - pistonWidth / 2 + 8, pistonTopY + pistonHeight - 6);
  ctx.lineTo(CX - pistonWidth / 2, pistonTopY + pistonHeight);
  ctx.closePath();
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#374151';
  for (let rOffset = 6; rOffset <= 18; rOffset += 6) {
    ctx.fillRect(CX - pistonWidth / 2 - 1, pistonTopY + rOffset, 5, 2.5);
    ctx.fillRect(CX + pistonWidth / 2 - 4, pistonTopY + rOffset, 5, 2.5);
  }

  ctx.fillStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(CX, pistonPinY, 8, 0, Math.PI * 2);
  ctx.fill();
  ctx.stroke();

  if (temperature > 75) {
    ctx.save();
    ctx.globalAlpha = Math.min(0.8, (temperature - 75) / 100);
    ctx.fillStyle = '#dc2626';
    ctx.beginPath();
    ctx.ellipse(CX, pistonTopY + 3, pistonWidth / 2 - 2, 4, 0, 0, Math.PI, false);
    ctx.fill();
    ctx.restore();
  }
  ctx.restore();
}

/** Intake + exhaust valves (open per the active stroke) and their ports. */
export function drawValves(ctx: CanvasRenderingContext2D, scene: EngineScene): void {
  const { stroke, state } = scene;
  const valW = 20;
  const vStroke = 10;

  const leftValveOpen = stroke === StrokeType.INTAKE && isRunningOrStarting(state);
  const rightValveOpen = stroke === StrokeType.EXHAUST && isRunningOrStarting(state);
  const leftDisp = leftValveOpen ? vStroke : 0;
  const rightDisp = rightValveOpen ? vStroke : 0;

  ctx.fillStyle = '#1f2937';
  ctx.beginPath();
  ctx.moveTo(133, 95);
  ctx.arc(145, 95, 12, 0, Math.PI, true);
  ctx.fill();

  ctx.beginPath();
  ctx.moveTo(247, 95);
  ctx.arc(255, 95, 12, 0, Math.PI, true);
  ctx.fill();

  ctx.save();
  ctx.lineWidth = 4;
  ctx.translate(142, 80);
  ctx.rotate(-0.4);
  ctx.strokeStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(0, -30);
  ctx.lineTo(0, leftDisp);
  ctx.stroke();
  ctx.fillStyle = '#475569';
  ctx.fillRect(-valW / 2, leftDisp, valW, 5);
  ctx.restore();

  ctx.save();
  ctx.lineWidth = 4;
  ctx.translate(258, 80);
  ctx.rotate(0.4);
  ctx.strokeStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(0, -30);
  ctx.lineTo(0, rightDisp);
  ctx.stroke();
  ctx.fillStyle = '#475569';
  ctx.fillRect(-valW / 2, rightDisp, valW, 5);
  ctx.restore();
}

/** Spark plug body and the live ignition arc when firing. */
export function drawSparkPlug(ctx: CanvasRenderingContext2D, scene: EngineScene): void {
  const plugX = CX;
  const plugY = 95;

  ctx.fillStyle = '#64748b';
  ctx.lineWidth = 1;
  ctx.strokeStyle = '#334155';
  ctx.beginPath();
  ctx.rect(plugX - 6, plugY - 25, 12, 10);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#f3f4f6';
  ctx.beginPath();
  ctx.rect(plugX - 4, plugY - 45, 8, 20);
  ctx.fill();
  ctx.stroke();

  ctx.fillStyle = '#d1d5db';
  ctx.fillRect(plugX - 5, plugY - 41, 10, 2);
  ctx.fillRect(plugX - 5, plugY - 35, 10, 2);

  ctx.fillStyle = '#1e293b';
  ctx.fillRect(plugX - 3.5, plugY - 15, 7, 13);

  ctx.lineWidth = 1.5;
  ctx.strokeStyle = '#334155';
  ctx.beginPath();
  ctx.moveTo(plugX - 3.5, plugY - 2);
  ctx.lineTo(plugX - 3.5, plugY + 3);
  ctx.lineTo(plugX - 1, plugY + 3);
  ctx.stroke();

  ctx.fillStyle = '#b45309';
  ctx.fillRect(plugX + 1, plugY - 2, 1, 4);

  if (scene.sparkActive) {
    ctx.save();
    ctx.strokeStyle = '#a855f7';
    ctx.lineWidth = 2.5;
    ctx.beginPath();
    ctx.moveTo(plugX + 1, plugY + 2);
    for (let branch = 0; branch < 3; branch++) {
      let currentX = plugX + 1;
      let currentY = plugY + 2;
      ctx.beginPath();
      ctx.moveTo(currentX, currentY);
      for (let step = 0; step < 5; step++) {
        currentX += Math.random() * 12 - 6;
        currentY += Math.random() * 8 + 4;
        ctx.lineTo(currentX, currentY);
      }
      ctx.stroke();
    }
    ctx.fillStyle = 'rgba(168, 85, 247, 0.28)';
    ctx.beginPath();
    ctx.arc(plugX + 1, plugY + 12, 35, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

/** Overheat vignette + failure / state overlays (explosion, seize, stall, cranking). */
export function drawStateOverlays(ctx: CanvasRenderingContext2D, scene: EngineScene): void {
  const { state, temperature } = scene;

  if (temperature > 120) {
    const heatGrad = ctx.createRadialGradient(CX, CRANK_Y, 50, CX, CRANK_Y, 240);
    heatGrad.addColorStop(0, 'rgba(239, 68, 68, 0)');
    const heatPulseVolume = 0.1 + 0.12 * Math.sin(Date.now() / 150);
    heatGrad.addColorStop(1, `rgba(239, 68, 68, ${Math.min(0.6, (temperature - 100) / 100) * heatPulseVolume})`);
    ctx.fillStyle = heatGrad;
    ctx.fillRect(0, 0, W_WIDTH, W_HEIGHT);
  }

  if (state === EngineState.EXPLODED) {
    ctx.strokeStyle = '#ef4444';
    ctx.lineWidth = 4;
    ctx.beginPath();
    ctx.moveTo(110, 160);
    ctx.lineTo(82, 140);
    ctx.lineTo(95, 120);
    ctx.moveTo(290, 180);
    ctx.lineTo(320, 195);
    ctx.lineTo(310, 220);
    ctx.stroke();

    ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
    ctx.fillRect(0, 0, W_WIDTH, W_HEIGHT);

    ctx.font = 'bold 36px var(--font-display)';
    ctx.fillStyle = '#ef4444';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 8;
    ctx.fillText('发动机已报销', CX, 220);
    ctx.fillText('CRITICAL WRECK', CX, 264);

    ctx.font = '14px var(--font-mono)';
    ctx.fillStyle = '#fca5a5';
    ctx.fillText('检测到活塞拉缸与连杆断裂', CX, 305);
    ctx.fillText('请点击右侧“完整修复”按钮', CX, 325);
    ctx.shadowBlur = 0;
  } else if (state === EngineState.SEIZED) {
    ctx.fillStyle = 'rgba(239, 68, 68, 0.15)';
    ctx.fillRect(0, 0, W_WIDTH, W_HEIGHT);

    ctx.font = 'bold 36px var(--font-display)';
    ctx.fillStyle = '#f97316';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 8;
    ctx.fillText('发动机已拉缸锁死', CX, 210);
    ctx.fillText('SEIZED / STUCK', CX, 255);

    ctx.font = '14px var(--font-sans)';
    ctx.fillStyle = '#ffedd5';
    ctx.fillText('缸体温度过高且未充分润滑导致抱死', CX, 295);
    ctx.fillText('请进行降温与全面大修', CX, 315);
    ctx.shadowBlur = 0;
  } else if (state === EngineState.STALLED) {
    ctx.font = 'bold 20px var(--font-display)';
    ctx.fillStyle = '#9ca3af';
    ctx.textAlign = 'center';
    ctx.shadowColor = '#000000';
    ctx.shadowBlur = 4;
    ctx.fillText('● 熄火 STALLED', CX, 455);
    ctx.shadowBlur = 0;
  } else if (state === EngineState.STARTING) {
    ctx.font = 'bold 15px var(--font-mono)';
    ctx.fillStyle = '#fbbf24';
    ctx.textAlign = 'center';
    ctx.fillText('⚡ CRANKING...', CX, 455);
  }
}

/** On-canvas instrument cluster: tach arc + water-temp / oil-pressure bars. */
export function drawInstrumentCluster(ctx: CanvasRenderingContext2D, scene: EngineScene): void {
  if (scene.state === EngineState.EXPLODED) return;
  const { rpm, redlineRpm, temperature, oilPressure } = scene;

  const gx = 56;
  const gy = 430;
  const gr = 34;
  const startA = Math.PI * 0.75;
  const endA = Math.PI * 2.25;

  ctx.lineWidth = 6;
  ctx.strokeStyle = '#1e293b';
  ctx.beginPath();
  ctx.arc(gx, gy, gr, startA, endA);
  ctx.stroke();

  const redFrac = redlineRpm / (redlineRpm * 1.18);
  ctx.strokeStyle = '#7f1d1d';
  ctx.beginPath();
  ctx.arc(gx, gy, gr, startA + (endA - startA) * redFrac, endA);
  ctx.stroke();

  const rpmFrac = Math.max(0, Math.min(1, rpm / (redlineRpm * 1.18)));
  const overRed = rpm > redlineRpm;
  ctx.strokeStyle = overRed ? '#ef4444' : rpm > redlineRpm * 0.82 ? '#f59e0b' : '#10b981';
  ctx.lineWidth = 6;
  ctx.beginPath();
  ctx.arc(gx, gy, gr, startA, startA + (endA - startA) * rpmFrac);
  ctx.stroke();

  ctx.fillStyle = overRed ? '#ef4444' : '#e2e8f0';
  ctx.font = 'bold 13px var(--font-mono)';
  ctx.textAlign = 'center';
  ctx.fillText(`${Math.round(rpm)}`, gx, gy + 2);
  ctx.fillStyle = '#64748b';
  ctx.font = '8px var(--font-mono)';
  ctx.fillText('RPM', gx, gy + 14);

  const bx = 280;
  const bw = 96;
  let by = 410;
  ctx.fillStyle = '#64748b';
  ctx.font = '9px var(--font-mono)';
  ctx.textAlign = 'left';
  ctx.fillText('水温 WATER', bx, by - 4);
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(bx, by, bw, 6);
  const tFrac = Math.max(0, Math.min(1, (temperature - 25) / 135));
  ctx.fillStyle = temperature > 120 ? '#ef4444' : temperature > 95 ? '#f59e0b' : '#22d3ee';
  ctx.fillRect(bx, by, bw * tFrac, 6);
  ctx.fillStyle = '#94a3b8';
  ctx.textAlign = 'right';
  ctx.fillText(`${Math.round(temperature)}°C`, bx + bw, by - 4);

  by = 440;
  ctx.fillStyle = '#64748b';
  ctx.textAlign = 'left';
  ctx.fillText('油压 OIL', bx, by - 4);
  ctx.fillStyle = '#0b1220';
  ctx.fillRect(bx, by, bw, 6);
  const oFrac = Math.max(0, Math.min(1, oilPressure / 6));
  const lowOil = oilPressure < 0.8 && rpm > 200;
  ctx.fillStyle = lowOil ? '#ef4444' : '#38bdf8';
  ctx.fillRect(bx, by, bw * oFrac, 6);
  ctx.fillStyle = lowOil ? '#fca5a5' : '#94a3b8';
  ctx.textAlign = 'right';
  ctx.fillText(`${oilPressure.toFixed(1)} bar`, bx + bw, by - 4);
  ctx.textAlign = 'left';
}

/** Top-left stroke-phase legend (highlights the active stroke). */
export function drawStrokeLegend(ctx: CanvasRenderingContext2D, scene: EngineScene): void {
  const { state, stroke } = scene;
  if (state === EngineState.EXPLODED || state === EngineState.SEIZED) return;

  ctx.font = 'bold 12px var(--font-mono)';
  ctx.textAlign = 'left';

  ctx.fillStyle = stroke === StrokeType.INTAKE ? '#3b82f6' : '#4b5563';
  ctx.fillText('1. 进气 INTAKE', 14, 25);

  ctx.fillStyle = stroke === StrokeType.COMPRESSION ? '#f59e0b' : '#4b5563';
  ctx.fillText('2. 压缩 COMPRESSION', 14, 45);

  ctx.fillStyle = stroke === StrokeType.POWER ? '#ef4444' : '#4b5563';
  ctx.fillText('3. 动力 POWER', 230, 25);

  ctx.fillStyle = stroke === StrokeType.EXHAUST ? '#9ca3af' : '#4b5563';
  ctx.fillText('4. 排气 EXHAUST', 230, 45);
}
