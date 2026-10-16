/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { Hammer } from 'lucide-react';
import { displacementCc } from '../engine';
import { EngineState, type EngineSpec } from '../types';

const STATE_RIBBON: Record<EngineState, { label: string; className: string; dot?: string }> = {
  [EngineState.RUNNING]: { label: '运转 RUNNING', className: 'text-emerald-400 font-extrabold', dot: 'bg-emerald-500 animate-pulse' },
  [EngineState.STARTING]: { label: '⚡ 起动 CRANKING', className: 'text-amber-400 font-bold animate-pulse' },
  [EngineState.STALLED]: { label: '● 熄火 STALLED', className: 'text-slate-500' },
  [EngineState.OFF]: { label: '● 停机 READY', className: 'text-slate-400' },
  [EngineState.SEIZED]: { label: '抱死 SEIZED', className: 'text-orange-500 font-bold', dot: 'bg-orange-500' },
  [EngineState.EXPLODED]: { label: '💥 爆炸 EXPLODED', className: 'text-pink-500 font-extrabold' },
};

interface AppHeaderProps {
  spec: EngineSpec;
  engineState: EngineState;
  rpm: number;
}

export default function AppHeader({ spec, engineState, rpm }: AppHeaderProps) {
  const ribbon = STATE_RIBBON[engineState];

  return (
    <header className="w-full max-w-[1600px] border-b border-slate-900 bg-slate-900/40 backdrop-blur py-4 px-4 md:px-8 flex flex-col lg:flex-row lg:items-center justify-between gap-3">
      <div className="flex items-center gap-3">
        <div className="p-2.5 bg-gradient-to-tr from-orange-600 to-amber-500 rounded-xl shadow-md flex items-center justify-center shrink-0">
          <Hammer className="w-5 h-5 text-slate-950" />
        </div>
        <div className="flex flex-col min-w-0">
          <h1 className="text-lg font-bold tracking-tight text-white font-display leading-none">
            四冲程发动机 · 改装车间
          </h1>
          <p className="text-[11px] text-slate-400 font-mono tracking-wide mt-1 truncate">
            {spec.name} · {Math.round(displacementCc(spec))}cc · CR {spec.compressionRatio.toFixed(1)} · 红线{' '}
            {spec.redlineRpm}
            {spec.boostBar > 0 && ` · 增压 ${spec.boostBar.toFixed(2)}bar`}
          </p>
        </div>
      </div>

      <div className="flex items-center gap-2 bg-slate-950 px-4 py-2 border border-slate-800 rounded-xl font-mono text-xs shadow-inner shrink-0">
        <span className="text-slate-500 text-[10px]">系统状态:</span>
        <span className={`flex items-center gap-1.5 ${ribbon.className}`}>
          {ribbon.dot && <span className={`w-2 h-2 rounded-full ${ribbon.dot}`} />}
          {ribbon.label}
          {engineState === EngineState.RUNNING && ` (${Math.round(rpm)} RPM)`}
        </span>
      </div>
    </header>
  );
}
