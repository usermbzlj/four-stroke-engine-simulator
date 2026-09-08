/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { EngineState, StrokeType } from '../types';

/** A lightweight 2D particle for intake spray / combustion flame / exhaust soot / debris. */
export class Particle {
  x: number;
  y: number;
  vx: number;
  vy: number;
  life: number;
  maxLife: number;
  size: number;
  color: string;

  constructor(x: number, y: number, vx: number, vy: number, maxLife: number, size: number, color: string) {
    this.x = x;
    this.y = y;
    this.vx = vx;
    this.vy = vy;
    this.life = maxLife;
    this.maxLife = maxLife;
    this.size = size;
    this.color = color;
  }

  update(): void {
    this.x += this.vx;
    this.y += this.vy;
    this.life--;
  }

  draw(ctx: CanvasRenderingContext2D): void {
    ctx.save();
    ctx.globalAlpha = this.life / this.maxLife;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

const MAX_PARTICLES = 400;

export interface SpawnContext {
  particles: Particle[];
  state: EngineState;
  stroke: StrokeType;
  throttle: number;
  oilLevel: number;
  temperature: number;
  nosActive: boolean;
  pistonTopY: number;
  pistonPinY: number;
  geometry: { CX: number; pistonWidth: number };
}

/** Geometry-driven particle emitters per stroke; mirrors the original spawn logic. */
export function spawnStrokeParticles(ctx: SpawnContext): void {
  const { particles: p, state, stroke, throttle, nosActive, pistonTopY } = ctx;
  const running = state === EngineState.RUNNING || state === EngineState.STARTING;
  if (!running || p.length >= MAX_PARTICLES) return;

  if (stroke === StrokeType.INTAKE) {
    const sprayCount = Math.floor(2 + throttle * 4);
    for (let i = 0; i < sprayCount; i++) {
      p.push(
        new Particle(
          156,
          95,
          Math.random() * 2 + 1,
          Math.random() * 4 + 1.5,
          40 + Math.random() * 15,
          Math.random() * 3.5 + 1.5,
          `rgba(59, 130, 246, ${0.4 + Math.random() * 0.4})`
        )
      );
    }
  } else if (stroke === StrokeType.POWER && state === EngineState.RUNNING) {
    const fireCount = Math.floor(1 + throttle * 3);
    for (let i = 0; i < fireCount; i++) {
      p.push(
        new Particle(
          ctx.geometry.CX + (Math.random() * 20 - 10),
          105,
          ((Math.random() * 6 - 3) * (pistonTopY - 100)) / 100,
          Math.random() * 5 + 2,
          15 + Math.random() * 15,
          Math.random() * 12 + 6,
          nosActive
            ? '#a855f7'
            : Math.random() > 0.4
            ? 'rgba(249, 115, 22, 0.7)'
            : 'rgba(234, 179, 8, 0.7)'
        )
      );
    }
  } else if (stroke === StrokeType.EXHAUST) {
    const sootCount = 1 + Math.floor(throttle * 3);
    for (let i = 0; i < sootCount; i++) {
      p.push(
        new Particle(
          220 + Math.random() * 15,
          100 + Math.random() * 10,
          Math.random() * 3 + 2,
          Math.random() * -3 - 2,
          50 + Math.random() * 25,
          Math.random() * 5 + 3,
          `rgba(107, 114, 128, ${0.3 + Math.random() * 0.4})`
        )
      );
    }
  }
}

/** Metal-on-metal sparks emitted when running dry / overheating. */
export function spawnSeizureSparks(ctx: SpawnContext): void {
  const { particles: p, state, oilLevel, temperature, pistonPinY } = ctx;
  if (state !== EngineState.RUNNING || p.length >= MAX_PARTICLES) return;
  if (!(oilLevel < 15 || temperature > 115)) return;
  if (Math.random() >= 0.25) return;

  for (let i = 0; i < 5; i++) {
    p.push(
      new Particle(
        ctx.geometry.CX + (Math.random() * ctx.geometry.pistonWidth - ctx.geometry.pistonWidth / 2),
        pistonPinY + (Math.random() * 10 - 5),
        Math.random() * 6 - 3,
        Math.random() * 3 - 1,
        30 + Math.random() * 20,
        1.5,
        '#eab308'
      )
    );
  }
}

/** Catastrophic explosion burst (fireballs + metal shards). */
export function spawnExplosion(particles: Particle[], CX: number): void {
  for (let i = 0; i < 80; i++) {
    particles.push(
      new Particle(
        CX + (Math.random() * 60 - 30),
        120 + (Math.random() * 80 - 40),
        Math.random() * 8 - 4,
        Math.random() * -10,
        100 + Math.random() * 50,
        Math.random() * 6 + 3,
        Math.random() > 0.5 ? '#f97316' : Math.random() > 0.3 ? '#ef4444' : '#eab308'
      )
    );
  }
  for (let i = 0; i < 40; i++) {
    particles.push(
      new Particle(
        CX + (Math.random() * 80 - 40),
        300 + (Math.random() * 100 - 50),
        Math.random() * 14 - 7,
        Math.random() * -6 - 2,
        80 + Math.random() * 40,
        Math.random() * 3 + 1,
        '#fbbf24'
      )
    );
  }
}
