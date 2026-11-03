import { useCallback, useEffect, useRef } from 'react';
import type { CycleTrace } from '../sim/core';
import { useBench } from '../state/benchStore';
import { onCoreEvents, useLive } from '../state/liveStore';
import { shownDeg, useView, type ViewSpeed } from '../state/viewStore';
import { drawEngine, traceStats } from './drawEngine';
import { useCanvasLoop } from './useCanvasLoop';

/**
 * The real crank turns up to ~200 times a second; the picture is slowed so
 * the eye can follow it. Gas state comes from the solver's last full cycle.
 */
function visualRps(rps: number, speed: ViewSpeed): number {
  if (rps <= 0 || speed === 'paused') return 0;
  if (speed === 'slow') return Math.min(rps, 0.12);
  return Math.min(rps, 3 + rps * 0.05);
}

const SPEEDS: { id: ViewSpeed; label: string; title: string }[] = [
  { id: 'auto', label: '慢放', title: '慢到眼睛跟得上' },
  { id: 'slow', label: '超慢', title: '一个循环十几秒，看清每个阶段' },
  { id: 'paused', label: '暂停', title: '冻结画面，拖动或按 ← → 转曲轴（P）' },
];

export function EngineView({ shake }: { shake: boolean }): React.ReactElement {
  const config = useBench((s) => s.config);
  const speed = useView((s) => s.speed);
  const labels = useView((s) => s.labels);
  const setSpeed = useView((s) => s.setSpeed);
  const toggleLabels = useView((s) => s.toggleLabels);
  const visual = useRef({ deg: 0, intake: 0, exhaust: 0, pop: 0 });
  const frozen = useRef<CycleTrace | null>(null);
  const drag = useRef<{ x: number; moved: boolean } | null>(null);

  useEffect(
    () =>
      onCoreEvents((events) => {
        for (const e of events) if (e.kind === 'afterfire') visual.current.pop = Math.min(1, visual.current.pop + 0.5 + e.energy);
      }),
    [],
  );

  // Hold on to the cycle that was on screen when the picture was frozen.
  useEffect(() => {
    frozen.current = speed === 'paused' ? (useLive.getState().traces[0] ?? null) : null;
  }, [speed]);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number, dt: number, now: number) => {
      const { snapshot, traces } = useLive.getState();
      const view = useView.getState();
      const v = visual.current;
      const paused = view.speed === 'paused';
      const trace = paused ? (frozen.current ?? traces[0] ?? null) : (traces[0] ?? null);
      const rps = Math.max(0, (snapshot?.rpm ?? 0) / 60);
      const broken = snapshot?.failure != null;
      const vis = broken ? 0 : visualRps(rps, view.speed);
      if (paused) v.deg = view.pausedDeg;
      else v.deg = (v.deg + vis * 360 * dt) % 720;
      shownDeg.value = v.deg;

      // Gas parcels follow the recorded valve flow, so reversion runs them backwards.
      const bin = Math.min(719, Math.floor(v.deg));
      if (trace && !paused) {
        const st = traceStats(trace);
        const iv = trace.ivFlow[bin]! / st.ivMax;
        const ev = trace.evFlow[bin]! / st.evMax;
        v.intake += dt * vis * 2.2 * iv;
        v.exhaust += dt * vis * 3 * Math.max(-0.5, ev) + dt * vis * 0.15;
      }
      v.pop = Math.max(0, v.pop - dt * 3);

      drawEngine(ctx, w, h, {
        config,
        deg: v.deg,
        trace,
        snapshot,
        time: now,
        intakeFlow: v.intake,
        exhaustFlow: v.exhaust,
        labels: view.labels,
        pop: v.pop,
        slow: vis > 0 ? Math.round(rps / vis) : 0,
        paused,
      });
    },
    [config],
  );
  const ref = useCanvasLoop(draw);

  return (
    <div className={`engine-view${shake ? ' is-shaking' : ''}`}>
      <canvas
        ref={ref}
        className={`engine-canvas${speed === 'paused' ? ' is-scrub' : ''}`}
        aria-label="发动机剖面实时画面"
        onPointerDown={(e) => {
          drag.current = { x: e.clientX, moved: false };
          e.currentTarget.setPointerCapture(e.pointerId);
        }}
        onPointerMove={(e) => {
          const d = drag.current;
          if (!d) return;
          const dx = e.clientX - d.x;
          // A click is not a drag; only a real drag freezes the picture.
          if (!d.moved && Math.abs(dx) < 4) return;
          d.moved = true;
          d.x = e.clientX;
          useView.getState().scrub(dx * 1.5, visual.current.deg);
        }}
        onPointerUp={() => {
          drag.current = null;
        }}
        onPointerCancel={() => {
          drag.current = null;
        }}
      />
      <div className="ev-tools" role="toolbar" aria-label="画面">
        <div className="ev-seg">
          {SPEEDS.map((s) => (
            <button key={s.id} type="button" aria-pressed={speed === s.id} className={speed === s.id ? 'is-on' : ''} title={s.title} onClick={() => setSpeed(s.id)}>
              {s.label}
            </button>
          ))}
        </div>
        <button type="button" aria-pressed={labels} className={`ev-btn${labels ? ' is-on' : ''}`} onClick={toggleLabels} title="给零件标上名字（L）">
          标注
        </button>
      </div>
    </div>
  );
}
