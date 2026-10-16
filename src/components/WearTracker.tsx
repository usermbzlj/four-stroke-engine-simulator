/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ComponentWear} from '../types';
import { EngineState } from '../types';
import { COMPONENT_LABELS, THERMAL } from '../engine';
import { Droplet, HeartPulse, PenTool, RefreshCw, Wrench } from 'lucide-react';

interface WearTrackerProps {
  wear: ComponentWear;
  state: EngineState;
  temp: number;
  rpm: number;
  redlineRpm: number;
  oilLevel: number;
  oilPressure: number;
  /** 0-100 smoothed knock severity. */
  knock: number;
  credits: number;
  oilChangeCost: number;
  rebuildCost: number;
  repairCostFor: (health: number) => number;
  onRepairComponent: (key: keyof ComponentWear) => void;
  onCompleteRebuild: () => void;
  onFlushOil: () => void;
}

const COMPONENT_SCHEMA: { key: keyof ComponentWear; desc: string }[] = [
  { key: 'pistonRings', desc: '密封燃烧室。爆震与过热是它的头号杀手，归零即永久熄火。' },
  { key: 'cylinderWall', desc: '摩擦主表面。缺油或极端高温会拉缸，归零即抱死。' },
  { key: 'conrodBearings', desc: '承受全部爆发力。爆震与超转会迅速吃掉它，归零即炸缸。' },
  { key: 'crankshaftJournal', desc: '主承力轴颈。油压不足时磨损飙升，是阻力增大的首因。' },
  { key: 'sparkPlug', desc: '点火能量来源。磨损后随机缺火，怠速首先变差。' },
  { key: 'valves', desc: '进排气密封。高温下漏气，动力与压缩同时下降。' },
];

function getStatusDetails(val: number) {
  if (val > 80) return { label: '良好', color: 'text-emerald-400 bg-emerald-950/45 border-emerald-900/30' };
  if (val > 50) return { label: '正常', color: 'text-blue-400 bg-blue-950/40 border-blue-900/25' };
  if (val > 25) return { label: '警告', color: 'text-amber-400 bg-amber-950/45 border-amber-900/30' };
  if (val > 0) return { label: '危急', color: 'text-red-400 bg-red-950/50 border-red-900/40 animate-pulse' };
  return { label: '报废', color: 'text-pink-500 bg-pink-950/50 border-pink-900/50 font-bold' };
}

function StressBar({ label, value, display, tone, bar }: { label: string; value: number; display: string; tone: string; bar: string }) {
  return (
    <div className="flex flex-col">
      <span className="text-[10px] text-slate-500 font-mono">{label}</span>
      <span className={`text-xs font-bold font-mono mt-0.5 ${tone}`}>{display}</span>
      <div className="w-full h-1 bg-slate-900 rounded-full mt-1.5 overflow-hidden">
        <div className={`h-full ${bar}`} style={{ width: `${Math.max(0, Math.min(100, value))}%` }} />
      </div>
    </div>
  );
}

export default function WearTracker({
  wear,
  state,
  temp,
  rpm,
  redlineRpm,
  oilLevel,
  oilPressure,
  knock,
  credits,
  oilChangeCost,
  rebuildCost,
  repairCostFor,
  onRepairComponent,
  onCompleteRebuild,
  onFlushOil,
}: WearTrackerProps) {
  const wrecked = state === EngineState.EXPLODED || state === EngineState.SEIZED;

  // Stress is shown against the thresholds that actually matter in the model,
  // not an arbitrary scale, so 100% really does mean "damage is happening".
  const thermalStress = Math.round((temp / THERMAL.warnTemp) * 100);
  const kineticStress = Math.round((rpm / Math.max(1, redlineRpm)) * 100);
  const frictionSevere = oilLevel < 35 ? Math.round((35 - oilLevel) * 2.85) : 0;

  return (
    <div className="flex flex-col gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl w-full">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 gap-2 flex-wrap">
        <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-300 flex items-center gap-1.5 font-display">
          <HeartPulse className="w-4 h-4 text-emerald-400" />
          部件诊断与维修
        </h2>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-900/30 px-2 py-1 rounded">
            {Math.floor(credits)} CR
          </span>
          <button
            onClick={onFlushOil}
            disabled={oilLevel >= 100}
            className="text-[10px] font-mono bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 disabled:opacity-40 disabled:cursor-not-allowed text-amber-400 px-2 py-1 rounded transition-colors cursor-pointer flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3" />
            换机油 {oilChangeCost}
          </button>
        </div>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-950 p-3 rounded-xl border border-slate-900">
        <StressBar
          label={`水温 / ${THERMAL.warnTemp}°C`}
          value={thermalStress}
          display={`${temp.toFixed(0)}°C`}
          tone={thermalStress > 95 ? 'text-red-500 animate-pulse' : thermalStress > 80 ? 'text-amber-500' : 'text-slate-300'}
          bar="bg-orange-500"
        />
        <StressBar
          label="转速 / 红线"
          value={kineticStress}
          display={`${kineticStress}%`}
          tone={kineticStress > 100 ? 'text-red-500 animate-pulse' : kineticStress > 85 ? 'text-amber-500' : 'text-slate-300'}
          bar="bg-emerald-500"
        />
        <StressBar
          label="爆震 (Knock)"
          value={knock}
          display={`${Math.round(knock)}%`}
          tone={knock > 15 ? 'text-red-500 animate-pulse' : knock > 0 ? 'text-amber-500' : 'text-slate-300'}
          bar="bg-red-500"
        />
        <StressBar
          label="机油压力"
          value={(oilPressure / 6) * 100}
          display={`${oilPressure.toFixed(1)} bar`}
          tone={oilPressure < 0.8 && rpm > 200 ? 'text-red-500 animate-pulse' : oilPressure < 1.5 ? 'text-amber-500' : 'text-sky-300'}
          bar={oilPressure < 0.8 ? 'bg-red-500' : 'bg-sky-400'}
        />
      </div>

      {frictionSevere > 0 && (
        <div className="flex items-center gap-2 text-[10px] font-mono text-red-400 bg-red-950/30 border border-red-900/40 rounded-lg px-2.5 py-2">
          <Droplet className="w-3.5 h-3.5 shrink-0" />
          机油液位过低（{oilLevel}%）：正在干摩擦，磨损速率是正常的数倍。
        </div>
      )}

      <div className="space-y-2 max-h-[220px] overflow-y-auto pr-1">
        {COMPONENT_SCHEMA.map((comp) => {
          const val = Math.round(wear[comp.key]);
          const detail = getStatusDetails(val);
          const cost = repairCostFor(wear[comp.key]);
          const healthy = wear[comp.key] >= 99.5;
          const affordable = credits >= cost;

          return (
            <div
              key={comp.key}
              className="flex flex-col gap-1.5 p-2 rounded-lg bg-slate-950/60 border border-slate-900 hover:border-slate-800 transition-colors"
            >
              <div className="flex items-start justify-between gap-2">
                <div className="flex flex-col min-w-0">
                  <span className="text-[11.5px] font-semibold text-slate-300">{COMPONENT_LABELS[comp.key]}</span>
                  <span className="text-[9px] text-slate-500 leading-relaxed">{comp.desc}</span>
                </div>
                <div className="flex items-center gap-2 shrink-0">
                  <span className={`text-[9px] font-mono border px-1.5 py-0.5 rounded leading-none ${detail.color}`}>
                    {detail.label}
                  </span>
                  <span className="text-[11px] font-bold font-mono w-8 text-right text-slate-200 tabular-nums">{val}%</span>
                  <button
                    onClick={() => onRepairComponent(comp.key)}
                    disabled={healthy || !affordable || state === EngineState.EXPLODED}
                    title={healthy ? '状态良好，无需维修' : `更换该部件 (${cost} CR)`}
                    className="px-1.5 py-1 border border-slate-800 bg-slate-900 enabled:hover:bg-slate-800 enabled:hover:text-sky-400 text-slate-400 disabled:opacity-30 disabled:cursor-not-allowed rounded transition-colors text-[9px] flex items-center gap-0.5 font-mono cursor-pointer"
                  >
                    <Wrench className="w-3 h-3" />
                    {healthy ? '—' : cost}
                  </button>
                </div>
              </div>

              <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    val > 70 ? 'bg-emerald-500' : val > 40 ? 'bg-blue-500' : val > 15 ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${val}%` }}
                />
              </div>
            </div>
          );
        })}
      </div>

      <div className="border-t border-slate-800 pt-3 space-y-2">
        <button
          onClick={onCompleteRebuild}
          disabled={credits < rebuildCost}
          className={`w-full py-2.5 px-4 rounded-xl flex items-center justify-center gap-2 font-display font-bold text-xs border select-none transition-all active:scale-[0.99] disabled:opacity-50 disabled:cursor-not-allowed cursor-pointer ${
            state === EngineState.EXPLODED
              ? 'bg-red-600 hover:bg-red-500 text-white border-red-700 shadow-lg'
              : state === EngineState.SEIZED
              ? 'bg-amber-600 hover:bg-amber-500 text-white border-amber-700 shadow-md'
              : 'bg-emerald-600/15 hover:bg-emerald-500/20 text-emerald-400 border-emerald-900/40'
          }`}
        >
          <PenTool className="w-4 h-4" />
          <span>
            {wrecked ? '整机重建（含事故附加费）' : '整机大修'} · {rebuildCost} CR
          </span>
        </button>
        {wrecked && (
          <p className="text-[9px] font-mono text-red-400/80 leading-relaxed">
            事故重建会收取附加费，且随缸体损毁的零件需要重新购买 —— 这就是为什么限速器值得开着。
          </p>
        )}
      </div>
    </div>
  );
}
