/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { ComponentWear, EngineState } from '../types';
import { PenTool, Wrench, HeartPulse, RefreshCw } from 'lucide-react';

interface WearTrackerProps {
  wear: ComponentWear;
  state: EngineState;
  temp: number;
  rpm: number;
  oilLevel: number;
  oilPressure: number;
  credits: number;
  onRepairComponent: (key: keyof ComponentWear) => void;
  onCompleteRebuild: () => void;
  onFlushOil: () => void;
}

export default function WearTracker({
  wear,
  state,
  temp,
  rpm,
  oilLevel,
  oilPressure,
  credits,
  onRepairComponent,
  onCompleteRebuild,
  onFlushOil
}: WearTrackerProps) {

  // Dynamic wear level descriptions and color states
  const getStatusDetails = (val: number) => {
    if (val > 80) return { label: '良好 Best', color: 'text-emerald-400 bg-emerald-950/45 border-emerald-900/30 font-medium' };
    if (val > 50) return { label: '正常 Norm', color: 'text-blue-400 bg-blue-950/40 border-blue-900/25' };
    if (val > 25) return { label: '警告 Warn', color: 'text-amber-400 bg-amber-950/45 border-amber-900/30' };
    if (val > 0) return { label: '危急 Crit', color: 'text-red-400 bg-red-950/50 border-red-900/40 animate-pulse font-semibold' };
    return { label: '报废 Dead', color: 'text-pink-500 bg-pink-950/50 border-pink-900/50 font-bold' };
  };

  // Stress load estimation based on current physical variables
  const thermalStress = Math.min(100, Math.round((temp / 130) * 100));
  const kineticStress = Math.min(100, Math.round((rpm / 7500) * 100));
  const frictionSevere = oilLevel < 35 ? Math.round((35 - oilLevel) * 2.85) : 0;

  const componentSchema = [
    { key: 'pistonRings' as keyof ComponentWear, name: '活塞压缩环 (Piston Rings)', desc: '密封燃烧室，防止漏气及烧机油' },
    { key: 'cylinderWall' as keyof ComponentWear, name: '气缸内壁 (Cylinder Wall)', desc: '气缸摩擦主表面，过热易拉缸' },
    { key: 'conrodBearings' as keyof ComponentWear, name: '连杆大头轴瓦 (Conrod Bearings)', desc: '连接曲轴承力件，磨损引起拉瓦爆震' },
    { key: 'crankshaftJournal' as keyof ComponentWear, name: '主轴颈与轴承 (Crankshaft Journals)', desc: '支撑旋转主力轴，阻力增大的首因' },
    { key: 'sparkPlug' as keyof ComponentWear, name: '火花塞电极 (Spark Plug)', desc: '提供点火能量，间隙过大导致缺火熄火' },
    { key: 'valves' as keyof ComponentWear, name: '气门与密封圈 (Valve Seals)', desc: '进排气启闭密封，漏气时动力极速下降' },
  ];

  return (
    <div className="flex flex-col space-y-4 bg-gray-900 border border-gray-800 p-5 rounded-2xl shadow-xl w-full">
      <div className="flex items-center justify-between border-b border-gray-800 pb-3">
        <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-300 flex items-center gap-1.5 font-display">
          <HeartPulse className="w-4 h-4 text-emerald-400" />
          部件磨损诊断与大修系统
        </h2>

        <div className="flex items-center gap-2">
          <span className="text-[10px] font-mono text-emerald-400 bg-emerald-950/40 border border-emerald-900/30 px-2 py-1 rounded">
            {Math.round(credits)} CR
          </span>
          {/* Rapid repair oil */}
          <button
            onClick={onFlushOil}
            className="text-[10px] font-mono bg-amber-500/10 border border-amber-500/30 hover:bg-amber-500/20 text-amber-400 px-2 py-1 rounded transition-colors cursor-pointer flex items-center gap-1"
          >
            <RefreshCw className="w-3 h-3 animate-spin" style={{ animationDuration: '6s' }} />
            更换机油
          </button>
        </div>
      </div>

      {/* STRESS INDEX METERS */}
      <div className="grid grid-cols-2 md:grid-cols-4 gap-3 bg-slate-950 p-3 rounded-xl border border-slate-900">
        <div className="flex flex-col">
          <span className="text-[10px] text-gray-500 font-mono">水温负载 (Thermal)</span>
          <span className={`text-xs font-bold font-mono mt-0.5 ${thermalStress > 85 ? 'text-red-500' : thermalStress > 60 ? 'text-amber-500' : 'text-slate-300'}`}>
            {thermalStress}%
          </span>
          <div className="w-full h-1 bg-slate-900 rounded-full mt-1.5 overflow-hidden">
            <div className="h-full bg-orange-500" style={{ width: `${thermalStress}%` }}></div>
          </div>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] text-gray-500 font-mono">转速拉力 (Kinetic)</span>
          <span className={`text-xs font-bold font-mono mt-0.5 ${kineticStress > 85 ? 'text-red-500 animate-pulse' : kineticStress > 60 ? 'text-amber-500' : 'text-slate-300'}`}>
            {kineticStress}%
          </span>
          <div className="w-full h-1 bg-slate-900 rounded-full mt-1.5 overflow-hidden">
            <div className="h-full bg-emerald-500" style={{ width: `${kineticStress}%` }}></div>
          </div>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] text-gray-500 font-mono">干摩擦 (Friction)</span>
          <span className={`text-xs font-bold font-mono mt-0.5 ${frictionSevere > 40 ? 'text-red-500 animate-pulse' : frictionSevere > 0 ? 'text-amber-500' : 'text-slate-300'}`}>
            {frictionSevere}%
          </span>
          <div className="w-full h-1 bg-slate-900 rounded-full mt-1.5 overflow-hidden">
            <div className="h-full bg-yellow-500" style={{ width: `${frictionSevere}%` }}></div>
          </div>
        </div>

        <div className="flex flex-col">
          <span className="text-[10px] text-gray-500 font-mono">机油压力 (Oil PSI)</span>
          <span className={`text-xs font-bold font-mono mt-0.5 ${oilPressure < 0.8 && rpm > 200 ? 'text-red-500 animate-pulse' : oilPressure < 1.5 ? 'text-amber-500' : 'text-sky-300'}`}>
            {oilPressure.toFixed(1)} bar
          </span>
          <div className="w-full h-1 bg-slate-900 rounded-full mt-1.5 overflow-hidden">
            <div className={`h-full ${oilPressure < 0.8 ? 'bg-red-500' : 'bg-sky-400'}`} style={{ width: `${Math.min(100, (oilPressure / 6) * 100)}%` }}></div>
          </div>
        </div>
      </div>

      {/* COMPONENT HEALTH GAUGES LIST */}
      <div className="space-y-3 max-h-[178px] overflow-y-auto pr-1">
        {componentSchema.map((comp) => {
          const val = Math.round(wear[comp.key]);
          const detail = getStatusDetails(val);

          return (
            <div key={comp.key} className="flex flex-col space-y-1.5 p-2 rounded-lg bg-slate-950/60 border border-slate-900 transition-all hover:border-slate-800">
              <div className="flex items-center justify-between">
                <div className="flex flex-col">
                  <span className="text-[11.5px] font-semibold text-slate-300">{comp.name}</span>
                  <span className="text-[9px] text-gray-500">{comp.desc}</span>
                </div>
                <div className="flex items-center space-x-2">
                  <span className={`text-[9px] font-mono border px-1.5 py-0.5 rounded leading-none ${detail.color}`}>
                    {detail.label}
                  </span>
                  <span className="text-[11px] font-bold font-mono w-7 text-right text-slate-200">
                    {val}%
                  </span>
                  <button
                    onClick={() => onRepairComponent(comp.key)}
                    className="px-1.5 py-1 border border-slate-800 bg-slate-900 hover:bg-slate-800 text-slate-400 hover:text-sky-400 rounded transition-colors text-[9px] flex items-center justify-center gap-0.5 font-mono cursor-pointer"
                    title="维护置换 (60 CR)"
                  >
                    <Wrench className="w-3 h-3" />
                    <span>60</span>
                  </button>
                </div>
              </div>

              {/* Progress bar */}
              <div className="w-full h-1 bg-slate-900 rounded-full overflow-hidden">
                <div
                  className={`h-full transition-all duration-300 ${
                    val > 70 ? 'bg-emerald-500' : val > 40 ? 'bg-blue-500' : val > 15 ? 'bg-amber-500' : 'bg-red-500'
                  }`}
                  style={{ width: `${val}%` }}
                ></div>
              </div>
            </div>
          );
        })}
      </div>

      {/* TOTAL MASTER REBUILD ACTION */}
      <div className="border-t border-slate-800/80 pt-3">
        <button
          onClick={onCompleteRebuild}
          className={`w-full py-2.5 px-4 rounded-xl flex items-center justify-center space-x-2 font-display font-bold text-xs border cursor-pointer select-none transition-all duration-300 active:scale-[0.99] ${
            state === EngineState.EXPLODED
              ? 'bg-red-600 hover:bg-red-500 text-white border-red-700 shadow-lg animate-pulse'
              : state === EngineState.SEIZED
              ? 'bg-amber-600 hover:bg-amber-500 text-white border-amber-700 shadow-md'
              : 'bg-emerald-600/15 hover:bg-emerald-500/20 text-emerald-400 border-emerald-900/40'
          }`}
        >
          <PenTool className="w-4 h-4" />
          <span>
            {state === EngineState.EXPLODED
              ? '重建发动机 (爆缸免费重建)'
              : state === EngineState.SEIZED
              ? '疏通拉缸抱死 (免费重建)'
              : '完整总合大修 (Full Overhaul · 320 CR)'}
          </span>
        </button>
      </div>
    </div>
  );
}
