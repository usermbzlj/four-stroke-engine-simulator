/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * The garage: buy parts, see exactly what they do to the engine before you
 * commit, and get told when a build is going to cook itself.
 *
 * Every option shows the real delta it would make, computed by resolving the
 * candidate build through the same `resolveBuild` the physics uses — so the shop
 * copy can never drift away from the simulation.
 */

import { useMemo, useState } from 'react';
import type { EngineBuild, EngineSpec, GarageState, Part, PartSlot } from '../types';
import {
  ENGINE_BLOCKS,
  KNOCK,
  PART_SLOTS,
  SLOT_LABELS,
  THERMAL,
  buildValue,
  displacementCc,
  equilibriumCoolantTemp,
  getPart,
  partsInSlot,
  resolveBuild,
} from '../engine';
import { Check, ChevronDown, ChevronRight, Coins, Lock, TriangleAlert, Wrench } from 'lucide-react';

interface GarageShopProps {
  garage: GarageState;
  build: EngineBuild;
  spec: EngineSpec;
  onBuyPart: (partId: string) => void;
  onBuyBlock: (blockId: string) => void;
}

/** Human-readable differences a candidate part would make to the resolved spec. */
function describeDelta(current: EngineSpec, next: EngineSpec): { text: string; good: boolean }[] {
  const out: { text: string; good: boolean }[] = [];
  const pct = (a: number, b: number) => ((b - a) / a) * 100;

  const torqueDelta = pct(current.peakTorque, next.peakTorque);
  if (Math.abs(torqueDelta) > 0.5) {
    out.push({ text: `峰值扭矩 ${torqueDelta > 0 ? '+' : ''}${torqueDelta.toFixed(1)}%`, good: torqueDelta > 0 });
  }

  if (Math.abs(next.torquePeakRpm - current.torquePeakRpm) > 50) {
    const d = next.torquePeakRpm - current.torquePeakRpm;
    out.push({ text: `扭矩峰 ${d > 0 ? '+' : ''}${d} rpm`, good: true });
  }

  if (Math.abs(next.redlineRpm - current.redlineRpm) > 20) {
    const d = next.redlineRpm - current.redlineRpm;
    out.push({ text: `红线 ${d > 0 ? '+' : ''}${d}`, good: d > 0 });
  }

  if (Math.abs(next.destructRpm - current.destructRpm) > 20) {
    const d = next.destructRpm - current.destructRpm;
    out.push({ text: `崩溃转速 ${d > 0 ? '+' : ''}${d}`, good: d > 0 });
  }

  const inertiaDelta = pct(current.rotatingInertia, next.rotatingInertia);
  if (Math.abs(inertiaDelta) > 1) {
    out.push({ text: `转动惯量 ${inertiaDelta > 0 ? '+' : ''}${inertiaDelta.toFixed(0)}%`, good: inertiaDelta < 0 });
  }

  if (Math.abs(next.compressionRatio - current.compressionRatio) > 0.05) {
    out.push({ text: `压缩比 ${current.compressionRatio} → ${next.compressionRatio}`, good: next.compressionRatio > current.compressionRatio });
  }

  const coolingDelta = pct(current.coolingFactor, next.coolingFactor);
  if (Math.abs(coolingDelta) > 1) {
    out.push({ text: `散热 ${coolingDelta > 0 ? '+' : ''}${coolingDelta.toFixed(0)}%`, good: coolingDelta > 0 });
  }

  // Knock margin is the currency the whole tuning game is played in, so show it
  // in the unit the player edits: degrees of ignition advance.
  // Same terms as `knockLimitAdvance`, including that compression below the
  // reference buys nothing back.
  const knockDelta = (next.knockResistance - current.knockResistance) * KNOCK.resistanceBonusDeg;
  const crKnockDelta =
    Math.max(0, current.compressionRatio - KNOCK.referenceCr) * KNOCK.crPenaltyPerPoint -
    Math.max(0, next.compressionRatio - KNOCK.referenceCr) * KNOCK.crPenaltyPerPoint;
  const boostKnockDelta = -(next.boostBar - current.boostBar) * KNOCK.boostPenaltyPerBar;
  const totalKnock = knockDelta + crKnockDelta + boostKnockDelta;
  if (Math.abs(totalKnock) > 0.3) {
    out.push({ text: `爆震余量 ${totalKnock > 0 ? '+' : ''}${totalKnock.toFixed(1)}°`, good: totalKnock > 0 });
  }

  if (Math.abs(next.boostBar - current.boostBar) > 0.01) {
    out.push({ text: `增压 ${next.boostBar.toFixed(2)} bar`, good: next.boostBar > current.boostBar });
  }

  if (next.ecuTier !== current.ecuTier) {
    out.push({ text: `ECU 标定点 ${next.ecuTier === 0 ? 1 : next.ecuTier === 1 ? 3 : 7} 段`, good: next.ecuTier > current.ecuTier });
  }

  const lowVe = pct(current.veLowMult, next.veLowMult);
  if (Math.abs(lowVe) > 1) out.push({ text: `低转进气 ${lowVe > 0 ? '+' : ''}${lowVe.toFixed(0)}%`, good: lowVe > 0 });
  const highVe = pct(current.veHighMult, next.veHighMult);
  if (Math.abs(highVe) > 1) out.push({ text: `高转进气 ${highVe > 0 ? '+' : ''}${highVe.toFixed(0)}%`, good: highVe > 0 });

  const oilDelta = pct(current.oilCapacity, next.oilCapacity);
  if (Math.abs(oilDelta) > 1) out.push({ text: `机油容量 ${oilDelta > 0 ? '+' : ''}${oilDelta.toFixed(0)}%`, good: oilDelta > 0 });

  if (Math.abs(next.sparkEnergy - current.sparkEnergy) > 0.01) {
    const d = next.sparkEnergy - current.sparkEnergy;
    out.push({ text: `点火能量 ${d > 0 ? '+' : ''}${(d * 100).toFixed(0)}%`, good: d > 0 });
  }

  return out;
}

function StatCell({ label, value, tone = 'text-slate-200' }: { label: string; value: string; tone?: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[9px] font-mono text-slate-500">{label}</span>
      <span className={`text-[12px] font-mono font-bold tabular-nums ${tone}`}>{value}</span>
    </div>
  );
}

export default function GarageShop({ garage, build, spec, onBuyPart, onBuyBlock }: GarageShopProps) {
  const [openSlot, setOpenSlot] = useState<PartSlot | null>(null);
  const [showBlocks, setShowBlocks] = useState(false);

  /** Predicted steady-state coolant temperature at sustained wide-open throttle. */
  const wotTemp = useMemo(
    () => equilibriumCoolantTemp(spec, spec.redlineRpm, 1, 1),
    [spec]
  );

  const advisories = useMemo(() => {
    const out: { level: 'warn' | 'danger' | 'tip'; text: string }[] = [];

    if (wotTemp > THERMAL.seizeTemp) {
      out.push({
        level: 'danger',
        text: `这套构型在红线全负载下的平衡水温约 ${wotTemp.toFixed(0)}°C，超过 ${THERMAL.seizeTemp}°C 的抱死点 —— 持续高转必定烧机。先加装散热。`,
      });
    } else if (wotTemp > THERMAL.warnTemp) {
      out.push({
        level: 'warn',
        text: `红线全负载平衡水温约 ${wotTemp.toFixed(0)}°C，已进入报警区（${THERMAL.warnTemp}°C）。爆震极限会随之下降，长时间拉高转要小心。`,
      });
    }

    if (spec.boostBar > 0 && spec.compressionRatio > 10) {
      out.push({
        level: 'danger',
        text: `增压 ${spec.boostBar.toFixed(2)} bar 配 CR ${spec.compressionRatio} 会吃掉约 ${(
          spec.boostBar * KNOCK.boostPenaltyPerBar +
          (spec.compressionRatio - KNOCK.referenceCr) * KNOCK.crPenaltyPerPoint
        ).toFixed(0)}° 爆震余量。换低压缩增压活塞。`,
      });
    }

    if (spec.ecuTier === 0 && (spec.compressionRatio > 10.5 || spec.boostBar > 0)) {
      out.push({
        level: 'warn',
        text: '原厂 ECU 只能整条曲线平移，压不住高转的爆震。这套构型需要可编程或独立 ECU。',
      });
    }

    if (spec.rotatingInertia < 0.09 && spec.idleRpm < 1200) {
      out.push({ level: 'tip', text: '转动惯量很低，怠速会明显不稳 —— 起动后可能需要用油门吊住。' });
    }

    if (spec.destructRpm - spec.redlineRpm < 900) {
      out.push({
        level: 'warn',
        text: `红线 ${spec.redlineRpm} 与机械崩溃 ${spec.destructRpm} 只差 ${spec.destructRpm - spec.redlineRpm} rpm，余量很薄，建议升级连杆或开启限速器。`,
      });
    }

    return out;
  }, [spec, wotTemp]);

  const renderOption = (slot: PartSlot, part: Part) => {
    const installed = build.installed[slot] === part.id;
    const owned = garage.owned.includes(part.id);
    const locked = !owned && part.tier > garage.tier;
    const affordable = owned || garage.credits >= part.cost;

    const candidate = resolveBuild({ ...build, installed: { ...build.installed, [slot]: part.id } });
    const deltas = installed ? [] : describeDelta(spec, candidate);

    return (
      <button
        key={part.id}
        onClick={() => !installed && !locked && onBuyPart(part.id)}
        disabled={installed || locked || !affordable}
        className={`w-full text-left p-2.5 rounded-lg border transition-colors ${
          installed
            ? 'bg-sky-950/40 border-sky-700/50'
            : locked
            ? 'bg-slate-950/40 border-slate-900 opacity-60 cursor-not-allowed'
            : !affordable
            ? 'bg-slate-950/60 border-slate-900 opacity-70 cursor-not-allowed'
            : 'bg-slate-950/60 border-slate-800 hover:border-sky-800/60 cursor-pointer'
        }`}
      >
        <div className="flex items-start justify-between gap-2">
          <span className={`text-[12px] font-semibold ${installed ? 'text-sky-300' : 'text-slate-300'}`}>
            {part.name}
          </span>
          <span className="shrink-0 flex items-center gap-1 text-[10px] font-mono">
            {installed ? (
              <span className="text-sky-400 flex items-center gap-0.5">
                <Check className="w-3 h-3" />
                在装
              </span>
            ) : locked ? (
              <span className="text-slate-500 flex items-center gap-0.5">
                <Lock className="w-3 h-3" />T{part.tier}
              </span>
            ) : owned ? (
              <span className="text-emerald-400">已拥有 · 装上</span>
            ) : (
              <span className={affordable ? 'text-amber-400' : 'text-red-400/70'}>{part.cost} CR</span>
            )}
          </span>
        </div>

        <p className="text-[9.5px] text-slate-500 mt-0.5 leading-relaxed">{part.desc}</p>
        {part.cost > 0 && <p className="text-[9.5px] text-amber-600/80 mt-0.5 leading-relaxed">代价：{part.drawback}</p>}

        {deltas.length > 0 && (
          <div className="flex flex-wrap gap-1 mt-1.5">
            {deltas.map((d, i) => (
              <span
                key={i}
                className={`text-[9px] font-mono px-1.5 py-0.5 rounded ${
                  d.good ? 'bg-emerald-950/50 text-emerald-400' : 'bg-red-950/50 text-red-400'
                }`}
              >
                {d.text}
              </span>
            ))}
          </div>
        )}
      </button>
    );
  };

  return (
    <div className="flex flex-col gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl w-full">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 gap-2 flex-wrap">
        <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-300 flex items-center gap-1.5 font-display">
          <Wrench className="w-4 h-4 text-amber-400" />
          车间 · 零件与构型
        </h2>
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span className="text-slate-500">车间等级 T{garage.tier}</span>
          <span className="flex items-center gap-1 text-emerald-400">
            <Coins className="w-3.5 h-3.5" />
            {Math.floor(garage.credits)} CR
          </span>
        </div>
      </div>

      {/* Current build summary */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-3 space-y-2">
        <div className="flex items-baseline justify-between">
          <span className="text-[12px] font-semibold text-slate-200">{spec.name}</span>
          <span className="text-[9px] font-mono text-slate-500">已投入 {buildValue(build)} CR</span>
        </div>
        <div className="grid grid-cols-3 sm:grid-cols-4 gap-2">
          <StatCell label="排量" value={`${Math.round(displacementCc(spec))} cc`} />
          <StatCell label="压缩比" value={spec.compressionRatio.toFixed(1)} />
          <StatCell label="峰值扭矩" value={`${spec.peakTorque.toFixed(1)} Nm`} tone="text-blue-300" />
          <StatCell label="扭矩峰" value={`${spec.torquePeakRpm} rpm`} />
          <StatCell label="红线" value={`${spec.redlineRpm} rpm`} tone="text-amber-300" />
          <StatCell label="崩溃转速" value={`${spec.destructRpm} rpm`} tone="text-red-300" />
          <StatCell label="转动惯量" value={`${spec.rotatingInertia.toFixed(3)} kg·m²`} />
          <StatCell
            label="全负载水温"
            value={`≈${wotTemp.toFixed(0)}°C`}
            tone={wotTemp > THERMAL.seizeTemp ? 'text-red-400' : wotTemp > THERMAL.warnTemp ? 'text-amber-400' : 'text-cyan-300'}
          />
        </div>
      </div>

      {/* Build advisor */}
      {advisories.length > 0 && (
        <div className="space-y-1.5">
          {advisories.map((a, i) => (
            <div
              key={i}
              className={`flex items-start gap-2 rounded-lg p-2 text-[10px] font-mono leading-relaxed border ${
                a.level === 'danger'
                  ? 'bg-red-950/40 border-red-900/50 text-red-300'
                  : a.level === 'warn'
                  ? 'bg-amber-950/30 border-amber-900/40 text-amber-300'
                  : 'bg-slate-950 border-slate-800 text-slate-400'
              }`}
            >
              <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>{a.text}</span>
            </div>
          ))}
        </div>
      )}

      {/* Blocks */}
      <div>
        <button
          onClick={() => setShowBlocks((v) => !v)}
          className="w-full flex items-center justify-between py-2 text-[11px] font-mono text-slate-400 hover:text-slate-200 cursor-pointer"
        >
          <span className="flex items-center gap-1.5">
            {showBlocks ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
            缸体平台 (Block)
          </span>
          <span className="text-slate-500">{ENGINE_BLOCKS.find((b) => b.id === build.blockId)?.name}</span>
        </button>

        {showBlocks && (
          <div className="grid grid-cols-1 gap-2 pt-1">
            <p className="text-[9px] font-mono text-amber-600/80">
              ⚠ 换缸体等于换一台发动机：所有零件退回原厂状态（已购买的仍在库中，可重新装上），ECU 会重新生成基础标定。
            </p>
            {ENGINE_BLOCKS.map((block) => {
              const owned = garage.owned.includes(block.id);
              const active = build.blockId === block.id;
              const locked = !owned && block.tier > garage.tier;
              const affordable = owned || garage.credits >= block.cost;
              return (
                <button
                  key={block.id}
                  onClick={() => !active && !locked && onBuyBlock(block.id)}
                  disabled={active || locked || !affordable}
                  className={`text-left p-2.5 rounded-lg border transition-colors ${
                    active
                      ? 'bg-sky-950/40 border-sky-700/50'
                      : locked || !affordable
                      ? 'bg-slate-950/40 border-slate-900 opacity-60 cursor-not-allowed'
                      : 'bg-slate-950/60 border-slate-800 hover:border-sky-800/60 cursor-pointer'
                  }`}
                >
                  <div className="flex items-start justify-between gap-2">
                    <span className={`text-[12px] font-semibold ${active ? 'text-sky-300' : 'text-slate-300'}`}>
                      {block.name}
                    </span>
                    <span className="shrink-0 text-[10px] font-mono">
                      {active ? (
                        <span className="text-sky-400">在装</span>
                      ) : locked ? (
                        <span className="text-slate-500">🔒 T{block.tier}</span>
                      ) : owned ? (
                        <span className="text-emerald-400">已拥有 · 换装</span>
                      ) : (
                        <span className={affordable ? 'text-amber-400' : 'text-red-400/70'}>{block.cost} CR</span>
                      )}
                    </span>
                  </div>
                  <p className="text-[9.5px] text-slate-500 mt-0.5 leading-relaxed">{block.desc}</p>
                  <div className="flex gap-3 mt-1 text-[9px] font-mono text-slate-500">
                    <span>{Math.round(displacementCc(block))}cc</span>
                    <span>CR {block.baseCompression}</span>
                    <span>红线 {block.baseRedline}</span>
                    <span>怠速 {block.idleRpm}</span>
                  </div>
                </button>
              );
            })}
          </div>
        )}
      </div>

      {/* Part slots */}
      <div className="space-y-1 border-t border-slate-800 pt-2">
        {PART_SLOTS.map((slot) => {
          const installedId = build.installed[slot];
          const installed = installedId ? getPart(installedId) : undefined;
          const options = partsInSlot(slot, build.blockId);
          const isOpen = openSlot === slot;
          const upgradesAvailable = options.filter(
            (p) => p.cost > 0 && p.tier <= garage.tier && p.id !== installedId
          ).length;

          return (
            <div key={slot}>
              <button
                onClick={() => setOpenSlot(isOpen ? null : slot)}
                className="w-full flex items-center justify-between py-2 px-1 rounded hover:bg-slate-950/60 cursor-pointer"
              >
                <span className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
                  {isOpen ? <ChevronDown className="w-3.5 h-3.5" /> : <ChevronRight className="w-3.5 h-3.5" />}
                  {SLOT_LABELS[slot]}
                </span>
                <span className="flex items-center gap-2">
                  <span className={`text-[10px] font-mono ${installed?.cost ? 'text-sky-300' : 'text-slate-500'}`}>
                    {installed?.name ?? '—'}
                  </span>
                  {upgradesAvailable > 0 && (
                    <span className="text-[9px] font-mono px-1.5 py-0.5 rounded-full bg-amber-950/60 text-amber-400 border border-amber-900/50">
                      {upgradesAvailable} 可升级
                    </span>
                  )}
                </span>
              </button>

              {isOpen && <div className="grid grid-cols-1 gap-2 pb-2 pl-1">{options.map((p) => renderOption(slot, p))}</div>}
            </div>
          );
        })}
      </div>
    </div>
  );
}
