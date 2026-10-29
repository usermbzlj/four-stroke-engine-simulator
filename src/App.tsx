import { useEffect, useRef, useState } from 'react';
import { PRESETS, displacementCc } from './sim/config';
import { useBench } from './state/benchStore';
import { useLink } from './state/engineLink';
import { useLive } from './state/liveStore';
import { BuildSheet } from './ui/BuildSheet';
import { ControlStrip } from './ui/ControlStrip';
import { DynoPanel } from './ui/DynoPanel';
import { EcuPanel } from './ui/EcuPanel';
import { EngineView } from './ui/EngineView';
import { EventFeed } from './ui/EventFeed';
import { FailureReport } from './ui/FailureReport';
import { Readouts } from './ui/Readouts';
import { Scope } from './ui/Scope';
import { StartScreen } from './ui/StartScreen';
import { Tach } from './ui/Tach';
import { nudgeThrottle, useBenchInput } from './ui/useBenchInput';

type Drawer = 'build' | 'ecu' | 'dyno' | null;

const DRAWERS: { id: Exclude<Drawer, null>; label: string }[] = [
  { id: 'build', label: '改装单' },
  { id: 'ecu', label: 'ECU' },
  { id: 'dyno', label: '测功' },
];

export default function App(): React.ReactElement {
  const started = useLink((s) => s.started);
  const audible = useLink((s) => s.audible);
  const config = useBench((s) => s.config);
  const presetId = useBench((s) => s.presetId);
  const volume = useBench((s) => s.volume);
  const setVolume = useBench((s) => s.setVolume);
  const failure = useLive((s) => s.snapshot?.failure ?? null);
  const [drawer, setDrawer] = useState<Drawer>(null);
  const [shake, setShake] = useState(false);
  const lastFailure = useRef<unknown>(null);

  useBenchInput(started);

  useEffect(() => {
    if (failure && failure !== lastFailure.current) {
      setShake(true);
      const t = window.setTimeout(() => setShake(false), 600);
      lastFailure.current = failure;
      return () => window.clearTimeout(t);
    }
    if (!failure) lastFailure.current = null;
    return undefined;
  }, [failure]);

  if (!started) return <StartScreen />;

  const presetName = PRESETS.find((p) => p.id === presetId)?.name ?? '改装发动机';

  return (
    <div className={`bench${drawer ? ' has-drawer' : ''}`}>
      <header className="topbar">
        <div className="topbar-id">
          <h1>{presetName}</h1>
          <span>
            {displacementCc(config).toFixed(0)} cc，{config.bore}×{config.stroke} mm
          </span>
        </div>
        <nav className="topbar-tabs" aria-label="面板">
          {DRAWERS.map((d) => (
            <button
              key={d.id}
              type="button"
              className={drawer === d.id ? 'is-on' : ''}
              aria-expanded={drawer === d.id}
              onClick={() => setDrawer(drawer === d.id ? null : d.id)}
            >
              {d.label}
            </button>
          ))}
        </nav>
        <label className="topbar-volume">
          <span>{audible ? '音量' : '没有声音输出'}</span>
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={volume}
            disabled={!audible}
            onChange={(e) => setVolume(Number(e.target.value))}
            aria-label="音量"
          />
        </label>
      </header>

      <main className="stage">
        <div
          className="stage-engine"
          onWheel={(e) => nudgeThrottle(e.deltaY < 0 ? 0.03 : -0.03)}
          title="滚轮调手油门"
        >
          <EngineView shake={shake} />
        </div>
        <aside className="stage-gauges">
          <Tach />
          <Readouts />
          <EventFeed />
        </aside>
        <Scope />
      </main>

      <ControlStrip />

      {drawer && (
        <aside className="drawer" aria-label={DRAWERS.find((d) => d.id === drawer)?.label}>
          <header className="drawer-head">
            <h2>{DRAWERS.find((d) => d.id === drawer)?.label}</h2>
            <button type="button" className="btn btn--ghost" onClick={() => setDrawer(null)}>
              收起
            </button>
          </header>
          {drawer === 'build' && <BuildSheet />}
          {drawer === 'ecu' && <EcuPanel />}
          {drawer === 'dyno' && <DynoPanel />}
        </aside>
      )}

      {failure && <FailureReport failure={failure} />}
    </div>
  );
}