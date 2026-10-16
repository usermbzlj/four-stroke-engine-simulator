/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Framework-agnostic engine simulation core.
 *
 * Everything in this folder is pure TypeScript with no React/DOM dependency:
 *  - `constants.ts`   — centralised tuning constants
 *  - `parts.ts`       — blocks, parts catalogue, and build → spec resolution
 *  - `tune.ts`        — ECU ignition/lambda maps and ECU-tier gating
 *  - `physics.ts`     — thermodynamics, kinematics, VE, knock & torque models
 *  - `simulation.ts`  — the per-step integrator (`stepEngine`)
 *  - `dyno.ts`        — the dyno controller (live and headless) over `stepEngine`
 *  - `career.ts`      — contracts, stars, rewards, tier progression
 *  - `smoothing.ts`   — telemetry smoothing
 *  - `labels.ts` / `onboarding.ts` — display labels and tutorial steps
 *  - `persistence.ts` — localStorage save/load with v1 migration
 *
 * src/runtime (EngineRuntime) drives this core; the UI only consumes runtime snapshots.
 */

export * from './constants';
export * from './parts';
export * from './tune';
export * from './physics';
export * from './simulation';
export * from './dyno';
export * from './career';
export * from './persistence';
export * from './smoothing';
export * from './labels';
export * from './onboarding';
