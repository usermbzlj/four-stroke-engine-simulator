/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import {
  ChallengeId,
  ChallengeProgress,
  ComponentWear,
  DynoResult,
  EngineState,
  GarageState,
  TunePreset,
} from './types';
import EngineCanvas from './components/EngineCanvas';
import TelemetryDashboard from './components/TelemetryDashboard';
import ControlPanel from './components/ControlPanel';
import WearTracker from './components/WearTracker';
import DynoPanel from './components/DynoPanel';
import ChallengePanel from './components/ChallengePanel';
import { useEngineSimulation } from './hooks/useEngineSimulation';
import {
  CHALLENGES,
  ECONOMY,
  ENGINE_SPECS,
  INITIAL_CHALLENGE,
  challengeReward,
  challengeScore,
  displacementCc,
  dynoCreditReward,
  dynoScoreGain,
  loadProgress,
  runDynoSweep,
  saveProgress,
  tickChallenge,
} from './engine';
import { engineAudio } from './utils/engineAudio';
import { ShieldAlert, Hammer } from 'lucide-react';

export default function App() {
  // ---- Persisted progress (loaded once) ----
  const persisted = useRef(loadProgress());

  // ---- Engine simulation (physics, audio, telemetry) ----
  const challengeRef = useRef<ChallengeProgress>(INITIAL_CHALLENGE);
  // `garageRef` is the authoritative, high-frequency store for credits/score/
  // runtime-hours (mutated from the rAF tick). React state mirrors it for render
  // + persistence. Both start from the same loaded snapshot.
  const garageRef = useRef<GarageState>({ ...persisted.current.garage });
  const idleStableRef = useRef(0);

  const sim = useEngineSimulation({
    onTick: ({ dt, rpm, wear, engineState, runningHoursDelta }) => {
      // Accumulate engine "mileage" into the authoritative ref, then mirror to
      // React state so it displays and persists (throttled to the tick cadence).
      if (runningHoursDelta > 0) {
        garageRef.current = { ...garageRef.current, runtimeHours: garageRef.current.runtimeHours + runningHoursDelta };
        setGarage(garageRef.current);
      }
      // Advance any active challenge.
      const tick = tickChallenge({
        progress: challengeRef.current,
        idleStableSeconds: idleStableRef.current,
        dt,
        rpm,
        wear,
        engineState,
        spec: sim.specRef.current,
        now: performance.now(),
      });
      idleStableRef.current = tick.idleStableSeconds;
      challengeRef.current = tick.progress;
      if (tick.finished) {
        finishChallenge(tick.finished.passed, tick.finished.value);
      } else {
        setChallenge(challengeRef.current);
      }
    },
  });

  const { engineState, spec, params, wear, liveStats, history, logs, addLog } = sim;

  // ---- Audio settings ----
  const [soundVolume, setSoundVolume] = useState(0.35);
  const [soundMuted, setSoundMuted] = useState(false);
  useEffect(() => engineAudio.setVolume(soundVolume), [soundVolume]);
  useEffect(() => engineAudio.setMute(soundMuted), [soundMuted]);

  // ---- Gameplay state (mirrors persisted refs for rendering) ----
  const [garage, setGarage] = useState<GarageState>({ ...persisted.current.garage });
  const [challenge, setChallenge] = useState<ChallengeProgress>({
    ...INITIAL_CHALLENGE,
    best: persisted.current.best,
  });
  const [presets, setPresets] = useState<TunePreset[]>(persisted.current.presets);
  // `challengeRef` mirrors challenge state every render (challenge is only ever
  // mutated via setChallenge). `garageRef` is authoritative and must NOT be
  // overwritten from state here, or rAF-accumulated runtime-hours would be lost.
  challengeRef.current = challenge;

  const [dynoResult, setDynoResult] = useState<DynoResult | null>(null);
  const [dynoRunning, setDynoRunning] = useState(false);
  const [dynoProgress, setDynoProgress] = useState(0);

  // Persist progress whenever the durable bits change.
  useEffect(() => {
    saveProgress({ garage, presets, best: challenge.best });
  }, [garage, presets, challenge.best]);

  const updateGarage = useCallback((patch: Partial<GarageState>) => {
    setGarage((prev) => {
      const next = { ...prev, ...patch };
      garageRef.current = next;
      return next;
    });
  }, []);

  // ---- Maintenance with economy ----
  const handleRepairComponentPaid = useCallback(
    (key: keyof ComponentWear) => {
      if (engineState === EngineState.EXPLODED) {
        addLog('error', '发动机缸体由于爆裂碎裂损毁。无法进行局部修理，必须彻底大修。');
        return;
      }
      if (sim.wear[key] >= 99.5) {
        addLog('info', '该部件状态良好，无需维修。');
        return;
      }
      if (garageRef.current.credits < ECONOMY.repairCost) {
        addLog('error', `信用点不足！局部维修需要 ${ECONOMY.repairCost} CR，可通过完成挑战/拉力测试赚取。`);
        return;
      }
      updateGarage({ credits: garageRef.current.credits - ECONOMY.repairCost });
      sim.repairComponent(key);
    },
    [engineState, sim, addLog, updateGarage]
  );

  const handleCompleteRebuild = useCallback(() => {
    const isWrecked = engineState === EngineState.EXPLODED || engineState === EngineState.SEIZED;
    if (!isWrecked) {
      if (garageRef.current.credits < ECONOMY.rebuildCost) {
        addLog('error', `信用点不足！完整大修需要 ${ECONOMY.rebuildCost} CR。`);
        return;
      }
      updateGarage({ credits: garageRef.current.credits - ECONOMY.rebuildCost });
    }
    sim.completeRebuild({ free: isWrecked });
  }, [engineState, sim, addLog, updateGarage]);

  // ---- Tune presets ----
  const handleSavePreset = useCallback(() => {
    const name = `T${presets.length + 1} · ${params.fuelAirRatio.toFixed(2)}λ/${params.ignitionTiming}°`;
    const preset: TunePreset = {
      name,
      params: {
        fuelAirRatio: params.fuelAirRatio,
        ignitionTiming: params.ignitionTiming,
        limiterRpm: params.limiterRpm,
        hasLimiter: params.hasLimiter,
        coolantPump: params.coolantPump,
      },
    };
    setPresets((prev) => [...prev, preset].slice(-6));
    addLog('success', `已保存 ECU 调校预设：${name}`);
  }, [presets.length, params, addLog]);

  const handleApplyPreset = useCallback(
    (p: TunePreset) => {
      sim.setParams({ ...p.params });
      addLog('info', `已载入 ECU 调校预设：${p.name}`);
    },
    [sim, addLog]
  );

  // ---- Dyno pull (async sweep with progress animation) ----
  const handleRunDyno = useCallback(() => {
    if (dynoRunning) return;
    if (engineState === EngineState.EXPLODED || engineState === EngineState.SEIZED) {
      addLog('error', '发动机已损毁，无法进行测功机拉力测试。请先大修。');
      return;
    }
    setDynoRunning(true);
    setDynoProgress(0);
    addLog('info', '测功机拉力测试启动：全油门扫描全转速域...');

    const s = sim.specRef.current;
    const p = sim.paramsRef.current;
    const w = sim.wear;
    const steps = 40;
    const result = runDynoSweep(s, p.fuelAirRatio, p.ignitionTiming, w, steps);

    // Animate the progress bar over the same cadence as before (~45ms/step).
    let i = 0;
    const tick = () => {
      i++;
      setDynoProgress(i / steps);
      if (i <= steps) {
        setTimeout(tick, 45);
        return;
      }
      setDynoResult(result);
      setDynoRunning(false);
      setDynoProgress(1);

      const reward = dynoCreditReward(result.peakPowerHp);
      const scoreGain = dynoScoreGain(result.peakPowerHp);
      updateGarage({
        credits: garageRef.current.credits + reward,
        score: garageRef.current.score + scoreGain,
      });
      addLog(
        'success',
        `拉力测试完成！峰值 ${result.peakPowerHp.toFixed(1)}HP @ ${Math.round(result.peakPowerRpm)}rpm，扭矩 ${result.peakTorqueNm.toFixed(
          1
        )}Nm。奖励 +${reward}CR / +${scoreGain}分。`
      );

      if (challengeRef.current.active === 'dyno' && challengeRef.current.status === 'running') {
        finishChallenge(result.peakPowerHp >= challengeRef.current.targetValue, result.peakPowerHp);
      }
    };
    tick();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [dynoRunning, engineState, sim, addLog, updateGarage]);

  // ---- Challenge engine ----
  const startChallenge = useCallback(
    (id: ChallengeId) => {
      if (engineState === EngineState.EXPLODED || engineState === EngineState.SEIZED) {
        addLog('error', '发动机已损毁，请先大修后再开始挑战。');
        return;
      }
      let label = '';
      let target = 0;
      let msg = '';
      const s = sim.specRef.current;
      if (id === 'idle') {
        label = '怠速稳定累计时间 (s)';
        target = 10;
        msg = '保持 950~1250 RPM';
      } else if (id === 'dyno') {
        label = '峰值马力 (HP)';
        target = Math.max(8, Math.round((dynoResult?.peakPowerHp ?? (s.peakTorque * s.torquePeakRpm) / 7127) * 1.05));
        msg = '调校后跑一次测功机';
      } else if (id === 'redline') {
        label = '冲线用时 (s, 越低越好)';
        target = (s.redlineRpm - 200) / 1000;
        msg = '全油门冲向红线';
      } else {
        label = '存活时间 (s)';
        target = 60;
        msg = '保持运转、勿损坏部件';
      }

      idleStableRef.current = 0;
      const next: ChallengeProgress = {
        ...challengeRef.current,
        active: id,
        startedAt: performance.now(),
        elapsed: 0,
        metricLabel: label,
        metricValue: 0,
        targetValue: target,
        status: 'running',
        message: msg,
      };
      challengeRef.current = next;
      setChallenge(next);
      addLog('info', `挑战开始：${CHALLENGES.find((c) => c.id === id)?.name}`);
    },
    [engineState, sim, dynoResult, addLog]
  );

  const stopChallenge = useCallback(() => {
    const next: ChallengeProgress = { ...challengeRef.current, active: null, status: 'idle', message: '' };
    challengeRef.current = next;
    setChallenge(next);
  }, []);

  const finishChallenge = useCallback(
    (passed: boolean, finalValue: number) => {
      const cur = challengeRef.current;
      if (!cur.active) return;
      const id = cur.active;
      const lowerBetter = id === 'redline';
      const prevBest = cur.best[id];
      const better = lowerBetter ? prevBest === 0 || finalValue < prevBest : finalValue > prevBest;
      const newBest = { ...cur.best, [id]: better ? finalValue : prevBest };

      let reward = 0;
      let scoreGain = 0;
      if (passed) {
        reward = challengeReward(id);
        scoreGain = challengeScore(id, finalValue);
        updateGarage({
          credits: garageRef.current.credits + reward,
          score: garageRef.current.score + scoreGain,
        });
      }

      const next: ChallengeProgress = {
        ...cur,
        best: newBest,
        status: passed ? 'passed' : 'failed',
        metricValue: finalValue,
        message: passed ? `挑战达成！+${reward}CR / +${scoreGain}分` : '挑战失败，再接再厉',
      };
      challengeRef.current = next;
      setChallenge(next);
      addLog(passed ? 'success' : 'warning', passed ? `🏆 挑战达成！奖励 +${reward}CR / +${scoreGain}分。` : '挑战失败。');
    },
    [addLog, updateGarage]
  );

  return (
    <main className="min-h-screen bg-slate-950 text-slate-100 flex flex-col items-center">
      {/* HEADER NAV */}
      <header className="w-full border-b border-slate-900 bg-slate-900/40 backdrop-blur py-5 px-6 md:px-12 flex flex-col md:flex-row md:items-center justify-between gap-4 max-w-7xl">
        <div className="flex items-center space-x-3">
          <div className="p-2.5 bg-gradient-to-tr from-orange-600 to-amber-500 rounded-xl shadow-md flex items-center justify-center">
            <Hammer className="w-5 h-5 text-slate-950" />
          </div>
          <div className="flex flex-col">
            <h1 className="text-xl font-bold tracking-tight text-white font-display flex items-center gap-1.5 leading-none">
              四冲程活塞发动机物理拟真模拟器
            </h1>
            <p className="text-xs text-slate-400 font-mono tracking-wide mt-1">
              {spec.name} · 排量 {Math.round(displacementCc(spec))}cc · 红线 {spec.redlineRpm}
            </p>
          </div>
        </div>

        {/* Diagnostic engine status ribbon */}
        <div className="flex items-center space-x-2 bg-slate-950 px-4 py-2 border border-slate-800 rounded-xl font-mono text-xs shadow-inner">
          <span className="text-gray-500 text-[10px]">系统状态:</span>
          {engineState === EngineState.RUNNING && (
            <span className="text-emerald-500 font-extrabold flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-emerald-500 animate-pulse"></span>
              运转 RUNNING ({Math.round(liveStats.rpm)} RPM)
            </span>
          )}
          {engineState === EngineState.STARTING && (
            <span className="text-amber-500 font-bold animate-pulse">⚡ 起动 CRANKING...</span>
          )}
          {engineState === EngineState.STALLED && <span className="text-slate-500">● 熄火 STALLED</span>}
          {engineState === EngineState.OFF && <span className="text-gray-400">● 停机 READY</span>}
          {engineState === EngineState.SEIZED && (
            <span className="text-orange-500 font-bold flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-orange-500"></span>
              抱死 SEIZED
            </span>
          )}
          {engineState === EngineState.EXPLODED && (
            <span className="text-pink-500 font-extrabold flex items-center gap-1 animate-ping">💥 爆炸 EXPLODED</span>
          )}
        </div>
      </header>

      {/* CORE WRAPPER GRID */}
      <div className="w-full max-w-7xl p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        {/* Left Side canvas (5cols) */}
        <div className="lg:col-span-5 flex flex-col space-y-4">
          <EngineCanvas
            state={engineState}
            stroke={sim.stroke}
            crankAngle={sim.getCrankAngle()}
            throttle={params.throttle}
            oilLevel={params.oilLevel}
            temperature={liveStats.temp}
            oilPressure={liveStats.oilPressure}
            wear={wear}
            nosActive={params.hasNitrous}
            redlineRpm={spec.redlineRpm}
            rpm={liveStats.rpm}
            onCrankDrag={sim.crankDrag}
            onManualSpark={sim.manualSpark}
          />

          <ChallengePanel
            challenges={CHALLENGES}
            progress={challenge}
            garage={garage}
            specs={ENGINE_SPECS}
            currentSpecId={spec.id}
            presets={presets}
            onStartChallenge={startChallenge}
            onStopChallenge={stopChallenge}
            onSwapSpec={sim.swapSpec}
            onApplyPreset={handleApplyPreset}
            onSavePreset={handleSavePreset}
          />

          {/* Quick instructions notes under canvas */}
          <div className="bg-slate-900/30 border border-slate-900 rounded-xl p-4 text-xs space-y-2 text-slate-400 leading-relaxed font-sans">
            <h3 className="font-semibold text-slate-300 font-mono flex items-center gap-1">
              <ShieldAlert className="w-3.5 h-3.5 text-sky-400" />
              四冲程原理及模拟说明 / How it works:
            </h3>
            <ul className="list-disc list-inside space-y-1.5 pl-1">
              <li>
                <strong className="text-blue-400 font-mono">1. 进气 (Intake):</strong> 活塞下行，进气门开启，吸入蓝色新鲜混合气（充量由油门×VE曲线决定）。
              </li>
              <li>
                <strong className="text-amber-400 font-mono">2. 压缩 (Compression):</strong> 活塞上行，气门关闭，按多变过程压缩，缸压随压缩比升高。
              </li>
              <li>
                <strong className="text-red-400 font-mono">3. 动力 (Power):</strong> 火花塞跳火（紫色电弧），火焰膨胀推动活塞做功。温度/压缩比过高会爆震。
              </li>
              <li>
                <strong className="text-slate-300 font-mono">4. 排气 (Exhaust):</strong> 活塞上行，排气门开启，排出灰色废气。
              </li>
            </ul>
          </div>
        </div>

        {/* Right Side dashboards & wear panels (7cols) */}
        <div className="lg:col-span-7 flex flex-col space-y-6">
          <TelemetryDashboard
            stats={liveStats}
            history={history}
            logs={logs}
            redlineRpm={spec.redlineRpm}
            onClearLogs={sim.clearLogs}
          />

          <ControlPanel
            state={engineState}
            params={params}
            volume={soundVolume}
            isMuted={soundMuted}
            redlineRpm={spec.redlineRpm}
            destructRpm={spec.destructRpm}
            onUpdateParams={sim.setParams}
            onStartHold={sim.startHold}
            onCutoffToggle={sim.toggleCutoff}
            onSoundVolumeChange={setSoundVolume}
            onSoundMuteToggle={() => setSoundMuted((m) => !m)}
            onTriggerSpark={sim.manualSpark}
            onResetParams={sim.resetParams}
          />

          <DynoPanel
            result={dynoResult}
            isRunning={dynoRunning}
            progress={dynoProgress}
            canRun={engineState !== EngineState.EXPLODED && engineState !== EngineState.SEIZED}
            onRunDyno={handleRunDyno}
          />

          <WearTracker
            wear={wear}
            state={engineState}
            temp={liveStats.temp}
            rpm={liveStats.rpm}
            oilLevel={params.oilLevel}
            oilPressure={liveStats.oilPressure}
            credits={garage.credits}
            onRepairComponent={handleRepairComponentPaid}
            onCompleteRebuild={handleCompleteRebuild}
            onFlushOil={sim.flushOil}
          />
        </div>
      </div>

      {/* FOOTER */}
      <footer className="w-full border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-500 font-mono mt-auto">
        <span>Engine Physics Sandbox v4.1 &bull; 模块化拟真核心 + 玩法升级 &bull; Built with React & Tailwind</span>
      </footer>
    </main>
  );
}
