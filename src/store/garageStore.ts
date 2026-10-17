/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Career, economy and build ownership.
 *
 * Everything durable lives here — credits, tier, stars, the engine build, the
 * ECU map, saved presets. The store knows nothing about React or about the
 * live engine: side effects (log lines, re-fitting the engine) go through the
 * injected {@link GarageDeps}, and the composition root wires persistence and
 * the runtime to store changes.
 */

import { createStore, type StoreApi } from 'zustand/vanilla';
import {
  BLAST_DAMAGE_SLOTS,
  ECONOMY,
  IDLE_RUN,
  THERMAL,
  autoTune,
  beginContract,
  defaultProgress,
  dynoCreditReward,
  dynoScoreGain,
  getBlock,
  getContract,
  getPart,
  isDynoResolved,
  projectToEcu,
  resolveBuild,
  settleContract,
  stockPartFor,
  tickContract,
  type PersistedProgress,
} from '../engine';
import type { TickContext } from '../runtime/engineRuntime';
import {
  EngineState,
  type Contract,
  type ContractRun,
  type DynoResult,
  type EngineBuild,
  type EngineSpec,
  type LogLevel,
  type PartSlot,
  type TuneMap,
  type TunePreset,
} from '../types';

export interface GarageDeps {
  log: (level: LogLevel, message: string) => void;
  /** A slot (or the whole block) was re-fitted: stop and reset the engine. */
  onPartInstalled: (slot: PartSlot | 'block', blockChanged: boolean) => void;
  /** Perform the mechanical side of a rebuild. */
  onRebuild: () => void;
  /** Simulated clock in ms, used to time contracts. */
  now: () => number;
}

export interface GarageStoreState extends PersistedProgress {
  /** The contract currently in play (mirrored to the UI at a throttled rate). */
  contract: ContractRun;
}

export interface GarageActions {
  buyAndInstall: (partId: string) => void;
  installOwned: (slot: PartSlot, partId: string) => void;
  buyBlock: (blockId: string) => void;
  switchBlock: (blockId: string) => void;

  setTune: (next: TuneMap) => void;
  applyAutoTune: () => void;
  savePreset: () => void;
  applyPreset: (index: number) => void;
  deletePreset: (index: number) => void;

  startContract: (id: string) => void;
  abortContract: () => void;
  dismissContract: () => void;
  /** Per-frame career bookkeeping: engine hours and contract scoring. */
  tick: (ctx: TickContext) => void;
  resolveDyno: (result: DynoResult) => void;

  /** Pay for a single-component repair. Returns whether the player could afford it. */
  payForRepair: (health: number) => boolean;
  /** Pay for a full rebuild; performs it when affordable. */
  payForRebuild: (wrecked: boolean) => void;
  payForOilChange: () => boolean;

  handleCatastrophe: (state: EngineState) => void;
  completeOnboarding: () => void;
  resetCareer: () => void;
}

export type GarageStore = GarageStoreState & GarageActions;

export const repairCostFor = (health: number): number =>
  Math.max(12, Math.round(ECONOMY.repairCost * (1 - health / 100)));

export const rebuildCostFor = (wrecked: boolean): number =>
  ECONOMY.rebuildCost + (wrecked ? ECONOMY.blastSurcharge : 0);

/** Wall-clock-independent: engine hours are banked in whole simulated seconds. */
const HOURS_FLUSH = 1 / 3600;
/** The running contract is mirrored to the UI at most this often (sim ms). */
const CONTRACT_UI_INTERVAL_MS = 100;

const starString = (stars: number): string => '★'.repeat(stars) + '☆'.repeat(3 - stars);

export function createGarageStore(initial: PersistedProgress, deps: GarageDeps): StoreApi<GarageStore> {
  // Non-reactive bookkeeping: changes every frame, so it must not live in state.
  let live: ContractRun = IDLE_RUN;
  let accumulator = 0;
  let pendingHours = 0;
  let lastContractPushMs = 0;
  let specCache: { build: EngineBuild; spec: EngineSpec } | null = null;

  return createStore<GarageStore>()((set, get) => {
    const specOf = (build: EngineBuild): EngineSpec => {
      if (specCache?.build !== build) specCache = { build, spec: resolveBuild(build) };
      return specCache.spec;
    };

    const setContract = (run: ContractRun): void => {
      live = run;
      set({ contract: run });
    };

    const pay = (amount: number): void => {
      set((s) => ({ garage: { ...s.garage, credits: s.garage.credits - amount } }));
    };

    const canAfford = (cost: number, message: string): boolean => {
      if (get().garage.credits >= cost) return true;
      deps.log('error', message);
      return false;
    };

    const finishContract = (c: Contract, passed: boolean, value: number): void => {
      const outcome = settleContract(get().garage, c, passed, value);
      set({ garage: outcome.garage });

      const stars = starString(outcome.stars);
      setContract({
        ...live,
        status: passed ? 'passed' : 'failed',
        metricValue: value,
        message: passed ? `${stars}  +${outcome.reward} CR` : '未达成，再来一次',
        hint: '',
      });
      accumulator = 0;

      if (!passed) {
        deps.log('warning', `合约「${c.name}」未达成。`);
        return;
      }
      deps.log('success', `🏆 合约达成「${c.name}」${stars} 奖励 +${outcome.reward} CR / +${outcome.score} 分。`);
      if (outcome.promoted) {
        deps.log('success', `🔧 车间等级提升至 ${outcome.garage.tier}：商店已上架新一档零件。`);
      }
      for (const gift of outcome.gifts) {
        deps.log('success', `🎁 合约附赠零件：「${getPart(gift)?.name ?? gift}」已入库。`);
      }
    };

    const runningContract = (): Contract | undefined => {
      if (!live.id || live.status !== 'running') return undefined;
      return getContract(live.id);
    };

    return {
      ...initial,
      contract: IDLE_RUN,

      // ---- Shop ------------------------------------------------------------
      installOwned: (slot, partId) => {
        const part = getPart(partId);
        const { garage, build } = get();
        if (!part || part.slot !== slot) return;
        if (!garage.owned.includes(partId)) return;
        if (build.installed[slot] === partId) return;

        set({ build: { ...build, installed: { ...build.installed, [slot]: partId } } });
        // An ECU downgrade cannot keep a curve it is unable to represent.
        if (slot === 'ecu') {
          const tier = part.mods.ecuTier ?? 0;
          set((s) => ({ tune: projectToEcu(s.tune, tier) }));
        }
        deps.onPartInstalled(slot, false);
        deps.log('success', `已装上「${part.name}」。发动机已停机等待重新起动。`);
      },

      buyAndInstall: (partId) => {
        const part = getPart(partId);
        if (!part) return;
        const { garage } = get();

        if (garage.owned.includes(partId)) {
          get().installOwned(part.slot, partId);
          return;
        }
        if (part.tier > garage.tier) {
          deps.log('warning', `「${part.name}」需要车间等级 ${part.tier}，先去完成合约。`);
          return;
        }
        if (
          !canAfford(
            part.cost,
            `信用点不足：「${part.name}」需要 ${part.cost} CR，你只有 ${Math.floor(garage.credits)} CR。`
          )
        ) {
          return;
        }

        set({ garage: { ...garage, credits: garage.credits - part.cost, owned: [...garage.owned, partId] } });
        deps.log('success', `购入「${part.name}」，花费 ${part.cost} CR。`);
        get().installOwned(part.slot, partId);
      },

      switchBlock: (blockId) => {
        const { build, garage } = get();
        if (build.blockId === blockId || !garage.owned.includes(blockId)) return;
        const block = getBlock(blockId);

        // A different block is a different engine: anything that does not fit
        // goes back to stock.
        const installed: EngineBuild['installed'] = {};
        for (const slot of Object.keys(build.installed) as PartSlot[]) {
          const currentId = build.installed[slot];
          const part = currentId ? getPart(currentId) : undefined;
          const fits = part && (!part.blocks || part.blocks.includes(blockId)) && garage.owned.includes(part.id);
          installed[slot] = fits ? part.id : stockPartFor(slot).id;
        }

        const next: EngineBuild = { blockId, installed };
        set({ build: next, tune: autoTune(resolveBuild(next)) });
        deps.onPartInstalled('block', true);
        deps.log('info', `已换装缸体：${block.name}。ECU 已重新生成基础标定。`);
      },

      buyBlock: (blockId) => {
        const block = getBlock(blockId);
        const { garage } = get();

        if (garage.owned.includes(blockId)) {
          get().switchBlock(blockId);
          return;
        }
        if (block.tier > garage.tier) {
          deps.log('warning', `「${block.name}」需要车间等级 ${block.tier}。`);
          return;
        }
        if (!canAfford(block.cost, `信用点不足：「${block.name}」需要 ${block.cost} CR。`)) return;

        set({ garage: { ...garage, credits: garage.credits - block.cost, owned: [...garage.owned, blockId] } });
        deps.log('success', `购入缸体「${block.name}」，花费 ${block.cost} CR。`);
        get().switchBlock(blockId);
      },

      // ---- Tuning ----------------------------------------------------------
      setTune: (next) => set({ tune: next }),

      applyAutoTune: () => {
        set({ tune: autoTune(specOf(get().build)) });
        deps.log('info', '已写入安全基础标定：取 MBT 与爆震极限中较低者，再留 2° 余量。剩下的靠你自己找。');
      },

      savePreset: () => {
        const { build, tune, presets } = get();
        const name = `${getBlock(build.blockId).name.slice(0, 6)} · ${(tune.ignition[4] ?? 0).toFixed(0)}°/${(tune.lambda[6] ?? 1).toFixed(2)}λ`;
        set({ presets: [...presets, { name, tune } satisfies TunePreset].slice(-8) });
        deps.log('success', `已保存标定预设「${name}」。`);
      },

      applyPreset: (index) => {
        const { presets, build } = get();
        const preset = presets[index];
        if (!preset) return;
        set({ tune: projectToEcu(preset.tune, specOf(build).ecuTier) });
        deps.log('info', `已载入标定预设「${preset.name}」。`);
      },

      deletePreset: (index) => set((s) => ({ presets: s.presets.filter((_, i) => i !== index) })),

      // ---- Contracts -------------------------------------------------------
      startContract: (id) => {
        const c = getContract(id);
        if (!c) return;
        const { garage, build } = get();
        if (c.tier > garage.tier) {
          deps.log('warning', `合约「${c.name}」尚未解锁，需要车间等级 ${c.tier}。`);
          return;
        }
        accumulator = 0;
        lastContractPushMs = 0;
        setContract(beginContract(c, specOf(build), deps.now()));
        deps.log('info', `接下合约「${c.name}」：${c.how}`);
      },

      abortContract: () => {
        accumulator = 0;
        setContract(IDLE_RUN);
      },

      dismissContract: () => setContract(IDLE_RUN),

      tick: (ctx) => {
        pendingHours += ctx.runningHoursDelta;
        if (pendingHours >= HOURS_FLUSH) {
          const hours = pendingHours;
          pendingHours = 0;
          set((s) => ({ garage: { ...s.garage, runtimeHours: s.garage.runtimeHours + hours } }));
        }

        const c = runningContract();
        if (!c) return;

        const result = tickContract({
          run: live,
          contract: c,
          accumulator,
          dt: ctx.dt,
          rpm: ctx.rpm,
          wear: ctx.wear,
          engineState: ctx.engineState,
          spec: specOf(get().build),
          now: ctx.clockMs,
        });
        accumulator = result.accumulator;
        live = result.run;

        if (result.finished) {
          finishContract(c, result.finished.passed, result.finished.value);
        } else if (ctx.clockMs - lastContractPushMs >= CONTRACT_UI_INTERVAL_MS) {
          lastContractPushMs = ctx.clockMs;
          set({ contract: live });
        }
      },

      resolveDyno: (result) => {
        const reward = dynoCreditReward(result.peakPowerHp);
        const score = dynoScoreGain(result.peakPowerHp);
        set((s) => ({
          garage: { ...s.garage, credits: s.garage.credits + reward, score: s.garage.score + score },
        }));

        if (result.aborted) {
          deps.log(
            'warning',
            `拉力测试中止：${result.aborted}。仍按已测得的 ${result.peakPowerHp.toFixed(1)}HP 结算 +${reward} CR。`
          );
        } else {
          deps.log(
            'success',
            `拉力测试完成：${result.peakPowerHp.toFixed(1)}HP @ ${Math.round(result.peakPowerRpm)}rpm，` +
              `${result.peakTorqueNm.toFixed(1)}Nm @ ${Math.round(result.peakTorqueRpm)}rpm。` +
              `最高水温 ${result.maxTemp.toFixed(0)}°C，峰值爆震 ${(result.maxKnock * 100).toFixed(0)}%。奖励 +${reward} CR。`
          );
        }
        if (result.maxKnock > 0.15) {
          deps.log('warning', '本次拉力检出明显爆震：去「ECU 标定」页把对应转速段的点火角压到爆震极限线以下。');
        }

        const c = runningContract();
        if (c?.kind === 'dyno') {
          const cleanEnough = c.knockLimit === undefined || result.maxKnock <= c.knockLimit;
          if (!cleanEnough) {
            deps.log(
              'warning',
              `马力达标但爆震读数 ${(result.maxKnock * 100).toFixed(0)}% 超出合约要求 —— 本次不算通过。`
            );
          }
          finishContract(c, result.peakPowerHp >= c.target && cleanEnough, result.peakPowerHp);
        } else if (c?.kind === 'thermal') {
          // A cold engine never reaches operating temperature in one pull, so it
          // would pass without proving anything about the cooling. Keep the run open.
          if (result.startTemp < THERMAL.thermostatTemp) {
            deps.log(
              'warning',
              `散热考核需要热车上台：本次起拉水温 ${result.startTemp.toFixed(0)}°C，低于 ${THERMAL.thermostatTemp}°C，不计成绩。暖机后再拉一次。`
            );
            return;
          }
          // A pull that overheated into an abort obviously does not pass.
          finishContract(c, !result.aborted && result.maxTemp <= c.target, result.maxTemp);
        }
      },

      // ---- Money out -------------------------------------------------------
      payForRepair: (health) => {
        const cost = repairCostFor(health);
        if (!canAfford(cost, `信用点不足：该项维修需要 ${cost} CR。跑一次拉力测试就能赚回来。`)) return false;
        pay(cost);
        return true;
      },

      payForRebuild: (wrecked) => {
        const cost = rebuildCostFor(wrecked);
        if (!canAfford(cost, `信用点不足：整机大修需要 ${cost} CR。`)) return;
        pay(cost);
        deps.onRebuild();
      },

      payForOilChange: () => {
        if (!canAfford(ECONOMY.oilChangeCost, `信用点不足：换机油需要 ${ECONOMY.oilChangeCost} CR。`)) return false;
        pay(ECONOMY.oilChangeCost);
        return true;
      },

      /**
       * Blowing an engine up costs you hardware, not just time. That is what
       * makes the destruct RPM something you actually respect.
       */
      handleCatastrophe: (state) => {
        const slots: PartSlot[] = state === EngineState.EXPLODED ? BLAST_DAMAGE_SLOTS : ['piston'];
        const { build, garage } = get();

        const installed = { ...build.installed };
        const destroyed: string[] = [];
        for (const slot of slots) {
          const id = installed[slot];
          const part = id ? getPart(id) : undefined;
          if (part && part.cost > 0) {
            destroyed.push(part.id);
            installed[slot] = stockPartFor(slot).id;
          }
        }

        if (destroyed.length > 0) {
          set({
            build: { ...build, installed },
            garage: { ...garage, owned: garage.owned.filter((id) => !destroyed.includes(id)) },
          });
          const names = destroyed.map((id) => getPart(id)?.name ?? id).join('、');
          deps.log('critical', `💀 报废清单：${names} 已随缸体一起损毁，需要重新购买。`);
        } else {
          deps.log('warning', '所幸损毁的都是原厂件，无额外零件损失。');
        }

        const c = runningContract();
        if (c && !isDynoResolved(c.kind)) finishContract(c, false, live.metricValue);
      },

      completeOnboarding: () => set({ onboarded: true }),

      resetCareer: () => {
        const fresh = defaultProgress();
        accumulator = 0;
        pendingHours = 0;
        setContract(IDLE_RUN);
        set({ ...fresh });
        deps.onPartInstalled('block', true);
        deps.log('info', '生涯已重置：回到一台全原厂 250，从头再来。');
      },
    };
  });
}