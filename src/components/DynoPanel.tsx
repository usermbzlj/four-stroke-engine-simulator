/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * Dyno readout.
 *
 * The curve draws itself live while the pull is happening, because the pull is a
 * real loaded sweep on the actual engine — you can hear it climb, and it can
 * absolutely blow up on the rollers.
 */

import type { DynoCurvePoint, EngineSpec } from '../types';
import type { DynoUiState } from '../runtime/engineRuntime';
import { DYNO, THERMAL } from '../engine';
import { Ban, Gauge, LineChart, Play, TriangleAlert } from 'lucide-react';

interface DynoPanelProps {
  spec: EngineSpec;
  dyno: DynoUiState;
  canRun: boolean;
  onRun: () => void;
  onAbort: () => void;
}

const CHART = { width: 400, height: 170, pad: 26 };

type PlotPoint = { rpm: number; torque: number; power: number; knock?: number };

function Curve({ points, spec, live }: { points: PlotPoint[]; spec: EngineSpec; live: boolean }) {
  const { width, height, pad } = CHART;
  const minRpm = DYNO.startRpm;
  const maxRpm = spec.redlineRpm;
  const maxTorque = Math.max(...points.map((p) => p.torque), spec.peakTorque * 0.6);
  const maxPower = Math.max(...points.map((p) => p.power), 5);

  const project = (value: number, max: number, rpm: number) => ({
    x: pad + ((rpm - minRpm) / Math.max(1, maxRpm - minRpm)) * (width - pad * 2),
    y: height - pad - (value / max) * (height - pad * 2),
  });
  const firstX = project(0, maxTorque, points[0]?.rpm ?? minRpm).x;
  const lastX = project(0, maxTorque, points.at(-1)?.rpm ?? minRpm).x;

  const toPath = (accessor: (p: PlotPoint) => number, max: number) =>
    points
      .map((p) => {
        const { x, y } = project(accessor(p), max, p.rpm);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

  const torquePath = toPath((p) => p.torque, maxTorque);
  const powerPath = toPath((p) => p.power, maxPower);
  const knockPoints = points.filter((p) => (p.knock ?? 0) > 0.05);

  return (
    <svg viewBox={`0 0 ${width} ${height}`} className="w-full">
      {[0.25, 0.5, 0.75, 1].map((g) => (
        <line
          key={g}
          x1={pad}
          x2={width - pad}
          y1={height - pad - g * (height - pad * 2)}
          y2={height - pad - g * (height - pad * 2)}
          stroke="#1e293b"
          strokeWidth="1"
        />
      ))}

      {/* redline marker */}
      <line
        x1={pad + (width - pad * 2)}
        x2={pad + (width - pad * 2)}
        y1={pad}
        y2={height - pad}
        stroke="#7f1d1d"
        strokeWidth="1.5"
        strokeDasharray="3 2"
      />

      <defs>
        <linearGradient id="dynoTorqueFill" x1="0" y1="0" x2="0" y2="1">
          <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.28" />
          <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
        </linearGradient>
      </defs>

      {points.length > 1 && (
        <>
          <path
            d={`M ${firstX},${height - pad} L ${torquePath} L ${lastX},${height - pad} Z`}
            fill="url(#dynoTorqueFill)"
          />
          <polyline points={torquePath} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />
          <polyline points={powerPath} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinejoin="round" />
        </>
      )}

      {/* knock is marked right where it happened, so it is actionable */}
      {knockPoints.map((p, i) => {
        const { x, y } = project(p.torque, maxTorque, p.rpm);
        return <circle key={i} cx={x} cy={y} r={3.5} fill="#ef4444" stroke="#0f172a" strokeWidth="1" />;
      })}

      {/* axis labels */}
      <text x={pad} y={height - 8} fontSize="8" fill="#475569" fontFamily="monospace">
        {(minRpm / 1000).toFixed(1)}k
      </text>
      <text x={width - pad} y={height - 8} fontSize="8" fill="#7f1d1d" fontFamily="monospace" textAnchor="end">
        {(maxRpm / 1000).toFixed(1)}k 红线
      </text>
      <text x={4} y={pad - 2} fontSize="8" fill="#3b82f6" fontFamily="monospace">
        {maxTorque.toFixed(0)}Nm
      </text>
      <text x={width - 4} y={pad - 2} fontSize="8" fill="#f59e0b" fontFamily="monospace" textAnchor="end">
        {maxPower.toFixed(0)}HP
      </text>

      {live && (
        <text x={width / 2} y={pad + 4} fontSize="9" fill="#38bdf8" fontFamily="monospace" textAnchor="middle">
          扫描中…
        </text>
      )}
    </svg>
  );
}

function ResultStat({
  label,
  value,
  unit,
  at,
  tone,
  border,
}: {
  label: string;
  value: string;
  unit: string;
  at?: string;
  tone: string;
  border: string;
}) {
  return (
    <div className={`bg-slate-950 p-2.5 rounded-lg border ${border} flex items-center justify-between`}>
      <div className="flex flex-col">
        <span className="text-[10px] font-mono text-slate-500">{label}</span>
        {at && <span className="text-[9px] text-slate-600 font-mono">{at}</span>}
      </div>
      <span className={`text-lg font-bold font-mono tabular-nums ${tone}`}>
        {value}
        <span className="text-[10px] ml-0.5 text-slate-500">{unit}</span>
      </span>
    </div>
  );
}

export default function DynoPanel({ spec, dyno, canRun, onRun, onAbort }: DynoPanelProps) {
  const { running, progress, live, result } = dyno;
  const plotted: PlotPoint[] = running ? live : (result?.curve as DynoCurvePoint[] | undefined) ?? [];

  return (
    <div className="flex flex-col gap-3 bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl w-full">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 gap-2 flex-wrap">
        <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-300 flex items-center gap-1.5 font-display">
          <LineChart className="w-4 h-4 text-blue-400" />
          测功机 · 拉力测试
        </h2>

        {running ? (
          <button
            onClick={onAbort}
            className="text-[11px] font-mono px-3 py-1.5 rounded-lg border flex items-center gap-1.5 bg-red-950/50 border-red-900/60 text-red-300 hover:bg-red-900/50 cursor-pointer"
          >
            <Ban className="w-3.5 h-3.5" />
            中止 {Math.round(progress * 100)}%
          </button>
        ) : (
          <button
            onClick={onRun}
            disabled={!canRun}
            className={`text-[11px] font-mono px-3 py-1.5 rounded-lg border flex items-center gap-1.5 transition-colors ${
              canRun
                ? 'bg-blue-600 hover:bg-blue-500 border-blue-700 text-white cursor-pointer'
                : 'bg-slate-950 border-slate-800 text-slate-600 cursor-not-allowed'
            }`}
          >
            <Play className="w-3.5 h-3.5 fill-current" />
            开始拉力 (D)
          </button>
        )}
      </div>

      <div className="relative bg-slate-950 rounded-xl border border-slate-800 p-1 min-h-[178px] flex items-center justify-center">
        {plotted.length > 1 ? (
          <Curve points={plotted} spec={spec} live={running} />
        ) : (
          <div className="h-[170px] flex flex-col items-center justify-center gap-2 text-center px-6">
            <Gauge className={`w-6 h-6 text-slate-700 ${running ? 'animate-spin' : ''}`} />
            <span className="text-slate-500 text-[11px] font-mono leading-relaxed">
              {running
                ? '测功台正在稳定起始转速…'
                : canRun
                ? '测功台会接管油门与制动，从 1500rpm 带载扫描到红线。全程约 10–20 秒，会计入部件损耗。'
                : '需要发动机处于运转状态才能上测功台。'}
            </span>
          </div>
        )}

        {running && (
          <div className="absolute bottom-1.5 left-2 right-2 h-1 bg-slate-900 rounded overflow-hidden">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>

      {result && !running && (
        <>
          <div className="grid grid-cols-2 gap-2">
            <ResultStat
              label="峰值马力"
              value={result.peakPowerHp.toFixed(1)}
              unit="HP"
              at={`@ ${Math.round(result.peakPowerRpm)} rpm`}
              tone="text-amber-400"
              border="border-amber-900/30"
            />
            <ResultStat
              label="峰值扭矩"
              value={result.peakTorqueNm.toFixed(1)}
              unit="Nm"
              at={`@ ${Math.round(result.peakTorqueRpm)} rpm`}
              tone="text-blue-400"
              border="border-blue-900/30"
            />
            <ResultStat
              label="最高水温"
              value={result.maxTemp.toFixed(0)}
              unit="°C"
              tone={result.maxTemp > THERMAL.warnTemp ? 'text-red-400' : 'text-cyan-400'}
              border={result.maxTemp > THERMAL.warnTemp ? 'border-red-900/40' : 'border-cyan-900/30'}
            />
            <ResultStat
              label="峰值爆震"
              value={(result.maxKnock * 100).toFixed(0)}
              unit="%"
              at={`部件损耗 ${result.wearCost.toFixed(1)}`}
              tone={result.maxKnock > 0.15 ? 'text-red-400' : result.maxKnock > 0 ? 'text-amber-400' : 'text-emerald-400'}
              border={result.maxKnock > 0.15 ? 'border-red-900/40' : 'border-slate-800'}
            />
          </div>

          {result.aborted && (
            <div className="flex items-start gap-2 bg-amber-950/30 border border-amber-900/40 rounded-lg p-2.5 text-[10px] font-mono text-amber-300">
              <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>本次拉力未跑完：{result.aborted}。曲线只覆盖已测得的转速段。</span>
            </div>
          )}

          {result.maxKnock > 0.15 && (
            <div className="flex items-start gap-2 bg-red-950/30 border border-red-900/40 rounded-lg p-2.5 text-[10px] font-mono text-red-300">
              <TriangleAlert className="w-3.5 h-3.5 shrink-0 mt-0.5" />
              <span>
                曲线上的红点标出了发生爆震的转速。去「ECU 标定」把这些转速段的点火角压到爆震极限线以下，
                或者先解决散热 —— 极限线会随水温下降。
              </span>
            </div>
          )}
        </>
      )}

      <div className="flex flex-wrap items-center gap-x-4 gap-y-1 text-[10px] font-mono text-slate-500 px-1">
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-blue-500 inline-block" /> 扭矩 (Nm)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-amber-500 inline-block" /> 马力 (HP)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-2 h-2 rounded-full bg-red-500 inline-block" /> 爆震点
        </span>
      </div>
    </div>
  );
}
