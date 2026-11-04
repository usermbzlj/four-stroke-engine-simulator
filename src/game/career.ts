/**
 * The garage's books: money, reputation, what has been bought and unlocked.
 *
 * Work orders pay per star; prize runs on the strip pay per medal. Money
 * buys parts for the player's own bike (once bought, a part can be retuned
 * freely), other engines and other chassis. Reputation opens the advanced
 * parts and the faster machinery.
 */

import { create } from 'zustand';
import { createJSONStorage, persist } from 'zustand/middleware';
import { RACE_EVENTS, type RaceEventId, type RaceResult } from '../sim/race';
import type { ChassisId, VehiclePartId } from '../sim/vehicle';
import { PARTS, type PartId } from './parts';

export type Medal = 0 | 1 | 2 | 3;
export const MEDAL_TEXT = ['', '铜', '银', '金'] as const;

/** Bronze, silver, gold: seconds (or km/h for top speed). */
export const MEDALS: Record<ChassisId, Record<RaceEventId, [number, number, number]>> = {
  street: { drag100: [9.5, 7.2, 5.6], quarter: [17, 15.4, 14], hill: [40, 34, 29], top: [125, 145, 165], overtake: [8, 6, 4.6] },
  race: { drag100: [5.8, 4.9, 4.2], quarter: [14.6, 13.4, 12.5], hill: [31, 28, 25.5], top: [158, 175, 192], overtake: [4.6, 3.6, 2.9] },
  kart: { drag100: [7, 5.8, 4.8], quarter: [15.6, 14.3, 13.2], hill: [34, 30, 27], top: [130, 145, 160], overtake: [5.5, 4.3, 3.5] },
};

export const MEDAL_PRIZE = [0, 400, 900, 1800];
export const STAR_PAY = 600;
export const STAR_REP = 10;
export const MEDAL_REP = [0, 5, 10, 20];
export const START_MONEY = 6000;

/** Reputation a part needs before it is on sale. */
export const PART_REP: Partial<Record<PartId, number>> = { vvt: 60, turbo: 110, intercooler: 110, head: 30, crank: 40 };
export const VEHICLE_PART_REP: Partial<Record<VehiclePartId, number>> = { gearbox: 40, quickshifter: 30, geometry: 50, diet: 30 };

export interface Unlockable {
  rep: number;
  price: number;
}

export const CHASSIS_UNLOCK: Record<ChassisId, Unlockable> = {
  street: { rep: 0, price: 0 },
  kart: { rep: 35, price: 3000 },
  race: { rep: 70, price: 4500 },
};

export const ENGINE_UNLOCK: Record<string, Unlockable> = {
  'street-250': { rep: 0, price: 0 },
  'thumper-650': { rep: 25, price: 2600 },
  'race-450': { rep: 60, price: 4200 },
};

interface CareerState {
  money: number;
  rep: number;
  /** Engine parts paid for: free to retune afterwards. */
  ownedParts: PartId[];
  ownedVehicleParts: VehiclePartId[];
  ownedChassis: ChassisId[];
  ownedEngines: string[];
  /** Best medal per `${chassis}:${event}`. */
  medals: Record<string, Medal>;
  /** Stars already paid out per job. */
  paidStars: Record<string, number>;
  /** Short log of income and spending, newest first. */
  ledger: { at: number; text: string; amount: number }[];
  set: (patch: Partial<Omit<CareerState, 'set'>>) => void;
}

export const useCareer = create<CareerState>()(
  persist(
    (set) => ({
      money: START_MONEY,
      rep: 0,
      ownedParts: ['fuel'],
      ownedVehicleParts: [],
      ownedChassis: ['street'],
      ownedEngines: ['street-250'],
      medals: {},
      paidStars: {},
      ledger: [],
      set: (patch) => set(patch),
    }),
    {
      name: 'engine-bench:career',
      version: 1,
      storage: createJSONStorage(() => localStorage),
      partialize: (s) => ({
        money: s.money,
        rep: s.rep,
        ownedParts: s.ownedParts,
        ownedVehicleParts: s.ownedVehicleParts,
        ownedChassis: s.ownedChassis,
        ownedEngines: s.ownedEngines,
        medals: s.medals,
        paidStars: s.paidStars,
        ledger: s.ledger.slice(0, 30),
      }),
    },
  ),
);

function book(text: string, amount: number, rep = 0): void {
  const c = useCareer.getState();
  c.set({ money: c.money + amount, rep: c.rep + rep, ledger: [{ at: Date.now(), text, amount }, ...c.ledger].slice(0, 30) });
}

export function medalFor(chassis: ChassisId, r: RaceResult): Medal {
  if (r.dnf) return 0;
  const t = MEDALS[chassis][r.event];
  const top = RACE_EVENTS[r.event].measure === 'topSpeed';
  const v = top ? r.topKmh : (r.time ?? Infinity);
  let m: Medal = 0;
  t.forEach((x, i) => {
    if (top ? v >= x : v <= x) m = (i + 1) as Medal;
  });
  return m;
}

/** Pay out a run's medal if it beats the best one held; returns what was earned. */
export function awardRun(chassis: ChassisId, r: RaceResult): { medal: Medal; prize: number; rep: number } {
  const c = useCareer.getState();
  const key = `${chassis}:${r.event}`;
  const m = medalFor(chassis, r);
  const had = c.medals[key] ?? 0;
  if (m <= had) return { medal: m, prize: 0, rep: 0 };
  let prize = 0;
  let rep = 0;
  for (let k = had + 1; k <= m; k++) {
    prize += MEDAL_PRIZE[k]!;
    rep += MEDAL_REP[k]!;
  }
  useCareer.getState().set({ medals: { ...c.medals, [key]: m } });
  book(`${RACE_EVENTS[r.event].name}${MEDAL_TEXT[m]}牌`, prize, rep);
  return { medal: m, prize, rep };
}

/** Pay a job's new stars. */
export function awardStars(jobId: string, title: string, stars: number): number {
  const c = useCareer.getState();
  const had = c.paidStars[jobId] ?? 0;
  if (stars <= had) return 0;
  const n = stars - had;
  useCareer.getState().set({ paidStars: { ...c.paidStars, [jobId]: stars } });
  book(`工单「${title}」${n} 颗星`, n * STAR_PAY, n * STAR_REP);
  return n * STAR_PAY;
}

export function partOpen(id: PartId): boolean {
  return useCareer.getState().rep >= (PART_REP[id] ?? 0);
}

export function vehiclePartOpen(id: VehiclePartId): boolean {
  return useCareer.getState().rep >= (VEHICLE_PART_REP[id] ?? 0);
}

export function isChassisOpen(id: ChassisId): boolean {
  return useCareer.getState().ownedChassis.includes(id);
}

export function isEngineOpen(id: string): boolean {
  return useCareer.getState().ownedEngines.includes(id);
}

/** Engine parts on the bill: changed from factory and not yet paid for. */
export function unpaidParts(changed: PartId[]): PartId[] {
  const owned = useCareer.getState().ownedParts;
  return changed.filter((p) => !owned.includes(p));
}

export function unpaidVehicleParts(changed: VehiclePartId[]): VehiclePartId[] {
  const owned = useCareer.getState().ownedVehicleParts;
  return changed.filter((p) => !owned.includes(p));
}

export function billOf(parts: PartId[], vparts: VehiclePartId[], vehiclePrice: (id: VehiclePartId) => number): number {
  return parts.reduce((s, p) => s + (PARTS.find((x) => x.id === p)?.price ?? 0), 0) + vparts.reduce((s, p) => s + vehiclePrice(p), 0);
}

/** Pay for parts; false if the money is not there. */
export function buyParts(parts: PartId[], vparts: VehiclePartId[], total: number): boolean {
  const c = useCareer.getState();
  if (total > c.money) return false;
  c.set({
    ownedParts: [...new Set([...c.ownedParts, ...parts])],
    ownedVehicleParts: [...new Set([...c.ownedVehicleParts, ...vparts])],
  });
  book(`买零件（${parts.length + vparts.length} 件）`, -total);
  return true;
}

export function buyUnlock(kind: 'chassis' | 'engine', id: string, name: string): boolean {
  const c = useCareer.getState();
  const u = kind === 'chassis' ? CHASSIS_UNLOCK[id as ChassisId] : ENGINE_UNLOCK[id];
  if (!u || c.rep < u.rep || c.money < u.price) return false;
  if (kind === 'chassis') c.set({ ownedChassis: [...new Set([...c.ownedChassis, id as ChassisId])] });
  else c.set({ ownedEngines: [...new Set([...c.ownedEngines, id])] });
  book(`买下${name}`, -u.price);
  return true;
}

const LEVELS: [number, string][] = [
  [0, '街边修车铺'],
  [30, '小有名气'],
  [70, '赛道常客'],
  [120, '改装名店'],
  [200, '传奇车间'],
];

export function garageTitle(rep: number): { title: string; next: number | null } {
  let title = LEVELS[0]![1];
  let next: number | null = null;
  for (const [need, t] of LEVELS) {
    if (rep >= need) title = t;
    else {
      next = need;
      break;
    }
  }
  return { title, next };
}
