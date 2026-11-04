import { useEffect, useRef, useState } from 'react';
import { startMentor } from './mentor/brain';
import { startCareerHooks } from './game/careerHooks';
import { useGame } from './game/store';
import { jobById, JOBS } from './game/jobs';
import { PRESETS, displacementCc } from './sim/config';
import { useBench } from './state/benchStore';
import { useLink } from './state/engineLink';
import { useLive } from './state/liveStore';
import { useUi, type Drawer } from './state/uiStore';
import { BuildSheet } from './ui/BuildSheet';
import { CarSheet } from './ui/CarSheet';
import { GarageSheet } from './ui/GarageSheet';
import { RacePanel } from './ui/RacePanel';
import { TrackView } from './ui/TrackView';
import { garageTitle, useCareer } from './game/career';
import { money } from './game/parts';
import { ControlStrip } from './ui/ControlStrip';
import { DynoPanel } from './ui/DynoPanel';
import { EcuPanel } from './ui/EcuPanel';
import { EngineView } from './ui/EngineView';
import { EventFeed } from './ui/EventFeed';
import { FailureReport } from './ui/FailureReport';
import { HelpOverlay } from './ui/HelpOverlay';
import { AcceptanceDialog } from './ui/job/AcceptanceDialog';
import { QuestDialog } from './ui/QuestDialog';
import { JobBoard } from './ui/job/JobBoard';
import { JobCard } from './ui/job/JobCard';
import { LiveStrip } from './ui/LiveStrip';
import { MentorPanel } from './ui/MentorPanel';
import { Readouts } from './ui/Readouts';
import { Scope } from './ui/Scope';
import { StartScreen } from './ui/StartScreen';
import { Tach } from './ui/Tach';
import { nudgeThrottle, useBenchInput } from './ui/useBenchInput';

const DRAWERS: { id: Drawer; label: string; key: string }[] = [
  { id: 'build', label: '改装单', key: 'Q' },
  { id: 'ecu', label: 'ECU', key: 'W' },
  { id: 'car', label: '整车', key: 'A' },
  { id: 'dyno', label: '测功', key: 'E' },
  { id: 'garage', label: '车库', key: 'G' },
];

function Wallet(): React.ReactElement {
  const cash = useCareer((s) => s.money);
  const rep = useCareer((s) => s.rep);
  const setDrawer = useUi((s) => s.setDrawer);
  const g = garageTitle(rep);
  return (
    <button type="button" className="topbar-wallet" onClick={() => setDrawer('garage')} title={g.next ? `声望 ${rep}，到 ${g.next} 升级` : `声望 ${rep}`}>
      <b>{money(cash)}</b>
      <span>
        {g.title} · 声望 {rep}
      </span>
    </button>
  );
}

function StageSwitch(): React.ReactElement {
  const stage = useUi((s) => s.stage);
  const setStage = useUi((s) => s.setStage);
  return (
    <div className="choice stage-switch" role="radiogroup" aria-label="场地">
      <button type="button" role="radio" aria-checked={stage === 'dyno'} className={stage === 'dyno' ? 'is-on' : ''} onClick={() => setStage('dyno')} title="快捷键 T 切换">
        台架
      </button>
      <button type="button" role="radio" aria-checked={stage === 'track'} className={stage === 'track' ? 'is-on' : ''} onClick={() => setStage('track')} title="快捷键 T 切换">
        赛道
      </button>
    </div>
  );
}

function Title(): React.ReactElement {
  const mode = useGame((s) => s.mode);
  const jobId = useGame((s) => s.jobId);
  const config = useBench((s) => s.config);
  const presetId = useBench((s) => s.presetId);
  const baseline = useBench((s) => s.baseline);
  const job = mode === 'job' ? jobById(jobId) : undefined;
  const name = job
    ? `工单 ${JOBS.indexOf(job) + 1} · ${job.title}`
    : (PRESETS.find((p) => p.id === presetId)?.name ?? `${baseline.name}（改）`);
  return (
    <div className="topbar-id">
      <h1>{name}</h1>
      <span>
        {displacementCc(config).toFixed(0)} cc · {config.bore}×{config.stroke} mm · 压缩比 {config.compressionRatio}
      </span>
    </div>
  );
}

function Bench(): React.ReactElement {
  const audible = useLink((s) => s.audible);
  const volume = useBench((s) => s.volume);
  const setVolume = useBench((s) => s.setVolume);
  const failure = useLive((s) => s.snapshot?.failure ?? null);
  const drawer = useUi((s) => s.drawer);
  const setDrawer = useUi((s) => s.setDrawer);
  const setView = useUi((s) => s.setView);
  const setHelp = useUi((s) => s.setHelp);
  const mode = useGame((s) => s.mode);
  const stage = useUi((s) => s.stage);
  const [shake, setShake] = useState(false);
  const lastFailure = useRef<string | null>(null);

  useEffect(() => {
    const sig = failure ? `${failure.kind}:${Math.round(failure.rpm)}:${Math.round(failure.crankDeg)}` : null;
    if (sig && sig !== lastFailure.current) {
      setShake(true);
      const t = window.setTimeout(() => setShake(false), 600);
      lastFailure.current = sig;
      return () => window.clearTimeout(t);
    }
    if (!failure) lastFailure.current = null;
    return undefined;
  }, [failure]);

  return (
    <div className={`bench${drawer ? ' has-drawer' : ''}`}>
      <header className="topbar">
        <button type="button" className="topbar-home" onClick={() => setView('board')} title="工单列表">
          <span aria-hidden="true">☰</span> 工单
        </button>
        <Title />
        <StageSwitch />
        <nav className="topbar-tabs" aria-label="面板">
          {DRAWERS.map((d) => (
            <button
              key={d.id}
              type="button"
              className={drawer === d.id ? 'is-on' : ''}
              aria-expanded={drawer === d.id}
              onClick={() => setDrawer(drawer === d.id ? null : d.id)}
              title={`快捷键 ${d.key}`}
            >
              {d.label} <kbd>{d.key}</kbd>
            </button>
          ))}
        </nav>
        <Wallet />
        <label className="topbar-volume">
          <span>{audible ? '音量' : '无声音'}</span>
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
        <button type="button" className="topbar-help" onClick={() => setHelp(true)} aria-label="按键说明">
          ?
        </button>
      </header>

      <main className="stage">
        <aside className="side" aria-label={mode === 'job' ? '工单和老周' : '老周'}>
          {mode === 'job' && <JobCard />}
          <MentorPanel />
        </aside>
        <div
          className="stage-engine"
          onWheel={(e) => nudgeThrottle(e.deltaY < 0 ? 0.03 : -0.03)}
          title="滚轮调手油门"
        >
          {stage === 'track' ? <TrackView /> : <EngineView shake={shake} />}
        </div>
        <aside className="stage-gauges" aria-label="仪表">
          <Tach />
          <Readouts />
          <EventFeed />
        </aside>
        {stage === 'track' ? <RacePanel /> : <Scope />}

        {drawer && (
          <aside className={`drawer${drawer === 'ecu' || drawer === 'garage' ? ' drawer--wide' : ''}`} aria-label={DRAWERS.find((d) => d.id === drawer)?.label}>
            <div className="drawer-top">
              <header className="drawer-head">
                <nav className="drawer-tabs" aria-label="面板">
                  {DRAWERS.map((d) => (
                    <button key={d.id} type="button" className={drawer === d.id ? 'is-on' : ''} onClick={() => setDrawer(d.id)}>
                      {d.label}
                    </button>
                  ))}
                </nav>
                <button type="button" className="btn btn--ghost btn--small" onClick={() => setDrawer(null)}>
                  收起 <kbd>Esc</kbd>
                </button>
              </header>
              <LiveStrip />
            </div>
            <div className="drawer-body">
              {drawer === 'build' && <BuildSheet />}
              {drawer === 'ecu' && <EcuPanel />}
              {drawer === 'car' && <CarSheet />}
              {drawer === 'garage' && <GarageSheet />}
              {drawer === 'dyno' && <DynoPanel />}
            </div>
          </aside>
        )}
      </main>

      <ControlStrip />

      {failure && <FailureReport failure={failure} />}
      <AcceptanceDialog />
      <QuestDialog />
    </div>
  );
}

export default function App(): React.ReactElement {
  const started = useLink((s) => s.started);
  const view = useUi((s) => s.view);
  const help = useUi((s) => s.help);

  useBenchInput(started && view === 'bench');

  useEffect(() => {
    if (started) {
      startMentor();
      startCareerHooks();
    }
  }, [started]);

  return (
    <>
      {view === 'home' && <StartScreen />}
      {view === 'board' && <JobBoard />}
      {view === 'bench' && (started ? <Bench /> : <div className="loading">正在接通台架…</div>)}
      {help && <HelpOverlay />}
    </>
  );
}
