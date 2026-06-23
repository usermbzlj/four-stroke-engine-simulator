/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, useEffect, useRef } from 'react';
import {
  EngineState,
  StrokeType,
  EngineParameters,
  ComponentWear,
  TelemetryPoint,
  LogMessage,
  EngineSpec,
  DynoResult,
  DynoCurvePoint,
  Challenge,
  ChallengeId,
  ChallengeProgress,
  GarageState,
  TunePreset,
} from './types';
import EngineCanvas from './components/EngineCanvas';
import TelemetryDashboard from './components/TelemetryDashboard';
import ControlPanel from './components/ControlPanel';
import WearTracker from './components/WearTracker';
import DynoPanel from './components/DynoPanel';
import ChallengePanel from './components/ChallengePanel';
import {
  getChamberState,
  calculatePistonTorque,
  smoothThrottle,
  oilPressureBar,
  estimateBrakeTorque,
  torqueToPowerHp,
  volumetricEfficiency,
  displacementCc,
  rotationalDragTorque,
  ENGINE_SPECS,
  getSpecById,
} from './utils/enginePhysics';
import { engineAudio } from './utils/engineAudio';
import { holdTransientZero, smoothMetric } from './utils/telemetrySmoothing';
import { ShieldAlert, Hammer } from 'lucide-react';

const INITIAL_PARAMS: EngineParameters = {
  throttle: 0.20,
  load: 0.8,
  fuelAirRatio: 1.0, // Lambda
  oilLevel: 90,
  ignitionTiming: 12, // BTDC degrees
  hasLimiter: false,
  limiterRpm: 6800,
  hasNitrous: false,
  coolantPump: 0.6,
  choke: 0.0,
};

const INITIAL_WEAR: ComponentWear = {
  pistonRings: 100,
  cylinderWall: 100,
  conrodBearings: 100,
  crankshaftJournal: 100,
  sparkPlug: 100,
  valves: 100
};

const CHALLENGES: Challenge[] = [
  {
    id: 'idle',
    name: '稳定怠速考验 (Idle Master)',
    subtitle: '把转速稳定在 1100±150 RPM 持续 10 秒',
    goal: '累计稳定 10s',
  },
  {
    id: 'dyno',
    name: '爆改马力赛 (Dyno King)',
    subtitle: '调校并跑一次测功机，追求最高峰值马力',
    goal: '峰值马力 ≥ 起步目标',
  },
  {
    id: 'redline',
    name: '红线冲刺 (Redline Sprint)',
    subtitle: '从怠速全油门冲到红线前 200rpm，越快越好',
    goal: '用时尽量短',
  },
  {
    id: 'endurance',
    name: '耐久挑战 (Endurance Run)',
    subtitle: '保持运转 60 秒且不损坏任何部件',
    goal: '存活 60s',
  },
];

const INITIAL_CHALLENGE: ChallengeProgress = {
  active: null,
  startedAt: 0,
  elapsed: 0,
  metricLabel: '',
  metricValue: 0,
  targetValue: 0,
  best: { idle: 0, dyno: 0, endurance: 0, redline: 0 },
  status: 'idle',
  message: '',
};

const createTelemetryPoint = (coolantTemp = 40): TelemetryPoint => ({
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

export default function App() {
  // Engine active conditions
  const [engineState, setEngineState] = useState<EngineState>(EngineState.OFF);
  const [stroke, setStroke] = useState<StrokeType>(StrokeType.INTAKE);
  const [params, setParams] = useState<EngineParameters>(INITIAL_PARAMS);
  const paramsRef = useRef<EngineParameters>(INITIAL_PARAMS);
  paramsRef.current = params;
  const [wear, setWear] = useState<ComponentWear>(INITIAL_WEAR);

  // Engine build spec
  const [spec, setSpec] = useState<EngineSpec>(ENGINE_SPECS[0]);
  const specRef = useRef<EngineSpec>(ENGINE_SPECS[0]);
  specRef.current = spec;

  // Audio system state
  const [soundVolume, setSoundVolume] = useState<number>(0.35);
  const [soundMuted, setSoundMuted] = useState<boolean>(false);

  // Gameplay state
  const [garage, setGarage] = useState<GarageState>({ credits: 250, runtimeHours: 0, score: 0 });
  const garageRef = useRef<GarageState>({ credits: 250, runtimeHours: 0, score: 0 });
  const [challenge, setChallenge] = useState<ChallengeProgress>(INITIAL_CHALLENGE);
  const challengeRef = useRef<ChallengeProgress>(INITIAL_CHALLENGE);
  const [presets, setPresets] = useState<TunePreset[]>([]);

  // Dyno state
  const [dynoResult, setDynoResult] = useState<DynoResult | null>(null);
  const [dynoRunning, setDynoRunning] = useState(false);
  const [dynoProgress, setDynoProgress] = useState(0);

  // Quick lookup refs for high-frequency physics updates at 60fps
  const angleRef = useRef<number>(0);         // current crank angle in radians (0 to 4*PI)
  const rpmRef = useRef<number>(0);           // engine rotation speed
  const tempRef = useRef<number>(40);         // coolant/cylinder temp (cold start baseline)
  const oilTempRef = useRef<number>(35);      // oil temperature (lags coolant)
  const oilPressureRef = useRef<number>(0);   // bar
  const actualThrottleRef = useRef<number>(0.20); // butterfly position after lag
  const isCrankingRef = useRef<boolean>(false);
  const cutoffRef = useRef<boolean>(false);   // ignition cutoff trigger
  const lastTimeRef = useRef<number>(0);
  const sparkFiredRef = useRef<boolean>(false);
  const wearRef = useRef<ComponentWear>(INITIAL_WEAR);
  const engineStateRef = useRef<EngineState>(EngineState.OFF);
  const initDoneRef = useRef(false);
  const backfiredRef = useRef<boolean>(false);

  // Diagnostic Logs
  const [logs, setLogs] = useState<LogMessage[]>([]);
  const logsRef = useRef<LogMessage[]>([]);

  // Telemetry buffer for real-time charting
  const [liveStats, setLiveStats] = useState<TelemetryPoint>(() => createTelemetryPoint());
  const [history, setHistory] = useState<TelemetryPoint[]>([]);
  const historyRef = useRef<TelemetryPoint[]>([]);
  const displayStatsRef = useRef<TelemetryPoint>(createTelemetryPoint());
  const pressurePeakRef = useRef<number>(1.0);
  const fuelZeroSecondsRef = useRef<number>(0);
  const efficiencyZeroSecondsRef = useRef<number>(0);
  const crankDriveTorqueRef = useRef<number>(0);
  const scrollIndexRef = useRef<number>(0);

  // Add diagnostic logs helper
  const addLog = (type: LogMessage['type'], message: string) => {
    const timeStr = new Date().toLocaleTimeString('zh-CN', { hour12: false });
    const newLog: LogMessage = {
      id: Math.random().toString(36).substring(2, 9),
      time: timeStr,
      type,
      message
    };
    logsRef.current = [newLog, ...logsRef.current].slice(0, 40); // cap at 40 log items
    setLogs(logsRef.current);
  };

  useEffect(() => {
    if (!initDoneRef.current) {
      initDoneRef.current = true;
      addLog('info', '四冲程单缸汽油发动机仿真模型已就绪。');
      addLog('info', '润滑油质良好。等待起动电机驱动旋转...');
    }

    const handleUnlock = () => {
      engineAudio.init();
      engineAudio.setVolume(soundVolume);
      engineAudio.setMute(soundMuted);
    };
    window.addEventListener('click', handleUnlock);
    window.addEventListener('touchstart', handleUnlock);
    return () => {
      window.removeEventListener('click', handleUnlock);
      window.removeEventListener('touchstart', handleUnlock);
    };
  }, []);

  // Sync sound settings with manager
  useEffect(() => {
    engineAudio.setVolume(soundVolume);
  }, [soundVolume]);

  useEffect(() => {
    engineAudio.setMute(soundMuted);
  }, [soundMuted]);

  // Main high-frequency dynamic physics integrator (requestAnimationFrame loop)
  useEffect(() => {
    let animId: number;
    let throttledUpdateTimer = 0;
    let torqueAvg = 0; // smoothed brake torque for stable HP/Nm readouts

    const loop = (timestamp: number) => {
      if (!lastTimeRef.current) lastTimeRef.current = timestamp;
      let dt = (timestamp - lastTimeRef.current) / 1000;
      lastTimeRef.current = timestamp;

      // Restrict dt leaps when tab is inactive
      if (dt > 0.1) dt = 0.1;

      const params = paramsRef.current;
      const spec = specRef.current;

      // Physics factors
      const isCranking = isCrankingRef.current;
      const curRpm = rpmRef.current;
      const angle = angleRef.current;
      const curState = engineStateRef.current;
      const isDead = curState === EngineState.EXPLODED || curState === EngineState.SEIZED;

      // Throttle butterfly inertia (commanded -> actual)
      actualThrottleRef.current = smoothThrottle(actualThrottleRef.current, params.throttle, dt);
      const actualThrottle = actualThrottleRef.current;

      // Oil pressure derived from rpm/oil/temp/wear
      oilPressureRef.current = oilPressureBar(curRpm, params.oilLevel, oilTempRef.current, wearRef.current);

      // 1. STARTER MOTOR TORQUE (heavier flywheels are harder to spin up)
      let starterTorque = 0;
      if (isCranking && !isDead) {
        const starterStrength = 2.2 * (spec.rotatingInertia / 0.14);
        starterTorque = Math.max(0, (75 - (curRpm * 2 * Math.PI) / 60) * starterStrength);
      }

      // 2. RECIPROCATING FRICTION TORQUE
      const normalViscosity = 0.3 + (oilTempRef.current < 70 ? (70 - oilTempRef.current) * 0.012 : 0); // cold oil is sticky
      let wearFrictionMultiplier = 1.0;
      if (params.oilLevel < 35) {
        wearFrictionMultiplier += Math.pow(35 - params.oilLevel, 1.3) * 0.06;
      }
      // Low oil pressure = metal-to-metal contact = big friction spike
      if (oilPressureRef.current < 0.8 && curRpm > 200) {
        wearFrictionMultiplier += (0.8 - oilPressureRef.current) * 2.5;
      }
      wearFrictionMultiplier += (100 - wearRef.current.crankshaftJournal) * 0.015;
      if (tempRef.current > 115) {
        wearFrictionMultiplier += (tempRef.current - 115) * 0.04;
      }

      const kineticFrictionTorque = curRpm * 0.0015 * normalViscosity * wearFrictionMultiplier;
      const staticFrictionTorque = 1.6 * wearFrictionMultiplier;
      const totalDecelFriction = staticFrictionTorque + kineticFrictionTorque;

      // 3. THERMODYNAMICS & CYLINDER PRESSURE FORCE
      const cycleRad = angle % (4 * Math.PI);
      const thetaDeg = (cycleRad * 180) / Math.PI;

      let strokeType = StrokeType.INTAKE;
      if (thetaDeg >= 0 && thetaDeg < 180) strokeType = StrokeType.INTAKE;
      else if (thetaDeg >= 180 && thetaDeg < 360) strokeType = StrokeType.COMPRESSION;
      else if (thetaDeg >= 360 && thetaDeg < 540) strokeType = StrokeType.POWER;
      else strokeType = StrokeType.EXHAUST;

      const isRunningSelfSustained = curState === EngineState.RUNNING || curState === EngineState.STARTING;
      const chamber = getChamberState(
        cycleRad,
        actualThrottle,
        params.fuelAirRatio,
        isRunningSelfSustained,
        wearRef.current,
        params.hasNitrous,
        params.ignitionTiming,
        curRpm,
        spec,
        tempRef.current,
        params.choke
      );

      if (chamber.knockSeverity > 0.12 && Math.random() < 0.02) {
        addLog('critical', `🚨 探测到发动机敲缸 (Knocking ${Math.round(chamber.knockSeverity * 100)}%)！高温/高压缩/点火过早导致异常爆震！建议延迟点火角或降温。`);
      }
      if (chamber.misfire && isRunningSelfSustained && Math.random() < 0.03) {
        addLog('warning', `⚠️ 气缸失火 (Misfire)！空燃比 λ:${params.fuelAirRatio.toFixed(2)} 已超越稳定燃烧极限！`);
      }

      const sparkThresholdDeg = 360 - params.ignitionTiming;
      const isWithinSparkWindow = thetaDeg >= sparkThresholdDeg && thetaDeg < sparkThresholdDeg + 12;

      let triggeredIgnitedState = chamber.ignited;
      let limiterCut = false;

      // Rev limiter spark cut (bounces off the limiter with backfires)
      if (params.hasLimiter && curRpm > params.limiterRpm) {
        triggeredIgnitedState = false;
        limiterCut = true;
        if (isWithinSparkWindow && Math.sin(timestamp * 0.05) > 0) {
          triggeredIgnitedState = true;
        }
      }

      if (cutoffRef.current) triggeredIgnitedState = false;

      // Worn spark plug random misfire
      if (triggeredIgnitedState && Math.random() > wearRef.current.sparkPlug / 100) {
        triggeredIgnitedState = false;
      }

      // Spark sound + combustion sound at the spark point
      if (isWithinSparkWindow && !sparkFiredRef.current && !isDead) {
        sparkFiredRef.current = true;
        engineAudio.triggerSpark();

        if (triggeredIgnitedState) {
          const knockingPing =
            chamber.knockSeverity > 0.2 ||
            wearRef.current.conrodBearings < 30 ||
            (params.ignitionTiming > 25 && params.fuelAirRatio > 1.25);
          engineAudio.triggerCombustion(curRpm, actualThrottle, knockingPing);
          if (params.hasNitrous && Math.random() < 0.2) {
            addLog('critical', 'NOS 笑气爆燃！产生极致燃烧功！');
          }
        } else if (limiterCut) {
          if (!backfiredRef.current) {
            engineAudio.triggerBackfire();
            backfiredRef.current = true;
          }
        } else if (isRunningSelfSustained && Math.random() < 0.12) {
          addLog('warning', '缺火 (Misfire): 火花塞电极碳化或混合气未点燃');
        }
      }

      if (!isWithinSparkWindow) {
        sparkFiredRef.current = false;
        backfiredRef.current = false;
      }

      // Torque from gas pressure on the piston crown
      let pistonForceTorque = 0;
      if (triggeredIgnitedState && strokeType === StrokeType.POWER) {
        pistonForceTorque = calculatePistonTorque(cycleRad, chamber.pressure, spec);
      } else {
        const effectivePressure = chamber.ignited && !triggeredIgnitedState ? 1.2 : chamber.pressure;
        pistonForceTorque = calculatePistonTorque(cycleRad, effectivePressure, spec);
      }

      const limiterTorqueScale = params.hasLimiter && curRpm > params.limiterRpm
        ? 0.22 + 0.25 * Math.max(0, Math.sin(timestamp * 0.05))
        : 1.0;
      const combustionDriveAvailable =
        isRunningSelfSustained &&
        !cutoffRef.current &&
        wearRef.current.sparkPlug > 10 &&
        params.fuelAirRatio >= 0.62 &&
        params.fuelAirRatio <= 1.45;
      const meanBrakeTorque = combustionDriveAvailable
        ? estimateBrakeTorque(curRpm, actualThrottle, params.fuelAirRatio, params.ignitionTiming, spec, wearRef.current, params.hasNitrous) * limiterTorqueScale
        : 0;
      const targetDriveTorque = meanBrakeTorque > 0 ? meanBrakeTorque + totalDecelFriction : 0;
      const torqueResponseTau = 0.16 + spec.rotatingInertia * 0.65;
      crankDriveTorqueRef.current = smoothMetric(crankDriveTorqueRef.current, targetDriveTorque, dt, {
        timeConstant: torqueResponseTau,
        maxDeltaPerSecond: spec.peakTorque * 18,
      });

      const pulseTrim = Math.max(-0.12, Math.min(0.12, pistonForceTorque / Math.max(1, spec.peakTorque * 12)));
      const externalLoadDrag = params.load;
      const rotationalDamping = rotationalDragTorque(curRpm);
      const netTorque = crankDriveTorqueRef.current * (1 + pulseTrim) + starterTorque - totalDecelFriction - externalLoadDrag - rotationalDamping;

      // 4. ANGULAR ROTATION ACCELERATION (spec-driven inertia)
      let angularVelocity = (curRpm * 2 * Math.PI) / 60;
      if (!isDead) {
        const acceleration = netTorque / spec.rotatingInertia;
        angularVelocity += acceleration * dt;
      } else {
        angularVelocity = 0;
      }
      if (angularVelocity < 0) angularVelocity = 0;

      let newRpm = (angularVelocity * 60) / (2 * Math.PI);

      // Self-sustained state transitions
      if (curState === EngineState.STARTING && newRpm > 420 && !isDead) {
        engineStateRef.current = EngineState.RUNNING;
        setEngineState(EngineState.RUNNING);
        addLog('success', '缸内点火连续自持！发动机正常运转运行。');
      }
      if (curState === EngineState.RUNNING && newRpm < 250 && !isDead) {
        engineStateRef.current = EngineState.STALLED;
        setEngineState(EngineState.STALLED);
        addLog('warning', '怠速转速偏低，发动机发生失速熄火。 (STALLED)');
      }
      if (curState === EngineState.STARTING && !isCranking && newRpm < 150 && !isDead) {
        engineStateRef.current = EngineState.OFF;
        setEngineState(EngineState.OFF);
        addLog('warning', '释放起动电机，拖动终止，未能成功点火启动。');
      }

      // 5. TEMPERATURE INTEGRATION (coolant + oil, spec thermal mass + coolant pump)
      const combustionHeatRate =
        (triggeredIgnitedState ? 5 : 0) * (curRpm / 1100) * (0.3 + 0.7 * actualThrottle) * (params.hasNitrous ? 2.5 : 1.0);
      const scoringFrictionHeatRate = (curRpm / 600) * Math.max(0, 35 - params.oilLevel) * 0.15;
      const radiatorCooling =
        (tempRef.current - 25) * 0.05 * (1.0 + (curRpm / 1000) * 0.55) * (0.45 + 0.9 * params.coolantPump);
      const netTempChange = ((combustionHeatRate + scoringFrictionHeatRate - radiatorCooling) / spec.thermalMass) * dt;
      tempRef.current = Math.max(25, tempRef.current + netTempChange);

      // Oil temp lags coolant temp and rises with rpm
      const oilTarget = tempRef.current + 8 + curRpm * 0.002;
      oilTempRef.current += (oilTarget - oilTempRef.current) * Math.min(1, dt * 0.4);

      if (tempRef.current > 125 && Math.random() < 0.02) {
        addLog('critical', '警告：水温过高！金属热膨胀，拉缸损坏加剧！请增大冷却泵或减小油门。');
      }
      if (oilPressureRef.current < 0.6 && curRpm > 1500 && Math.random() < 0.015) {
        addLog('error', '机油压力过低！轴瓦润滑不足，磨损急剧上升。请补充机油或降低转速。');
      }

      // 6. COMPONENT WEAR DEGRADATION
      if (!isDead && curRpm > 100) {
        const oilWearMultiplier = params.oilLevel < 35 ? 1 + Math.pow(35 - params.oilLevel, 1.6) * 0.4 : 1;
        // Low oil pressure dramatically accelerates bearing/journal wear
        const pressureWearMultiplier = oilPressureRef.current < 1.0 ? 1 + (1.0 - oilPressureRef.current) * 6 : 1;
        const knockWearMultiplier = 1.0 + chamber.knockSeverity * 35.0;
        const overRev = newRpm > spec.redlineRpm;

        const pistonRingWearDt = dt * 0.018 * oilWearMultiplier * knockWearMultiplier * (tempRef.current > 110 ? 25 : 1);
        const wallWearDt = dt * 0.016 * oilWearMultiplier * (tempRef.current > 115 ? 40 : 1);
        const bearingsWearDt =
          dt * 0.02 * oilWearMultiplier * pressureWearMultiplier * knockWearMultiplier * (overRev ? 12 : 1) * (params.hasNitrous ? 5 : 1);
        const crankshaftWearDt = dt * 0.012 * oilWearMultiplier * pressureWearMultiplier * (overRev ? 8 : 1);
        const sparkPlugWearDt = dt * 0.01 * (triggeredIgnitedState ? 1.5 : 0.2);
        const valvesWearDt = dt * 0.009 * (tempRef.current > 110 ? 5 : 1);

        const prevWear = wearRef.current;
        const nextWear: ComponentWear = {
          pistonRings: Math.max(0, prevWear.pistonRings - pistonRingWearDt),
          cylinderWall: Math.max(0, prevWear.cylinderWall - wallWearDt),
          conrodBearings: Math.max(0, prevWear.conrodBearings - bearingsWearDt),
          crankshaftJournal: Math.max(0, prevWear.crankshaftJournal - crankshaftWearDt),
          sparkPlug: Math.max(0, prevWear.sparkPlug - sparkPlugWearDt),
          valves: Math.max(0, prevWear.valves - valvesWearDt),
        };
        wearRef.current = nextWear;

        // Accumulate runtime "mileage" while actually running
        if (curState === EngineState.RUNNING) {
          garageRef.current = { ...garageRef.current, runtimeHours: garageRef.current.runtimeHours + dt / 3600 };
        }

        if (nextWear.pistonRings === 0 && prevWear.pistonRings > 0) {
          addLog('critical', '活塞环熔断！气缸失去气密压缩，发动机永久熄火。');
          engineStateRef.current = EngineState.STALLED;
          setEngineState(EngineState.STALLED);
          rpmRef.current = 0;
        }
        if (nextWear.conrodBearings === 0 && prevWear.conrodBearings > 0) {
          triggerEngineFailure(EngineState.EXPLODED, '活塞连杆轴瓦烧毁，连杆断裂，飞出击穿气缸缸体！发动机彻底报废！');
        }
        if (nextWear.cylinderWall === 0 && prevWear.cylinderWall > 0) {
          triggerEngineFailure(EngineState.SEIZED, '由于干摩擦与高温，活塞与汽缸完全融结抱死，发动机抱死阻断转动。');
        }
      }

      // 7. CRITICAL STRESS THRESHOLDS (spec-driven destruct rpm)
      if (newRpm > spec.destructRpm && !isDead) {
        triggerEngineFailure(EngineState.EXPLODED, `转速超越物理极限 ${spec.destructRpm} RPM！高机械惯性拉断连杆，机械碎裂爆炸！`);
      }
      if (tempRef.current > 145 && !isDead) {
        triggerEngineFailure(EngineState.SEIZED, '极其严重之高温过热！金属烧熔卡死，曲轴抱死 (SEIZED)。');
      }
      if (params.hasNitrous && tempRef.current > 120 && Math.random() < 0.06 && !isDead) {
        triggerEngineFailure(EngineState.EXPLODED, '在高温过热状态下不当施加笑气 (NOS)，混合气剧烈回火引发缸体瞬时爆震！');
      }

      // Save physics ref updates
      rpmRef.current = newRpm;
      angleRef.current = (angle + angularVelocity * dt) % (4 * Math.PI);

      // Representative steady-state brake torque at the current operating point
      // (stable, and consistent with the dyno estimator).
      torqueAvg += (Math.max(0, meanBrakeTorque) - torqueAvg) * Math.min(1, dt * 5);

      // Audio synthesis
      const activeRunningSound = engineStateRef.current === EngineState.RUNNING;
      engineAudio.update(
        newRpm,
        actualThrottle,
        isCranking,
        activeRunningSound,
        100 - wearRef.current.conrodBearings,
        tempRef.current,
        params.coolantPump
      );

      // Live challenge tracking
      updateChallenge(dt, newRpm, wearRef.current, engineStateRef.current);

      // Throttled React state telemetry updates
      throttledUpdateTimer += dt;
      pressurePeakRef.current = Math.max(1.0, pressurePeakRef.current * Math.exp(-dt / 0.95), chamber.pressure);

      if (throttledUpdateTimer > 0.095) {
        setStroke(strokeType);

        // Stable brake torque / power readout from the smoothed steady-state estimate.
        const sampleDt = throttledUpdateTimer;
        const veNow = volumetricEfficiency(newRpm, spec);
        const displayTorque = Math.max(0, torqueAvg);
        const hp = torqueToPowerHp(displayTorque, newRpm);
        const engineLiters = displacementCc(spec) / 1000;
        const mlFlow = newRpm > 50 && isRunningSelfSustained
          ? (newRpm / 1000) * (0.08 + actualThrottle) * veNow * engineLiters * 0.72 * (params.hasNitrous ? 2.5 : 1.0)
          : 0;
        const optTiming = 10 + newRpm / 280;
        const timingQuality = Math.max(0.05, Math.exp(-Math.pow((params.ignitionTiming - optTiming) / 15, 2)));
        const lambdaQuality = Math.max(0, 1.0 - Math.pow(params.fuelAirRatio - 0.92, 2) * 2.2);
        const combustionQuality = isRunningSelfSustained && newRpm > 80
          ? Math.round(Math.max(0, Math.min(100, 100 * lambdaQuality * timingQuality * (0.75 + 0.25 * veNow) * (wearRef.current.sparkPlug / 100) * limiterTorqueScale)))
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

        const previousStats = displayStatsRef.current;

        const statPoint: TelemetryPoint = {
          timeIndex: scrollIndexRef.current++,
          rpm: smoothMetric(previousStats.rpm, newRpm, sampleDt, {
            timeConstant: 0.24,
            maxDeltaPerSecond: spec.redlineRpm * 0.65,
            deadband: 2,
          }),
          temp: smoothMetric(previousStats.temp, tempRef.current, sampleDt, { timeConstant: 0.9 }),
          torque: smoothMetric(previousStats.torque, displayTorque, sampleDt, {
            timeConstant: 0.34,
            maxDeltaPerSecond: spec.peakTorque * 3.5,
            deadband: 0.05,
          }),
          power: smoothMetric(previousStats.power, hp, sampleDt, {
            timeConstant: 0.38,
            maxDeltaPerSecond: Math.max(12, spec.peakTorque * 1.5),
            deadband: 0.05,
          }),
          pressure: smoothMetric(previousStats.pressure, pressurePeakRef.current, sampleDt, {
            timeConstant: 0.28,
            maxDeltaPerSecond: 90,
          }),
          fuelFlow: smoothMetric(previousStats.fuelFlow, heldFuel.value, sampleDt, {
            timeConstant: 0.44,
            deadband: 0.0005,
          }),
          efficiency: Math.round(smoothMetric(previousStats.efficiency, heldEfficiency.value, sampleDt, {
            timeConstant: 0.48,
            maxDeltaPerSecond: 95,
            deadband: 0.4,
          })),
          oilPressure: smoothMetric(previousStats.oilPressure, oilPressureRef.current, sampleDt, {
            timeConstant: 0.24,
            maxDeltaPerSecond: 12,
            deadband: 0.02,
          }),
        };

        displayStatsRef.current = statPoint;
        setLiveStats(statPoint);
        historyRef.current = [...historyRef.current, statPoint].slice(-72);
        setHistory(historyRef.current);
        setWear(wearRef.current);
        setGarage(garageRef.current);

        throttledUpdateTimer = 0;
      }

      animId = requestAnimationFrame(loop);
    };

    animId = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(animId);
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Execute engine failure
  const triggerEngineFailure = (targetState: EngineState, reason: string) => {
    engineStateRef.current = targetState;
    setEngineState(targetState);
    rpmRef.current = 0;
    
    // Play structural crash boom
    if (targetState === EngineState.EXPLODED) {
      engineAudio.triggerExplosion();
      addLog('critical', `🚨 CATASTROPHIC BLAST: ${reason}`);
    } else {
      addLog('critical', `🚨 MECHANICAL SEIZE: ${reason}`);
    }
  };

  // Updatable controls handlers
  const handleUpdateParams = (newParams: Partial<EngineParameters>) => {
    setParams(prev => {
      const merged = { ...prev, ...newParams };
      return merged;
    });
  };

  // Cranking switch press
  const handleStartHold = (active: boolean) => {
    isCrankingRef.current = active;
    if (active) {
      if (engineState === EngineState.OFF || engineState === EngineState.STALLED) {
        cutoffRef.current = false;
        engineStateRef.current = EngineState.STARTING;
        setEngineState(EngineState.STARTING);
        addLog('info', '起动马达接合啮合齿：起动电机开始拖动机件运转。');
      }
    }
  };

  // Spark trigger
  const handleManualTriggerSpark = () => {
    if (engineState === EngineState.EXPLODED || engineState === EngineState.SEIZED) return;
    engineAudio.triggerSpark();
    addLog('info', '外部强制高压脉冲跳火。');
    
    // If cranking or stalled but warm, spark can fire cylinder
    if (rpmRef.current > 100 && params.throttle > 0.05) {
      const knocking = wear.conrodBearings < 30 || (params.ignitionTiming > 25 && params.fuelAirRatio > 1.25);
      engineAudio.triggerCombustion(rpmRef.current, params.throttle, knocking);
      if (engineState === EngineState.STALLED || engineState === EngineState.OFF) {
        engineStateRef.current = EngineState.RUNNING;
        setEngineState(EngineState.RUNNING);
        addLog('success', '点火连续！发动机正常运转运行。');
      }
    }
  };

  const handleCutoffToggle = () => {
    cutoffRef.current = !cutoffRef.current;
    if (engineState === EngineState.RUNNING) {
      engineStateRef.current = EngineState.STALLED;
      setEngineState(EngineState.STALLED);
      rpmRef.current = 0;
      addLog('warning', '切断点火系统，发动机熄火。 (IGNITION OFF)');
    }
  };

  // Repair systems
  const handleRepairComponent = (key: keyof ComponentWear) => {
    if (engineState === EngineState.EXPLODED) {
      addLog('error', '发动机缸体由于爆照碎裂损毁。无法进行局部修理，必须彻底大修。');
      return;
    }
    const repaired = { ...wearRef.current, [key]: 100 };
    wearRef.current = repaired;
    setWear(repaired);
    addLog('success', `大修部件完成：已修复及翻新组件：${key === 'pistonRings' ? '活塞压缩环' : key === 'cylinderWall' ? '气缸内壁' : key === 'conrodBearings' ? '大头轴瓦承载圈' : key === 'crankshaftJournal' ? '曲轴主轴颈' : key === 'sparkPlug' ? '火花塞跳火间隙电极' : '气门气密封套'}。`);
  };

  const REPAIR_COST = 60; // credits per component
  const REBUILD_COST = 320;

  // Repair a single component (costs credits)
  const handleRepairComponentPaid = (key: keyof ComponentWear) => {
    if (engineState === EngineState.EXPLODED) {
      addLog('error', '发动机缸体由于爆裂碎裂损毁。无法进行局部修理，必须彻底大修。');
      return;
    }
    if (wearRef.current[key] >= 99.5) {
      addLog('info', '该部件状态良好，无需维修。');
      return;
    }
    if (garageRef.current.credits < REPAIR_COST) {
      addLog('error', `信用点不足！局部维修需要 ${REPAIR_COST} CR，可通过完成挑战/拉力测试赚取。`);
      return;
    }
    garageRef.current = { ...garageRef.current, credits: garageRef.current.credits - REPAIR_COST };
    setGarage(garageRef.current);
    handleRepairComponent(key);
  };

  const resetEngineRefs = (coolantTemp: number) => {
    tempRef.current = coolantTemp;
    oilTempRef.current = coolantTemp - 5;
    oilPressureRef.current = 0;
    rpmRef.current = 0;
    angleRef.current = 0;
    actualThrottleRef.current = paramsRef.current.throttle;
    cutoffRef.current = false;
    sparkFiredRef.current = false;
    backfiredRef.current = false;
    isCrankingRef.current = false;
    lastTimeRef.current = 0;
    scrollIndexRef.current = 0;
    historyRef.current = [];
    displayStatsRef.current = createTelemetryPoint(coolantTemp);
    pressurePeakRef.current = 1.0;
    fuelZeroSecondsRef.current = 0;
    efficiencyZeroSecondsRef.current = 0;
    crankDriveTorqueRef.current = 0;
    setHistory([]);
    setLiveStats(createTelemetryPoint(coolantTemp));
  };

  const handleCompleteRebuild = () => {
    if (engineState !== EngineState.EXPLODED && engineState !== EngineState.SEIZED) {
      if (garageRef.current.credits < REBUILD_COST) {
        addLog('error', `信用点不足！完整大修需要 ${REBUILD_COST} CR。`);
        return;
      }
      garageRef.current = { ...garageRef.current, credits: garageRef.current.credits - REBUILD_COST };
      setGarage(garageRef.current);
    }
    wearRef.current = INITIAL_WEAR;
    setWear(INITIAL_WEAR);
    setParams(prev => ({ ...prev, oilLevel: 100 }));
    engineStateRef.current = EngineState.OFF;
    setEngineState(EngineState.OFF);
    resetEngineRefs(40);
    addLog('success', '🛠 核心重构与总装：发动机完全彻底修理完成！缸体已重装翻新，换装多项原厂全新高承载组件！');
  };

  const handleFlushOil = () => {
    setParams(prev => ({ ...prev, oilLevel: 100 }));
    addLog('success', '清洗并更换引擎机油完成。曲轴箱内注入高粘度高质全合成润滑脂。');
  };

  const handleResetParams = () => {
    setParams(INITIAL_PARAMS);
    addLog('info', '调节控制台所有性能及阻力参数已还原为出厂默认设置。');
  };

  // Manual gesture crank angular rotate
  const handleCrankDrag = (newAngle: number) => {
    angleRef.current = newAngle;
    if (engineState === EngineState.OFF || engineState === EngineState.STALLED) {
      rpmRef.current = 90; // mock hand crank speed
    }
  };

  // ----- Engine spec swap (full reset) -----
  const handleSwapSpec = (id: string) => {
    const next = getSpecById(id);
    if (next.id === specRef.current.id) return;
    setSpec(next);
    specRef.current = next;
    wearRef.current = INITIAL_WEAR;
    setWear(INITIAL_WEAR);
    engineStateRef.current = EngineState.OFF;
    setEngineState(EngineState.OFF);
    setParams(prev => ({ ...prev, throttle: 0.2, limiterRpm: Math.min(prev.limiterRpm, next.redlineRpm), oilLevel: 100 }));
    resetEngineRefs(40);
    addLog('info', `已换装发动机平台：${next.name}（排量 ${(Math.PI * (next.bore / 2) ** 2 * next.stroke / 1000).toFixed(0)}cc，红线 ${next.redlineRpm}）。`);
  };

  // ----- Tune presets -----
  const handleSavePreset = () => {
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
    setPresets(prev => [...prev, preset].slice(-6));
    addLog('success', `已保存 ECU 调校预设：${name}`);
  };

  const handleApplyPreset = (p: TunePreset) => {
    setParams(prev => ({ ...prev, ...p.params }));
    addLog('info', `已载入 ECU 调校预设：${p.name}`);
  };

  // ----- Dyno pull (steady-state sweep across the rev range) -----
  const handleRunDyno = () => {
    if (dynoRunning) return;
    if (engineState === EngineState.EXPLODED || engineState === EngineState.SEIZED) {
      addLog('error', '发动机已损毁，无法进行测功机拉力测试。请先大修。');
      return;
    }
    setDynoRunning(true);
    setDynoProgress(0);
    addLog('info', '测功机拉力测试启动：全油门扫描全转速域...');

    const s = specRef.current;
    const p = paramsRef.current;
    const w = wearRef.current;
    const startRpm = 1500;
    const endRpm = s.redlineRpm;
    const steps = 40;
    const curve: DynoCurvePoint[] = [];
    let i = 0;

    const tick = () => {
      const rpm = startRpm + ((endRpm - startRpm) * i) / steps;
      const tq = estimateBrakeTorque(rpm, 1.0, p.fuelAirRatio, p.ignitionTiming, s, w, false);
      const hp = torqueToPowerHp(tq, rpm);
      curve.push({ rpm, torque: tq, power: hp });
      i++;
      setDynoProgress(i / steps);
      if (i <= steps) {
        setTimeout(tick, 45);
      } else {
        // Finalize
        let peakPowerHp = 0, peakPowerRpm = 0, peakTorqueNm = 0, peakTorqueRpm = 0;
        curve.forEach((c) => {
          if (c.power > peakPowerHp) { peakPowerHp = c.power; peakPowerRpm = c.rpm; }
          if (c.torque > peakTorqueNm) { peakTorqueNm = c.torque; peakTorqueRpm = c.rpm; }
        });
        const result: DynoResult = {
          id: Math.random().toString(36).slice(2, 8),
          specName: s.name,
          curve,
          peakPowerHp,
          peakPowerRpm,
          peakTorqueNm,
          peakTorqueRpm,
          timestamp: Date.now(),
        };
        setDynoResult(result);
        setDynoRunning(false);
        setDynoProgress(1);

        // Reward: credits + score scaled to peak power
        const reward = Math.round(peakPowerHp * 4);
        const scoreGain = Math.round(peakPowerHp * 2);
        garageRef.current = {
          ...garageRef.current,
          credits: garageRef.current.credits + reward,
          score: garageRef.current.score + scoreGain,
        };
        setGarage(garageRef.current);
        addLog('success', `拉力测试完成！峰值 ${peakPowerHp.toFixed(1)}HP @ ${Math.round(peakPowerRpm)}rpm，扭矩 ${peakTorqueNm.toFixed(1)}Nm。奖励 +${reward}CR / +${scoreGain}分。`);

        // Resolve dyno challenge if active
        if (challengeRef.current.active === 'dyno' && challengeRef.current.status === 'running') {
          finishChallenge(peakPowerHp >= challengeRef.current.targetValue, peakPowerHp);
        }
      }
    };
    tick();
  };

  // ----- Challenge engine -----
  const startChallenge = (id: ChallengeId) => {
    if (engineState === EngineState.EXPLODED || engineState === EngineState.SEIZED) {
      addLog('error', '发动机已损毁，请先大修后再开始挑战。');
      return;
    }
    let label = '', target = 0, msg = '';
    if (id === 'idle') { label = '怠速稳定累计时间 (s)'; target = 10; msg = '保持 950~1250 RPM'; }
    else if (id === 'dyno') {
      label = '峰值马力 (HP)';
      target = Math.max(8, Math.round((dynoResult?.peakPowerHp ?? specRef.current.peakTorque * specRef.current.torquePeakRpm / 7127) * 1.05));
      msg = '调校后跑一次测功机';
    }
    else if (id === 'redline') { label = '冲线用时 (s, 越低越好)'; target = (specRef.current.redlineRpm - 200) / 1000; msg = '全油门冲向红线'; }
    else if (id === 'endurance') { label = '存活时间 (s)'; target = 60; msg = '保持运转、勿损坏部件'; }

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
    addLog('info', `挑战开始：${CHALLENGES.find(c => c.id === id)?.name}`);
  };

  const stopChallenge = () => {
    const next: ChallengeProgress = { ...challengeRef.current, active: null, status: 'idle', message: '' };
    challengeRef.current = next;
    setChallenge(next);
  };

  const finishChallenge = (passed: boolean, finalValue: number) => {
    const cur = challengeRef.current;
    if (!cur.active) return;
    const id = cur.active;
    // For redline, lower is better; track best as min. Others, higher is better.
    const lowerBetter = id === 'redline';
    const prevBest = cur.best[id];
    const better = lowerBetter ? (prevBest === 0 || finalValue < prevBest) : finalValue > prevBest;
    const newBest = { ...cur.best, [id]: better ? finalValue : prevBest };

    let reward = 0, scoreGain = 0;
    if (passed) {
      reward = id === 'endurance' ? 200 : id === 'redline' ? 150 : id === 'idle' ? 120 : 100;
      scoreGain = id === 'endurance' ? 120 : id === 'redline' ? Math.round(200 / Math.max(0.5, finalValue)) : 80;
      garageRef.current = {
        ...garageRef.current,
        credits: garageRef.current.credits + reward,
        score: garageRef.current.score + scoreGain,
      };
      setGarage(garageRef.current);
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
  };

  // Called every physics frame to track active challenge progress.
  const idleStableRef = useRef(0);
  const updateChallenge = (dt: number, rpm: number, w: ComponentWear, st: EngineState) => {
    const cur = challengeRef.current;
    if (!cur.active || cur.status !== 'running') return;
    const elapsed = (performance.now() - cur.startedAt) / 1000;

    const dead = st === EngineState.EXPLODED || st === EngineState.SEIZED;
    const anyBroken =
      w.pistonRings < 99 || w.cylinderWall < 99 || w.conrodBearings < 99 ||
      w.crankshaftJournal < 99 || w.sparkPlug < 99 || w.valves < 99;

    if (cur.active === 'idle') {
      if (rpm >= 950 && rpm <= 1250) idleStableRef.current += dt;
      else idleStableRef.current = Math.max(0, idleStableRef.current - dt * 1.5);
      const v = idleStableRef.current;
      challengeRef.current = { ...cur, metricValue: v, elapsed };
      if (v >= cur.targetValue) { finishChallenge(true, v); idleStableRef.current = 0; }
      else if (dead) finishChallenge(false, v);
    } else if (cur.active === 'redline') {
      const targetRpm = specRef.current.redlineRpm - 200;
      challengeRef.current = { ...cur, metricValue: elapsed, elapsed };
      if (rpm >= targetRpm) finishChallenge(true, elapsed);
      else if (dead || elapsed > 30) finishChallenge(false, elapsed);
    } else if (cur.active === 'endurance') {
      challengeRef.current = { ...cur, metricValue: Math.min(cur.targetValue, elapsed), elapsed };
      if (anyBroken || dead) finishChallenge(false, elapsed);
      else if (elapsed >= cur.targetValue) finishChallenge(true, elapsed);
    } else if (cur.active === 'dyno') {
      // resolved when dyno completes; just keep elapsed ticking
      challengeRef.current = { ...cur, elapsed };
    }
  };

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
              {spec.name} · 排量 {Math.round(Math.PI * (spec.bore / 2) ** 2 * spec.stroke / 1000)}cc · 红线 {spec.redlineRpm}
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
            <span className="text-amber-500 font-bold animate-pulse">
              ⚡ 起动 CRANKING...
            </span>
          )}
          {engineState === EngineState.STALLED && (
            <span className="text-slate-500">
              ● 熄火 STALLED
            </span>
          )}
          {engineState === EngineState.OFF && (
            <span className="text-gray-400">
              ● 停机 READY
            </span>
          )}
          {engineState === EngineState.SEIZED && (
            <span className="text-orange-500 font-bold flex items-center gap-1">
              <span className="w-2 h-2 rounded-full bg-orange-500"></span>
              抱死 SEIZED
            </span>
          )}
          {engineState === EngineState.EXPLODED && (
            <span className="text-pink-500 font-extrabold flex items-center gap-1 animate-ping">
              💥 爆炸 EXPLODED
            </span>
          )}
        </div>
      </header>

      {/* CORE WRAPPER GRID */}
      <div className="w-full max-w-7xl p-4 md:p-8 grid grid-cols-1 lg:grid-cols-12 gap-6 items-start">
        
        {/* Left Side canvas (5cols) */}
        <div className="lg:col-span-5 flex flex-col space-y-4">
          <EngineCanvas
            state={engineState}
            stroke={stroke}
            crankAngle={angleRef.current}
            throttle={params.throttle}
            oilLevel={params.oilLevel}
            temperature={liveStats.temp}
            oilPressure={liveStats.oilPressure}
            wear={wear}
            nosActive={params.hasNitrous}
            redlineRpm={spec.redlineRpm}
            rpm={liveStats.rpm}
            onCrankDrag={handleCrankDrag}
            onManualSpark={handleManualTriggerSpark}
          />

          {/* Challenge / garage gameplay panel */}
          <ChallengePanel
            challenges={CHALLENGES}
            progress={challenge}
            garage={garage}
            specs={ENGINE_SPECS}
            currentSpecId={spec.id}
            presets={presets}
            onStartChallenge={startChallenge}
            onStopChallenge={stopChallenge}
            onSwapSpec={handleSwapSpec}
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
          {/* Real-time telemetry dashboard gauges */}
          <TelemetryDashboard
            stats={liveStats}
            history={history}
            logs={logs}
            redlineRpm={spec.redlineRpm}
            onClearLogs={() => {
              logsRef.current = [];
              setLogs([]);
            }}
          />

          {/* Interactive controls console panel */}
          <ControlPanel
            state={engineState}
            params={params}
            volume={soundVolume}
            isMuted={soundMuted}
            redlineRpm={spec.redlineRpm}
            destructRpm={spec.destructRpm}
            onUpdateParams={handleUpdateParams}
            onStartHold={handleStartHold}
            onCutoffToggle={handleCutoffToggle}
            onSoundVolumeChange={(vol) => {
              setSoundVolume(vol);
            }}
            onSoundMuteToggle={() => {
              setSoundMuted(!soundMuted);
            }}
            onTriggerSpark={handleManualTriggerSpark}
            onResetParams={handleResetParams}
          />

          {/* Dyno power curve panel */}
          <DynoPanel
            result={dynoResult}
            isRunning={dynoRunning}
            progress={dynoProgress}
            canRun={engineState !== EngineState.EXPLODED && engineState !== EngineState.SEIZED}
            onRunDyno={handleRunDyno}
          />

          {/* Detailed component health diagnostics & wears */}
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
            onFlushOil={handleFlushOil}
          />
        </div>

      </div>

      {/* FOOTER */}
      <footer className="w-full border-t border-slate-900 bg-slate-950 py-6 text-center text-xs text-slate-500 font-mono mt-auto">
        <span>Engine Physics Sandbox v4.0 &bull; 拟真大修 + 玩法升级 &bull; Built with React & Tailwind</span>
      </footer>

    </main>
  );
}
