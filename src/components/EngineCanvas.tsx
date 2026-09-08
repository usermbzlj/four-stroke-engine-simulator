/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import React, { useRef, useEffect, useState, MouseEvent } from 'react';
import { EngineState, StrokeType, ComponentWear } from '../types';
import { advanceReadableCrankAngle, getReadableVisualRpm, strokeFromCrankAngle } from '../utils/engineVisuals';
import { Particle, spawnExplosion, spawnSeizureSparks, spawnStrokeParticles } from './engineCanvasParticles';
import {
  CANVAS_GEOMETRY,
  EngineScene,
  drawBackdrop,
  drawChamberWash,
  drawCrankcase,
  drawCrankshaft,
  drawConnectingRod,
  drawCylinderBlock,
  drawInstrumentCluster,
  drawManifolds,
  drawPiston,
  drawSparkPlug,
  drawStateOverlays,
  drawStrokeLegend,
  drawValves,
  resolveSceneGeometry,
} from './engineCanvasRenderer';

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

const { W_WIDTH, W_HEIGHT, CX, CRANK_Y, R_RADIUS } = CANVAS_GEOMETRY;

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
  onManualSpark,
}: EngineCanvasProps) {
  const canvasRef = useRef<HTMLCanvasElement | null>(null);
  const particlesRef = useRef<Particle[]>([]);
  const sparkTriggerRef = useRef<boolean>(false);
  const lastStateRef = useRef<EngineState>(state);
  const lastRenderTimeRef = useRef<number>(0);
  const visualAngleRef = useRef<number>(crankAngle);
  const [isDragging, setIsDragging] = useState(false);

  // Mirror live props into a ref so the rAF loop reads fresh values without
  // re-subscribing the effect each render.
  const propsRef = useRef({ state, stroke, crankAngle, throttle, oilLevel, temperature, oilPressure, wear, nosActive, redlineRpm, rpm });
  propsRef.current = { state, stroke, crankAngle, throttle, oilLevel, temperature, oilPressure, wear, nosActive, redlineRpm, rpm };

  // One-shot explosion particle burst on the OFF->EXPLODED edge.
  useEffect(() => {
    if (state === EngineState.EXPLODED && lastStateRef.current !== EngineState.EXPLODED) {
      spawnExplosion(particlesRef.current, CX);
    }
    lastStateRef.current = state;
  }, [state]);

  // Main render loop: derive readable-mode crank angle, spawn + update particles,
  // then paint each layer via the renderer module.
  useEffect(() => {
    const canvas = canvasRef.current;
    if (!canvas) return;
    const ctx = canvas.getContext('2d');
    if (!ctx) return;

    let frameId: number;

    const render = () => {
      const props = propsRef.current;

      const now = performance.now();
      const dt = lastRenderTimeRef.current ? Math.min(0.05, (now - lastRenderTimeRef.current) / 1000) : 1 / 60;
      lastRenderTimeRef.current = now;

      const visualMotion = advanceReadableCrankAngle({
        previousAngle: visualAngleRef.current,
        physicalAngle: props.crankAngle,
        rpm: props.rpm,
        dt,
        state: props.state,
      });
      visualAngleRef.current = visualMotion.angle;

      const visualAngle = visualMotion.angle;
      const activeStroke = visualMotion.mode === 'readable' ? strokeFromCrankAngle(visualAngle) : props.stroke;
      const highRpmReadable = visualMotion.mode === 'readable';

      const geom = resolveSceneGeometry(visualAngle);

      // Edge-trigger the spark flash graphic at the top of the power stroke.
      const angleDeg = ((visualAngle * 180) / Math.PI) % 720;
      if (props.state === EngineState.RUNNING && activeStroke === StrokeType.POWER && Math.abs(angleDeg - 360) < 12) {
        if (!sparkTriggerRef.current) {
          sparkTriggerRef.current = true;
          setTimeout(() => {
            sparkTriggerRef.current = false;
          }, 70);
        }
      }

      const scene: EngineScene = {
        state: props.state,
        stroke: activeStroke,
        crankAngle: visualAngle,
        throttle: props.throttle,
        oilLevel: props.oilLevel,
        temperature: props.temperature,
        oilPressure: props.oilPressure,
        wear: props.wear,
        nosActive: props.nosActive,
        redlineRpm: props.redlineRpm,
        rpm: props.rpm,
        highRpmReadable,
        sparkActive: sparkTriggerRef.current,
        ...geom,
      };

      drawBackdrop(ctx);

      // Particles render behind the mechanical components.
      const spawnCtx = {
        particles: particlesRef.current,
        state: scene.state,
        stroke: scene.stroke,
        throttle: scene.throttle,
        oilLevel: scene.oilLevel,
        temperature: scene.temperature,
        nosActive: scene.nosActive,
        pistonTopY: scene.pistonTopY,
        pistonPinY: scene.pistonPinY,
        geometry: { CX, pistonWidth: CANVAS_GEOMETRY.pistonWidth },
      };
      spawnStrokeParticles(spawnCtx);
      spawnSeizureSparks(spawnCtx);
      particlesRef.current = particlesRef.current.filter((part) => {
        part.update();
        part.draw(ctx);
        return part.life > 0;
      });

      drawManifolds(ctx, scene);
      drawCrankcase(ctx, scene);
      drawCylinderBlock(ctx, scene);
      drawChamberWash(ctx, scene);
      drawCrankshaft(ctx, scene);
      drawConnectingRod(ctx, scene);
      drawPiston(ctx, scene);
      drawValves(ctx, scene);
      drawSparkPlug(ctx, scene);
      drawStateOverlays(ctx, scene);
      drawInstrumentCluster(ctx, scene);
      drawStrokeLegend(ctx, scene);

      frameId = requestAnimationFrame(render);
    };

    render();

    return () => {
      cancelAnimationFrame(frameId);
    };
  }, []);

  // ---- Pointer / touch input: drag the crank, tap the plug to spark ----
  const isDead = state === EngineState.EXPLODED || state === EngineState.SEIZED;

  const handleMouseDown = (e: MouseEvent<HTMLCanvasElement>) => {
    if (isDead) return;
    const canvas = canvasRef.current;
    if (!canvas) return;

    const rect = canvas.getBoundingClientRect();
    const x = e.clientX - rect.left;
    const y = e.clientY - rect.top;

    const distToCrankCenter = Math.sqrt((x - CX) ** 2 + (y - CRANK_Y) ** 2);
    if (distToCrankCenter < R_RADIUS + 40) {
      setIsDragging(true);
    }
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

    const dx = x - CX;
    const dy = CRANK_Y - y; // Inverse Y
    // atan2 gives the angle from the X axis; offset so theta = 0 points UP.
    let angle = Math.atan2(dx, dy);
    if (angle < 0) angle += 2 * Math.PI;
    onCrankDrag(angle);
  };

  const handleMouseUpOrLeave = () => setIsDragging(false);

  const getCanvasCoords = (touch: React.Touch) => {
    const canvas = canvasRef.current;
    if (!canvas) return null;
    const rect = canvas.getBoundingClientRect();
    return {
      x: (touch.clientX - rect.left) * (W_WIDTH / rect.width),
      y: (touch.clientY - rect.top) * (W_HEIGHT / rect.height),
    };
  };

  const handleTouchStart = (e: React.TouchEvent<HTMLCanvasElement>) => {
    if (isDead) return;
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

  const handleTouchEnd = () => setIsDragging(false);

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
