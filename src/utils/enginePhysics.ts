/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ComponentWear, EngineSpec } from '../types';

// ---------------------------------------------------------------------------
// Geometry constants (visual px scale kept for the canvas; physics uses mm/m)
// ---------------------------------------------------------------------------
export const CRANK_RADIUS = 36;       // r (px, drawing only)
export const CONROD_LENGTH = 105;     // l (px, drawing only)

// ---------------------------------------------------------------------------
// Selectable engine builds. Swapping a spec reconfigures the entire simulation.
// ---------------------------------------------------------------------------
export const ENGINE_SPECS: EngineSpec[] = [
  {
    id: 'stock',
    name: '原厂单缸 250cc (Stock Thumper)',
    bore: 72,
    stroke: 60,
    compressionRatio: 9.5,
    rotatingInertia: 0.14,
    redlineRpm: 6800,
    destructRpm: 8200,
    peakTorque: 24,
    torquePeakRpm: 4200,
    thermalMass: 1.0,
    description: '均衡耐用的街车心脏。怠速稳定、低扭充沛，红线 6800。',
  },
  {
    id: 'race',
    name: '高转赛用 450cc (Race High-Rev)',
    bore: 96,
    stroke: 62,
    compressionRatio: 12.8,
    rotatingInertia: 0.085,
    redlineRpm: 9500,
    destructRpm: 11000,
    peakTorque: 41,
    torquePeakRpm: 7200,
    thermalMass: 0.82,
    description: '轻量化飞轮+高压缩，转速攀升极快，但怠速暴躁、易爆震。',
  },
  {
    id: 'torque',
    name: '大排量低扭 650cc (Big-Bore Torque)',
    bore: 100,
    stroke: 83,
    compressionRatio: 10.5,
    rotatingInertia: 0.22,
    redlineRpm: 6200,
    destructRpm: 7400,
    peakTorque: 62,
    torquePeakRpm: 3600,
    thermalMass: 1.35,
    description: '沉重飞轮+长行程，低转扭矩巨大、极其耐造，但反应迟钝。',
  },
];

export function getSpecById(id: string): EngineSpec {
  return ENGINE_SPECS.find((s) => s.id === id) ?? ENGINE_SPECS[0];
}

/** Displacement of a single cylinder in cc from a spec. */
export function displacementCc(spec: EngineSpec): number {
  return (Math.PI * Math.pow(spec.bore / 2, 2) * spec.stroke) / 1000;
}

/** Piston crown area in m² from bore (mm). */
export function pistonAreaM2(spec: EngineSpec): number {
  return Math.PI * Math.pow(spec.bore / 2000, 2);
}

// ---------------------------------------------------------------------------
// Kinematics
// ---------------------------------------------------------------------------

/**
 * Piston displacement from TDC using exact crank-slider geometry (drawing px).
 * 0 at TDC (angle = 0/720), peak at BDC.
 */
export function getPistonDisplacement(angleRad: number): number {
  const theta = angleRad;
  const r = CRANK_RADIUS;
  const l = CONROD_LENGTH;
  const yMax = r + l;
  const yCurrent = r * Math.cos(theta) + Math.sqrt(Math.max(0.1, l * l - r * r * Math.sin(theta) * Math.sin(theta)));
  return yMax - yCurrent;
}

/**
 * Torque generated on the crankpin by gas pressure on the piston crown.
 * Uses the real reciprocating mechanism torque equation, scaled by the spec geometry.
 */
export function calculatePistonTorque(angleRad: number, cylinderPressureBar: number, spec: EngineSpec): number {
  const theta = angleRad % (2 * Math.PI);
  const r_m = spec.stroke / 2000;                 // crank radius in m (= stroke/2)
  const l_m = (spec.stroke / 2000) * 1.85;        // typical conrod ratio l/r ≈ 1.85
  const area = pistonAreaM2(spec);

  // gauge pressure acting on the piston (subtract atmospheric)
  const gaugePressure_pa = Math.max(0, cylinderPressureBar - 1.013) * 100000;
  const force_n = gaugePressure_pa * area;

  const sin_t = Math.sin(theta);
  const cos_t = Math.cos(theta);
  const numerator = r_m * sin_t * cos_t;
  const denominator = Math.sqrt(Math.max(1e-6, l_m * l_m - r_m * r_m * sin_t * sin_t));

  return force_n * r_m * (sin_t + numerator / denominator);
}

// ---------------------------------------------------------------------------
// Throttle butterfly inertia — commanded throttle doesn't snap instantly.
// ---------------------------------------------------------------------------
export function smoothThrottle(actual: number, commanded: number, dt: number): number {
  // First-order lag; ~90ms to settle. Snappier when closing (engine braking realism).
  const tau = commanded < actual ? 0.05 : 0.09;
  const alpha = 1 - Math.exp(-dt / tau);
  return actual + (commanded - actual) * alpha;
}

// ---------------------------------------------------------------------------
// Volumetric Efficiency (VE) curve — the heart of a realistic torque curve.
// Produces a 0..1.15 breathing-efficiency multiplier shaped like a real engine.
// ---------------------------------------------------------------------------
export function volumetricEfficiency(rpm: number, spec: EngineSpec): number {
  const peak = spec.torquePeakRpm;
  // Asymmetric bell: breathing falls off faster past peak (valve float / flow choke).
  const x = rpm / peak;
  let ve: number;
  if (x <= 1) {
    // rising side — strong low-end but dips slightly at very low rpm (poor scavenging)
    ve = 1.05 - 0.55 * Math.pow(1 - x, 2.0) - 0.18 * Math.pow(Math.max(0, 0.35 - x), 1.5) * 4;
  } else {
    // falling side past torque peak
    const over = x - 1;
    ve = 1.05 - 0.62 * Math.pow(over, 1.35);
  }
  return Math.max(0.12, Math.min(1.12, ve));
}

// ---------------------------------------------------------------------------
// Oil pressure model. Pump is crank-driven: pressure rises with RPM, but falls
// with low oil level, hot thin oil, and worn bearings (more clearance = leak-down).
// Returns bar.
// ---------------------------------------------------------------------------
export function oilPressureBar(rpm: number, oilLevel: number, oilTemp: number, wear: ComponentWear): number {
  if (rpm < 30) return 0;
  const pumpFlow = Math.min(1, rpm / 3000);                 // saturates ~3000rpm
  const supply = oilLevel / 100;                            // not enough oil = no pressure
  const hotThinning = Math.max(0.45, 1 - Math.max(0, oilTemp - 95) * 0.006); // hot oil = thinner
  const bearingClearance = 0.6 + 0.4 * (wear.conrodBearings / 100) * (wear.crankshaftJournal / 100);
  const raw = 5.2 * pumpFlow * supply * hotThinning * bearingClearance;
  return Math.max(0, Math.min(6.5, raw));
}

// ---------------------------------------------------------------------------
// Thermodynamic cylinder state for the current crank angle.
// ---------------------------------------------------------------------------
export function getChamberState(
  angleRad: number,
  throttle: number,
  lambda: number,
  isRunning: boolean,
  wear: ComponentWear,
  hasNitrous: boolean,
  ignitionTiming: number,
  rpm: number,
  spec: EngineSpec,
  cylinderTemp: number,
  choke: number
): { pressure: number; temp: number; ignited: boolean; efficiency: number; knockSeverity: number; misfire: boolean } {
  const thetaDeg = ((angleRad * 180) / Math.PI) % 720;
  const pistonHeightFactor = getPistonDisplacement(angleRad) / (2 * CRANK_RADIUS); // 0..1

  const baseCR = spec.compressionRatio;
  const ringSealing = 0.3 + 0.7 * (wear.pistonRings / 100) * (wear.cylinderWall / 100) * (wear.valves / 100);
  // instantaneous geometric volume ratio (TDC: baseCR, BDC: 1)
  const currentRatio = baseCR - (baseCR - 1) * pistonHeightFactor;

  // Breathing: throttle * VE shapes how much charge is actually trapped.
  const ve = volumetricEfficiency(rpm, spec);
  const charge = Math.max(0.04, throttle) * ve;

  let pressure = 1.0;
  let temp = 25.0;
  let ignited = false;
  let efficiency = 0;
  let knockSeverity = 0;
  let misfire = false;

  // 1. INTAKE STROKE (0 - 180°)
  if (thetaDeg >= 0 && thetaDeg < 180) {
    const manifoldVacuum = 0.72 * (1.0 - throttle);
    pressure = Math.max(0.28, 1.0 - manifoldVacuum);
    temp = 25.0 + 35.0 * throttle;
  }
  // 2. COMPRESSION STROKE (180 - 360°)
  else if (thetaDeg >= 180 && thetaDeg < 360) {
    const initialPressure = Math.max(0.28, 1.0 - 0.72 * (1.0 - throttle)) * (0.6 + 0.4 * ve);
    pressure = initialPressure * Math.pow(currentRatio, 1.3) * ringSealing;
    temp = 45.0 + 180.0 * Math.pow(currentRatio, 0.3) * ringSealing;
  }
  // 3. POWER STROKE (360 - 540°)
  else if (thetaDeg >= 360 && thetaDeg < 540) {
    const powerPart = thetaDeg - 360;

    // Cold-start enrichment (choke) widens the rich limit. Effective lambda seen by flame:
    const effLambda = lambda - choke * 0.18;

    const isWithinFlammability = effLambda >= 0.62 && effLambda <= 1.45;
    let misfireChance = 0;
    if (effLambda < 0.78) misfireChance = (0.78 - effLambda) / (0.78 - 0.62);
    else if (effLambda > 1.22) misfireChance = (effLambda - 1.22) / (1.45 - 1.22);

    const isMisfiredByFuel = Math.random() < misfireChance;
    const hasFuel = charge > 0.01 && isWithinFlammability && !isMisfiredByFuel;

    if (isRunning && hasFuel && wear.sparkPlug > 10) {
      ignited = true;

      // MBT timing scales with speed (more advance needed at high rpm).
      const optTiming = 10 + rpm / 280;
      const timingError = ignitionTiming - optTiming;
      const timingEfficiencyFactor = Math.max(0.15, Math.exp(-Math.pow(timingError / 15, 2)));
      const lambdaEfficiency = Math.max(0, 1.0 - Math.pow(effLambda - 0.92, 2) * 2.2);

      const baseEfficiency = 0.40 * lambdaEfficiency * timingEfficiencyFactor * (0.85 + 0.15 * ve);
      efficiency = Math.max(0.04, baseEfficiency);

      // --- Knock model (temperature & CR dependent) ---
      // Hotter cylinders and higher compression ratios are far more knock-prone.
      const thermalKnock = Math.max(0, (cylinderTemp - 95) / 70);   // grows once hot
      const crKnock = Math.max(0, (baseCR - 9.5) / 4);              // race CR knocks easier
      if (timingError > 4 || thermalKnock > 0.2 || crKnock > 0.2) {
        const advanceTerm = Math.max(0, (timingError - 4) / 15);
        knockSeverity = Math.min(
          1.0,
          (advanceTerm + thermalKnock * 0.5 + crKnock * 0.35) *
            (0.4 + throttle) *
            (1.25 - Math.min(0.4, Math.max(-0.2, effLambda - 0.9)))
        );
      }

      const knockPressureBonus = 1.0 + knockSeverity * 0.45;
      const energyMultiplier =
        charge * (hasNitrous ? 2.6 : 1.0) * timingEfficiencyFactor * (baseCR / 9.5) * 1.05;

      // Burn curve (mass fraction burned approximation)
      let combustionFactor: number;
      if (powerPart < 15) combustionFactor = powerPart / 15;
      else if (powerPart < 90) combustionFactor = 1.0 - (powerPart - 15) / 110;
      else combustionFactor = 0.3 - (powerPart - 90) / 300;
      combustionFactor = Math.max(0.05, combustionFactor);

      const theoreticalPeak = 78.0 * energyMultiplier * ringSealing * knockPressureBonus;
      pressure = theoreticalPeak * combustionFactor * Math.pow(currentRatio / baseCR, 1.15);

      const lateCombustionHeat = timingError < -4 ? Math.abs(timingError + 4) * 0.013 : 0;
      temp = 320.0 + 1380.0 * combustionFactor * energyMultiplier * (0.8 + 0.2 * ringSealing) * (1 + lateCombustionHeat);
    } else {
      misfire = isMisfiredByFuel || !isWithinFlammability;
      const initialPressure = Math.pow(baseCR, 1.3) * ringSealing;
      pressure = initialPressure * Math.pow(currentRatio / baseCR, 1.2);
      temp = 120.0;
    }
  }
  // 4. EXHAUST STROKE (540 - 720°)
  else {
    pressure = 1.02 + 0.25 * (1.0 - wear.valves / 100);
    temp = 380 * (0.4 + 0.6 * throttle);
  }

  return {
    pressure: Math.max(0.1, pressure),
    temp: Math.max(25, temp),
    ignited,
    efficiency: Math.round(efficiency * 100),
    knockSeverity: Math.max(0, knockSeverity),
    misfire,
  };
}

// ---------------------------------------------------------------------------
// Steady-state brake torque estimator (used by the dyno sweep, decoupled from
// the per-frame integrator). Returns Nm at a given operating point.
// ---------------------------------------------------------------------------
export function estimateBrakeTorque(
  rpm: number,
  throttle: number,
  lambda: number,
  ignitionTiming: number,
  spec: EngineSpec,
  wear: ComponentWear,
  hasNitrous: boolean
): number {
  const ve = volumetricEfficiency(rpm, spec);
  const ringSealing = 0.3 + 0.7 * (wear.pistonRings / 100) * (wear.cylinderWall / 100) * (wear.valves / 100);

  const optTiming = 10 + rpm / 280;
  const timingError = ignitionTiming - optTiming;
  const timingFactor = Math.max(0.15, Math.exp(-Math.pow(timingError / 15, 2)));
  const lambdaFactor = Math.max(0, 1.0 - Math.pow(lambda - 0.92, 2) * 2.2);

  // Indicated torque ~ peakTorque * VE * load factors.
  const indicated =
    spec.peakTorque *
    ve *
    throttle *
    ringSealing *
    timingFactor *
    Math.max(0.2, lambdaFactor) *
    (hasNitrous ? 1.5 : 1.0);

  // Friction/pumping losses rise with rpm (FMEP-ish).
  const fmep = 1.2 + Math.pow(rpm / 1000, 1.7) * 0.22;
  return Math.max(0, indicated - fmep);
}

export function torqueToPowerHp(torqueNm: number, rpm: number): number {
  // HP = T(Nm) * RPM / 7127
  return (torqueNm * rpm) / 7127;
}
