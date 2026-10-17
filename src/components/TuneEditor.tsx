/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * ECU map editor.
 *
 * Two sliders with one correct answer is not tuning. Here you shape ignition
 * advance and target lambda against RPM, with the two things you are actually
 * trading between drawn right on the chart: the MBT line you want to reach, and
 * the knock ceiling you must stay under. The ceiling moves with coolant
 * temperature, so it visibly closes in on you as the engine heats up.
 */

import { useMemo, useRef, useState, type PointerEvent as ReactPointerEvent } from 'react';
import type { ComponentWear, EngineSpec, TuneMap, TunePreset } from '../types';
import {
  TUNE,
  TUNE_POINTS,
  knockCeiling,
  mbtCeiling,
  previewCurve,
  setZoneValue,
  tuneBreakpoints,
  tuneZones,
  zoneLabels,
  zoneValue,
} from '../engine';
import { Cpu, Save, Sparkles, Trash2, TriangleAlert } from 'lucide-react';

interface TuneEditorProps {
  spec: EngineSpec;
  tune: TuneMap;
  wear: ComponentWear;
  coolantTemp: number;
  presets: TunePreset[];
  /** A dyno pull is in progress: its result must belong to a single map. */
  locked: boolean;
  onChange: (next: TuneMap) => void;
  onAutoTune: () => void;
  onSavePreset: () => void;
  onApplyPreset: (index: number) => void;
  onDeletePreset: (index: number) => void;
}

const CHART = { width: 420, height: 150, padLeft: 30, padRight: 10, padTop: 12, padBottom: 20 };

type Channel = 'ignition' | 'lambda';

const CHANNEL_RANGE: Record<Channel, { min: number; max: number }> = {
  ignition: { min: TUNE.minIgnition, max: TUNE.maxIgnition },
  lambda: { min: TUNE.minLambda, max: TUNE.maxLambda },
};

export default function TuneEditor({
  spec,
  tune,
  wear,
  coolantTemp,
  presets,
  locked,
  onChange,
  onAutoTune,
  onSavePreset,
  onApplyPreset,
  onDeletePreset,
}: TuneEditorProps) {
  const [channel, setChannel] = useState<Channel>('ignition');
  const svgRef = useRef<SVGSVGElement | null>(null);
  const draggingRef = useRef<number | null>(null);

  const breakpoints = useMemo(() => tuneBreakpoints(spec), [spec]);
  const zones = useMemo(() => tuneZones(spec.ecuTier), [spec.ecuTier]);
  const labels = useMemo(() => zoneLabels(spec.ecuTier), [spec.ecuTier]);
  const mbt = useMemo(() => mbtCeiling(spec), [spec]);
  const ceiling = useMemo(() => knockCeiling(spec, tune, coolantTemp), [spec, tune, coolantTemp]);

  // Instant analytic feedback while dragging: the player sees the estimate move.
  const estimate = useMemo(() => {
    const curve = previewCurve(spec, tune, wear, Math.max(90, coolantTemp));
    let hp = 0;
    let rpm = 0;
    let nm = 0;
    for (const point of curve) {
      if (point.power > hp) {
        hp = point.power;
        rpm = point.rpm;
      }
      nm = Math.max(nm, point.torque);
    }
    const worstKnock = curve.reduce((max, p) => Math.max(max, p.knock), 0);
    return { hp, rpm, nm, worstKnock };
  }, [spec, tune, wear, coolantTemp]);

  const range = CHANNEL_RANGE[channel];
  const values = tune[channel];

  const xFor = (index: number) =>
    CHART.padLeft + (index / (TUNE_POINTS - 1)) * (CHART.width - CHART.padLeft - CHART.padRight);
  const yFor = (value: number) => {
    const t = (value - range.min) / (range.max - range.min);
    return CHART.height - CHART.padBottom - t * (CHART.height - CHART.padTop - CHART.padBottom);
  };
  const valueForY = (y: number) => {
    const t = (CHART.height - CHART.padBottom - y) / (CHART.height - CHART.padTop - CHART.padBottom);
    return range.min + t * (range.max - range.min);
  };

  const zoneOf = (index: number) => zones.findIndex((z) => z.includes(index));

  /** Convert a pointer event into viewBox coordinates. */
  const toViewBox = (event: ReactPointerEvent<SVGSVGElement>) => {
    const svg = svgRef.current;
    if (!svg) return null;
    const rect = svg.getBoundingClientRect();
    return {
      x: ((event.clientX - rect.left) / rect.width) * CHART.width,
      y: ((event.clientY - rect.top) / rect.height) * CHART.height,
    };
  };

  const nearestIndex = (x: number) => {
    let best = 0;
    let bestDist = Infinity;
    for (let i = 0; i < TUNE_POINTS; i++) {
      const d = Math.abs(xFor(i) - x);
      if (d < bestDist) {
        bestDist = d;
        best = i;
      }
    }
    return best;
  };

  const applyAt = (index: number, value: number) => {
    const zoneIndex = zoneOf(index);
    if (zoneIndex < 0) return;
    onChange(setZoneValue(tune, spec.ecuTier, zoneIndex, channel, value));
  };

  const handlePointerDown = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (locked) return;
    const point = toViewBox(event);
    if (!point) return;
    const index = nearestIndex(point.x);
    draggingRef.current = index;
    event.currentTarget.setPointerCapture(event.pointerId);
    applyAt(index, valueForY(point.y));
  };

  const handlePointerMove = (event: ReactPointerEvent<SVGSVGElement>) => {
    if (locked || draggingRef.current === null) return;
    const point = toViewBox(event);
    if (!point) return;
    applyAt(draggingRef.current, valueForY(point.y));
  };

  const endDrag = () => {
    draggingRef.current = null;
  };

  const pointsPath = values.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ');
  const mbtPath = mbt.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ');
  const ceilingPath = ceiling.map((v, i) => `${xFor(i).toFixed(1)},${yFor(v).toFixed(1)}`).join(' ');

  const overLimit = channel === 'ignition' && values.some((v, i) => v > (ceiling[i] ?? Infinity));

  return (
    <div className="flex flex-col gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl w-full">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 gap-2 flex-wrap">
        <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-300 flex items-center gap-1.5 font-display">
          <Cpu className="w-4 h-4 text-indigo-400" />
          ECU 标定
        </h2>
        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-slate-500">
            {spec.ecuTier === 0 ? '原厂 ECU · 只能整条曲线平移' : spec.ecuTier === 1 ? '可编程 ECU · 三段' : '独立 ECU · 全图 7 点'}
          </span>
          <button
            onClick={onAutoTune}
            disabled={locked}
            className="text-[10px] font-mono px-2 py-1 rounded border border-indigo-800/60 bg-indigo-950/40 text-indigo-300 hover:bg-indigo-900/50 disabled:opacity-40 disabled:cursor-not-allowed flex items-center gap-1 cursor-pointer"
          >
            <Sparkles className="w-3 h-3" />
            安全基础标定
          </button>
        </div>
      </div>

      {locked && (
        <div className="flex items-center gap-2 bg-sky-950/40 border border-sky-900/50 rounded-xl p-2.5 text-[10px] font-mono text-sky-300">
          <Cpu className="w-3.5 h-3.5 shrink-0" />
          测功拉力进行中，标定已锁定 —— 一次拉力只对应一套曲线。拉完或中止后即可继续调整。
        </div>
      )}

      {/* Channel switch */}
      <div className="flex gap-2">
        {(['ignition', 'lambda'] as Channel[]).map((c) => (
          <button
            key={c}
            onClick={() => setChannel(c)}
            className={`flex-1 text-[11px] font-mono py-1.5 rounded-lg border transition-colors cursor-pointer ${
              channel === c
                ? 'bg-indigo-950/50 border-indigo-700/60 text-indigo-200'
                : 'bg-slate-950 border-slate-800 text-slate-500 hover:text-slate-300'
            }`}
          >
            {c === 'ignition' ? '点火提前角 (° BTDC)' : '目标空燃比 (λ)'}
          </button>
        ))}
      </div>

      {/* Chart */}
      <div className="bg-slate-950 border border-slate-800 rounded-xl p-2">
        <svg
          ref={svgRef}
          viewBox={`0 0 ${CHART.width} ${CHART.height}`}
          className="w-full touch-none cursor-crosshair select-none"
          onPointerDown={handlePointerDown}
          onPointerMove={handlePointerMove}
          onPointerUp={endDrag}
          onPointerCancel={endDrag}
          onLostPointerCapture={endDrag}
        >
          {/* grid + y labels */}
          {[0, 0.25, 0.5, 0.75, 1].map((t) => {
            const value = range.min + t * (range.max - range.min);
            const y = yFor(value);
            return (
              <g key={t}>
                <line x1={CHART.padLeft} x2={CHART.width - CHART.padRight} y1={y} y2={y} stroke="#1e293b" strokeWidth="1" />
                <text x={4} y={y + 3} fontSize="8" fill="#475569" fontFamily="monospace">
                  {channel === 'ignition' ? value.toFixed(0) : value.toFixed(2)}
                </text>
              </g>
            );
          })}

          {/* zone separators, so it's obvious what your ECU can move independently */}
          {zones.slice(0, -1).map((zone, i) => {
            const lastIndex = zone.at(-1) ?? 0;
            const x = (xFor(lastIndex) + xFor(lastIndex + 1)) / 2;
            return <line key={i} x1={x} x2={x} y1={CHART.padTop} y2={CHART.height - CHART.padBottom} stroke="#334155" strokeDasharray="2 3" strokeWidth="1" />;
          })}

          {channel === 'ignition' && (
            <>
              {/* knock danger zone: everything above the ceiling detonates */}
              <path
                d={`M ${CHART.padLeft},${CHART.padTop} L ${ceilingPath} L ${CHART.width - CHART.padRight},${CHART.padTop} Z`}
                fill="#ef4444"
                fillOpacity="0.12"
              />
              <polyline points={ceilingPath} fill="none" stroke="#ef4444" strokeWidth="1.5" strokeDasharray="4 2" />
              <polyline points={mbtPath} fill="none" stroke="#f59e0b" strokeWidth="1.5" strokeDasharray="2 2" />
            </>
          )}

          {/* the editable curve */}
          <polyline points={pointsPath} fill="none" stroke="#818cf8" strokeWidth="2.5" strokeLinejoin="round" />
          {values.map((v, i) => {
            const danger = channel === 'ignition' && v > (ceiling[i] ?? Infinity);
            return (
              <circle
                key={i}
                cx={xFor(i)}
                cy={yFor(v)}
                r={4}
                fill={danger ? '#ef4444' : '#818cf8'}
                stroke="#0f172a"
                strokeWidth="1.5"
              />
            );
          })}

          {/* x labels */}
          {breakpoints.map((rpm, i) => (
            <text
              key={i}
              x={xFor(i)}
              y={CHART.height - 6}
              fontSize="8"
              fill="#475569"
              fontFamily="monospace"
              textAnchor="middle"
            >
              {(rpm / 1000).toFixed(1)}k
            </text>
          ))}
        </svg>

        {channel === 'ignition' && (
          <div className="flex flex-wrap items-center gap-x-4 gap-y-1 px-1 pt-1 text-[9px] font-mono text-slate-500">
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-indigo-400 inline-block" /> 你的点火曲线（可拖动）
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-amber-500 inline-block" /> MBT 最大扭矩点
            </span>
            <span className="flex items-center gap-1">
              <span className="w-3 h-0.5 bg-red-500 inline-block" /> 爆震极限 @ {coolantTemp.toFixed(0)}°C
            </span>
          </div>
        )}
      </div>

      {overLimit && (
        <div className="flex items-start gap-2 bg-red-950/40 border border-red-900/50 rounded-xl p-2.5 text-[10px] font-mono text-red-300">
          <TriangleAlert className="w-4 h-4 shrink-0 mt-0.5" />
          <span>
            曲线已越过爆震极限（红色区域）。发动机会敲缸：功率下降、轴瓦寿命骤减，持续下去会炸缸。
            要么把该段点火角压回去，要么加大冷却 / 加浓混合气把极限线抬起来。
          </span>
        </div>
      )}

      {/* Per-zone precise entry */}
      <div className="space-y-2">
        <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">分段精调</span>
        <div className="grid grid-cols-1 sm:grid-cols-2 lg:grid-cols-3 gap-2">
          {zones.map((zone, zi) => {
            const current = zoneValue(tune, spec.ecuTier, zi, channel);
            const rpmLo = breakpoints[zone[0] ?? 0] ?? 0;
            const rpmHi = breakpoints[zone.at(-1) ?? 0] ?? 0;
            const limit = Math.min(...zone.map((i) => ceiling[i] ?? Infinity));
            const risky = channel === 'ignition' && current > limit;
            const step = channel === 'ignition' ? 0.5 : 0.01;
            return (
              <div
                key={zi}
                className={`bg-slate-950 border rounded-lg p-2 ${risky ? 'border-red-900/60' : 'border-slate-800'}`}
              >
                <div className="flex items-baseline justify-between">
                  <span className="text-[9px] font-mono text-slate-500">
                    {labels[zi]} · {rpmLo === rpmHi ? `${rpmLo}` : `${rpmLo}–${rpmHi}`}
                  </span>
                  <span className={`text-[11px] font-mono font-bold ${risky ? 'text-red-400' : 'text-indigo-300'}`}>
                    {channel === 'ignition' ? `${current.toFixed(1)}°` : current.toFixed(2)}
                  </span>
                </div>
                <div className="flex items-center gap-1 mt-1">
                  <button
                    onClick={() => onChange(setZoneValue(tune, spec.ecuTier, zi, channel, current - step))}
                    disabled={locked}
                    className="w-6 h-6 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs cursor-pointer"
                  >
                    −
                  </button>
                  <input
                    type="range"
                    min={range.min}
                    max={range.max}
                    step={step}
                    value={current}
                    disabled={locked}
                    onChange={(e) =>
                      onChange(setZoneValue(tune, spec.ecuTier, zi, channel, parseFloat(e.target.value)))
                    }
                    className="flex-1 h-1 bg-slate-900 rounded appearance-none cursor-pointer disabled:opacity-40 accent-indigo-400"
                  />
                  <button
                    onClick={() => onChange(setZoneValue(tune, spec.ecuTier, zi, channel, current + step))}
                    disabled={locked}
                    className="w-6 h-6 rounded bg-slate-800 text-slate-300 hover:bg-slate-700 disabled:opacity-40 disabled:cursor-not-allowed text-xs cursor-pointer"
                  >
                    +
                  </button>
                </div>
                {channel === 'ignition' && (
                  <div className="text-[8px] font-mono text-slate-600 mt-0.5">极限 {limit.toFixed(1)}°</div>
                )}
              </div>
            );
          })}
        </div>
      </div>

      {/* Analytic estimate */}
      <div className="grid grid-cols-3 gap-2 bg-slate-950 border border-slate-800 rounded-xl p-3">
        <div className="flex flex-col">
          <span className="text-[9px] text-slate-500 font-mono">预估峰值马力</span>
          <span className="text-base font-mono font-bold text-amber-400 tabular-nums">{estimate.hp.toFixed(1)} HP</span>
          <span className="text-[8px] text-slate-600 font-mono">@ {Math.round(estimate.rpm)} rpm</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-slate-500 font-mono">预估峰值扭矩</span>
          <span className="text-base font-mono font-bold text-blue-400 tabular-nums">{estimate.nm.toFixed(1)} Nm</span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-slate-500 font-mono">全域最大爆震</span>
          <span
            className={`text-base font-mono font-bold tabular-nums ${
              estimate.worstKnock > 0.1 ? 'text-red-400' : estimate.worstKnock > 0 ? 'text-amber-400' : 'text-emerald-400'
            }`}
          >
            {(estimate.worstKnock * 100).toFixed(0)}%
          </span>
        </div>
        <span className="col-span-3 text-[9px] font-mono text-slate-600">
          这是理想稳态估算，不含升温与限速影响 —— 真实数字请去测功台拉一次。
        </span>
      </div>

      {/* Presets */}
      <div className="border-t border-slate-800 pt-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">标定预设</span>
          <button
            onClick={onSavePreset}
            className="text-[10px] font-mono text-indigo-400 hover:text-indigo-300 flex items-center gap-1 cursor-pointer"
          >
            <Save className="w-3 h-3" />
            保存当前
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.length === 0 ? (
            <span className="text-[10px] text-slate-600 font-mono">还没有预设。调出满意的曲线后点「保存当前」。</span>
          ) : (
            presets.map((p, i) => (
              <span
                key={i}
                className="group flex items-center gap-1 text-[10px] font-mono pl-2 pr-1 py-1 rounded bg-indigo-950/40 border border-indigo-900/40 text-indigo-300"
              >
                <button
                  onClick={() => onApplyPreset(i)}
                  disabled={locked}
                  className="hover:text-white disabled:opacity-40 disabled:cursor-not-allowed cursor-pointer"
                >
                  {p.name}
                </button>
                <button
                  onClick={() => onDeletePreset(i)}
                  className="opacity-40 group-hover:opacity-100 hover:text-red-400 cursor-pointer"
                  aria-label="删除预设"
                >
                  <Trash2 className="w-3 h-3" />
                </button>
              </span>
            ))
          )}
        </div>
      </div>
    </div>
  );
}