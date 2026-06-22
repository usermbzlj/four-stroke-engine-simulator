/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Challenge, ChallengeProgress, GarageState, EngineSpec, TunePreset } from '../types';
import { Trophy, Target, Coins, Timer, Cpu, Cog, CheckCircle2, XCircle, Save } from 'lucide-react';

interface ChallengePanelProps {
  challenges: Challenge[];
  progress: ChallengeProgress;
  garage: GarageState;
  specs: EngineSpec[];
  currentSpecId: string;
  presets: TunePreset[];
  onStartChallenge: (id: Challenge['id']) => void;
  onStopChallenge: () => void;
  onSwapSpec: (id: string) => void;
  onApplyPreset: (p: TunePreset) => void;
  onSavePreset: () => void;
}

export default function ChallengePanel({
  challenges,
  progress,
  garage,
  specs,
  currentSpecId,
  presets,
  onStartChallenge,
  onStopChallenge,
  onSwapSpec,
  onApplyPreset,
  onSavePreset,
}: ChallengePanelProps) {
  const pct =
    progress.targetValue > 0 ? Math.min(100, Math.round((progress.metricValue / progress.targetValue) * 100)) : 0;

  return (
    <div className="flex flex-col space-y-4 bg-gray-900 border border-gray-800 p-5 rounded-2xl shadow-xl w-full">
      <div className="flex items-center justify-between border-b border-gray-800 pb-3">
        <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-300 flex items-center gap-1.5 font-display">
          <Trophy className="w-4 h-4 text-amber-400" />
          挑战任务 · 调校车库
        </h2>
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span className="flex items-center gap-1 text-amber-400" title="积分">
            <Target className="w-3.5 h-3.5" />
            {Math.round(garage.score)}
          </span>
          <span className="flex items-center gap-1 text-emerald-400" title="信用点">
            <Coins className="w-3.5 h-3.5" />
            {Math.round(garage.credits)}
          </span>
          <span className="flex items-center gap-1 text-slate-400" title="累计运转工时">
            <Timer className="w-3.5 h-3.5" />
            {garage.runtimeHours.toFixed(2)}h
          </span>
        </div>
      </div>

      {/* Engine spec swapper */}
      <div className="space-y-2">
        <div className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
          <Cog className="w-3.5 h-3.5 text-sky-400" />
          发动机平台 (Engine Build) — 切换将彻底重置发动机
        </div>
        <div className="grid grid-cols-1 gap-2">
          {specs.map((s) => {
            const active = s.id === currentSpecId;
            return (
              <button
                key={s.id}
                onClick={() => onSwapSpec(s.id)}
                className={`text-left p-2.5 rounded-lg border transition-all ${
                  active
                    ? 'bg-sky-950/40 border-sky-700/50 ring-1 ring-sky-700/40'
                    : 'bg-slate-950/60 border-slate-800 hover:border-slate-700 cursor-pointer'
                }`}
              >
                <div className="flex items-center justify-between">
                  <span className={`text-[12px] font-semibold ${active ? 'text-sky-300' : 'text-slate-300'}`}>
                    {s.name}
                  </span>
                  {active && <CheckCircle2 className="w-3.5 h-3.5 text-sky-400" />}
                </div>
                <div className="text-[9.5px] text-slate-500 mt-0.5">{s.description}</div>
                <div className="flex gap-3 mt-1 text-[9px] font-mono text-slate-500">
                  <span>红线 {s.redlineRpm}</span>
                  <span>峰扭 {s.peakTorque}Nm</span>
                  <span>CR {s.compressionRatio}</span>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Active challenge live bar */}
      {progress.active && (
        <div
          className={`p-3 rounded-xl border ${
            progress.status === 'passed'
              ? 'bg-emerald-950/30 border-emerald-800/40'
              : progress.status === 'failed'
              ? 'bg-red-950/30 border-red-800/40'
              : 'bg-slate-950 border-slate-800'
          }`}
        >
          <div className="flex items-center justify-between mb-1.5">
            <span className="text-[11px] font-mono text-slate-300 flex items-center gap-1">
              {progress.status === 'passed' ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400" />
              ) : progress.status === 'failed' ? (
                <XCircle className="w-3.5 h-3.5 text-red-400" />
              ) : (
                <Timer className="w-3.5 h-3.5 text-amber-400 animate-pulse" />
              )}
              {progress.metricLabel}
            </span>
            <span className="text-[11px] font-mono font-bold text-slate-200">
              {progress.metricValue.toFixed(1)} / {progress.targetValue.toFixed(1)}
            </span>
          </div>
          <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                progress.status === 'passed' ? 'bg-emerald-500' : progress.status === 'failed' ? 'bg-red-500' : 'bg-amber-500'
              }`}
              style={{ width: `${pct}%` }}
            />
          </div>
          <div className="flex items-center justify-between mt-1.5">
            <span className="text-[10px] font-mono text-slate-500">{progress.message}</span>
            <button
              onClick={onStopChallenge}
              className="text-[10px] font-mono text-slate-400 hover:text-white underline"
            >
              {progress.status === 'running' ? '放弃' : '关闭'}
            </button>
          </div>
        </div>
      )}

      {/* Challenge list */}
      <div className="grid grid-cols-1 gap-2">
        {challenges.map((c) => {
          const isActive = progress.active === c.id;
          const best = progress.best[c.id];
          return (
            <div
              key={c.id}
              className="flex items-center justify-between p-2.5 rounded-lg bg-slate-950/60 border border-slate-900"
            >
              <div className="flex flex-col">
                <span className="text-[12px] font-semibold text-slate-300">{c.name}</span>
                <span className="text-[9.5px] text-slate-500">{c.subtitle}</span>
                <span className="text-[9px] text-slate-600 font-mono mt-0.5">
                  目标: {c.goal}
                  {best > 0 && <span className="text-amber-500/80 ml-2">最佳 {best.toFixed(1)}</span>}
                </span>
              </div>
              <button
                onClick={() => onStartChallenge(c.id)}
                disabled={isActive && progress.status === 'running'}
                className={`text-[10px] font-mono px-2.5 py-1.5 rounded-lg border transition-all whitespace-nowrap ${
                  isActive && progress.status === 'running'
                    ? 'bg-amber-950/30 border-amber-800/40 text-amber-500 cursor-default'
                    : 'bg-slate-900 border-slate-800 hover:border-amber-700/50 text-slate-300 hover:text-amber-400 cursor-pointer active:scale-95'
                }`}
              >
                {isActive && progress.status === 'running' ? '进行中' : '开始'}
              </button>
            </div>
          );
        })}
      </div>

      {/* Tune presets */}
      <div className="border-t border-slate-800/80 pt-3 space-y-2">
        <div className="flex items-center justify-between">
          <span className="flex items-center gap-1.5 text-[11px] font-mono text-slate-400">
            <Cpu className="w-3.5 h-3.5 text-indigo-400" />
            ECU 调校预设
          </span>
          <button
            onClick={onSavePreset}
            className="text-[10px] font-mono text-indigo-400 hover:text-indigo-300 flex items-center gap-1 hover:underline"
          >
            <Save className="w-3 h-3" />
            保存当前
          </button>
        </div>
        <div className="flex flex-wrap gap-2">
          {presets.length === 0 ? (
            <span className="text-[10px] text-slate-600 font-mono">暂无预设，调好参数后点击“保存当前”。</span>
          ) : (
            presets.map((p, i) => (
              <button
                key={i}
                onClick={() => onApplyPreset(p)}
                className="text-[10px] font-mono px-2 py-1 rounded bg-indigo-950/40 border border-indigo-900/40 text-indigo-300 hover:bg-indigo-900/50 cursor-pointer active:scale-95"
              >
                {p.name}
              </button>
            ))
          )}
        </div>
      </div>
    </div>
  );
}
