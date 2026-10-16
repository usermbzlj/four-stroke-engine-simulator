/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { HeartPulse } from 'lucide-react';

const STROKES: { name: string; color: string; text: string }[] = [
  {
    name: '进气',
    color: 'text-blue-400',
    text: '活塞下行、进气门开启，吸入蓝色混合气。进气量 = 节气门开度 × 容积效率（凸轮决定曲线形状）。',
  },
  {
    name: '压缩',
    color: 'text-amber-400',
    text: '气门关闭，按多变过程压缩。压缩比越高热效率越高，但抗爆震余量越小。',
  },
  {
    name: '做功',
    color: 'text-red-400',
    text: '火花塞按 ECU 曲线跳火。点火角越接近 MBT 越有力，一旦越过爆震极限就开始敲缸。',
  },
  {
    name: '排气',
    color: 'text-slate-300',
    text: '活塞上行排出废气。缸压、温度、爆震与磨损全部逐帧积分，不是贴图。',
  },
];

export default function CycleExplainer() {
  return (
    <section className="bg-slate-900/30 border border-slate-900 rounded-xl p-4 text-xs text-slate-400 leading-relaxed">
      <h3 className="font-semibold text-slate-300 font-mono flex items-center gap-1.5 mb-2">
        <HeartPulse className="w-3.5 h-3.5 text-sky-400" />
        四冲程循环 · 你在剖面图里看到的东西
      </h3>
      <ul className="list-disc list-inside space-y-1.5 pl-1">
        {STROKES.map((stroke) => (
          <li key={stroke.name}>
            <strong className={`${stroke.color} font-mono`}>{stroke.name}：</strong>
            {stroke.text}
          </li>
        ))}
      </ul>
    </section>
  );
}
