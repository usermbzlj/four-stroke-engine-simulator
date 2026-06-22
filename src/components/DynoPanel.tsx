/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { DynoResult } from '../types';
import { LineChart, Play, Gauge } from 'lucide-react';

interface DynoPanelProps {
  result: DynoResult | null;
  isRunning: boolean;
  progress: number; // 0-1 sweep progress
  canRun: boolean;
  onRunDyno: () => void;
}

export default function DynoPanel({ result, isRunning, progress, canRun, onRunDyno }: DynoPanelProps) {
  const renderCurve = () => {
    if (!result || result.curve.length < 2) {
      return (
        <div className="h-[150px] flex items-center justify-center text-slate-600 text-xs font-mono text-center px-4">
          {isRunning
            ? `测功机扫描中... ${Math.round(progress * 100)}%`
            : '点击“开始拉力测试”记录全转速域扭矩 / 马力曲线'}
        </div>
      );
    }

    const width = 360;
    const height = 150;
    const padding = 24;
    const maxRpm = Math.max(...result.curve.map((c) => c.rpm));
    const maxTorque = Math.max(...result.curve.map((c) => c.torque), 10);
    const maxPower = Math.max(...result.curve.map((c) => c.power), 10);

    const tqPts = result.curve
      .map((c) => {
        const x = padding + (c.rpm / maxRpm) * (width - padding * 2);
        const y = height - padding - (c.torque / maxTorque) * (height - padding * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    const pwPts = result.curve
      .map((c) => {
        const x = padding + (c.rpm / maxRpm) * (width - padding * 2);
        const y = height - padding - (c.power / maxPower) * (height - padding * 2);
        return `${x.toFixed(1)},${y.toFixed(1)}`;
      })
      .join(' ');

    return (
      <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
        <defs>
          <linearGradient id="tqArea" x1="0" y1="0" x2="0" y2="1">
            <stop offset="0%" stopColor="#3b82f6" stopOpacity="0.25" />
            <stop offset="100%" stopColor="#3b82f6" stopOpacity="0" />
          </linearGradient>
        </defs>
        {[0.25, 0.5, 0.75].map((g) => (
          <line
            key={g}
            x1={padding}
            x2={width - padding}
            y1={height - padding - g * (height - padding * 2)}
            y2={height - padding - g * (height - padding * 2)}
            stroke="#1e293b"
            strokeWidth="1"
          />
        ))}
        <path d={`M ${padding},${height - padding} L ${tqPts} L ${width - padding},${height - padding} Z`} fill="url(#tqArea)" />
        <polyline points={tqPts} fill="none" stroke="#3b82f6" strokeWidth="2" strokeLinejoin="round" />
        <polyline points={pwPts} fill="none" stroke="#f59e0b" strokeWidth="2" strokeLinejoin="round" />
        {/* peak markers */}
        {(() => {
          const px = padding + (result.peakPowerRpm / maxRpm) * (width - padding * 2);
          const py = height - padding - (result.peakPowerHp / maxPower) * (height - padding * 2);
          return <circle cx={px} cy={py} r="3" fill="#f59e0b" stroke="#fff" strokeWidth="1" />;
        })()}
      </svg>
    );
  };

  return (
    <div className="flex flex-col space-y-3 bg-gray-900 border border-gray-800 p-5 rounded-2xl shadow-xl w-full">
      <div className="flex items-center justify-between border-b border-gray-800 pb-3">
        <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-300 flex items-center gap-1.5 font-display">
          <LineChart className="w-4 h-4 text-blue-400" />
          测功机 · Dyno 拉力曲线
        </h2>
        <button
          onClick={onRunDyno}
          disabled={!canRun || isRunning}
          className={`text-[11px] font-mono px-3 py-1.5 rounded-lg border flex items-center gap-1.5 transition-all ${
            !canRun || isRunning
              ? 'bg-slate-950 border-slate-800 text-slate-600 cursor-not-allowed'
              : 'bg-blue-600 hover:bg-blue-500 border-blue-700 text-white cursor-pointer active:scale-95'
          }`}
        >
          {isRunning ? (
            <>
              <Gauge className="w-3.5 h-3.5 animate-spin" />
              扫描 {Math.round(progress * 100)}%
            </>
          ) : (
            <>
              <Play className="w-3.5 h-3.5 fill-current" />
              开始拉力测试
            </>
          )}
        </button>
      </div>

      <div className="relative h-[150px] bg-slate-950 rounded-xl border border-slate-800 p-1">
        {renderCurve()}
        {isRunning && (
          <div className="absolute bottom-1 left-1 right-1 h-1 bg-slate-900 rounded overflow-hidden">
            <div className="h-full bg-blue-500 transition-all" style={{ width: `${progress * 100}%` }} />
          </div>
        )}
      </div>

      {result && (
        <div className="grid grid-cols-2 gap-3">
          <div className="bg-slate-950 p-2.5 rounded-lg border border-amber-900/30 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-[10px] text-amber-500/80 font-mono">峰值马力</span>
              <span className="text-[9px] text-slate-500 font-mono">@ {Math.round(result.peakPowerRpm)} rpm</span>
            </div>
            <span className="text-lg font-bold font-mono text-amber-400">
              {result.peakPowerHp.toFixed(1)}
              <span className="text-[10px] ml-0.5 text-slate-500">HP</span>
            </span>
          </div>
          <div className="bg-slate-950 p-2.5 rounded-lg border border-blue-900/30 flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-[10px] text-blue-400/80 font-mono">峰值扭矩</span>
              <span className="text-[9px] text-slate-500 font-mono">@ {Math.round(result.peakTorqueRpm)} rpm</span>
            </div>
            <span className="text-lg font-bold font-mono text-blue-400">
              {result.peakTorqueNm.toFixed(1)}
              <span className="text-[10px] ml-0.5 text-slate-500">Nm</span>
            </span>
          </div>
        </div>
      )}

      <div className="flex items-center gap-4 text-[10px] font-mono text-slate-500 px-1">
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-blue-500 inline-block" /> 扭矩 Torque (Nm)
        </span>
        <span className="flex items-center gap-1">
          <span className="w-3 h-0.5 bg-amber-500 inline-block" /> 马力 Power (HP)
        </span>
      </div>
    </div>
  );
}
