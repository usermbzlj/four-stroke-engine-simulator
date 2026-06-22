/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { TelemetryPoint, LogMessage } from '../types';
import { Activity, Thermometer, Zap, Gauge, Flame, AlertCircle, Droplet } from 'lucide-react';

interface TelemetryDashboardProps {
  stats: TelemetryPoint;
  history: TelemetryPoint[];
  logs: LogMessage[];
  redlineRpm: number;
  onClearLogs: () => void;
}

export default function TelemetryDashboard({ stats, history, logs, redlineRpm, onClearLogs }: TelemetryDashboardProps) {
  // Format numbers to keep layout compact
  const rpm = Math.round(stats.rpm);
  const temp = Math.round(stats.temp);
  const torque = stats.torque.toFixed(1);
  const power = stats.power.toFixed(1);
  const pressure = stats.pressure.toFixed(1);
  const fuelFlow = stats.fuelFlow.toFixed(2);
  const efficiency = stats.efficiency;
  const oilPressure = stats.oilPressure.toFixed(1);
  const warnRpm = redlineRpm * 0.82;
  const critRpm = redlineRpm;

  // Render a scrolling line chart using simple SVG
  const renderHistoryChart = () => {
    if (history.length === 0) return null;

    const width = 360;
    const height = 110;
    const padding = 15;

    // Find extremes
    let maxRpm = Math.max(...history.map(h => h.rpm), redlineRpm * 0.9);
    // Smooth grid lines
    maxRpm = Math.ceil(maxRpm / 1000) * 1000;

    // Generate path points
    const points = history.map((pt, index) => {
      const x = padding + (index / Math.max(1, history.length - 1)) * (width - padding * 2);
      // Invert Y: higher RPM is near top (padding), lower RPM is near bottom (height - padding)
      const ratio = pt.rpm / maxRpm;
      const y = height - padding - ratio * (height - padding * 2);
      return `${x},${y}`;
    }).join(' ');

    // Spark Pressure path points
    const maxPres = Math.max(...history.map(h => h.pressure), 50);
    const pressurePoints = history.map((pt, index) => {
      const x = padding + (index / Math.max(1, history.length - 1)) * (width - padding * 2);
      const ratio = pt.pressure / maxPres;
      const y = height - padding - ratio * (height - padding * 2);
      return `${x},${y}`;
    }).join(' ');

    return (
      <div className="relative w-full h-[120px] bg-slate-900/60 rounded-xl border border-slate-800 p-2 overflow-hidden">
        <div className="absolute top-2 left-3 flex justify-between w-[92%] z-10 pointer-events-none">
          <span className="text-[10px] font-mono font-medium text-emerald-400 flex items-center">
            <span className="w-1.5 h-1.5 rounded-full bg-emerald-500 mr-1 animate-pulse"></span>
            转速 RPM ({rpm} U/min)
          </span>
          <span className="text-[10px] font-mono text-purple-400">
            气缸瞬时压力 Pressure ({pressure} bar)
          </span>
        </div>

        {/* Floating gridlines */}
        <div className="absolute left-0 right-0 top-1/4 border-t border-slate-800/60 pointer-events-none"></div>
        <div className="absolute left-0 right-0 top-1/2 border-t border-slate-800/60 pointer-events-none"></div>
        <div className="absolute left-0 right-0 top-3/4 border-t border-slate-800/60 pointer-events-none"></div>

        <svg width="100%" height="100%" viewBox={`0 0 ${width} ${height}`} className="overflow-visible">
          {/* Subtle Area gradient under RPM */}
          <defs>
            <linearGradient id="rpmGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#10b981" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#10b981" stopOpacity="0" />
            </linearGradient>
            <linearGradient id="presGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#a855f7" stopOpacity="0.15" />
              <stop offset="100%" stopColor="#a855f7" stopOpacity="0" />
            </linearGradient>
          </defs>

          {/* Area fill */}
          {history.length > 1 && (
            <>
              <path
                d={`M ${padding},${height - padding} L ${points} L ${padding + (history.length - 1) / Math.max(1, history.length - 1) * (width - padding * 2)},${height - padding} Z`}
                fill="url(#rpmGrad)"
                className="transition-all duration-100"
              />
              <path
                d={`M ${padding},${height - padding} L ${pressurePoints} L ${padding + (history.length - 1) / Math.max(1, history.length - 1) * (width - padding * 2)},${height - padding} Z`}
                fill="url(#presGrad)"
                className="transition-all duration-100"
              />
            </>
          )}

          {/* Core Paths */}
          {history.length > 1 && (
            <>
              <polyline
                fill="none"
                stroke="#10b981"
                strokeWidth="1.8"
                points={points}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-all duration-100"
              />
              <polyline
                fill="none"
                stroke="#a855f7"
                strokeWidth="1.2"
                points={pressurePoints}
                strokeLinecap="round"
                strokeLinejoin="round"
                className="transition-all duration-100"
              />
            </>
          )}
        </svg>
      </div>
    );
  };

  return (
    <div className="flex flex-col space-y-4 bg-gray-900 border border-gray-800 p-5 rounded-2xl shadow-xl w-full">
      {/* Visual Gauges */}
      <div className="flex items-center justify-between border-b border-gray-800 pb-3">
        <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-300 flex items-center gap-1.5 font-display">
          <Activity className="w-4 h-4 text-emerald-400" />
          实时性能监控面板
        </h2>
        <span className={`text-[10px] px-2 py-0.5 rounded font-mono border ${
          temp > 115 || rpm > critRpm
            ? 'bg-red-950 text-red-400 border-red-800/40 animate-pulse'
            : temp > 90 || rpm > warnRpm
            ? 'bg-amber-950 text-amber-400 border-amber-800/40'
            : 'bg-emerald-950 text-emerald-400 border-emerald-800/40'
        }`}>
          {temp > 115 || rpm > critRpm ? 'CRITICAL' : temp > 90 || rpm > warnRpm ? 'WARNING' : 'HEALTHY CYCLE'}
        </span>
      </div>

      <div className="grid grid-cols-2 md:grid-cols-5 gap-3">
        {/* RPM Card */}
        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-500 text-[11px] mb-1 font-mono">
            <span>引擎转速</span>
            <Gauge className="w-3.5 h-3.5 text-emerald-500" />
          </div>
          <div className="flex items-baseline space-x-1">
            <span className={`text-xl font-bold font-mono tracking-tight ${rpm > critRpm ? 'text-red-500 animate-pulse' : rpm > warnRpm ? 'text-amber-400' : 'text-emerald-400'}`}>
              {rpm}
            </span>
            <span className="text-[9px] text-gray-500 font-mono">RPM</span>
          </div>
          {/* RPM Mini bar */}
          <div className="w-full h-1 bg-slate-900 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-150 ${rpm > critRpm ? 'bg-red-500' : rpm > warnRpm ? 'bg-amber-500' : 'bg-emerald-500'}`}
              style={{ width: `${Math.min(100, (rpm / (critRpm * 1.05)) * 100)}%` }}
            ></div>
          </div>
        </div>

        {/* Cylinder Temp Card */}
        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-500 text-[11px] mb-1 font-mono">
            <span>气缸温度</span>
            <Thermometer className="w-3.5 h-3.5 text-orange-500" />
          </div>
          <div className="flex items-baseline space-x-1">
            <span className={`text-xl font-bold font-mono tracking-tight ${temp > 115 ? 'text-red-500 animate-pulse' : temp > 85 ? 'text-amber-500' : 'text-orange-400'}`}>
              {temp}
            </span>
            <span className="text-[9px] text-gray-500 font-mono">°C</span>
          </div>
          {/* Temp Progress */}
          <div className="w-full h-1 bg-slate-900 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-300 ${temp > 115 ? 'bg-red-600' : temp > 85 ? 'bg-amber-500' : 'bg-orange-500'}`}
              style={{ width: `${Math.min(100, (temp / 160) * 100)}%` }}
            ></div>
          </div>
        </div>

        {/* Torque and Power Card */}
        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-500 text-[11px] mb-1 font-mono">
            <span>输出马力/扭矩</span>
            <Zap className="w-3.5 h-3.5 text-blue-400" />
          </div>
          <div className="flex flex-col space-y-0.5">
            <div className="flex items-baseline space-x-1">
              <span className="text-sm font-bold font-mono text-slate-300">{power}</span>
              <span className="text-[9px] text-gray-500 font-mono">HP</span>
            </div>
            <div className="flex items-baseline space-x-1 border-t border-slate-900/60 pt-0.5">
              <span className="text-xs font-semibold font-mono text-slate-400">{torque}</span>
              <span className="text-[8px] text-gray-500 font-mono">Nm</span>
            </div>
          </div>
        </div>

        {/* Fuel Card */}
        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-500 text-[11px] mb-1 font-mono">
            <span>燃料效率/油耗</span>
            <Flame className="w-3.5 h-3.5 text-cyan-400" />
          </div>
          <div className="flex flex-col space-y-0.5">
            <div className="flex items-baseline space-x-1">
              <span className="text-sm font-bold font-mono text-cyan-400">{efficiency}%</span>
              <span className="text-[9px] text-gray-500 font-mono">Eff</span>
            </div>
            <div className="flex items-baseline space-x-1 border-t border-slate-900/60 pt-0.5">
              <span className="text-xs font-semibold font-mono text-slate-300">{fuelFlow}</span>
              <span className="text-[8px] text-gray-500 font-mono">ml/s</span>
            </div>
          </div>
        </div>

        {/* Oil Pressure Card */}
        <div className="bg-slate-950 p-3 rounded-xl border border-slate-800 flex flex-col justify-between">
          <div className="flex items-center justify-between text-gray-500 text-[11px] mb-1 font-mono">
            <span>机油压力</span>
            <Droplet className="w-3.5 h-3.5 text-sky-400" />
          </div>
          <div className="flex items-baseline space-x-1">
            <span className={`text-xl font-bold font-mono tracking-tight ${stats.oilPressure < 0.8 && rpm > 200 ? 'text-red-500 animate-pulse' : stats.oilPressure < 1.5 ? 'text-amber-400' : 'text-sky-300'}`}>
              {oilPressure}
            </span>
            <span className="text-[9px] text-gray-500 font-mono">bar</span>
          </div>
          <div className="w-full h-1 bg-slate-900 rounded-full mt-2 overflow-hidden">
            <div
              className={`h-full transition-all duration-150 ${stats.oilPressure < 0.8 ? 'bg-red-500' : 'bg-sky-400'}`}
              style={{ width: `${Math.min(100, (stats.oilPressure / 6) * 100)}%` }}
            ></div>
          </div>
        </div>
      </div>

      {/* Historical line Chart */}
      {renderHistoryChart()}

      {/* Diagnostics Logs Console panel */}
      <div className="bg-slate-950 p-4 rounded-xl border border-slate-800 mt-1">
        <div className="flex items-center justify-between text-xs font-mono border-b border-slate-900 pb-2 mb-2">
          <span className="text-gray-400 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5 text-slate-500" />
            系统运行及诊断记录 Logs
          </span>
          <button
            onClick={onClearLogs}
            className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors font-mono hover:underline"
          >
            清空记录 Clear
          </button>
        </div>
        <div className="h-[90px] overflow-y-auto space-y-1 pr-1 font-mono text-[11px]">
          {logs.length === 0 ? (
            <div className="text-slate-600 text-center py-6">暂无系统诊断日志</div>
          ) : (
            logs.map((log) => {
              // Color styles mapping
              let textClass = 'text-slate-400';
              let badgeBg = 'bg-slate-900/50 text-slate-500 border-slate-800';
              if (log.type === 'success') {
                textClass = 'text-emerald-300';
                badgeBg = 'bg-emerald-950/40 text-emerald-400 border-emerald-900/35';
              } else if (log.type === 'warning') {
                textClass = 'text-amber-300';
                badgeBg = 'bg-amber-950/40 text-amber-400 border-amber-900/35';
              } else if (log.type === 'error') {
                textClass = 'text-red-400';
                badgeBg = 'bg-red-950/40 text-red-400 border-red-900/35';
              } else if (log.type === 'critical') {
                textClass = 'text-pink-300 animate-pulse font-semibold';
                badgeBg = 'bg-pink-950/50 text-pink-400 border-pink-900/40';
              }

              return (
                <div key={log.id} className="flex items-start space-x-2 py-0.5 border-b border-slate-900/30">
                  <span className="text-[10px] text-slate-600 font-mono pt-0.5">{log.time}</span>
                  <span className={`text-[9px] px-1.5 rounded border leading-relaxed font-semibold uppercase ${badgeBg}`}>
                    {log.type}
                  </span>
                  <span className={`flex-1 break-all ${textClass}`}>{log.message}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </div>
  );
}
