import { useCallback, useRef } from 'react';
import { useBench } from '../state/benchStore';
import { useLive } from '../state/liveStore';
import { drawPressureAngle, drawPressureVolume, scopeScale } from './drawScope';
import { useCanvasLoop } from './useCanvasLoop';

function useScale(): () => number {
  const scale = useRef(20);
  return () => {
    const target = scopeScale(useLive.getState().traces);
    // Grow at once, shrink slowly, so the axis does not jitter.
    scale.current = target > scale.current ? target : scale.current + (target - scale.current) * 0.02;
    return Math.max(20, Math.round(scale.current / 10) * 10);
  };
}

export function Scope(): React.ReactElement {
  const config = useBench((s) => s.config);
  const cycle = useLive((s) => s.snapshot?.cycle ?? null);
  const scaleA = useScale();
  const scaleV = useScale();

  const drawA = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      const { traces, snapshot } = useLive.getState();
      drawPressureAngle(ctx, w, h, traces, config, snapshot?.advance ?? 10, scaleA());
    },
    [config, scaleA],
  );
  const drawV = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number) => {
      drawPressureVolume(ctx, w, h, useLive.getState().traces, config, scaleV());
    },
    [config, scaleV],
  );
  const refA = useCanvasLoop(drawA);
  const refV = useCanvasLoop(drawV);

  return (
    <section className="scope" aria-label="缸压示波器">
      <div className="scope-pane scope-pane--wide">
        <header className="scope-head">
          <h2>缸压随曲轴转角</h2>
          {cycle && (
            <p>
              峰值 <b>{cycle.pmax.toFixed(0)}</b> bar 在上止点后 <b>{cycle.pmaxDeg.toFixed(0)}°</b>
              <span className="sep" />
              燃烧 10–90% <b>{cycle.burnDeg > 0 ? `${cycle.burnDeg.toFixed(0)}°` : '—'}</b>
            </p>
          )}
        </header>
        <canvas ref={refA} className="scope-canvas" />
      </div>
      <div className="scope-pane">
        <header className="scope-head">
          <h2>示功图</h2>
          {cycle && (
            <p>
              平均指示压力 <b>{cycle.imep.toFixed(1)}</b> bar
            </p>
          )}
        </header>
        <canvas ref={refV} className="scope-canvas" />
      </div>
    </section>
  );
}
