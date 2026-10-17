/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Layout only. The live engine and the career are long-lived objects owned by
 * `game.ts`; this file reads them through hooks and lays out the cross-section
 * plus a tabbed workbench.
 */

import { Cpu, Gauge, LineChart, Trophy, Wrench, type LucideIcon } from 'lucide-react';
import { useEffect, useState } from 'react';
import AppHeader from './components/AppHeader';
import CareerPanel from './components/CareerPanel';
import ContractBanner from './components/ContractBanner';
import ControlDeck from './components/ControlDeck';
import CycleExplainer from './components/CycleExplainer';
import DynoPanel from './components/DynoPanel';
import EngineCanvas from './components/EngineCanvas';
import GarageShop from './components/GarageShop';
import Onboarding from './components/Onboarding';
import TelemetryDashboard from './components/TelemetryDashboard';
import TuneEditor from './components/TuneEditor';
import WearTracker from './components/WearTracker';
import { ECONOMY } from './engine';
import { garage as garageStore, pointerControls, runtime, startGame } from './game';
import { useGarage, useRuntime } from './hooks/useGame';
import { useKeyboardControls } from './hooks/useKeyboardControls';
import { rebuildCostFor, repairCostFor } from './store/garageStore';
import { useLogStore } from './store/logStore';
import { useSettingsStore } from './store/settingsStore';
import { useTutorialStore } from './store/tutorialStore';
import { EngineState } from './types';

type TabId = 'drive' | 'tune' | 'dyno' | 'garage' | 'career';

const TABS: { id: TabId; label: string; icon: LucideIcon }[] = [
  { id: 'drive', label: '驾驶台', icon: Gauge },
  { id: 'tune', label: 'ECU 标定', icon: Cpu },
  { id: 'dyno', label: '测功机', icon: LineChart },
  { id: 'garage', label: '车间', icon: Wrench },
  { id: 'career', label: '生涯', icon: Trophy },
];

const { buyAndInstall, buyBlock, setTune, applyAutoTune, savePreset, applyPreset, deletePreset } =
  garageStore.getState();

export default function App() {
  const [tab, setTab] = useState<TabId>('drive');

  useEffect(() => startGame(), []);

  const { engineState, stroke, spec, controls, wear, liveStats, history, hud, dyno } = useRuntime((s) => s);
  const logs = useLogStore((s) => s.logs);
  const clearLogs = useLogStore((s) => s.clear);
  const tutorial = useTutorialStore((s) => s.progress);
  const volume = useSettingsStore((s) => s.volume);
  const muted = useSettingsStore((s) => s.muted);
  const setVolume = useSettingsStore((s) => s.setVolume);
  const toggleMuted = useSettingsStore((s) => s.toggleMuted);

  const garage = useGarage((s) => s.garage);
  const build = useGarage((s) => s.build);
  const tune = useGarage((s) => s.tune);
  const presets = useGarage((s) => s.presets);
  const onboarded = useGarage((s) => s.onboarded);
  const contract = useGarage((s) => s.contract);

  useKeyboardControls({
    onKill: () => runtime.toggleCutoff(),
    onSpark: () => runtime.manualSpark(),
    onChoke: () => runtime.toggleChoke(),
    onDyno: () => {
      if (runtime.isDynoRunning()) {
        runtime.abortDyno();
      } else {
        setTab('dyno');
        runtime.startDyno();
      }
    },
    onEscape: () => {
      if (runtime.isDynoRunning()) runtime.abortDyno();
      else garageStore.getState().abortContract();
    },
    onSelectTab: (index) => {
      const target = TABS[index];
      if (target) setTab(target.id);
    },
  });

  const wrecked = engineState === EngineState.EXPLODED || engineState === EngineState.SEIZED;

  const handleTuneChange = (next: typeof tune) => {
    setTune(next);
    useTutorialStore.getState().mark('tuned');
  };

  const handleBuyPart = (partId: string) => {
    buyAndInstall(partId);
    useTutorialStore.getState().mark('shopped');
  };

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center">
      <AppHeader spec={spec} engineState={engineState} rpm={liveStats.rpm} />

      <div className="w-full max-w-[1600px] p-3 md:p-6 grid grid-cols-1 xl:grid-cols-12 gap-5 items-start">
        {/* ---- LEFT: the engine itself, always visible ---- */}
        <div className="xl:col-span-5 flex flex-col gap-4 xl:sticky xl:top-4">
          <EngineCanvas
            state={engineState}
            stroke={stroke}
            getCrankAngle={() => runtime.getCrankAngle()}
            throttle={Math.max(hud.butterfly, hud.idleBypass)}
            oilLevel={controls.oilLevel}
            temperature={liveStats.temp}
            oilPressure={liveStats.oilPressure}
            wear={wear}
            nosActive={hud.nitrous}
            redlineRpm={spec.redlineRpm}
            rpm={liveStats.rpm}
            onCrankDrag={(angle) => runtime.crankDrag(angle)}
            onManualSpark={() => runtime.manualSpark()}
          />

          {!onboarded && (
            <Onboarding progress={tutorial} onDismiss={() => garageStore.getState().completeOnboarding()} />
          )}

          <TelemetryDashboard
            stats={liveStats}
            history={history}
            logs={logs}
            redlineRpm={spec.redlineRpm}
            onClearLogs={clearLogs}
          />
        </div>

        {/* ---- RIGHT: tabbed workbench ---- */}
        <div className="xl:col-span-7 flex flex-col gap-4">
          <nav className="flex gap-1 bg-slate-900/60 border border-slate-800 rounded-xl p-1 overflow-x-auto">
            {TABS.map((t, i) => {
              const Icon = t.icon;
              const active = tab === t.id;
              return (
                <button
                  key={t.id}
                  onClick={() => setTab(t.id)}
                  className={`flex-1 min-w-[92px] flex items-center justify-center gap-1.5 px-3 py-2 rounded-lg text-[11px] font-mono transition-colors cursor-pointer ${
                    active ? 'bg-slate-800 text-white shadow-inner' : 'text-slate-500 hover:text-slate-300'
                  }`}
                >
                  <Icon className="w-3.5 h-3.5" />
                  {t.label}
                  <span className="text-[9px] text-slate-600">{i + 1}</span>
                </button>
              );
            })}
          </nav>

          {contract.id && contract.status === 'running' && tab !== 'career' && (
            <ContractBanner run={contract} onOpen={() => setTab('career')} />
          )}

          {tab === 'drive' && (
            <ControlDeck
              state={engineState}
              controls={controls}
              hud={hud}
              spec={spec}
              volume={volume}
              isMuted={muted}
              dynoRunning={dyno.running}
              onUpdateControls={(patch) => runtime.setControls(patch)}
              onPointerThrottle={pointerControls.throttle}
              onPointerStarter={pointerControls.starter}
              onPointerNitrous={pointerControls.nitrous}
              onToggleCutoff={() => runtime.toggleCutoff()}
              onToggleChoke={() => runtime.toggleChoke()}
              onManualSpark={() => runtime.manualSpark()}
              onVolumeChange={setVolume}
              onMuteToggle={toggleMuted}
              onResetControls={() => runtime.resetControls()}
            />
          )}

          {tab === 'tune' && (
            <TuneEditor
              spec={spec}
              tune={tune}
              wear={wear}
              coolantTemp={liveStats.temp}
              presets={presets}
              locked={dyno.running}
              onChange={handleTuneChange}
              onAutoTune={applyAutoTune}
              onSavePreset={savePreset}
              onApplyPreset={applyPreset}
              onDeletePreset={deletePreset}
            />
          )}

          {tab === 'dyno' && (
            <DynoPanel
              spec={spec}
              dyno={dyno}
              canRun={engineState === EngineState.RUNNING && !dyno.running}
              onRun={() => runtime.startDyno()}
              onAbort={() => runtime.abortDyno()}
            />
          )}

          {tab === 'garage' && (
            <GarageShop garage={garage} build={build} spec={spec} onBuyPart={handleBuyPart} onBuyBlock={buyBlock} />
          )}

          {tab === 'career' && (
            <CareerPanel
              garage={garage}
              run={contract}
              onStart={(id) => garageStore.getState().startContract(id)}
              onAbort={() => garageStore.getState().abortContract()}
              onDismiss={() => garageStore.getState().dismissContract()}
              onResetCareer={() => garageStore.getState().resetCareer()}
            />
          )}

          {/* Diagnostics are relevant on every tab, so they live below the switcher. */}
          <WearTracker
            wear={wear}
            state={engineState}
            temp={liveStats.temp}
            rpm={liveStats.rpm}
            redlineRpm={spec.redlineRpm}
            oilLevel={controls.oilLevel}
            oilPressure={liveStats.oilPressure}
            knock={liveStats.knock}
            credits={garage.credits}
            oilChangeCost={ECONOMY.oilChangeCost}
            rebuildCost={rebuildCostFor(wrecked)}
            repairCostFor={repairCostFor}
            onRepairComponent={(key) => {
              if (garageStore.getState().payForRepair(wear[key])) runtime.repairComponent(key);
            }}
            onCompleteRebuild={() => garageStore.getState().payForRebuild(wrecked)}
            onFlushOil={() => {
              if (garageStore.getState().payForOilChange()) runtime.flushOil();
            }}
          />

          <CycleExplainer />
        </div>
      </div>

      <footer className="w-full border-t border-slate-900 bg-slate-950 py-5 text-center text-[11px] text-slate-500 font-mono mt-auto">
        Engine Build Sandbox v5 · 纯 TS 仿真内核 + 真实测功台 + 生涯改装 · React &amp; Tailwind
      </footer>
    </main>
  );
}
