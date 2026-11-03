/** Known-good builds for each job, used to prove every job can be solved. */
import type { EcuConfig, EngineConfig } from '../sim/config';

export const SOLUTIONS: Record<string, { config?: Partial<EngineConfig>; ecu?: Partial<EcuConfig> }> = {
  stall: { ecu: { idleRpm: 1400, cruiseLambda: 1 } },
  timid: { ecu: { advanceOffset: -7 } },
  courier: { config: { intakeDuration: 269, exhaustDuration: 268, intakeLift: 12.5, exhaustLift: 12, lobeSeparation: 103.0, intakeCenterline: 103.5, exhaustHeaderLength: 1126, exhaustHeaderDiameter: 36 }, ecu: { advanceOffset: -5, wotLambda: 0.95 } },
  tractor: {
    config: { intakeDuration: 221, exhaustDuration: 218, intakeLift: 12.5, lobeSeparation: 100, intakeCenterline: 99, intakeRunnerLength: 505, intakeRunnerDiameter: 31 },
  },
  octane: { config: { compressionRatio: 11.2 }, ecu: { advanceOffset: -6, knockControl: true } },
  flames: { ecu: { overrunFuelCut: false, wotLambda: 0.76 } },
  snappy: { config: { flywheelInertia: 0.012 }, ecu: { idleRpm: 1600 } },
  redline: { config: { valveSpringForce: 1100, reciprocatingMass: 0.24, intakeRunnerLength: 150, intakeRunnerDiameter: 44 } },
  durable: { config: { reciprocatingMass: 0.26 }, ecu: { limiterRpm: 11500 } },
  class250: { config: { compressionRatio: 14.5, intakeValveDiameter: 36.5, exhaustValveDiameter: 31, intakeDuration: 257, exhaustDuration: 268, intakeLift: 12.5, exhaustLift: 12, lobeSeparation: 100, intakeCenterline: 100.5, valveSpringForce: 695, throttleDiameter: 50, intakeRunnerLength: 249, intakeRunnerDiameter: 41, fuelOctane: 97 }, ecu: { advanceOffset: -7.5, limiterRpm: 9675 } },
  king: { config: { bore: 105, compressionRatio: 14.4, intakeValveDiameter: 44, exhaustValveDiameter: 38, intakeDuration: 269, exhaustDuration: 256, intakeLift: 12.5, exhaustLift: 12, lobeSeparation: 103, intakeCenterline: 103.0, throttleDiameter: 50, intakeRunnerLength: 239, intakeRunnerDiameter: 46, exhaustHeaderLength: 1200, exhaustHeaderDiameter: 48, fuelOctane: 98 }, ecu: { advanceOffset: -9.0, limiterRpm: 7038 } },
};
