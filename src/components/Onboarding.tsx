/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 *
 * First-run guide.
 *
 * A newcomer facing a dozen sliders has no idea that the first move is "hold S".
 * This is a live checklist rather than a modal wall of text: each step ticks
 * itself off as the player actually does it, so the tutorial *is* the game.
 */

import { CheckCircle2, Circle, GraduationCap, X } from 'lucide-react';
import type { OnboardingProgress } from '../engine/onboarding';

const STEPS: { key: keyof OnboardingProgress; title: string; detail: string }[] = [
  { key: 'cranked', title: '按住 S 接合起动机', detail: '起动机会拖动曲轴。冷车可以先按 C 拉起阻风门。' },
  { key: 'idled', title: '松手，让它自己怠速', detail: '怠速旁通阀会接手 —— 不用一直踩着油门。' },
  { key: 'revved', title: '按住空格轰一脚油门', detail: '按住 Shift 再踩是「一脚到底」。听排气脉冲的变化。' },
  { key: 'dynoed', title: '按 D 跑一次测功机拉力', detail: '这是你的收入来源，也是唯一诚实的性能读数。' },
  { key: 'tuned', title: '去「ECU 标定」拖动点火曲线', detail: '红线是爆震极限，金线是最大扭矩点。目标是贴着红线下方走。' },
  { key: 'shopped', title: '去「车间」买第一个零件', detail: '每个零件都会写清楚它给你什么、拿走什么。' },
];

interface OnboardingProps {
  progress: OnboardingProgress;
  onDismiss: () => void;
}

export default function Onboarding({ progress, onDismiss }: OnboardingProps) {
  const done = STEPS.filter((s) => progress[s.key]).length;
  const next = STEPS.find((s) => !progress[s.key]);

  return (
    <div className="bg-gradient-to-br from-sky-950/60 to-slate-900 border border-sky-900/50 rounded-2xl p-4 w-full">
      <div className="flex items-start justify-between gap-2 mb-3">
        <div className="flex items-center gap-2">
          <GraduationCap className="w-4 h-4 text-sky-400" />
          <span className="text-[12px] font-semibold text-sky-200 font-display">上手指引</span>
          <span className="text-[10px] font-mono text-sky-500/80">
            {done}/{STEPS.length}
          </span>
        </div>
        <button
          onClick={onDismiss}
          className="text-slate-500 hover:text-slate-300 shrink-0 cursor-pointer"
          aria-label="关闭指引"
        >
          <X className="w-4 h-4" />
        </button>
      </div>

      <div className="space-y-1.5">
        {STEPS.map((step) => {
          const complete = progress[step.key];
          const isNext = step.key === next?.key;
          return (
            <div
              key={step.key}
              className={`flex items-start gap-2 rounded-lg px-2 py-1.5 ${
                isNext ? 'bg-sky-950/50 border border-sky-800/40' : ''
              }`}
            >
              {complete ? (
                <CheckCircle2 className="w-3.5 h-3.5 text-emerald-400 shrink-0 mt-0.5" />
              ) : (
                <Circle className={`w-3.5 h-3.5 shrink-0 mt-0.5 ${isNext ? 'text-sky-400' : 'text-slate-700'}`} />
              )}
              <div className="min-w-0">
                <div
                  className={`text-[11px] font-mono ${
                    complete ? 'text-slate-600 line-through' : isNext ? 'text-sky-200 font-semibold' : 'text-slate-400'
                  }`}
                >
                  {step.title}
                </div>
                {isNext && <div className="text-[9.5px] text-sky-400/70 mt-0.5 leading-relaxed">{step.detail}</div>}
              </div>
            </div>
          );
        })}
      </div>

      {done === STEPS.length && (
        <div className="mt-3 text-[10px] font-mono text-emerald-400 leading-relaxed">
          全部走完了 —— 循环就是这样：接合约 → 改装 → 标定 → 拉力 → 拿钱 → 再改装。
          <button onClick={onDismiss} className="underline ml-1 hover:text-emerald-300 cursor-pointer">
            收起指引
          </button>
        </div>
      )}
    </div>
  );
}
