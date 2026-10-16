/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * A running contract stays visible from every tab — otherwise you cannot watch
 * your progress while operating the engine.
 */

import type { ContractRun } from '../types';

interface ContractBannerProps {
  run: ContractRun;
  onOpen: () => void;
}

export default function ContractBanner({ run, onOpen }: ContractBannerProps) {
  const progress = run.targetValue > 0 ? Math.min(100, (run.metricValue / run.targetValue) * 100) : 0;

  return (
    <button
      onClick={onOpen}
      className="w-full text-left bg-sky-950/40 border border-sky-900/50 rounded-xl px-3 py-2 cursor-pointer hover:border-sky-700/60"
    >
      <div className="flex items-center justify-between gap-2 text-[10px] font-mono">
        <span className="text-sky-300 truncate">合约进行中 · {run.metricLabel}</span>
        <span className="text-slate-200 font-bold tabular-nums shrink-0">
          {run.metricValue.toFixed(1)} / {run.targetValue.toFixed(1)}
        </span>
      </div>
      <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden mt-1.5">
        <div className="h-full bg-sky-500 transition-all" style={{ width: `${progress}%` }} />
      </div>
      <div className="text-[9px] font-mono text-sky-400/70 mt-1">{run.hint || run.message}</div>
    </button>
  );
}
