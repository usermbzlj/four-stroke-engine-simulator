/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useMemo, useState } from 'react';
import type { Contract, ContractRun, GarageState } from '../types';
import { CONTRACTS, contractStars, isLocked, lowerIsBetter, visibleContracts } from '../engine';
import { Coins, Lock, RotateCcw, Star, Target, Timer, Trophy } from 'lucide-react';

interface CareerPanelProps {
  garage: GarageState;
  run: ContractRun;
  onStart: (id: string) => void;
  onAbort: () => void;
  onDismiss: () => void;
  onResetCareer: () => void;
}

function Stars({ count }: { count: number }) {
  return (
    <span className="flex items-center gap-0.5">
      {[0, 1, 2].map((i) => (
        <Star
          key={i}
          className={`w-3 h-3 ${i < count ? 'text-amber-400 fill-amber-400' : 'text-slate-700'}`}
        />
      ))}
    </span>
  );
}

const formatMetric = (contract: Contract, value: number): string => {
  if (contract.kind === 'dyno') return `${value.toFixed(1)} HP`;
  if (contract.kind === 'thermal') return `${value.toFixed(0)} °C`;
  return `${value.toFixed(1)} s`;
};

export default function CareerPanel({ garage, run, onStart, onAbort, onDismiss, onResetCareer }: CareerPanelProps) {
  const [confirmReset, setConfirmReset] = useState(false);

  const visible = useMemo(() => visibleContracts(garage), [garage]);
  const activeContract = useMemo(() => CONTRACTS.find((c) => c.id === run.id), [run.id]);

  const tiers = useMemo<number[]>(() => {
    const seen: number[] = [];
    for (const c of visible) if (!seen.includes(c.tier)) seen.push(c.tier);
    return seen;
  }, [visible]);

  const totalStars = useMemo(
    () => CONTRACTS.reduce((sum, c) => sum + contractStars(garage, c), 0),
    [garage]
  );

  // Progress is measured toward the pass mark, in whichever direction counts.
  const progressPct = (() => {
    if (!activeContract) return 0;
    if (lowerIsBetter(activeContract.kind)) {
      if (run.metricValue <= 0) return 0;
      return Math.max(0, Math.min(100, (1 - run.metricValue / activeContract.target) * 100));
    }
    return run.targetValue > 0 ? Math.min(100, (run.metricValue / run.targetValue) * 100) : 0;
  })();

  return (
    <div className="flex flex-col gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl w-full">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3 gap-2 flex-wrap">
        <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-300 flex items-center gap-1.5 font-display">
          <Trophy className="w-4 h-4 text-amber-400" />
          生涯 · 合约
        </h2>
        <div className="flex items-center gap-3 font-mono text-[11px]">
          <span className="flex items-center gap-1 text-amber-400" title="累计星数">
            <Star className="w-3.5 h-3.5" />
            {totalStars}/{CONTRACTS.length * 3}
          </span>
          <span className="flex items-center gap-1 text-sky-400" title="积分">
            <Target className="w-3.5 h-3.5" />
            {Math.round(garage.score)}
          </span>
          <span className="flex items-center gap-1 text-emerald-400" title="信用点">
            <Coins className="w-3.5 h-3.5" />
            {Math.floor(garage.credits)}
          </span>
          <span className="flex items-center gap-1 text-slate-400" title="累计运转工时">
            <Timer className="w-3.5 h-3.5" />
            {garage.runtimeHours.toFixed(2)}h
          </span>
        </div>
      </div>

      {/* Active run */}
      {activeContract && run.status !== 'idle' && (
        <div
          className={`p-3 rounded-xl border ${
            run.status === 'passed'
              ? 'bg-emerald-950/30 border-emerald-800/40'
              : run.status === 'failed'
              ? 'bg-red-950/30 border-red-800/40'
              : 'bg-slate-950 border-sky-900/50'
          }`}
        >
          <div className="flex items-center justify-between gap-2 mb-1">
            <span className="text-[12px] font-semibold text-slate-200">{activeContract.name}</span>
            <span className="text-[11px] font-mono font-bold text-slate-200 tabular-nums">
              {formatMetric(activeContract, run.metricValue)}
              <span className="text-slate-500"> / {formatMetric(activeContract, run.targetValue)}</span>
            </span>
          </div>
          <div className="text-[10px] font-mono text-slate-500 mb-1.5">{run.metricLabel}</div>

          <div className="w-full h-1.5 bg-slate-900 rounded-full overflow-hidden">
            <div
              className={`h-full transition-all ${
                run.status === 'passed' ? 'bg-emerald-500' : run.status === 'failed' ? 'bg-red-500' : 'bg-sky-500'
              }`}
              style={{ width: `${progressPct}%` }}
            />
          </div>

          <div className="flex items-center justify-between mt-2 gap-2">
            <span className="text-[10px] font-mono text-slate-400">
              {run.status === 'running' ? run.hint || run.message : run.message}
            </span>
            <button
              onClick={run.status === 'running' ? onAbort : onDismiss}
              className="text-[10px] font-mono text-slate-400 hover:text-white underline shrink-0 cursor-pointer"
            >
              {run.status === 'running' ? '放弃 (Esc)' : '关闭'}
            </button>
          </div>

          {run.status === 'running' && (
            <div className="text-[9px] font-mono text-slate-600 mt-1">
              满星目标 {formatMetric(activeContract, activeContract.stretch)} · 已用时 {run.elapsed.toFixed(1)}s
            </div>
          )}
        </div>
      )}

      {/* Ladder */}
      <div className="space-y-3">
        {tiers.map((tier) => (
          <div key={tier} className="space-y-1.5">
            <div className="flex items-center gap-2">
              <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">车间等级 T{tier}</span>
              <span className="flex-1 h-px bg-slate-800" />
              {tier > garage.tier && (
                <span className="text-[9px] font-mono text-slate-600 flex items-center gap-1">
                  <Lock className="w-3 h-3" />
                  完成 T{garage.tier} 任一合约即解锁
                </span>
              )}
            </div>

            {visible
              .filter((c) => c.tier === tier)
              .map((c) => {
                const locked = isLocked(c, garage);
                const stars = contractStars(garage, c);
                const best = garage.best[c.id];
                const isActive = run.id === c.id && run.status === 'running';

                return (
                  <div
                    key={c.id}
                    className={`p-2.5 rounded-lg border ${
                      locked ? 'bg-slate-950/40 border-slate-900 opacity-60' : 'bg-slate-950/60 border-slate-800'
                    }`}
                  >
                    <div className="flex items-start justify-between gap-2">
                      <div className="min-w-0">
                        <div className="flex items-center gap-2">
                          <span className="text-[12px] font-semibold text-slate-300">{c.name}</span>
                          <Stars count={stars} />
                        </div>
                        <p className="text-[9.5px] text-slate-500 mt-0.5 leading-relaxed">{c.brief}</p>
                        <p className="text-[9.5px] text-sky-400/70 mt-0.5 leading-relaxed">{c.how}</p>
                        <div className="flex flex-wrap gap-x-3 gap-y-0.5 mt-1 text-[9px] font-mono text-slate-600">
                          <span>及格 {formatMetric(c, c.target)}</span>
                          <span>满星 {formatMetric(c, c.stretch)}</span>
                          <span className="text-emerald-600/80">奖励 ≤{Math.round(c.reward * 1.15)} CR</span>
                          {best !== undefined && <span className="text-amber-500/80">最佳 {formatMetric(c, best)}</span>}
                          {c.unlocks.length > 0 && stars === 0 && <span className="text-violet-400/80">🎁 附赠零件</span>}
                        </div>
                      </div>

                      <button
                        onClick={() => onStart(c.id)}
                        disabled={locked || isActive}
                        className={`shrink-0 text-[10px] font-mono px-2.5 py-1.5 rounded-lg border transition-colors ${
                          locked
                            ? 'bg-slate-950 border-slate-900 text-slate-600 cursor-not-allowed'
                            : isActive
                            ? 'bg-sky-950/40 border-sky-800/50 text-sky-400 cursor-default'
                            : 'bg-slate-900 border-slate-800 text-slate-300 hover:border-amber-700/60 hover:text-amber-400 cursor-pointer'
                        }`}
                      >
                        {locked ? '未解锁' : isActive ? '进行中' : stars > 0 ? '重跑' : '接下'}
                      </button>
                    </div>
                  </div>
                );
              })}
          </div>
        ))}
      </div>

      <div className="border-t border-slate-800 pt-3 flex items-center justify-between">
        <span className="text-[9px] font-mono text-slate-600">进度自动保存在本地浏览器。</span>
        {confirmReset ? (
          <span className="flex items-center gap-2">
            <button
              onClick={() => {
                onResetCareer();
                setConfirmReset(false);
              }}
              className="text-[10px] font-mono text-red-400 hover:text-red-300 underline cursor-pointer"
            >
              确认清空
            </button>
            <button
              onClick={() => setConfirmReset(false)}
              className="text-[10px] font-mono text-slate-500 hover:text-slate-300 cursor-pointer"
            >
              取消
            </button>
          </span>
        ) : (
          <button
            onClick={() => setConfirmReset(true)}
            className="text-[10px] font-mono text-slate-600 hover:text-red-400 flex items-center gap-1 cursor-pointer"
          >
            <RotateCcw className="w-3 h-3" />
            重开生涯
          </button>
        )}
      </div>
    </div>
  );
}
