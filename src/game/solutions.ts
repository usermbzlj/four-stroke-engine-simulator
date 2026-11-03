/** Known-good builds for each job, used to prove every job can be solved. */
import type { EcuConfig, EngineConfig } from '../sim/config';

export const SOLUTIONS: Record<string, { config?: Partial<EngineConfig>; ecu?: Partial<EcuConfig> }> = {
  stall: { ecu: { idleRpm: 1400, cruiseLambda: 1 } },
  timid: { ecu: { advanceOffset: -7 } },
  courier: { config: { intakeDuration: 250, exhaustDuration: 252, intakeLift: 9, exhaustLift: 8.5, exhaustHeaderLength: 560, throttleDiameter: 34 } },
  tractor: {
    config: { intakeDuration: 221, exhaustDuration: 218, intakeLift: 12.5, lobeSeparation: 100, intakeCenterline: 99, intakeRunnerLength: 505, intakeRunnerDiameter: 31 },
  },
  octane: { config: { compressionRatio: 11.2 }, ecu: { advanceOffset: -6, knockControl: true } },
  flames: { ecu: { overrunFuelCut: false, wotLambda: 0.76 } },
  snappy: { config: { flywheelInertia: 0.012 }, ecu: { idleRpm: 1600 } },
  redline: { config: { valveSpringForce: 1100, reciprocatingMass: 0.24, intakeRunnerLength: 150, intakeRunnerDiameter: 44 } },
  durable: { config: { reciprocatingMass: 0.26 }, ecu: { limiterRpm: 11500 } },
  class250: {},
  king: {},
};
