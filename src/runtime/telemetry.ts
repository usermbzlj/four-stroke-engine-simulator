/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Telemetry shaping.
 *
 * The physics produces violent single-cylinder signals: pressure spikes once
 * per two revolutions, knock is a handful of discrete events. A gauge fed those
 * raw numbers is unreadable, so this turns step outputs into the smoothed,
 * peak-held values the dashboard shows.
 */

import { COMBUSTION } from '../engine/constants';
import { displacementCc } from '../engine/parts';
import { torqueToPowerHp, volumetricEfficiency } from '../engine/physics';
import { holdTransientZero, smoothMetric } from '../engine/smoothing';
import type { EngineSimState, StepDerived } from '../engine/simulation';
import type { EngineParameters, EngineSpec, TelemetryPoint } from '../types';

export const HISTORY_LENGTH = 72;

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
  knock: 0,
});

const clamp = (v: number, lo: number, hi: number): number => Math.max(lo, Math.min(hi, v));

export class TelemetryTracker {
  stats: TelemetryPoint = createTelemetryPoint();
  history: TelemetryPoint[] = [];

  private pressurePeak = 1.0;
  private knockPeak = 0;
  private torqueAvg = 0;
  private fuelZeroSeconds = 0;
  private efficiencyZeroSeconds = 0;
  private index = 0;

  reset(coolantTemp: number): void {
    this.stats = createTelemetryPoint(coolantTemp);
    this.history = [];
    this.pressurePeak = 1.0;
    this.knockPeak = 0;
    this.torqueAvg = 0;
    this.fuelZeroSeconds = 0;
    this.efficiencyZeroSeconds = 0;
    this.index = 0;
  }

  /** Feed every physics step so short-lived peaks are not missed between samples. */
  observe(dt: number, derived: StepDerived): void {
    this.pressurePeak = Math.max(1.0, this.pressurePeak * Math.exp(-dt / 0.95), derived.chamber.pressure);
    this.knockPeak = Math.max(this.knockPeak * Math.exp(-dt / 1.2), derived.chamber.knockSeverity);
    this.torqueAvg += (Math.max(0, derived.meanBrakeTorque) - this.torqueAvg) * Math.min(1, dt * 5);
  }

  /** Produce the next gauge reading and append it to the history strip. */
  sample(
    sampleDt: number,
    state: EngineSimState,
    derived: StepDerived,
    spec: EngineSpec,
    params: Pick<EngineParameters, 'hasNitrous'>
  ): TelemetryPoint {
    const rpm = state.rpm;
    const ve = volumetricEfficiency(rpm, spec);
    const torque = Math.max(0, this.torqueAvg);
    const power = torqueToPowerHp(torque, rpm);
    const liters = displacementCc(spec) / 1000;

    const fuelFlow =
      rpm > 50 && derived.selfSustained
        ? (rpm / 1000) *
          (0.08 + derived.effectiveThrottle) *
          ve *
          liters *
          0.72 *
          (1 + spec.boostBar) *
          (params.hasNitrous ? 2.5 : 1.0)
        : 0;

    const optTiming = COMBUSTION.optTimingBase + rpm / COMBUSTION.optTimingRpmSlope;
    const timingQuality = Math.max(0.05, Math.exp(-(((derived.tune.ignition - optTiming) / 15) ** 2)));
    const lambdaQuality = Math.max(0, 1.0 - (derived.tune.lambda - COMBUSTION.lambdaPower) ** 2 * 2.2);
    const combustionQuality =
      derived.selfSustained && rpm > 80
        ? Math.round(
            clamp(
              100 *
                lambdaQuality *
                timingQuality *
                (0.75 + 0.25 * ve) *
                (state.wear.sparkPlug / 100) *
                derived.limiterTorqueScale *
                (1 - derived.chamber.knockSeverity * 0.5),
              0,
              100
            )
          )
        : 0;

    const previous = this.stats;

    const fuel = holdTransientZero(previous.fuelFlow, fuelFlow, sampleDt, {
      zeroHoldSeconds: 0.3,
      zeroDecayTimeConstant: 0.75,
      elapsedZeroSeconds: this.fuelZeroSeconds,
    });
    this.fuelZeroSeconds = fuel.elapsedZeroSeconds;

    const efficiency = holdTransientZero(previous.efficiency, combustionQuality, sampleDt, {
      zeroHoldSeconds: 0.45,
      zeroDecayTimeConstant: 0.9,
      elapsedZeroSeconds: this.efficiencyZeroSeconds,
    });
    this.efficiencyZeroSeconds = efficiency.elapsedZeroSeconds;

    const point: TelemetryPoint = {
      timeIndex: this.index++,
      rpm: smoothMetric(previous.rpm, rpm, sampleDt, {
        timeConstant: 0.24,
        maxDeltaPerSecond: spec.redlineRpm * 0.65,
        deadband: 2,
      }),
      temp: smoothMetric(previous.temp, state.coolantTemp, sampleDt, { timeConstant: 0.9 }),
      torque: smoothMetric(previous.torque, torque, sampleDt, {
        timeConstant: 0.34,
        maxDeltaPerSecond: spec.peakTorque * 3.5,
        deadband: 0.05,
      }),
      power: smoothMetric(previous.power, power, sampleDt, {
        timeConstant: 0.38,
        maxDeltaPerSecond: Math.max(12, spec.peakTorque * 1.5),
        deadband: 0.05,
      }),
      pressure: smoothMetric(previous.pressure, this.pressurePeak, sampleDt, {
        timeConstant: 0.28,
        maxDeltaPerSecond: 90,
      }),
      fuelFlow: smoothMetric(previous.fuelFlow, fuel.value, sampleDt, { timeConstant: 0.44, deadband: 0.0005 }),
      efficiency: Math.round(
        smoothMetric(previous.efficiency, efficiency.value, sampleDt, {
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
      knock: Math.round(
        smoothMetric(previous.knock, this.knockPeak * 100, sampleDt, { timeConstant: 0.3, deadband: 0.5 })
      ),
    };

    this.stats = point;
    this.history = [...this.history, point].slice(-HISTORY_LENGTH);
    return point;
  }
}
