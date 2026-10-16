/**
 * @license
 * SPDX-License-Identifier: Apache-2.0
 */

import { useState, type PointerEvent as ReactPointerEvent, type ReactNode } from 'react';
import type { EngineControls, HudState } from '../types';
import { EngineState } from '../types';
import { KEY_BINDINGS } from '../hooks/useKeyboardControls';
import {
  Flame,
  Gauge,
  Keyboard,
  Power,
  Snowflake,
  Volume2,
  VolumeX,
  Zap,
  ChevronDown,
  ChevronUp,
} from 'lucide-react';

interface ControlDeckProps {
  state: EngineState;
  controls: EngineControls;
  hud: HudState;
  spec: { redlineRpm: number; destructRpm: number; idleRpm: number };
  volume: number;
  isMuted: boolean;
  dynoRunning: boolean;
  onUpdateControls: (patch: Partial<EngineControls>) => void;
  onPointerThrottle: (active: boolean) => void;
  onPointerStarter: (active: boolean) => void;
  onPointerNitrous: (active: boolean) => void;
  onToggleCutoff: () => void;
  onToggleChoke: () => void;
  onManualSpark: () => void;
  onVolumeChange: (v: number) => void;
  onMuteToggle: () => void;
  onResetControls: () => void;
}

/** A held-down control. Pointer events cover mouse, pen and touch in one path. */
function HoldButton({
  active,
  disabled,
  onHold,
  className,
  children,
}: {
  active: boolean;
  disabled?: boolean;
  onHold: (down: boolean) => void;
  className: string;
  children: ReactNode;
}) {
  return (
    <button
      type="button"
      disabled={disabled}
      onPointerDown={(e: ReactPointerEvent<HTMLButtonElement>) => {
        if (disabled) return;
        e.currentTarget.setPointerCapture(e.pointerId);
        onHold(true);
      }}
      onPointerUp={() => onHold(false)}
      onPointerCancel={() => onHold(false)}
      onLostPointerCapture={() => onHold(false)}
      // Keyboard activation of a hold button would otherwise fight the global
      // bindings, so it is suppressed entirely.
      onKeyDown={(e) => e.preventDefault()}
      className={`${className} ${active ? 'ring-2 ring-offset-1 ring-offset-slate-950' : ''} select-none touch-none`}
    >
      {children}
    </button>
  );
}

function Slider({
  label,
  value,
  min,
  max,
  step,
  display,
  accent,
  disabled,
  hint,
  onChange,
}: {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  display: string;
  accent: string;
  disabled?: boolean;
  hint?: string;
  onChange: (v: number) => void;
}) {
  return (
    <div className="flex flex-col gap-1">
      <div className="flex items-baseline justify-between text-[11px] font-mono">
        <span className="text-slate-400">{label}</span>
        <span className={accent}>{display}</span>
      </div>
      <input
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        onChange={(e) => onChange(parseFloat(e.target.value))}
        className="w-full h-1.5 bg-slate-950 rounded-lg appearance-none cursor-pointer disabled:opacity-40"
      />
      {hint && <span className="text-[9px] text-slate-600 font-mono">{hint}</span>}
    </div>
  );
}

export default function ControlDeck({
  state,
  controls,
  hud,
  spec,
  volume,
  isMuted,
  dynoRunning,
  onUpdateControls,
  onPointerThrottle,
  onPointerStarter,
  onPointerNitrous,
  onToggleCutoff,
  onToggleChoke,
  onManualSpark,
  onVolumeChange,
  onMuteToggle,
  onResetControls,
}: ControlDeckProps) {
  const [showKeys, setShowKeys] = useState(false);

  const isDead = state === EngineState.EXPLODED || state === EngineState.SEIZED;
  const isRunning = state === EngineState.RUNNING;
  const locked = isDead || dynoRunning;

  // The ECU is asking for more advance than the engine will currently take.
  const knockMargin = hud.knockLimit - hud.ignition;
  const knockTone =
    knockMargin < 0 ? 'text-red-400' : knockMargin < 2 ? 'text-amber-400' : 'text-emerald-400';

  return (
    <div className="flex flex-col gap-4 bg-slate-900 border border-slate-800 p-5 rounded-2xl shadow-xl w-full">
      <div className="flex items-center justify-between border-b border-slate-800 pb-3">
        <h2 className="text-sm font-semibold tracking-wider uppercase text-slate-300 flex items-center gap-1.5 font-display">
          <Gauge className="w-4 h-4 text-sky-400" />
          驾驶台
        </h2>
        <button
          onClick={() => setShowKeys((v) => !v)}
          className="text-[10px] font-mono text-slate-500 hover:text-sky-300 flex items-center gap-1"
        >
          <Keyboard className="w-3 h-3" />
          按键说明
          {showKeys ? <ChevronUp className="w-3 h-3" /> : <ChevronDown className="w-3 h-3" />}
        </button>
      </div>

      {showKeys && (
        <div className="grid grid-cols-1 sm:grid-cols-2 gap-x-4 gap-y-1 bg-slate-950 border border-slate-800 rounded-xl p-3">
          {KEY_BINDINGS.map((b) => (
            <div key={b.keys} className="flex items-center justify-between text-[10px] font-mono">
              <kbd className="px-1.5 py-0.5 bg-slate-800 border border-slate-700 rounded text-slate-300">{b.keys}</kbd>
              <span className="text-slate-500">{b.label}</span>
            </div>
          ))}
        </div>
      )}

      {/* ---- THROTTLE ---- */}
      <div className="space-y-2">
        <div className="flex items-baseline justify-between text-[11px] font-mono">
          <span className="text-slate-300 font-semibold">油门 THROTTLE</span>
          <span className="text-red-400 font-bold tabular-nums">{Math.round(hud.pedal * 100)}%</span>
        </div>

        {/* Pedal (commanded) over butterfly (actual) over idle bypass. */}
        <div className="relative h-7 bg-slate-950 rounded-lg border border-slate-800 overflow-hidden">
          <div
            className="absolute inset-y-0 left-0 bg-red-900/40 transition-none"
            style={{ width: `${hud.pedal * 100}%` }}
          />
          <div
            className="absolute inset-y-0 left-0 bg-gradient-to-r from-red-600 to-orange-500"
            style={{ width: `${hud.butterfly * 100}%` }}
          />
          {hud.idleBypass > 0.005 && (
            <div
              className="absolute inset-y-0 border-r-2 border-cyan-400/80"
              style={{ width: `${hud.idleBypass * 100}%` }}
              title="怠速旁通阀开度"
            />
          )}
          <div className="absolute inset-0 flex items-center justify-center text-[10px] font-mono text-white/90 drop-shadow">
            {dynoRunning ? '测功台接管油门' : '按住 空格 / 或按住此条'}
          </div>
        </div>

        <HoldButton
          active={hud.pedal > 0.01}
          disabled={locked}
          onHold={onPointerThrottle}
          className={`w-full py-3 rounded-xl border font-bold text-xs transition-colors ${
            locked
              ? 'bg-slate-950 border-slate-900 text-slate-600 cursor-not-allowed'
              : 'bg-red-950/40 border-red-900/50 text-red-300 hover:bg-red-900/40 active:bg-red-800/50 cursor-pointer ring-red-500'
          }`}
        >
          踩油门 (按住)
        </HoldButton>
      </div>

      {/* ---- IGNITION / STARTING ---- */}
      <div className="grid grid-cols-2 gap-2">
        <HoldButton
          active={hud.cranking}
          disabled={locked || isRunning}
          onHold={onPointerStarter}
          className={`flex items-center justify-center gap-1.5 font-bold text-xs py-2.5 rounded-xl border transition-colors ${
            locked || isRunning
              ? 'bg-slate-950 border-slate-900 text-slate-600 cursor-not-allowed'
              : 'bg-amber-500 hover:bg-amber-400 text-slate-950 border-amber-600 cursor-pointer ring-amber-300'
          }`}
        >
          <Power className="w-4 h-4" />
          起动机 (S)
        </HoldButton>

        <button
          onClick={onToggleCutoff}
          disabled={isDead}
          className={`flex items-center justify-center gap-1.5 font-bold text-xs py-2.5 rounded-xl border transition-colors ${
            isDead
              ? 'bg-slate-950 border-slate-900 text-slate-600 cursor-not-allowed'
              : hud.ignitionCut
              ? 'bg-slate-800 border-slate-700 text-slate-400 cursor-pointer'
              : 'bg-red-600 hover:bg-red-500 text-white border-red-700 cursor-pointer'
          }`}
        >
          {hud.ignitionCut ? '点火已切断 (K)' : '切断点火 (K)'}
        </button>

        <HoldButton
          active={hud.nitrous}
          disabled={locked || !isRunning}
          onHold={onPointerNitrous}
          className={`flex items-center justify-center gap-1.5 font-bold text-xs py-2 rounded-lg border transition-colors ${
            locked || !isRunning
              ? 'bg-slate-950 border-slate-900 text-slate-700 cursor-not-allowed'
              : hud.nitrous
              ? 'bg-purple-600 border-purple-500 text-white ring-purple-300'
              : 'bg-indigo-950/50 hover:bg-indigo-900/60 border-indigo-800/50 text-indigo-300 cursor-pointer ring-indigo-400'
          }`}
        >
          <Flame className="w-3.5 h-3.5" />
          笑气 (N)
        </HoldButton>

        <div className="grid grid-cols-2 gap-2">
          <button
            onClick={onToggleChoke}
            disabled={isDead}
            className={`flex items-center justify-center gap-1 font-bold text-[10px] py-2 rounded-lg border transition-colors ${
              controls.choke > 0.05
                ? 'bg-orange-600 border-orange-500 text-white'
                : 'bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200 cursor-pointer'
            }`}
          >
            <Snowflake className="w-3 h-3" />
            阻风 (C)
          </button>
          <button
            onClick={onManualSpark}
            disabled={isDead}
            className="flex items-center justify-center gap-1 font-bold text-[10px] py-2 rounded-lg border bg-slate-800 border-slate-700 text-slate-400 hover:text-slate-200 disabled:opacity-40 cursor-pointer"
          >
            <Zap className="w-3 h-3" />
            跳火 (X)
          </button>
        </div>
      </div>

      {/* ---- LIVE ECU READOUT ---- */}
      <div className="grid grid-cols-3 gap-2 bg-slate-950 border border-slate-800 rounded-xl p-3">
        <div className="flex flex-col">
          <span className="text-[9px] text-slate-500 font-mono">当前点火角</span>
          <span className="text-sm font-mono font-bold text-indigo-300 tabular-nums">
            {hud.ignition.toFixed(1)}°
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-slate-500 font-mono">爆震极限</span>
          <span className={`text-sm font-mono font-bold tabular-nums ${knockTone}`}>
            {hud.knockLimit.toFixed(1)}°
          </span>
        </div>
        <div className="flex flex-col">
          <span className="text-[9px] text-slate-500 font-mono">目标 λ</span>
          <span className="text-sm font-mono font-bold text-violet-300 tabular-nums">{hud.lambda.toFixed(2)}</span>
        </div>
        <div className="col-span-3 text-[9px] font-mono text-slate-500 leading-relaxed">
          {knockMargin < 0
            ? `⚠ 已超出爆震极限 ${Math.abs(knockMargin).toFixed(1)}°，正在敲缸 —— 立即回退点火角或降温。`
            : `余量 ${knockMargin.toFixed(1)}°。极限随水温上升而下降，标定时留点余地。`}
        </div>
      </div>

      {/* ---- AUXILIARY CONTROLS ---- */}
      <div className="space-y-3 border-t border-slate-800 pt-3">
        <div className="flex items-center justify-between">
          <span className="text-[10px] font-mono text-slate-500 uppercase tracking-wider">辅助控制</span>
          <button onClick={onResetControls} className="text-[10px] font-mono text-slate-500 hover:text-slate-300">
            恢复默认
          </button>
        </div>

        <Slider
          label="外部负载 (Brake Load)"
          value={controls.load}
          min={0}
          max={60}
          step={0.5}
          display={`${controls.load.toFixed(1)} Nm`}
          accent="text-blue-400 font-bold accent-blue-400"
          disabled={locked}
          hint="模拟带载运转；测功机拉力时由测功台自动接管。"
          onChange={(v) => onUpdateControls({ load: v })}
        />

        <Slider
          label="机油液位 (Oil Level)"
          value={controls.oilLevel}
          min={0}
          max={100}
          step={1}
          display={`${controls.oilLevel}%${controls.oilLevel < 35 ? ' ☠ 拉缸风险' : ''}`}
          accent={controls.oilLevel < 35 ? 'text-red-400 font-bold animate-pulse' : 'text-amber-400 font-bold'}
          disabled={locked}
          onChange={(v) => onUpdateControls({ oilLevel: Math.round(v) })}
        />

        <Slider
          label="冷却泵流量 (Coolant Pump)"
          value={controls.coolantPump}
          min={0}
          max={1}
          step={0.05}
          display={`${Math.round(controls.coolantPump * 100)}%`}
          accent="text-cyan-400 font-bold"
          disabled={locked}
          hint="高负载持续运转时，散热能力直接决定爆震极限。"
          onChange={(v) => onUpdateControls({ coolantPump: v })}
        />

        <div className="flex flex-col gap-2 border-t border-slate-800/60 pt-3">
          <label className="flex items-center justify-between cursor-pointer">
            <span className="text-[11px] font-mono text-slate-300">电子断火限速器</span>
            <span className="relative inline-flex items-center">
              <input
                type="checkbox"
                checked={controls.hasLimiter}
                onChange={(e) => onUpdateControls({ hasLimiter: e.target.checked })}
                className="sr-only peer"
              />
              <span className="w-9 h-5 bg-slate-950 rounded-full peer peer-checked:bg-red-600 after:content-[''] after:absolute after:top-[2px] after:left-[2px] after:bg-slate-400 after:rounded-full after:h-4 after:w-4 after:transition-all peer-checked:after:translate-x-full peer-checked:after:bg-white" />
            </span>
          </label>

          {controls.hasLimiter ? (
            <Slider
              label="断火转速"
              value={controls.limiterRpm}
              min={2000}
              max={spec.destructRpm}
              step={100}
              display={`${controls.limiterRpm} RPM`}
              accent="text-red-400 font-bold"
              disabled={locked}
              hint={`安全红线 ${spec.redlineRpm} · 机械崩溃 ${spec.destructRpm} RPM`}
              onChange={(v) => onUpdateControls({ limiterRpm: Math.round(v) })}
            />
          ) : (
            <span className="text-[9px] font-mono text-amber-500/80">
              ⚠ 限速器已关闭：超过 {spec.destructRpm} RPM 会直接炸缸并损毁活塞、连杆与曲轴。
            </span>
          )}
        </div>
      </div>

      {/* ---- AUDIO ---- */}
      <div className="border-t border-slate-800 pt-3 flex items-center gap-3">
        <button onClick={onMuteToggle} className="p-2 text-slate-400 hover:text-white bg-slate-950 rounded-lg">
          {isMuted ? <VolumeX className="w-3.5 h-3.5" /> : <Volume2 className="w-3.5 h-3.5" />}
        </button>
        <input
          type="range"
          min={0}
          max={1}
          step={0.05}
          value={volume}
          onChange={(e) => onVolumeChange(parseFloat(e.target.value))}
          className="flex-1 h-1 bg-slate-950 rounded appearance-none cursor-pointer accent-slate-400"
        />
      </div>
    </div>
  );
}
