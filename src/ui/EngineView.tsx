import { useCallback, useRef, useState } from 'react';
import { liftFraction } from '../sim/config';
import { useBench } from '../state/benchStore';
import { useLive } from '../state/liveStore';
import { drawEngine } from './drawEngine';
import { useCanvasLoop } from './useCanvasLoop';

/**
 * The real crank turns up to ~200 times a second; the picture is slowed so
 * the eye can follow it. Gas state comes from the solver's last full cycle.
 */
function visualRps(rps: number): number {
  return rps <= 0 ? 0 : Math.min(rps, 3 + rps * 0.05);
}

export function EngineView({ shake }: { shake: boolean }): React.ReactElement {
  const config = useBench((s) => s.config);
  const visual = useRef({ deg: 0, intake: 0, exhaust: 0 });
  const [slow, setSlow] = useState(1);
  const slowRef = useRef(1);

  const draw = useCallback(
    (ctx: CanvasRenderingContext2D, w: number, h: number, dt: number, now: number) => {
      const { snapshot, traces } = useLive.getState();
      const v = visual.current;
      const rps = Math.max(0, (snapshot?.rpm ?? 0) / 60);
      const broken = snapshot?.failure != null;
      const vis = broken ? 0 : visualRps(rps);
      v.deg = (v.deg + vis * 360 * dt) % 720;
      const iv = liftFraction(config, v.deg, 'intake');
      const ev = liftFraction(config, v.deg, 'exhaust');
      v.intake += dt * vis * (0.2 + 2.5 * iv) * (0.3 + (snapshot?.throttle ?? 0));
      v.exhaust += dt * vis * (0.2 + 3 * ev);
      const ratio = vis > 0 ? Math.round(rps / vis) : 1;
      if (ratio !== slowRef.current) {
        slowRef.current = ratio;
        setSlow(ratio);
      }
      drawEngine(ctx, w, h, {
        config,
        deg: v.deg,
        trace: traces[0] ?? null,
        snapshot,
        time: now,
        intakeFlow: v.intake,
        exhaustFlow: v.exhaust,
      });
    },
    [config],
  );
  const ref = useCanvasLoop(draw);

  return (
    <div className={`engine-view${shake ? ' is-shaking' : ''}`}>
      <canvas ref={ref} className="engine-canvas" aria-label="发动机剖面实时画面" />
      {slow > 1 && <span className="engine-slowmo">画面慢放 1/{slow}</span>}
    </div>
  );
}
