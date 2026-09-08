/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { MutableRefObject, useCallback, useEffect, useRef, useState } from 'react';
import {
  ComponentWear,
  EngineParameters,
  EngineSpec,
  EngineState,
  LogMessage,
  StrokeType,
  TelemetryPoint,
} from '../types';
import {
  EngineEvent,
  EngineSimState,
  INITIAL_WEAR,
  StepDerived,
  createEngineState,
  displacementCc,
  getSpecById,
  stepEngine,
  torqueToPowerHp,
  volumetricEfficiency,
  ENGINE_SPECS,
  COMBUSTION,
} from '../engine';
import { engineAudio } from '../utils/engineAudio';
import { holdTransientZero, smoothMetric } from '../utils/telemetrySmoothing';

const TELEMETRY_INTERVAL = 0.095; // seconds between React telemetry pushes
const HISTORY_LENGTH = 72;
const LOG_LIMIT = 40;

export const createTelemetryPoint = (coolantTemp = 40): TelemetryPoint => ({
  timeIndex: 0,
  rpm: 0,
  temp: coolantTemp,
  torque: 0,
  power: 0,
  pressure: 1.0,
  fuelFlow: 0,
  efficiency: 0,
  oilPressure: 0,
});

/** Callbacks the hook invokes when the simulation crosses gameplay-relevant edges. */
export interface EngineSimCallbacks {
  /** Called once per telemetry tick with dt and the live physics snapshot. */
  onTick?: (ctx: {
    dt: number;
    rpm: number;
    wear: ComponentWear;
    engineState: EngineState;
    runningHoursDelta: number;
  }) => void;
}

export interface EngineSimApi {
  // Live React state
  engineState: EngineState;
  stroke: StrokeType;
  params: EngineParameters;
  spec: EngineSpec;
  wear: ComponentWear;
  liveStats: TelemetryPoint;
  history: TelemetryPoint[];
  logs: LogMessage[];

  // Imperative reads for the canvas (avoid re-render churn)
  getCrankAngle: () => number;

  // Mutators
  setParams: (patch: Partial<EngineParameters>) => void;
  resetParams: () => void;
  startHold: (active: boolean) => void;
  toggleCutoff: () => void;
  manualSpark: () => void;
  crankDrag: (angle: number) => void;
  swapSpec: (id: string) => void;

  // Wear / maintenance
  repairComponent: (key: keyof ComponentWear) => void;
  flushOil: () => void;
  completeRebuild: (opts?: { free?: boolean }) => void;

  // Logging
  addLog: (level: LogMessage['type'], message: string) => void;
  clearLogs: () => void;

  // Direct refs (used by gameplay orchestration in App)
  stateRef: MutableRefObject<EngineSimState>;
  specRef: MutableRefObject<EngineSpec>;
  paramsRef: MutableRefObject<EngineParameters>;
}

export const INITIAL_PARAMS: EngineParameters = {
  throttle: 0.2,
  load: 0.8,
  fuelAirRatio: 1.0,
  oilLevel: 90,
  ignitionTiming: 12,
  hasLimiter: false,
  limiterRpm: 6800,
  hasNitrous: false,
  coolantPump: 0.6,
  choke: 0.0,
};

const makeLogId = (): string => Math.random().toString(36).substring(2, 9);

/**
 * Owns the 60fps physics loop and bridges the pure engine core to React.
 *
 * The integrator itself lives in `src/engine/simulation.ts`; this hook handles
 * rAF scheduling, turning {@link EngineEvent}s into logs/audio, and computing
 * smoothed display telemetry (identical to the original implementation).
 */
export function useEngineSimulation(callbacks: EngineSimCallbacks = {}): EngineSimApi {
  // --- React state (low-frequency, render-driving) ---
  const [engineState, setEngineState] = useState<EngineState>(EngineState.OFF);
  const [stroke, setStroke] = useState<StrokeType>(StrokeType.INTAKE);
  const [params, setParamsState] = useState<EngineParameters>(INITIAL_PARAMS);
  const [spec, setSpec] = useState<EngineSpec>(ENGINE_SPECS[0]);
  const [wear, setWear] = useState<ComponentWear>(INITIAL_WEAR);
  const [liveStats, setLiveStats] = useState<TelemetryPoint>(() => createTelemetryPoint());
  const [history, setHistory] = useState<TelemetryPoint[]>([]);
  const [logs, setLogs] = useState<LogMessage[]>([]);

  // --- High-frequency refs (mutated inside rAF, never trigger renders) ---
  const stateRef = useRef<EngineSimState>(createEngineState(40, INITIAL_PARAMS.throttle));
  const paramsRef = useRef<EngineParameters>(INITIAL_PARAMS);
  const specRef = useRef<EngineSpec>(ENGINE_SPECS[0]);
  const callbacksRef = useRef(callbacks);
  callbacksRef.current = callbacks;
  paramsRef.current = params;
  specRef.current = spec;

  const logsRef = useRef<LogMessage[]>([]);
  const lastTimeRef = useRef<number>(0);

  // Telemetry smoothing carriers
  const displayStatsRef = useRef<TelemetryPoint>(createTelemetryPoint());
  const historyRef = useRef<TelemetryPoint[]>([]);
  const pressurePeakRef = useRef<number>(1.0);
  const fuelZeroSecondsRef = useRef<number>(0);
  const efficiencyZeroSecondsRef = useRef<number>(0);
  const torqueAvgRef = useRef<number>(0);
  const scrollIndexRef = useRef<number>(0);
  const initDoneRef = useRef(false);

  const addLog = useCallback((type: LogMessage['type'], message: string) => {
    const time = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const next: LogMessage = { id: makeLogId(), time, type, message };
    logsRef.current = [next, ...logsRef.current].slice(0, LOG_LIMIT);
    setLogs(logsRef.current);
  }, []);

  const clearLogs = useCallback(() => {
    logsRef.current = [];
    setLogs([]);
  }, []);

  // Process a single simulation event into side effects.
  const handleEvent = useCallback(
    (e: EngineEvent) => {
      switch (e.kind) {
        case 'stateChange':
          setEngineState(e.to);
          break;
        case 'log':
          addLog(e.level, e.message);
          break;
        case 'spark':
          engineAudio.triggerSpark();
          break;
        case 'combustion':
          engineAudio.triggerCombustion(e.rpm, e.throttle, e.knocking);
          break;
        case 'backfire':
          engineAudio.triggerBackfire();
          break;
        case 'explosion':
          engineAudio.triggerExplosion();
          break;
        case 'failure':
          // The simulation already applied the failure to its own state; just
          // sync React and play audio (audio handled by the 'explosion' event).
          setEngineState(e.state);
          break;
      }
    },
    [addLog]
  );

  // ---- Init logs + audio unlock ----
  useEffect(() => {
    if (!initDoneRef.current) {
      initDoneRef.current = true;
      addLog('info', '四冲程单缸汽油发动机仿真模型已就绪。');
      addLog('info', '润滑油质良好。等待起动电机驱动旋转...');
    }
    const handleUnlock = () => engineAudio.init();
    window.addEventListener('click', handleUnlock);
    window.addEventListener('touchstart', handleUnlock);
    return () => {
      window.removeEventListener('click', handleUnlock);
      window.removeEventListener('touchstart', handleUnlock);
    };
  }, [addLog]);

  // ---- Main rAF physics loop ----
  useEffect(() => {
    let animId = 0;
    let throttledTimer = 0;

    const loop = (timestamp: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = timestamp;
      const dt = (timestamp - lastTimeRef.current) / 1000;
      lastTimeRef.current = timestamp;

      const p = paramsRef.current;
      const sp = specRef.current;

      const { state, derived, events } = stepEngine(stateRef.current, p, sp, dt, timestamp);
      stateRef.current = state;

      for (const e of events) handleEvent(e);

      // Accumulate runtime "mileage" while actually running (matches original).
      const clampedDt = Math.min(0.1, Math.max(0, dt));
      const runningHoursDelta =
        state.engineState === EngineState.RUNNING && state.rpm > 100 ? clampedDt / 3600 : 0;

      // Audio synthesis bed.
      engineAudio.update(
        state.rpm,
        state.actualThrottle,
        state.cranking,
        state.engineState === EngineState.RUNNING,
        100 - state.wear.conrodBearings,
        state.coolantTemp,
        p.coolantPump
      );

      // Let the owner track challenges etc.
      callbacksRef.current.onTick?.({
        dt: clampedDt,
        rpm: state.rpm,
        wear: state.wear,
        engineState: state.engineState,
        runningHoursDelta,
      });

      // Decay the pressure peak hold and the steady-state torque average.
      pressurePeakRef.current = Math.max(
        1.0,
        pressurePeakRef.current * Math.exp(-clampedDt / 0.95),
        derived.chamber.pressure
      );
      torqueAvgRef.current += (Math.max(0, derived.meanBrakeTorque) - torqueAvgRef.current) * Math.min(1, clampedDt * 5);

      // ---- Throttled telemetry push to React ----
      throttledTimer += clampedDt;
      if (throttledTimer > TELEMETRY_INTERVAL) {
        pushTelemetry(throttledTimer, state, derived, sp, p);
        setStroke(derived.stroke);
        setWear(state.wear);
        throttledTimer = 0;
      }

      animId = requestAnimationFrame(loop);
    };

    const pushTelemetry = (
      sampleDt: number,
      state: EngineSimState,
      derived: StepDerived,
      sp: EngineSpec,
      p: EngineParameters
    ) => {
      const newRpm = state.rpm;
      const veNow = volumetricEfficiency(newRpm, sp);
      const displayTorque = Math.max(0, torqueAvgRef.current);
      const hp = torqueToPowerHp(displayTorque, newRpm);
      const engineLiters = displacementCc(sp) / 1000;
      const mlFlow =
        newRpm > 50 && derived.selfSustained
          ? (newRpm / 1000) * (0.08 + state.actualThrottle) * veNow * engineLiters * 0.72 * (p.hasNitrous ? 2.5 : 1.0)
          : 0;
      const optTiming = COMBUSTION.optTimingBase + newRpm / COMBUSTION.optTimingRpmSlope;
      const timingQuality = Math.max(0.05, Math.exp(-Math.pow((p.ignitionTiming - optTiming) / 15, 2)));
      const lambdaQuality = Math.max(0, 1.0 - Math.pow(p.fuelAirRatio - COMBUSTION.lambdaPower, 2) * 2.2);
      const combustionQuality =
        derived.selfSustained && newRpm > 80
          ? Math.round(
              Math.max(
                0,
                Math.min(
                  100,
                  100 *
                    lambdaQuality *
                    timingQuality *
                    (0.75 + 0.25 * veNow) *
                    (state.wear.sparkPlug / 100) *
                    derived.limiterTorqueScale
                )
              )
            )
          : 0;

      const heldFuel = holdTransientZero(displayStatsRef.current.fuelFlow, mlFlow, sampleDt, {
        zeroHoldSeconds: 0.3,
        zeroDecayTimeConstant: 0.75,
        elapsedZeroSeconds: fuelZeroSecondsRef.current,
      });
      fuelZeroSecondsRef.current = heldFuel.elapsedZeroSeconds;

      const heldEfficiency = holdTransientZero(displayStatsRef.current.efficiency, combustionQuality, sampleDt, {
        zeroHoldSeconds: 0.45,
        zeroDecayTimeConstant: 0.9,
        elapsedZeroSeconds: efficiencyZeroSecondsRef.current,
      });
      efficiencyZeroSecondsRef.current = heldEfficiency.elapsedZeroSeconds;

      const previous = displayStatsRef.current;
      const statPoint: TelemetryPoint = {
        timeIndex: scrollIndexRef.current++,
        rpm: smoothMetric(previous.rpm, newRpm, sampleDt, {
          timeConstant: 0.24,
          maxDeltaPerSecond: sp.redlineRpm * 0.65,
          deadband: 2,
        }),
        temp: smoothMetric(previous.temp, state.coolantTemp, sampleDt, { timeConstant: 0.9 }),
        torque: smoothMetric(previous.torque, displayTorque, sampleDt, {
          timeConstant: 0.34,
          maxDeltaPerSecond: sp.peakTorque * 3.5,
          deadband: 0.05,
        }),
        power: smoothMetric(previous.power, hp, sampleDt, {
          timeConstant: 0.38,
          maxDeltaPerSecond: Math.max(12, sp.peakTorque * 1.5),
          deadband: 0.05,
        }),
        pressure: smoothMetric(previous.pressure, pressurePeakRef.current, sampleDt, {
          timeConstant: 0.28,
          maxDeltaPerSecond: 90,
        }),
        fuelFlow: smoothMetric(previous.fuelFlow, heldFuel.value, sampleDt, {
          timeConstant: 0.44,
          deadband: 0.0005,
        }),
        efficiency: Math.round(
          smoothMetric(previous.efficiency, heldEfficiency.value, sampleDt, {
            timeConstant: 0.48,
            maxDeltaPerSecond: 95,
            deadband: 0.4,
          })
        ),
        oilPressure: smoothMetric(previous.oilPressure, state.oilPressure, sampleDt, {
          timeConstant: 0.24,
          maxDeltaPerSecond: 12,
          deadband: 0.02,
        }),
      };

      displayStatsRef.current = statPoint;
      setLiveStats(statPoint);
      historyRef.current = [...historyRef.current, statPoint].slice(-HISTORY_LENGTH);
      setHistory(historyRef.current);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  }, [handleEvent]);

  // ---- Reset helpers ----
  const resetTelemetry = useCallback((coolantTemp: number) => {
    scrollIndexRef.current = 0;
    historyRef.current = [];
    displayStatsRef.current = createTelemetryPoint(coolantTemp);
    pressurePeakRef.current = 1.0;
    fuelZeroSecondsRef.current = 0;
    efficiencyZeroSecondsRef.current = 0;
    torqueAvgRef.current = 0;
    lastTimeRef.current = 0;
    setHistory([]);
    setLiveStats(createTelemetryPoint(coolantTemp));
  }, []);

  // ---- Public mutators ----
  const setParams = useCallback((patch: Partial<EngineParameters>) => {
    setParamsState((prev) => ({ ...prev, ...patch }));
  }, []);

  const resetParams = useCallback(() => {
    setParamsState(INITIAL_PARAMS);
    addLog('info', '调节控制台所有性能及阻力参数已还原为出厂默认设置。');
  }, [addLog]);

  const startHold = useCallback(
    (active: boolean) => {
      stateRef.current.cranking = active;
      if (active) {
        const st = stateRef.current.engineState;
        if (st === EngineState.OFF || st === EngineState.STALLED) {
          stateRef.current.ignitionCut = false;
          stateRef.current.engineState = EngineState.STARTING;
          setEngineState(EngineState.STARTING);
          addLog('info', '起动马达接合啮合齿：起动电机开始拖动机件运转。');
        }
      }
    },
    [addLog]
  );

  const toggleCutoff = useCallback(() => {
    stateRef.current.ignitionCut = !stateRef.current.ignitionCut;
    if (stateRef.current.engineState === EngineState.RUNNING) {
      stateRef.current.engineState = EngineState.STALLED;
      stateRef.current.rpm = 0;
      setEngineState(EngineState.STALLED);
      addLog('warning', '切断点火系统，发动机熄火。 (IGNITION OFF)');
    }
  }, [addLog]);

  const manualSpark = useCallback(() => {
    const st = stateRef.current.engineState;
    if (st === EngineState.EXPLODED || st === EngineState.SEIZED) return;
    engineAudio.triggerSpark();
    addLog('info', '外部强制高压脉冲跳火。');

    const p = paramsRef.current;
    if (stateRef.current.rpm > 100 && p.throttle > 0.05) {
      const knocking =
        stateRef.current.wear.conrodBearings < 30 || (p.ignitionTiming > 25 && p.fuelAirRatio > 1.25);
      engineAudio.triggerCombustion(stateRef.current.rpm, p.throttle, knocking);
      if (st === EngineState.STALLED || st === EngineState.OFF) {
        stateRef.current.engineState = EngineState.RUNNING;
        setEngineState(EngineState.RUNNING);
        addLog('success', '点火连续！发动机正常运转运行。');
      }
    }
  }, [addLog]);

  const crankDrag = useCallback((angle: number) => {
    stateRef.current.angle = angle;
    const st = stateRef.current.engineState;
    if (st === EngineState.OFF || st === EngineState.STALLED) {
      stateRef.current.rpm = 90;
    }
  }, []);

  const swapSpec = useCallback(
    (id: string) => {
      const next = getSpecById(id);
      if (next.id === specRef.current.id) return;
      setSpec(next);
      specRef.current = next;
      stateRef.current = createEngineState(40, 0.2);
      setWear(INITIAL_WEAR);
      setEngineState(EngineState.OFF);
      setParamsState((prev) => ({
        ...prev,
        throttle: 0.2,
        limiterRpm: Math.min(prev.limiterRpm, next.redlineRpm),
        oilLevel: 100,
      }));
      stateRef.current.actualThrottle = 0.2;
      resetTelemetry(40);
      addLog(
        'info',
        `已换装发动机平台：${next.name}（排量 ${Math.round(displacementCc(next))}cc，红线 ${next.redlineRpm}）。`
      );
    },
    [addLog, resetTelemetry]
  );

  const repairComponent = useCallback(
    (key: keyof ComponentWear) => {
      const st = stateRef.current.engineState;
      if (st === EngineState.EXPLODED) {
        addLog('error', '发动机缸体由于爆裂碎裂损毁。无法进行局部修理，必须彻底大修。');
        return false;
      }
      stateRef.current.wear = { ...stateRef.current.wear, [key]: 100 };
      setWear(stateRef.current.wear);
      const label =
        key === 'pistonRings'
          ? '活塞压缩环'
          : key === 'cylinderWall'
          ? '气缸内壁'
          : key === 'conrodBearings'
          ? '大头轴瓦承载圈'
          : key === 'crankshaftJournal'
          ? '曲轴主轴颈'
          : key === 'sparkPlug'
          ? '火花塞跳火间隙电极'
          : '气门气密封套';
      addLog('success', `大修部件完成：已修复及翻新组件：${label}。`);
      return true;
    },
    [addLog]
  );

  const flushOil = useCallback(() => {
    setParamsState((prev) => ({ ...prev, oilLevel: 100 }));
    addLog('success', '清洗并更换引擎机油完成。曲轴箱内注入高粘度高质全合成润滑脂。');
  }, [addLog]);

  const completeRebuild = useCallback(
    (_opts?: { free?: boolean }) => {
      stateRef.current = createEngineState(40, paramsRef.current.throttle);
      setWear(INITIAL_WEAR);
      setParamsState((prev) => ({ ...prev, oilLevel: 100 }));
      setEngineState(EngineState.OFF);
      resetTelemetry(40);
      addLog('success', '🛠 核心重构与总装：发动机完全彻底修理完成！缸体已重装翻新，换装多项原厂全新高承载组件！');
    },
    [addLog, resetTelemetry]
  );

  const getCrankAngle = useCallback(() => stateRef.current.angle, []);

  return {
    engineState,
    stroke,
    params,
    spec,
    wear,
    liveStats,
    history,
    logs,
    getCrankAngle,
    setParams,
    resetParams,
    startHold,
    toggleCutoff,
    manualSpark,
    crankDrag,
    swapSpec,
    repairComponent,
    flushOil,
    completeRebuild,
    addLog,
    clearLogs,
    stateRef,
    specRef,
    paramsRef,
  };
}
