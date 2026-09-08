/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Framework-agnostic engine simulation core.
 *
 * Everything in this folder is pure TypeScript with no React/DOM dependency:
 *  - `physics.ts`      — thermodynamics, kinematics, torque & VE models
 *  - `simulation.ts`   — the per-step integrator (`stepEngine`) + state shape
 *  - `gameplay.ts`     — challenges, dyno sweep, reward math
 *  - `persistence.ts`  — localStorage progress save/load
 *  - `constants.ts`    — centralised tuning constants
 *
 * The React layer (`src/hooks`, `src/components`, `App.tsx`) consumes this core.
 */

export * from './constants';
export * from './physics';
export * from './simulation';
export * from './gameplay';
export * from './persistence';
