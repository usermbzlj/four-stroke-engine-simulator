/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState, MouseEvent } from 'react';
import { EngineState, StrokeType, ComponentWear } from '../types';
import { advanceReadableCrankAngle, getReadableVisualRpm, strokeFromCrankAngle } from '../utils/engineVisuals';
interface EngineCanvasProps {
  state: EngineState;
  stroke: StrokeType;
  crankAngle: number; // in radians
  throttle: number;
  oilLevel: number;
  temperature: number; // calculated celsius
  oilPressure: number; // bar
  wear: ComponentWear;
  nosActive: boolean;
  redlineRpm: number;
  rpm: number;
  onCrankDrag?: (newAngle: number) => void;
  onManualSpark?: () => void;
}

// Particle helper classes
class Particle {
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

  update() {
    this.x += this.vx;
    this.y += this.vy;
    this.life--;
  }

  draw(ctx: CanvasRenderingContext2D) {
    ctx.save();
    ctx.globalAlpha = this.life / this.maxLife;
    ctx.fillStyle = this.color;
    ctx.beginPath();
    ctx.arc(this.x, this.y, this.size, 0, Math.PI * 2);
    ctx.fill();
    ctx.restore();
  }
}

export default function EngineCanvas({
  state,
  stroke,
  crankAngle,
  throttle,
  oilLevel,
  temperature,
  oilPressure,
  wear,
  nosActive,
  redlineRpm,
  rpm,
  onCrankDrag,
  onManualSpark
}: EngineCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const sparkTriggerRef = useRef<boolean>(false);
  const lastStateRef = useRef<EngineState>(state);
  const lastRenderTimeRef = useRef<number>(0);
  const visualAngleRef = useRef<number>(crankAngle);
  const [isDragging, setIsDragging] = useState(false);

  const W_WIDTH = 400;
  const W_HEIGHT = 480;
  const CX = 200;
  const CRANK_Y = 370;
  const R_RADIUS = 48;
  const CONROD_LEN = 135;
  const pistonWidth = 84;
  const pistonHeight = 52;

  const propsRef = useRef({ state, stroke, crankAngle, throttle, oilLevel, temperature, oilPressure, wear, nosActive, redlineRpm, rpm });
  propsRef.current = { state, stroke, crankAngle, throttle, oilLevel, temperature, oilPressure, wear, nosActive, redlineRpm, rpm };

  // Handle Explosion particles
  useEffect(() => {
    if (state === EngineState.EXPLODED && lastStateRef.current !== EngineState.EXPLODED) {
      // Trigger catastrophic explosion particles
      const p = particlesRef.current;
      for (let i = 0; i < 80; i++) {
        p.push(new Particle(
          CX + (Math.random() * 60 - 30),
          120 + (Math.random() * 80 - 40),
          Math.random() * 8 - 4,
          Math.random() * -10,
          100 + Math.random() * 50,
          Math.random() * 6 + 3,
          Math.random() > 0.5 ? '#f97316' : Math.random() > 0.3 ? '#ef4444' : '#eab308'
        ));
      }
      // Mechanical shards / metallic sparks
      for (let i = 0; i < 40; i++) {
        p.push(new Particle(
          CX + (Math.random() * 80 - 40),
          300 + (Math.random() * 100 - 50),
          Math.random() * 14 - 7,
          Math.random() * -6 - 2,
          80 + Math.random() * 40,
          Math.random() * 3 + 1,
          '#fbbf24'
        ));
      }
    }
    lastStateRef.current = state;
  }, [state]);

  // Manage animation particles (intake spray, combustion exhaust, oil sparkles)
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameId: number;

    const render = () => {
      const {
        state,
        stroke: actualStroke,
        crankAngle: physicalCrankAngle,
        throttle,
        oilLevel,
        temperature,
        oilPressure,
        wear,
        nosActive,
        redlineRpm,
        rpm,
      } = propsRef.current;

      const now = performance.now();
      const dt = lastRenderTimeRef.current ? Math.min(0.05, (now - lastRenderTimeRef.current) / 1000) : 1 / 60;
      lastRenderTimeRef.current = now;

      const visualMotion = advanceReadableCrankAngle({
        previousAngle: visualAngleRef.current,
        physicalAngle: physicalCrankAngle,
        rpm,
        dt,
        state,
      });
      visualAngleRef.current = visualMotion.angle;

      const crankAngle = visualMotion.angle;
      const stroke = visualMotion.mode === 'readable' ? strokeFromCrankAngle(crankAngle) : actualStroke;
      const highRpmReadable = visualMotion.mode === 'readable';

      const C_x = CX + R_RADIUS * Math.sin(crankAngle);
      const C_y = CRANK_Y - R_RADIUS * Math.cos(crankAngle);
      const dy = C_x - CX;
      const pistonPinY = C_y - Math.sqrt(Math.max(0.1, CONROD_LEN * CONROD_LEN - dy * dy));
      const pistonTopY = pistonPinY - 32;

      const angleDeg = ((crankAngle * 180) / Math.PI) % 720;
      if (state === EngineState.RUNNING && stroke === StrokeType.POWER && Math.abs(angleDeg - 360) < 12) {
        if (!sparkTriggerRef.current) {
          sparkTriggerRef.current = true;
          setTimeout(() => { sparkTriggerRef.current = false; }, 70);
        }
      }

      ctx.clearRect(0, 0, W_WIDTH, W_HEIGHT);

      // Draw elegant container backdrop
      ctx.fillStyle = '#0f172a';
      ctx.fillRect(0, 0, W_WIDTH, W_HEIGHT);

      // Procedural particle updates
      const p = particlesRef.current;
      
      // Inject stroke particles dynamically (cap at 400 to prevent GC pressure)
      if ((state === EngineState.RUNNING || state === EngineState.STARTING) && p.length < 400) {
        if (stroke === StrokeType.INTAKE) {
          // Intake valve coordinates (Left, approx. (150, 95))
          // Blue spray particles
          const sprayCount = Math.floor(2 + throttle * 4);
          for (let i = 0; i < sprayCount; i++) {
            p.push(new Particle(
              156, 95,
              Math.random() * 2 + 1, // diagonal right-down
              Math.random() * 4 + 1.5,
              40 + Math.random() * 15,
              Math.random() * 3.5 + 1.5,
              `rgba(59, 130, 246, ${0.4 + Math.random() * 0.4})` // blue
            ));
          }
        } else if (stroke === StrokeType.POWER) {
          // Flame fireballs
          if (state === EngineState.RUNNING) {
            const fireCount = Math.floor(1 + throttle * 3);
            for (let i = 0; i < fireCount; i++) {
              p.push(new Particle(
                CX + (Math.random() * 20 - 10),
                105,
                (Math.random() * 6 - 3) * (pistonTopY - 100) / 100, // spreads within piston bounds
                Math.random() * 5 + 2,
                15 + Math.random() * 15,
                Math.random() * 12 + 6,
                nosActive ? '#a855f7' : Math.random() > 0.4 ? 'rgba(249, 115, 22, 0.7)' : 'rgba(234, 179, 8, 0.7)' // Purple (NOS) vs orange/yellow (fuel)
              ));
            }
          }
        } else if (stroke === StrokeType.EXHAUST) {
          // Exhaust valve coordinates (Right, approx. (244, 95))
          // Gray carbon smoke particles
          const sootCount = 1 + Math.floor(throttle * 3);
          for (let i = 0; i < sootCount; i++) {
            // Leak out of cylinder right head
            p.push(new Particle(
              220 + Math.random() * 15,
              100 + Math.random() * 10,
              Math.random() * 3 + 2, // diagonal right-up
              Math.random() * -3 - 2,
              50 + Math.random() * 25,
              Math.random() * 5 + 3,
              `rgba(107, 114, 128, ${0.3 + Math.random() * 0.4})` // grey smoke
            ));
          }
        }
      }

      // Seizure metal sparks
      if (state === EngineState.RUNNING && (oilLevel < 15 || temperature > 115) && p.length < 400) {
        if (Math.random() < 0.25) {
          for (let i = 0; i < 5; i++) {
            p.push(new Particle(
              CX + (Math.random() * pistonWidth - pistonWidth/2),
              pistonPinY + (Math.random() * 10 - 5),
              Math.random() * 6 - 3,
              Math.random() * 3 - 1,
              30 + Math.random() * 20,
              1.5,
              '#eab308'
            ));
          }
        }
      }

      // Render and filter particles
      particlesRef.current = p.filter((part) => {
        part.update();
        part.draw(ctx);
        return part.life > 0;
      });

      // ==========================================
      // DRAW ENGINE COMPONENTS (STATIC / BACKGROUND)
      // ==========================================
      
      // Exhaust pipeline (Right, metallic grey out)
      ctx.lineWidth = 14;
      ctx.strokeStyle = '#374151';
      ctx.beginPath();
      ctx.moveTo(240, 95);
      ctx.quadraticCurveTo(340, 95, 340, 60);
      ctx.stroke();

      // Exhaust pipe heat glow if hot
      if (temperature > 90) {
        ctx.save();
        ctx.globalAlpha = Math.min(0.7, (temperature - 90) / 100);
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

      // ==========================================
      // UNDER-CRANK FLYWHEEL BASEMENT
      // ==========================================
      ctx.lineWidth = 2;
      ctx.strokeStyle = '#1e293b';
      ctx.fillStyle = '#111827';
      ctx.beginPath();
      ctx.arc(CX, CRANK_Y, R_RADIUS + 35, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // Draw Oil bath inside crankcase
      const minWearFactor = wear.pistonRings / 100;
      const oilY = CRANK_Y + R_RADIUS + 25 - (oilLevel * 0.15);
      ctx.fillStyle = minWearFactor < 0.4 ? '#4a3f35' : 'rgba(234, 179, 8, 0.45)'; // dark sludge vs clean golden oil
      ctx.beginPath();
      ctx.arc(CX, CRANK_Y, R_RADIUS + 33, Math.PI * 0.1, Math.PI * 0.9);
      ctx.lineTo(CX - (R_RADIUS + 32) * Math.sin(Math.PI*0.4), oilY);
      ctx.fill();

      // ==========================================
      // CYLINDER WALL / BLOCK
      // ==========================================
      const wallLeft = CX - pistonWidth / 2 - 10;
      const wallRight = CX + pistonWidth / 2 + 10;
      
      // Cylinder block jackets (heat dispersion structure)
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

      // Draw heat-jacket thermal glow (based on cylinder temperature)
      if (temperature > 40) {
        ctx.save();
        ctx.globalAlpha = Math.min(0.5, (temperature - 40) / 150);
        ctx.fillStyle = '#f87171';
        for (let h = 100; h <= 280; h += 24) {
          ctx.beginPath();
          ctx.arc(wallLeft - 10, h, 6, 0, Math.PI * 2);
          ctx.arc(wallRight + 10, h, 6, 0, Math.PI * 2);
          ctx.fill();
        }
        ctx.restore();
      }

      // Cylinder inner wall surface
      ctx.lineWidth = 4;
      ctx.strokeStyle = state === EngineState.EXPLODED ? '#7f1d1d' : '#4b5563';
      ctx.beginPath();
      ctx.moveTo(wallLeft, 80);
      ctx.lineTo(wallLeft, 305);
      ctx.moveTo(wallRight, 80);
      ctx.lineTo(wallRight, 305);
      ctx.stroke();

      // Wear scratches inside cylinder walls if physical damage is present
      if (wear.cylinderWall < 70) {
        ctx.strokeStyle = 'rgba(224, 242, 254, 0.25)';
        ctx.lineWidth = 1;
        ctx.beginPath();
        for (let wIndex = 0; wIndex < 5; wIndex++) {
          const rx = wallLeft + 3 + (wIndex * 15) % 15;
          ctx.moveTo(rx, 110);
          ctx.lineTo(rx, 260);

          const rx2 = wallRight - 3 - (wIndex * 17) % 15;
          ctx.moveTo(rx2, 120);
          ctx.lineTo(rx2, 250);
        }
        ctx.stroke();
      }

      // ==========================================
      // CYLINDER CHAMBER COLOR WASH (Stroke Gas Indicator)
      // ==========================================
      if (state !== EngineState.EXPLODED) {
        ctx.save();
        const pathMaxY = Math.max(120, pistonTopY);
        ctx.beginPath();
        ctx.moveTo(wallLeft + 2, 95);
        ctx.lineTo(wallLeft + 2, pathMaxY);
        ctx.lineTo(wallRight - 2, pathMaxY);
        ctx.lineTo(wallRight - 2, 95);
        ctx.closePath();
        ctx.clip();

        if (stroke === StrokeType.INTAKE && (state === EngineState.RUNNING || state === EngineState.STARTING)) {
          // Rich/Lean intake blend wash (Standard: blue, Lean: lighter cyan, Rich: darker blue/purple)
          ctx.fillStyle = 'rgba(59, 130, 246, 0.18)';
          ctx.fill();
        } else if (stroke === StrokeType.COMPRESSION) {
          // Compressed state (soft ambient yellowish white)
          ctx.fillStyle = `rgba(254, 243, 199, ${0.1 + (0.15 * (1 - (pistonTopY - 100) / 100))})`;
          ctx.fill();
        } else if (stroke === StrokeType.POWER && state === EngineState.RUNNING) {
          // Live combustion (warm amber/orange glow)
          const grad = ctx.createLinearGradient(CX, 95, CX, pistonTopY);
          grad.addColorStop(0, nosActive ? 'rgba(168, 85, 247, 0.55)' : 'rgba(239, 68, 68, 0.55)');
          grad.addColorStop(0.3, nosActive ? 'rgba(192, 132, 252, 0.45)' : 'rgba(249, 115, 22, 0.45)');
          grad.addColorStop(1, 'rgba(245, 158, 11, 0.1)');
          ctx.fillStyle = grad;
          ctx.fill();
        } else if (stroke === StrokeType.EXHAUST && (state === EngineState.RUNNING || state === EngineState.STARTING)) {
          // Exhaust fumes wash (dirty grey)
          ctx.fillStyle = 'rgba(156, 163, 175, 0.14)';
          ctx.fill();
        }
        ctx.restore();
      }

      // ==========================================
      // CRANKSHAFT AND FLYWHEEL
      // ==========================================
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

      // Counterweight shape (opposite to the crankpin)
      const counterWeightAngle = crankAngle + Math.PI;
      const cw_x = CX + (R_RADIUS + 12) * Math.sin(counterWeightAngle);
      const cw_y = CRANK_Y - (R_RADIUS + 12) * Math.cos(counterWeightAngle);

      ctx.beginPath();
      ctx.arc(CX, CRANK_Y, 20, 0, Math.PI * 2); // main journal center
      ctx.fill();
      ctx.stroke();

      // Draw counterweight arm
      ctx.lineWidth = 14;
      ctx.strokeStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(CX, CRANK_Y);
      ctx.lineTo(cw_x, cw_y);
      ctx.stroke();

      // Crankpin link arm
      ctx.lineWidth = 16;
      ctx.strokeStyle = '#475569';
      ctx.beginPath();
      ctx.moveTo(CX, CRANK_Y);
      ctx.lineTo(C_x, C_y);
      ctx.stroke();

      // Crankpin pin
      ctx.fillStyle = '#64748b';
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.arc(C_x, C_y, 11, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      // ==========================================
      // CONNECTING ROD
      // ==========================================
      if (state !== EngineState.EXPLODED) {
        // Conrod body shank (tapered beam)
        ctx.save();
        ctx.lineWidth = 10;
        ctx.strokeStyle = '#64748b';
        ctx.beginPath();
        ctx.moveTo(CX, pistonPinY);
        ctx.lineTo(C_x, C_y);
        ctx.stroke();

        // High gloss details on con-rod
        ctx.lineWidth = 3;
        ctx.strokeStyle = '#94a3b8';
        ctx.beginPath();
        ctx.moveTo(CX - 2, pistonPinY + 15);
        ctx.lineTo(C_x - 2, C_y - 12);
        ctx.stroke();

        // Hemi-end rod cap at crankpin
        ctx.fillStyle = '#475569';
        ctx.lineWidth = 2;
        ctx.strokeStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(C_x, C_y, 15, crankAngle - Math.PI/2, crankAngle + Math.PI/2);
        ctx.stroke();

        // Small wristpin cap at piston
        ctx.beginPath();
        ctx.arc(CX, pistonPinY, 11, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      } else {
        // DETONATED/EXPLODED STATE: Broken Connecting Rod laying shattered!
        ctx.save();
        // Drawing shattered top part attached to piston
        ctx.lineWidth = 8;
        ctx.strokeStyle = '#450a0a';
        ctx.beginPath();
        ctx.moveTo(CX, pistonPinY);
        // Snapped jagged coordinate
        ctx.lineTo(CX - 15, pistonPinY + 45);
        ctx.lineTo(CX - 18, pistonPinY + 40);
        ctx.stroke();

        // Draw shattered bottom part flying off to bottom-left of crankcase
        ctx.lineWidth = 10;
        ctx.strokeStyle = '#311005';
        ctx.beginPath();
        ctx.moveTo(C_x, C_y);
        ctx.lineTo(C_x + 18, C_y - 30);
        ctx.lineTo(C_x + 22, C_y - 25);
        ctx.stroke();

        // Loose metal fragments floating in the oil
        ctx.fillStyle = '#1e293b';
        ctx.strokeStyle = '#020617';
        ctx.beginPath();
        ctx.arc(CX - 45, CRANK_Y + 15, 6, 0, Math.PI * 2);
        ctx.rect(CX + 50, CRANK_Y + 28, 8, 4);
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }

      // ==========================================
      // PISTON
      // ==========================================
      ctx.save();
      ctx.fillStyle = state === EngineState.EXPLODED ? '#450a0a' : '#94a3b8';
      ctx.strokeStyle = '#334155';
      ctx.lineWidth = 2.5;

      // Draw Piston main structure (with wrist pin socket recess)
      ctx.beginPath();
      // Side profile skirts
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

      // Piston Rings lines (3 compression ring channels on piston crown sides)
      ctx.fillStyle = '#374151';
      for (let rOffset = 6; rOffset <= 18; rOffset += 6) {
        ctx.fillRect(CX - pistonWidth/2 - 1, pistonTopY + rOffset, 5, 2.5);
        ctx.fillRect(CX + pistonWidth/2 - 4, pistonTopY + rOffset, 5, 2.5);
      }

      // Wrist Pin hole
      ctx.fillStyle = '#1e293b';
      ctx.beginPath();
      ctx.arc(CX, pistonPinY, 8, 0, Math.PI*2);
      ctx.fill();
      ctx.stroke();

      // Heat discoloration/damage on piston dome crown if hot
      if (temperature > 75) {
        ctx.save();
        ctx.globalAlpha = Math.min(0.8, (temperature - 75) / 100);
        ctx.fillStyle = '#dc2626'; // hot red crown top washed down
        ctx.beginPath();
        ctx.ellipse(CX, pistonTopY + 3, pistonWidth/2 - 2, 4, 0, 0, Math.PI, false);
        ctx.fill();
        ctx.restore();
      }
      ctx.restore();

      // ==========================================
      // VALVES AND PORT INT/EXH (Cylinder Top Head)
      // ==========================================
      // Valve dimensions
      const valW = 20;
      const vStroke = 10; // Max valve opening push displacement
      
      const leftValveOpen = stroke === StrokeType.INTAKE && (state === EngineState.RUNNING || state === EngineState.STARTING);
      const rightValveOpen = stroke === StrokeType.EXHAUST && (state === EngineState.RUNNING || state === EngineState.STARTING);

      const leftDisp = leftValveOpen ? vStroke : 0;
      const rightDisp = rightValveOpen ? vStroke : 0;

      // Draw left port channel openings
      ctx.fillStyle = '#1f2937';
      ctx.beginPath();
      ctx.moveTo(133, 95);
      ctx.arc(145, 95, 12, 0, Math.PI, true);
      ctx.fill();

      // Draw right port channel openings
      ctx.beginPath();
      ctx.moveTo(247, 95);
      ctx.arc(255, 95, 12, 0, Math.PI, true);
      ctx.fill();

      // 1. Intake Valve (Left) diagonally actuated
      ctx.save();
      ctx.lineWidth = 4;
      const intAngle = -0.4;
      ctx.translate(142, 80);
      ctx.rotate(intAngle);
      ctx.strokeStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(0, -30);
      ctx.lineTo(0, leftDisp);
      ctx.stroke();
      ctx.fillStyle = '#475569';
      ctx.fillRect(-valW/2, leftDisp, valW, 5);
      ctx.restore();

      // 2. Exhaust Valve (Right) diagonally actuated
      ctx.save();
      ctx.lineWidth = 4;
      const exhAngle = 0.4;
      ctx.translate(258, 80);
      ctx.rotate(exhAngle);
      ctx.strokeStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(0, -30);
      ctx.lineTo(0, rightDisp);
      ctx.stroke();
      ctx.fillStyle = '#475569';
      ctx.fillRect(-valW/2, rightDisp, valW, 5);
      ctx.restore();

      // ==========================================
      // SPARK PLUG (TOP HEAD CENTER)
      // ==========================================
      const plugX = CX;
      const plugY = 95;

      // Plug steel shell
      ctx.fillStyle = '#64748b';
      ctx.lineWidth = 1;
      ctx.strokeStyle = '#334155';
      ctx.beginPath();
      ctx.rect(plugX - 6, plugY - 25, 12, 10);
      ctx.fill();
      ctx.stroke();

      // Ceramics body
      ctx.fillStyle = '#f3f4f6';
      ctx.beginPath();
      ctx.rect(plugX - 4, plugY - 45, 8, 20);
      ctx.fill();
      ctx.stroke();

      // Corrugation cooling ridges on ceramics
      ctx.fillStyle = '#d1d5db';
      ctx.fillRect(plugX - 5, plugY - 41, 10, 2);
      ctx.fillRect(plugX - 5, plugY - 35, 10, 2);

      // Plug tip threads extending into bore
      ctx.fillStyle = '#1e293b';
      ctx.fillRect(plugX - 3.5, plugY - 15, 7, 13);
      
      // Ground electrode bent arm
      ctx.lineWidth = 1.5;
      ctx.strokeStyle = '#334155';
      ctx.beginPath();
      ctx.moveTo(plugX - 3.5, plugY - 2);
      ctx.lineTo(plugX - 3.5, plugY + 3);
      ctx.lineTo(plugX - 1, plugY + 3);
      ctx.stroke();

      // Center electrode rod tip
      ctx.fillStyle = '#b45309';
      ctx.fillRect(plugX + 1, plugY - 2, 1, 4);

      // LIVE SPARK IGNITION GRAPHICS (cyan electrifying lighting)
      if (sparkTriggerRef.current) {
        ctx.save();
        ctx.strokeStyle = '#a855f7'; // high energy electric mauve violet
        ctx.lineWidth = 2.5;
        
        ctx.beginPath();
        ctx.moveTo(plugX + 1, plugY + 2);

        // Draw multiple jagged crackling branches
        let currentX = plugX + 1;
        let currentY = plugY + 2;
        for (let branch = 0; branch < 3; branch++) {
          currentX = plugX + 1;
          currentY = plugY + 2;
          ctx.beginPath();
          ctx.moveTo(currentX, currentY);
          for (let step = 0; step < 5; step++) {
            currentX += (Math.random() * 12 - 6);
            currentY += (Math.random() * 8 + 4);
            ctx.lineTo(currentX, currentY);
          }
          ctx.stroke();
        }
        
        // Add ambient flash glow
        ctx.fillStyle = 'rgba(168, 85, 247, 0.28)';
        ctx.beginPath();
        ctx.arc(plugX + 1, plugY + 12, 35, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }

      // ==========================================
      // OVERHEATING / SMOKE WRECKAGE OVERLAY
      // ==========================================
      if (temperature > 120) {
        // Red heating warning vignette around canvas
        const heatGrad = ctx.createRadialGradient(CX, CRANK_Y, 50, CX, CRANK_Y, 240);
        heatGrad.addColorStop(0, 'rgba(239, 68, 68, 0)');
        const heatPulseVolume = 0.1 + 0.12 * Math.sin(Date.now() / 150);
        heatGrad.addColorStop(1, `rgba(239, 68, 68, ${Math.min(0.6, (temperature - 100) / 100) * heatPulseVolume})`);
        ctx.fillStyle = heatGrad;
        ctx.fillRect(0, 0, W_WIDTH, W_HEIGHT);
      }

      if (state === EngineState.EXPLODED) {
        // Catastrophic structural cracks overlaid
        ctx.strokeStyle = '#ef4444';
        ctx.lineWidth = 4;
        ctx.beginPath();
        // Left cracking
        ctx.moveTo(110, 160);
        ctx.lineTo(82, 140);
        ctx.lineTo(95, 120);
        // Right cracking
        ctx.moveTo(290, 180);
        ctx.lineTo(320, 195);
        ctx.lineTo(310, 220);
        ctx.stroke();

        // Overlay smoke screen
        ctx.fillStyle = 'rgba(15, 23, 42, 0.45)';
        ctx.fillRect(0, 0, W_WIDTH, W_HEIGHT);

        // Giant warning
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
        // Seized locked overlay
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
        // Soft stall alert
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

      // ==========================================
      // INSTRUMENT CLUSTER (tach arc + temp + oil)
      // ==========================================
      if (state !== EngineState.EXPLODED) {
        // --- Tachometer arc (bottom-left corner) ---
        const gx = 56;
        const gy = 430;
        const gr = 34;
        const startA = Math.PI * 0.75;
        const endA = Math.PI * 2.25;
        // background track
        ctx.lineWidth = 6;
        ctx.strokeStyle = '#1e293b';
        ctx.beginPath();
        ctx.arc(gx, gy, gr, startA, endA);
        ctx.stroke();
        // redline zone
        const redFrac = redlineRpm / (redlineRpm * 1.18);
        ctx.strokeStyle = '#7f1d1d';
        ctx.beginPath();
        ctx.arc(gx, gy, gr, startA + (endA - startA) * redFrac, endA);
        ctx.stroke();
        // value sweep
        const rpmFrac = Math.max(0, Math.min(1, rpm / (redlineRpm * 1.18)));
        const overRed = rpm > redlineRpm;
        ctx.strokeStyle = overRed ? '#ef4444' : rpm > redlineRpm * 0.82 ? '#f59e0b' : '#10b981';
        ctx.lineWidth = 6;
        ctx.beginPath();
        ctx.arc(gx, gy, gr, startA, startA + (endA - startA) * rpmFrac);
        ctx.stroke();
        // needle hub + digits
        ctx.fillStyle = overRed ? '#ef4444' : '#e2e8f0';
        ctx.font = 'bold 13px var(--font-mono)';
        ctx.textAlign = 'center';
        ctx.fillText(`${Math.round(rpm)}`, gx, gy + 2);
        ctx.fillStyle = '#64748b';
        ctx.font = '8px var(--font-mono)';
        ctx.fillText('RPM', gx, gy + 14);

        // --- Water temp + oil pressure mini bars (bottom-right) ---
        const bx = 280;
        const bw = 96;
        // water temp
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

        // oil pressure
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

      // Draw standard top stroke overlay HUD text
      if (state !== EngineState.EXPLODED && state !== EngineState.SEIZED) {
        ctx.font = 'bold 12px var(--font-mono)';
        ctx.textAlign = 'left';
        
        // Intake stroke text indicator
        ctx.fillStyle = stroke === StrokeType.INTAKE ? '#3b82f6' : '#4b5563';
        ctx.fillText('1. 进气 INTAKE', 14, 25);
        
        ctx.fillStyle = stroke === StrokeType.COMPRESSION ? '#f59e0b' : '#4b5563';
        ctx.fillText('2. 压缩 COMPRESSION', 14, 45);

        ctx.fillStyle = stroke === StrokeType.POWER ? '#ef4444' : '#4b5563';
        ctx.fillText('3. 动力 POWER', 230, 25);

        ctx.fillStyle = stroke === StrokeType.EXHAUST ? '#9ca3af' : '#4b5563';
        ctx.fillText('4. 排气 EXHAUST', 230, 45);
      }

      frameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, []);

  // Mouse drag handling to rotate the crank manually!
  const handleMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
    if (state === EngineState.EXPLODED || state === EngineState.SEIZED) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Check if clicking near the crankshaft/counterweight region (bottom half)
    const distToCrankCenter = Math.sqrt((x - CX) ** 2 + (y - CRANK_Y) ** 2);
    if (distToCrankCenter < R_RADIUS + 40) {
      setIsDragging(true);
    }

    // Manual Spark Plug core touch
    if (x >= CX - 15 && x <= CX + 15 && y <= 110 && y >= 65) {
      onManualSpark?.();
    }
  };

  const handleMouseMove = (e: MouseEvent<HTMLCanvasElement>) => {
    if (!isDragging || !onCrankDrag) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    // Calculate angular sweep in radians
    const dx = x - CX;
    const dy = CRANK_Y - y; // Inverse Y
    
    // atan2 gives counterclockwise angle from X axis.
    // We adjust it so that theta = 0 points straight UP.
    let angle = Math.atan2(dx, dy);
    if (angle < 0) angle += 2 * Math.PI;

    onCrankDrag(angle);
  };

  const handleMouseUpOrLeave = () => {
    setIsDragging(false);
  };

  const getCanvasCoords = (touch: React.Touch) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (touch.clientX - rect.left) * (W_WIDTH / rect.width),
      y: (touch.clientY - rect.top) * (W_HEIGHT / rect.height)
    };
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (state === EngineState.EXPLODED || state === EngineState.SEIZED) return;
    e.preventDefault();
    const coords = getCanvasCoords(e.touches[0]);
    if (!coords) return;
    const distToCrankCenter = Math.sqrt((coords.x - CX) ** 2 + (coords.y - CRANK_Y) ** 2);
    if (distToCrankCenter < R_RADIUS + 40) {
      setIsDragging(true);
    }
    if (coords.x >= CX - 15 && coords.x <= CX + 15 && coords.y <= 110 && coords.y >= 65) {
      onManualSpark?.();
    }
  };

  const handleTouchMove = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (!isDragging || !onCrankDrag) return;
    e.preventDefault();
    const coords = getCanvasCoords(e.touches[0]);
    if (!coords) return;
    const dx = coords.x - CX;
    const dy = CRANK_Y - coords.y;
    let angle = Math.atan2(dx, dy);
    if (angle < 0) angle += 2 * Math.PI;
    onCrankDrag(angle);
  };

  const handleTouchEnd = () => {
    setIsDragging(false);
  };

  const showReadableMode = (state === EngineState.RUNNING || state === EngineState.STARTING) && rpm > 1400;
  const visualSlowdown = showReadableMode ? rpm / Math.max(1, getReadableVisualRpm(rpm)) : 1;

  return (
    <div className="relative flex flex-col items-center bg-gray-950 p-4 rounded-2xl border border-gray-800 shadow-2xl h-[530px] justify-center">
      <div className="absolute top-4 left-6 flex items-center space-x-1.5 bg-gray-900/90 text-[10px] font-mono px-2 py-1 rounded border border-gray-800 backdrop-blur z-10 text-gray-400">
        <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
        <span>交互式物理剖面</span>
      </div>

      {showReadableMode && (
        <div className="absolute top-4 right-6 bg-sky-950/90 text-[10px] font-mono px-2 py-1 rounded border border-sky-800/60 backdrop-blur z-10 text-sky-200 text-right">
          <div className="font-bold text-cyan-300">高转清晰模式</div>
          <div className="text-sky-300/80">视觉慢放 ×{visualSlowdown.toFixed(0)}</div>
        </div>
      )}

      <div className="absolute bottom-4 right-6 bg-gray-900/90 px-2 py-1 rounded text-[10px] font-mono text-gray-500 border border-gray-800 pointer-events-none">
        提示：支持手势旋转曲轴 / 轻点火花塞点火
      </div>

      <canvas
        id="engine-renderer-canvas"
        ref={canvasRef}
        width={W_WIDTH}
        height={W_HEIGHT}
        className="w-[340px] h-[410px] rounded-lg cursor-grab active:cursor-grabbing border border-gray-900 touch-none"
        onMouseDown={handleMouseDown}
        onMouseMove={handleMouseMove}
        onMouseUp={handleMouseUpOrLeave}
        onMouseLeave={handleMouseUpOrLeave}
        onTouchStart={handleTouchStart}
        onTouchMove={handleTouchMove}
        onTouchEnd={handleTouchEnd}
      />
    </div>
  );
}
