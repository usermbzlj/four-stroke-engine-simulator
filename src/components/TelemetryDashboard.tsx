/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import type { ReactNode } from 'react';
import type { TelemetryPoint, LogMessage } from '../types';
import { THERMAL } from '../engine';
import { Activity, Thermometer, Zap, Gauge, AlertCircle, Droplet, Waves } from 'lucide-react';

interface TelemetryDashboardProps {
  stats: TelemetryPoint;
  history: TelemetryPoint[];
  logs: LogMessage[];
  redlineRpm: number;
  onClearLogs: () => void;
}

type Tone = 'emerald' | 'amber' | 'red' | 'sky' | 'violet' | 'orange' | 'slate';

const toneClass: Record<Tone, { text: string; bar: string; border: string; bg: string }> = {
  emerald: { text: 'text-emerald-300', bar: 'bg-emerald-400', border: 'border-emerald-900/35', bg: 'bg-emerald-950/20' },
  amber: { text: 'text-amber-300', bar: 'bg-amber-400', border: 'border-amber-900/35', bg: 'bg-amber-950/20' },
  red: { text: 'text-red-300', bar: 'bg-red-500', border: 'border-red-900/45', bg: 'bg-red-950/25' },
  sky: { text: 'text-sky-300', bar: 'bg-sky-400', border: 'border-sky-900/35', bg: 'bg-sky-950/20' },
  violet: { text: 'text-violet-300', bar: 'bg-violet-400', border: 'border-violet-900/35', bg: 'bg-violet-950/20' },
  orange: { text: 'text-orange-300', bar: 'bg-orange-400', border: 'border-orange-900/35', bg: 'bg-orange-950/20' },
  slate: { text: 'text-slate-300', bar: 'bg-slate-500', border: 'border-slate-800', bg: 'bg-slate-950' },
};

const clampPct = (value: number): number => Math.max(0, Math.min(100, value));

function MetricTile({
  title,
  value,
  unit,
  caption,
  icon,
  tone,
  percent,
}: {
  title: string;
  value: string;
  unit: string;
  caption: string;
  icon: ReactNode;
  tone: Tone;
  percent: number;
}) {
  const palette = toneClass[tone];

  return (
    <div className={`min-h-[108px] border ${palette.border} ${palette.bg} rounded-lg p-3 flex flex-col justify-between`}>
      <div className="flex items-center justify-between gap-2 text-[11px] font-mono text-slate-500">
        <span className="truncate">{title}</span>
        <span className={palette.text}>{icon}</span>
      </div>
      <div>
        <div className="flex items-baseline gap-1 min-w-0">
          <span className={`font-mono text-[22px] leading-none font-bold tabular-nums ${palette.text}`}>{value}</span>
          <span className="text-[10px] text-slate-500 font-mono shrink-0">{unit}</span>
        </div>
        <div className="mt-2 h-1.5 w-full rounded-full bg-slate-950 overflow-hidden">
          <div className={`h-full rounded-full ${palette.bar} transition-[width] duration-300`} style={{ width: `${clampPct(percent)}%` }} />
        </div>
        <p className="mt-1.5 text-[10px] leading-snug text-slate-500 font-mono">{caption}</p>
      </div>
    </div>
  );
}

export default function TelemetryDashboard({ stats, history, logs, redlineRpm, onClearLogs }: TelemetryDashboardProps) {
  const rpm = Math.round(stats.rpm);
  const temp = Math.round(stats.temp);
  const torque = stats.torque.toFixed(1);
  const power = stats.power.toFixed(1);
  const pressure = stats.pressure.toFixed(1);
  const fuelMlMin = stats.fuelFlow * 60;
  const fuelFlow = fuelMlMin >= 10 ? fuelMlMin.toFixed(0) : fuelMlMin.toFixed(1);
  const efficiency = stats.efficiency;
  const oilPressure = stats.oilPressure.toFixed(1);

  const warnRpm = redlineRpm * 0.82;
  const isReady = rpm < 30;
  const isCritical =
    temp > THERMAL.warnTemp || rpm > redlineRpm || stats.knock > 15 || (stats.oilPressure < 0.8 && rpm > 350);
  const isWarning =
    !isCritical &&
    (temp > THERMAL.warnTemp - 12 || rpm > warnRpm || stats.knock > 0 || (stats.oilPressure < 1.4 && rpm > 350));
  const statusTone: Tone = isCritical ? 'red' : isWarning ? 'amber' : isReady ? 'slate' : 'emerald';
  const statusLabel = isCritical ? 'CRITICAL' : isWarning ? 'WATCH' : isReady ? 'READY' : 'STABLE';

  const rpmPercent = (rpm / Math.max(1, redlineRpm)) * 100;
  const tempPercent = ((temp - 30) / (THERMAL.seizeTemp - 30)) * 100;
  const oilPercent = (stats.oilPressure / 5.5) * 100;
  const pressurePercent = (stats.pressure / 75) * 100;
  const torquePercent = (stats.torque / 70) * 100;
  const trend = history.length > 6 ? rpm - (history.at(-6)?.rpm ?? rpm) : 0;
  const trendLabel = isReady ? '停机待命' : Math.abs(trend) < 35 ? '转速稳定' : trend > 0 ? `上升 +${Math.round(trend)} rpm` : `下降 ${Math.round(trend)} rpm`;

  const renderHistoryChart = () => {
    if (history.length < 2) {
      return (
        <div className="h-[168px] rounded-lg border border-slate-800 bg-slate-950 flex items-center justify-center text-xs text-slate-600 font-mono">
          等待稳定采样...
        </div>
      );
    }

    const width = 520;
    const height = 168;
    const padX = 28;
    const padTop = 18;
    const padBottom = 26;
    const chartHeight = height - padTop - padBottom;
    const baseline = height - padBottom;
    const maxRpm = Math.ceil(Math.max(redlineRpm, ...history.map((h) => h.rpm)) / 1000) * 1000;
    const maxPressure = Math.max(35, Math.ceil(Math.max(...history.map((h) => h.pressure)) / 10) * 10);

    const pathFor = (value: (pt: TelemetryPoint) => number, max: number): string =>
      history
        .map((pt, index) => {
          const x = padX + (index / Math.max(1, history.length - 1)) * (width - padX * 2);
          const y = baseline - (Math.max(0, value(pt)) / max) * chartHeight;
          return `${index === 0 ? 'M' : 'L'} ${x.toFixed(1)} ${y.toFixed(1)}`;
        })
        .join(' ');

    const rpmPath = pathFor((pt) => pt.rpm, maxRpm);
    const pressurePath = pathFor((pt) => pt.pressure, maxPressure);
    const areaEndX = padX + (width - padX * 2);
    const redlineY = baseline - (redlineRpm / maxRpm) * chartHeight;

    return (
      <div className="rounded-lg border border-slate-800 bg-slate-950 p-3">
        <div className="flex items-center justify-between gap-3 mb-2">
          <div className="min-w-0">
            <div className="text-xs font-semibold text-slate-300 font-mono flex items-center gap-1.5">
              <Activity className="w-3.5 h-3.5 text-emerald-400" />
              稳定趋势
            </div>
            <div className="text-[10px] text-slate-500 font-mono">{trendLabel}</div>
          </div>
          <div className="flex items-center gap-3 text-[10px] font-mono text-slate-500 shrink-0">
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-emerald-400" /> RPM</span>
            <span className="flex items-center gap-1"><span className="w-3 h-0.5 bg-violet-400" /> 峰值缸压</span>
          </div>
        </div>

        <svg width="100%" height="168" viewBox={`0 0 ${width} ${height}`} role="img" aria-label="RPM and cylinder pressure trend">
          <defs>
            <linearGradient id="stableRpmArea" x1="0" y1="0" x2="0" y2="1">
              <stop offset="0%" stopColor="#34d399" stopOpacity="0.22" />
              <stop offset="100%" stopColor="#34d399" stopOpacity="0" />
            </linearGradient>
          </defs>
          {[0.25, 0.5, 0.75].map((g) => (
            <line
              key={g}
              x1={padX}
              x2={width - padX}
              y1={baseline - g * chartHeight}
              y2={baseline - g * chartHeight}
              stroke="#1e293b"
              strokeWidth="1"
            />
          ))}
          <line x1={padX} x2={width - padX} y1={redlineY} y2={redlineY} stroke="#ef4444" strokeWidth="1" strokeDasharray="4 5" opacity="0.65" />
          <text x={width - padX} y={Math.max(11, redlineY - 4)} textAnchor="end" className="fill-red-400 text-[10px] font-mono">
            redline {redlineRpm}
          </text>
          <path d={`${rpmPath} L ${areaEndX} ${baseline} L ${padX} ${baseline} Z`} fill="url(#stableRpmArea)" />
          <path d={rpmPath} fill="none" stroke="#34d399" strokeWidth="2.3" strokeLinecap="round" strokeLinejoin="round" />
          <path d={pressurePath} fill="none" stroke="#a78bfa" strokeWidth="1.7" strokeLinecap="round" strokeLinejoin="round" opacity="0.9" />
          <text x={padX} y={height - 7} className="fill-slate-500 text-[10px] font-mono">last {history.length} samples</text>
          <text x={width - padX} y={height - 7} textAnchor="end" className="fill-slate-500 text-[10px] font-mono">
            {maxRpm} rpm / {maxPressure} bar
          </text>
        </svg>
      </div>
    );
  };

  return (
    <section className="flex flex-col space-y-4 bg-gray-900 border border-gray-800 p-5 rounded-lg shadow-xl w-full">
      <div className="flex items-center justify-between border-b border-gray-800 pb-3 gap-3">
        <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-300 flex items-center gap-1.5 font-display">
          <Gauge className="w-4 h-4 text-emerald-400" />
          调校仪表盘
        </h2>
        <span className={`text-[10px] px-2 py-1 rounded-md font-mono border ${toneClass[statusTone].bg} ${toneClass[statusTone].text} ${toneClass[statusTone].border}`}>
          {statusLabel}
        </span>
      </div>

      <div className={`rounded-lg border ${toneClass[statusTone].border} ${toneClass[statusTone].bg} p-4`}>
        <div className="grid grid-cols-1 md:grid-cols-[1.15fr_1fr] gap-4 items-end">
          <div>
            <div className="flex items-center justify-between gap-4">
              <div>
                <div className="text-[11px] text-slate-500 font-mono uppercase">Engine Speed</div>
                <div className={`font-mono text-[42px] leading-none font-bold tabular-nums ${toneClass[statusTone].text}`}>{rpm}</div>
              </div>
              <div className="text-right">
                <div className="text-[10px] text-slate-500 font-mono">红线</div>
                <div className="text-sm text-slate-300 font-mono">{redlineRpm} RPM</div>
              </div>
            </div>
            <div className="mt-3 h-2 rounded-full bg-slate-950 overflow-hidden">
              <div className={`h-full ${toneClass[statusTone].bar} transition-[width] duration-300`} style={{ width: `${clampPct(rpmPercent)}%` }} />
            </div>
          </div>

          <div className="grid grid-cols-2 gap-2 text-xs font-mono">
            <div className="rounded-md bg-slate-950/70 border border-slate-800 p-2">
              <div className="text-slate-500 text-[10px]">动力输出</div>
              <div className="text-slate-200 text-lg font-bold tabular-nums">{power}<span className="text-[10px] text-slate-500 ml-1">HP</span></div>
              <div className="text-slate-500 text-[10px]">{torque} Nm</div>
            </div>
            <div className="rounded-md bg-slate-950/70 border border-slate-800 p-2">
              <div className="text-slate-500 text-[10px]">燃烧质量</div>
              <div className="text-cyan-300 text-lg font-bold tabular-nums">{efficiency}<span className="text-[10px] text-slate-500 ml-1">%</span></div>
              <div className="text-slate-500 text-[10px]">{fuelFlow} ml/min</div>
            </div>
          </div>
        </div>
      </div>

      <div className="grid grid-cols-2 xl:grid-cols-5 gap-3">
        <MetricTile
          title="扭矩"
          value={torque}
          unit="Nm"
          caption={`${power} HP 输出`}
          icon={<Zap className="w-3.5 h-3.5" />}
          tone="sky"
          percent={torquePercent}
        />
        <MetricTile
          title="热管理"
          value={`${temp}`}
          unit="°C"
          caption={
            temp > THERMAL.warnTemp
              ? '过热！爆震极限下降'
              : temp > THERMAL.warnTemp - 12
              ? '接近热区'
              : temp < THERMAL.thermostatTemp - 8
              ? '暖机中'
              : '温度正常'
          }
          icon={<Thermometer className="w-3.5 h-3.5" />}
          tone={temp > THERMAL.warnTemp ? 'red' : temp > THERMAL.warnTemp - 12 ? 'amber' : 'orange'}
          percent={tempPercent}
        />
        <MetricTile
          title="爆震"
          value={`${Math.round(stats.knock)}`}
          unit="%"
          caption={stats.knock > 15 ? '正在敲缸，回退点火角' : stats.knock > 0 ? '轻微爆震' : '燃烧平稳'}
          icon={<AlertCircle className="w-3.5 h-3.5" />}
          tone={stats.knock > 15 ? 'red' : stats.knock > 0 ? 'amber' : 'emerald'}
          percent={stats.knock}
        />
        <MetricTile
          title="润滑"
          value={oilPressure}
          unit="bar"
          caption={rpm < 350 ? '曲轴未建压' : stats.oilPressure < 1.2 ? '油压偏低' : '油膜稳定'}
          icon={<Droplet className="w-3.5 h-3.5" />}
          tone={stats.oilPressure < 0.8 && rpm > 350 ? 'red' : stats.oilPressure < 1.4 && rpm > 350 ? 'amber' : 'sky'}
          percent={oilPercent}
        />
        <MetricTile
          title="峰值缸压"
          value={pressure}
          unit="bar"
          caption={`${efficiency}% 燃烧质量`}
          icon={<Waves className="w-3.5 h-3.5" />}
          tone="violet"
          percent={pressurePercent}
        />
      </div>

      {renderHistoryChart()}

      <div className="bg-slate-950 p-4 rounded-lg border border-slate-800 mt-1">
        <div className="flex items-center justify-between text-xs font-mono border-b border-slate-900 pb-2 mb-2">
          <span className="text-gray-400 flex items-center gap-1">
            <AlertCircle className="w-3.5 h-3.5 text-slate-500" />
            诊断记录
          </span>
          <button
            onClick={onClearLogs}
            className="text-[10px] text-slate-500 hover:text-slate-300 transition-colors font-mono hover:underline"
          >
            清空
          </button>
        </div>
        <div className="h-[90px] overflow-y-auto space-y-1 pr-1 font-mono text-[11px]">
          {logs.length === 0 ? (
            <div className="text-slate-600 text-center py-6">暂无诊断日志</div>
          ) : (
            logs.map((log) => {
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
                textClass = 'text-pink-300 font-semibold';
                badgeBg = 'bg-pink-950/50 text-pink-400 border-pink-900/40';
              }

              return (
                <div key={log.id} className="flex items-start gap-2 py-0.5 border-b border-slate-900/30">
                  <span className="text-[10px] text-slate-600 font-mono pt-0.5 shrink-0">{log.time}</span>
                  <span className={`text-[9px] px-1.5 rounded border leading-relaxed font-semibold uppercase shrink-0 ${badgeBg}`}>
                    {log.type}
                  </span>
                  <span className={`flex-1 break-words ${textClass}`}>{log.message}</span>
                </div>
              );
            })
          )}
        </div>
      </div>
    </section>
  );
}
