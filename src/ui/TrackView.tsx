import { useCallback } from 'react';
import { RACE_EVENTS } from '../sim/race';
import { useBench } from '../state/benchStore';
import { useLive } from '../state/liveStore';
import { bestKey, useRace } from '../state/raceStore';
import { drawTrack, traceX } from './drawTrack';
import { useCanvasLoop } from './useCanvasLoop';

export function TrackView(): React.ReactElement {
  const draw = useCallback((ctx: CanvasRenderingContext2D, w: number, h: number, dt: number, now: number) => {
    const s = useLive.getState().snapshot;
    const { vehicle, ecu, config } = useBench.getState();
    const race = useRace.getState();
    const ride = s?.ride ?? { phase: 'free' as const, event: null, rider: race.rider, t: 0, x: 0, kmh: 0, gear: 0, slip: 0, pitch: 0, clutch: 0, cut: false, frontLoad: 1, grade: 0 };
    const eventId = ride.event ?? race.event;
    const best = race.bests[bestKey(vehicle.chassis, eventId)];
    const showGhost = race.ghost && best && ride.phase === 'run' && ride.event === eventId;
    const ghostX = showGhost ? traceX(best.result.trace, ride.t) : null;
    const gear = Math.max(1, ride.gear);
    const set = ecu.shiftRpm[gear - 1] ?? 0;
    drawTrack(ctx, w, h, dt, {
      ride,
      event: RACE_EVENTS[eventId],
      chassis: vehicle.chassis,
      tireRadius: vehicle.tireRadius,
      wheelbase: vehicle.wheelbase,
      rpm: s?.rpm ?? 0,
      limiter: ecu.limiterRpm,
      shiftRpm: set > 0 ? set : ecu.limiterRpm - 150,
      boostKpa: s?.boostKpa ?? 0,
      turbo: config.turboSize > 0,
      ghostX,
      ghostDelta: ghostX !== null ? ride.x - ghostX : null,
      now,
    });
  }, []);
  const ref = useCanvasLoop(draw);
  return (
    <div className="engine-view">
      <canvas ref={ref} className="engine-canvas" aria-label="赛道" />
    </div>
  );
}
