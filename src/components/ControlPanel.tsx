/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { EngineState, EngineParameters } from '../types';
import { MAX_THROTTLE } from '../utils/enginePhysics';
import { Play, Square, Settings, Volume2, VolumeX, Flame, RotateCcw } from 'lucide-react';

interface ControlPanelProps {
  state: EngineState;
  params: EngineParameters;
  volume: number;
  isMuted: boolean;
  redlineRpm: number;
  destructRpm: number;
  onUpdateParams: (newParams: Partial<EngineParameters>) => void;
  onStartHold: (active: boolean) => void;
  onCutoffToggle: () => void;
  onSoundVolumeChange: (vol: number) => void;
  onSoundMuteToggle: () => void;
  onTriggerSpark: () => void;
  onResetParams: () => void;
}

export default function ControlPanel({
  state,
  params,
  volume,
  isMuted,
  redlineRpm,
  destructRpm,
  onUpdateParams,
  onStartHold,
  onCutoffToggle,
  onSoundVolumeChange,
  onSoundMuteToggle,
  onTriggerSpark,
  onResetParams
}: ControlPanelProps) {

  // Diagnostic warnings
  const isDead = state === EngineState.EXPLODED || state === EngineState.SEIZED;
  const isRunning = state === EngineState.RUNNING;

  const handleStartMouseDown = () => {
    if (isDead) return;
    onStartHold(true);
  };

  const handleStartMouseUp = () => {
    onStartHold(false);
  };

  return (
    <div className="flex flex-col space-y-4 bg-gray-900 border border-gray-800 p-5 rounded-2xl shadow-xl w-full">
      <div className="flex items-center justify-between border-b border-gray-800 pb-3">
        <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-300 flex items-center gap-1.5 font-display">
          <Settings className="w-4 h-4 text-sky-400" />
          物理参数调节控制台
        </h2>
        <button
          onClick={onResetParams}
          className="text-[10px] font-mono text-gray-500 hover:text-gray-300 flex items-center gap-1 hover:underline"
        >
          <RotateCcw className="w-3 h-3" />
          重置参数 Default
        </button>
      </div>

      {/* CORE IGNITION AND STARTER ACTIONS */}
      <div className="grid grid-cols-2 gap-3">
        {/* Starter button */}
        <button
          onMouseDown={handleStartMouseDown}
          onMouseUp={handleStartMouseUp}
          onMouseLeave={handleStartMouseUp}
          onTouchStart={handleStartMouseDown}
          onTouchEnd={handleStartMouseUp}
          disabled={isDead || isRunning}
          className={`flex items-center justify-center space-x-1.5 font-sans font-bold text-xs py-3 px-4 rounded-xl border transition-all select-none ${
            isDead
              ? 'bg-slate-950 border-slate-950 text-slate-600 cursor-not-allowed'
              : isRunning
              ? 'bg-emerald-950/20 border-emerald-900/30 text-emerald-600 cursor-not-allowed'
              : 'bg-amber-500 hover:bg-amber-400 active:scale-[0.98] text-gray-950 border-amber-600 shadow-lg cursor-pointer transform'
          }`}
        >
          <Play className="w-4 h-4 fill-current" />
          <span className="uppercase">起动电机 (按住 Starter)</span>
        </button>

        {/* Cutoff switch */}
        <button
          onClick={onCutoffToggle}
          disabled={isDead}
          className={`flex items-center justify-center space-x-1.5 font-sans font-bold text-xs py-3 px-4 rounded-xl border transition-all ${
            isDead
              ? 'bg-slate-950 border-slate-950 text-slate-600 cursor-not-allowed'
              : isRunning
              ? 'bg-red-600 hover:bg-red-500 text-white border-red-700 shadow-md transform active:scale-95 cursor-pointer'
              : 'bg-slate-800 hover:bg-slate-700 text-slate-300 border-slate-700 cursor-pointer'
          }`}
        >
          <Square className="w-4 h-4 fill-current" />
          <span>{isRunning ? '点火切断 (KILL IGNITION)' : '安全切断开关'}</span>
        </button>
      </div>

      {/* NOX & Manual Spark trigger row */}
      <div className="grid grid-cols-2 gap-3 mt-1">
        <button
          onMouseDown={() => onUpdateParams({ hasNitrous: true })}
          onMouseUp={() => onUpdateParams({ hasNitrous: false })}
          onMouseLeave={() => { if (params.hasNitrous) onUpdateParams({ hasNitrous: false }); }}
          onTouchStart={() => onUpdateParams({ hasNitrous: true })}
          onTouchEnd={() => onUpdateParams({ hasNitrous: false })}
          disabled={isDead || !isRunning}
          className={`flex items-center justify-center space-x-1.5 font-bold text-xs py-2 px-3 rounded-lg border transition-all select-none ${
            isDead || !isRunning
              ? 'bg-slate-950 border-slate-950 text-slate-700 cursor-not-allowed'
              : params.hasNitrous
              ? 'bg-purple-600 border-purple-500 text-white animate-pulse'
              : 'bg-indigo-950/45 hover:bg-indigo-900/60 border-indigo-800/40 text-indigo-400 active:scale-95 cursor-pointer'
          }`}
        >
          <Flame className="w-3.5 h-3.5" />
          <span>笑气喷射 (Nos Boost)</span>
        </button>

        <button
          onClick={onTriggerSpark}
          disabled={isDead}
          className={`flex items-center justify-center space-x-1.5 font-bold text-xs py-2 px-3 rounded-lg border transition-all ${
            isDead
              ? 'bg-slate-950 border-slate-950 text-slate-700 cursor-not-allowed'
              : 'bg-slate-800 hover:bg-slate-700 border-slate-700 text-slate-300 active:scale-95 cursor-pointer'
          }`}
        >
          <span className="text-[14px]">⚡</span>
          <span>独立强制跳火 (Manual Spark)</span>
        </button>
      </div>

      {/* ROTATING SLIDERS GRID */}
      <div className="space-y-4 pt-2">
        {/* Throttle slider */}
        <div className="flex flex-col space-y-1.5">
          <div className="flex justify-between items-center text-xs text-gray-400 font-mono">
            <span className="flex items-center gap-1 font-semibold text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-red-500"></span>
              油门阀开度 (Throttle)
            </span>
            <span className={`font-bold ${params.throttle > 1 ? 'text-amber-300' : 'text-red-400'}`}>
              {Math.round(params.throttle * 100)}%{params.throttle > 1 ? ' 超开度' : ''}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max={MAX_THROTTLE}
            step="0.01"
            value={params.throttle}
            disabled={isDead}
            onChange={(e) => onUpdateParams({ throttle: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-red-500 disabled:opacity-40"
          />
          <div className="flex justify-between text-[9px] text-gray-500 font-mono">
            <span>关闭</span>
            <span>100% 机械全开</span>
            <span>150% 赛用进气</span>
          </div>
        </div>

        {/* Load slider */}
        <div className="flex flex-col space-y-1.5">
          <div className="flex justify-between items-center text-xs text-gray-400 font-mono">
            <span className="flex items-center gap-1 font-semibold text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-blue-400"></span>
              测功机阻力负载 (Brake Load)
            </span>
            <span className="text-blue-400 font-bold">{params.load.toFixed(1)} Nm</span>
          </div>
          <input
            type="range"
            min="0"
            max="32"
            step="0.5"
            value={params.load}
            disabled={isDead}
            onChange={(e) => onUpdateParams({ load: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-blue-400 disabled:opacity-40"
          />
          <div className="flex justify-between text-[9px] text-gray-500 font-mono">
            <span>无负载 (0 Nm)</span>
            <span>发动机扭矩极限 (~25-28 Nm)</span>
          </div>
        </div>

        {/* Fuel air ratio slider */}
        <div className="flex flex-col space-y-1.5">
          <div className="flex justify-between items-center text-xs text-gray-400 font-mono">
            <span className="flex items-center gap-1 font-semibold text-slate-300">
              过量空气系数 (Lambda / 空燃比)
            </span>
            <span className={`font-bold ${params.fuelAirRatio < 0.78 ? 'text-purple-400' : params.fuelAirRatio > 1.22 ? 'text-amber-500' : 'text-emerald-400'}`}>
              λ: {params.fuelAirRatio.toFixed(2)} {params.fuelAirRatio < 0.78 ? '(极浓 Mis)' : params.fuelAirRatio >= 0.88 && params.fuelAirRatio <= 0.95 ? '(强动力 Power)' : params.fuelAirRatio > 1.22 ? '(极稀 Mis)' : '(最佳 Stoich)'}
            </span>
          </div>
          <input
            type="range"
            min="0.6"
            max="1.5"
            step="0.02"
            value={params.fuelAirRatio}
            disabled={isDead}
            onChange={(e) => onUpdateParams({ fuelAirRatio: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-[#a855f7] disabled:opacity-40"
          />
          <div className="flex justify-between text-[9px] text-gray-500 font-mono">
            <span>富油极浓 (λ=0.6)</span>
            <span>最佳动力 (λ=0.92)</span>
            <span>经济/稀薄 (λ=1.5)</span>
          </div>
        </div>

        {/* Oil Level slider */}
        <div className="flex flex-col space-y-1.5">
          <div className="flex justify-between items-center text-xs text-gray-400 font-mono">
            <span className="flex items-center gap-1 font-semibold text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-amber-400"></span>
              机油润滑液位 (Oil Level)
            </span>
            <span className={`font-bold ${params.oilLevel < 35 ? 'text-red-500 animate-pulse font-extrabold' : 'text-amber-400'}`}>
              {params.oilLevel}% {params.oilLevel < 35 ? '(低油拉缸! ☠)' : ''}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="100"
            step="1"
            value={params.oilLevel}
            disabled={isDead}
            onChange={(e) => onUpdateParams({ oilLevel: parseInt(e.target.value) })}
            className="w-full h-1.5 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-amber-500 disabled:opacity-40"
          />
        </div>

        {/* Coolant pump slider */}
        <div className="flex flex-col space-y-1.5">
          <div className="flex justify-between items-center text-xs text-gray-400 font-mono">
            <span className="flex items-center gap-1 font-semibold text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-cyan-400"></span>
              冷却泵流量 (Coolant Pump)
            </span>
            <span className="text-cyan-400 font-bold">{Math.round(params.coolantPump * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={params.coolantPump}
            disabled={isDead}
            onChange={(e) => onUpdateParams({ coolantPump: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-cyan-400 disabled:opacity-40"
          />
          <div className="flex justify-between text-[9px] text-gray-500 font-mono">
            <span>关闭(易过热)</span>
            <span>高转重载请加大散热</span>
          </div>
        </div>

        {/* Choke (cold-start enrichment) slider */}
        <div className="flex flex-col space-y-1.5">
          <div className="flex justify-between items-center text-xs text-gray-400 font-mono">
            <span className="flex items-center gap-1 font-semibold text-slate-300">
              <span className="w-1.5 h-1.5 rounded-full bg-orange-400"></span>
              冷启动阻风门 (Choke)
            </span>
            <span className="text-orange-400 font-bold">{Math.round(params.choke * 100)}%</span>
          </div>
          <input
            type="range"
            min="0"
            max="1"
            step="0.05"
            value={params.choke}
            disabled={isDead}
            onChange={(e) => onUpdateParams({ choke: parseFloat(e.target.value) })}
            className="w-full h-1.5 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-orange-400 disabled:opacity-40"
          />
          <div className="flex justify-between text-[9px] text-gray-500 font-mono">
            <span>暖机后关闭</span>
            <span>冷车起动加浓助燃</span>
          </div>
        </div>

        {/* Ignition Timing slider */}
        <div className="flex flex-col space-y-1.5">
          <div className="flex justify-between items-center text-xs text-gray-400 font-mono">
            <span className="flex items-center gap-1 font-semibold text-slate-300">
              点火提前角 (Ignition Timing BTDC)
            </span>
            <span className={`font-bold ${params.ignitionTiming > 25 ? 'text-red-400' : 'text-indigo-400'}`}>
              {params.ignitionTiming}° BTDC {params.ignitionTiming > 25 ? '(过早爆震)' : ''}
            </span>
          </div>
          <input
            type="range"
            min="0"
            max="40"
            step="1"
            value={params.ignitionTiming}
            disabled={isDead}
            onChange={(e) => onUpdateParams({ ignitionTiming: parseInt(e.target.value) })}
            className="w-full h-1.5 bg-gray-950 rounded-lg appearance-none cursor-pointer accent-indigo-400 disabled:opacity-40"
          />
          <div className="flex justify-between text-[9px] text-gray-500 font-mono">
            <span>上止点点火 (0°)</span>
            <span>怠速最佳 (12°)</span>
            <span>高转最佳 (30°+)</span>
          </div>
        </div>

        {/* Rev limiter rows */}
        <div className="border-t border-slate-800/80 pt-3 flex flex-col space-y-2">
          <div className="flex items-center justify-between">
            <div className="flex flex-col">
              <span className="text-xs text-slate-300 font-semibold font-mono font-display">
                电子断火限速器 (Rev Limiter)
              </span>
              <span className="text-[10px] text-gray-500 font-mono">
                保护轴承连杆，防止高机械惯性炸缸
              </span>
            </div>
            <div className="flex items-center space-x-3">
              <label className="relative inline-flex items-center cursor-pointer">
                <input
                  type="checkbox"
                  checked={params.hasLimiter}
                  onChange={(e) => onUpdateParams({ hasLimiter: e.target.checked })}
                  className="sr-only peer"
                />
                <div className="w-9 h-5 bg-slate-950 rounded-full peer peer-checked:after:translate-x-full peer-checked:after:border-white after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-gray-400 after:border-gray-300 after:border after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:bg-red-600 peer-checked:after:bg-white"></div>
              </label>
            </div>
          </div>

          {params.hasLimiter && (
            <div className="flex flex-col space-y-1.5 pl-2 border-l-2 border-red-500/40 bg-red-950/5 p-2 rounded-r-lg">
              <div className="flex justify-between items-center text-[10px] font-mono">
                <span className="text-gray-400">最高限制断火转速:</span>
                <span className="text-red-500 font-bold">{params.limiterRpm} RPM</span>
              </div>
              <input
                type="range"
                min="3500"
                max={destructRpm}
                step="100"
                value={params.limiterRpm}
                disabled={isDead}
                onChange={(e) => onUpdateParams({ limiterRpm: parseInt(e.target.value) })}
                className="w-full h-1 bg-gray-950 rounded appearance-none cursor-pointer accent-red-600"
              />
              <span className="text-[9px] text-gray-500 text-right font-mono">
                安全红线: {redlineRpm} · 崩溃极限: {destructRpm} RPM
              </span>
            </div>
          )}
        </div>
      </div>

      {/* AUDIO SPEAKER VOLUME CONTROL */}
      <div className="border-t border-slate-800/80 pt-3 flex items-center justify-between">
        <button
          onClick={onSoundMuteToggle}
          className="p-2 text-slate-400 hover:text-white transition-colors bg-slate-950 rounded-lg"
        >
          {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>
        <div className="flex-1 ml-3 flex items-center space-x-2">
          <span className="text-[10px] text-gray-500 font-mono w-[30px]">音量</span>
          <input
            type="range"
            min="0"
            max="1.0"
            step="0.05"
            value={volume}
            onChange={(e) => onSoundVolumeChange(parseFloat(e.target.value))}
            className="w-full h-1 bg-gray-950 rounded appearance-none cursor-pointer accent-slate-400"
          />
        </div>
      </div>
    </div>
  );
}
