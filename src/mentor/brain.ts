/**
 * 老周 watching the bench: reads the build when it changes, the engine every
 * quarter second and the solver's events as they arrive; talks, steps in
 * when something is about to break, and can take the dyno to calibrate.
 */

import { BLOCK_KEYS, rodBreakRpm, valveFloatRpm, type BenchConfig, type EcuConfig, type EngineConfig } from '../sim/config';
import type { CoreEvent, Failure, FailureKind } from '../sim/core';
import { basePreset, buildSig, useBench, type DynoRun } from '../state/benchStore';
import { effectiveThrottle, useControls } from '../state/controlStore';
import { restoreEngine, startSweep, stopSweep } from '../state/engineLink';
import { onCoreEvents, useLive } from '../state/liveStore';
import { useUi, type Focus } from '../state/uiStore';
import { applyFix, crankForMe, isMentorEdit, mentorEdit, wait } from './actions';
import { assessBuild, reviewFailure, safeLimiter, type Fix, type Issue } from './advice';
import { freshMemory, LESSON, type LessonMemory } from './lessons';
import { PARAM_NOTES } from './params';
import { addDespair, say, sinceSaid, useMentor, type MentorAction } from './store';
import { Stopped, tuneLambda, tuneSpark, type Sample, type TunerPort } from './tuner';
import * as V from './voice';

const TICK_MS = 250;
const SETTLE_S = 1.2;
/** Time after a change before torque is compared with the baseline. */
const RESULT_S = 2.5;

const fmtRpm = (rpm: number): string => Math.round(rpm).toLocaleString('en-US');
const pct = (v: number): string => `${Math.round(v * 100)}%`;
const now = (): number => performance.now() / 1000;

export function fixAction(fix: Fix, primary = false): MentorAction {
  return { label: fix.label, run: () => applyFix(fix), primary };
}

function issueTone(i: Issue): 'danger' | 'warn' | 'say' {
  return i.level === 'danger' ? 'danger' : i.level === 'warn' ? 'warn' : 'say';
}

function currentIssues(): Issue[] {
  const { config, ecu, bench } = useBench.getState();
  return assessBuild(config, ecu, bench, basePreset());
}

// ---------------------------------------------------------------------------
// Watch state
// ---------------------------------------------------------------------------

const w = {
  prevStatus: 'off' as string,
  crankSince: 0,
  runningSince: 0,
  lastThrottle: 0,
  knocks: [] as { t: number; i: number }[],
  limiterHits: [] as number[],
  pops: 0,
  popsTold: false,
  misfires: [] as { t: number; reason: string }[],
  changes: [] as { t: number; key: string }[],
  burstIssues: null as Set<string> | null,
  lastChange: 0,
  resultFor: null as Focus | null,
  /** When each danger topic was last raised, for "I told you so". */
  warned: new Map<FailureKind, number>(),
  damage: 0,
  fatigue: 0,
  rescueUntil: 0,
  idleRpm: [] as number[],
  brakeShort: 0,
  steadyWot: 0,
  seenParams: new Set<string>(),
  lastFocusParam: '',
  lesson: null as LessonMemory | null,
  lastFailure: null as Failure | null,
};

// ---------------------------------------------------------------------------
// Build commentary
// ---------------------------------------------------------------------------

function onBuildChange(prev: { config: EngineConfig; ecu: EcuConfig; bench: BenchConfig }): void {
  if (useMentor.getState().tuning) return;
  const s = useBench.getState();
  if (!w.burstIssues) {
    w.burstIssues = new Set(assessBuild(prev.config, prev.ecu, prev.bench, basePreset()).map((i) => i.id));
  }
  w.lastChange = now();
  if (isMentorEdit()) return;
  const keys: string[] = [];
  for (const k of Object.keys(s.config) as (keyof EngineConfig)[]) if (s.config[k] !== prev.config[k]) keys.push(`config.${k}`);
  for (const k of Object.keys(s.ecu) as (keyof EcuConfig)[]) if (s.ecu[k] !== prev.ecu[k]) keys.push(`ecu.${k}`);
  for (const k of Object.keys(s.bench) as (keyof BenchConfig)[]) if (s.bench[k] !== prev.bench[k]) keys.push(`bench.${k}`);
  const t = now();
  for (const key of keys) w.changes.push({ t, key });
}

function settleBuild(t: number): void {
  if (!w.burstIssues || t - w.lastChange < SETTLE_S) return;
  const before = w.burstIssues;
  w.burstIssues = null;
  const issues = currentIssues();
  const fresh = issues.filter((i) => !before.has(i.id));
  for (const i of fresh.sort((a, b) => rank(b) - rank(a))) {
    say(`issue:${i.id}`, issueTone(i), i.text, {
      actions: i.fixes.map((f, n) => fixAction(f, n === 0)),
      ...(i.level === 'danger' ? { head: '认真的。' } : {}),
    });
    if (i.id.startsWith('rod')) w.warned.set('rod', t);
    if (i.id.startsWith('float')) w.warned.set('valve', t);
  }
  const fixed = [...before].filter((id) => !issues.some((i) => i.id === id) && (id.startsWith('rod') || id.startsWith('float') || id === 'knock-hot'));
  if (fixed.length > 0 && fresh.length === 0) say('fixed', 'good', '这下安全了。看，也没那么难。', { cooldown: 5 });
}

const rank = (i: Issue): number => (i.level === 'danger' ? 2 : i.level === 'warn' ? 1 : 0);

function watchChaos(t: number): void {
  w.changes = w.changes.filter((c) => t - c.t < 6);
  const distinct = new Set(w.changes.map((c) => c.key)).size;
  if (distinct >= 5 && sinceSaid('chaos') > 25) {
    const d = useMentor.getState().despair;
    say('chaos', 'joke', V.byDespair(V.CHAOS, d));
    addDespair(0.6);
    w.changes = [];
  }
}

function explainFocus(focus: Focus | null): void {
  if (!focus || focus.param === w.lastFocusParam) return;
  w.lastFocusParam = focus.param;
  if (w.seenParams.has(focus.param) || useMentor.getState().tuning) return;
  const note = PARAM_NOTES[focus.param];
  if (!note) return;
  w.seenParams.add(focus.param);
  const field = focus.param.split('.')[1] as (typeof BLOCK_KEYS)[number];
  const locked = focus.param.startsWith('config.') && BLOCK_KEYS.includes(field) && useLive.getState().snapshot?.status === 'running';
  say('explain', 'say', `${note.what}${locked ? ' 这是缸体件，得熄火才能换。' : ''} 看：${note.watch}`, { head: `${focus.label}：` });
}

/** Same knob, same throttle, same held speed: then a torque change is the part, not the driver. */
function judgeResult(t: number): void {
  const focus = useUi.getState().focus;
  if (!focus?.before || w.resultFor === focus || t - w.lastChange < RESULT_S || w.lastChange * 1000 < focus.at - 50) return;
  if (useMentor.getState().tuning) return;
  const live = useLive.getState();
  const m = live.metrics;
  const braked = useControls.getState().brakeMode === 'speed';
  if (!m || !braked || !focus.beforeBrake) return;
  if (Math.abs(m.rpm - focus.before.rpm) > 150 || Math.abs((live.snapshot?.throttle ?? 0) - focus.beforeThrottle) > 0.05) return;
  w.resultFor = focus;
  const before = focus.before.brakeTorque;
  if (before < 1) return;
  const d = m.brakeTorque / before - 1;
  if (Math.abs(d) < 0.02) return;
  const text = `${focus.label}这一下，在 ${fmtRpm(m.rpm)} rpm 扭矩 ${before.toFixed(1)} → ${m.brakeTorque.toFixed(1)} Nm（${d > 0 ? '+' : ''}${(d * 100).toFixed(1)}%）。`;
  if (d > 0) {
    say('result', 'good', `${text}${V.pick(V.PRAISE)}`);
    addDespair(-0.4);
  } else {
    say('result', 'warn', `${text}${V.pick(V.WORSE)}`, { actions: [{ label: '撤销这次改动', run: () => undo(focus), primary: true }] });
  }
}

function undo(f: Focus): void {
  const [scope, key] = f.param.split('.') as [string, string];
  mentorEdit(() => {
    const b = useBench.getState();
    if (scope === 'config') b.setConfig({ [key]: f.beforeConfig[key as keyof EngineConfig] } as Partial<EngineConfig>);
    if (scope === 'ecu') b.setEcu({ [key]: f.beforeEcu[key as keyof EcuConfig] } as Partial<EcuConfig>);
  });
}

// ---------------------------------------------------------------------------
// Live engine
// ---------------------------------------------------------------------------

function rescue(kind: FailureKind, text: string, fix?: Fix): void {
  useControls.getState().set({ autoThrottle: 0 });
  w.rescueUntil = now() + 1.5;
  if (fix) applyFix(fix);
  if (useMentor.getState().tuning) stopTune('保护模式');
  w.warned.set(kind, now());
  say('rescue', 'danger', text, {
    head: '我接手了。',
    actions: [{ label: '关掉保护模式', run: () => useMentor.getState().set({ protect: false }) }],
  });
}

function watchEngine(t: number, dt: number): void {
  const live = useLive.getState();
  const s = live.snapshot;
  if (!s) return;
  const ctl = useControls.getState();
  const { config, ecu, bench } = useBench.getState();
  const protect = useMentor.getState().protect;
  const tuning = useMentor.getState().tuning !== null;

  if (w.rescueUntil > 0 && t > w.rescueUntil && !tuning) {
    w.rescueUntil = 0;
    useControls.getState().set({ autoThrottle: null });
  }

  // ---- starting and stalling ----
  if (s.status === 'cranking') {
    if (w.prevStatus !== 'cranking') w.crankSince = t;
    if (!ctl.ignition && t - w.crankSince > 1) {
      say('ign', 'joke', '点火是关的。你这是在给它做按摩？', {
        cooldown: 20,
        actions: [{ label: '打开点火', run: () => useControls.getState().set({ ignition: true }), primary: true }],
      });
    } else if (t - w.crankSince > 3.5 && !tuning) {
      const lean = ecu.cruiseLambda > 1.25;
      say('crank', 'warn', `拖了 ${Math.round(t - w.crankSince)} 秒还不着。${lean ? '部分负荷 λ 太稀，冷机根本点不着。' : '松开歇一下，起动机也是要喘气的。'}`, {
        cooldown: 20,
        actions: lean ? [fixAction({ label: 'λ 改回 1.00', ecu: { cruiseLambda: 1 } }, true)] : [{ label: '我来起动', run: () => void crankForMe() }],
      });
    }
  }
  if (w.prevStatus === 'running' && s.status === 'off' && ctl.ignition && !s.failure && !tuning) {
    const stall = currentIssues().find((i) => i.id === 'idle-stall');
    say('stall', 'warn', `${V.pick(V.STALL)}${stall ? ` ${stall.text}` : ''}`, {
      cooldown: 15,
      actions: [
        ...(stall ? stall.fixes.map((f) => fixAction(f, true)) : [fixAction({ label: '怠速 +300', ecu: { idleRpm: ecu.idleRpm + 300 } })]),
        { label: '我来起动', run: () => void crankForMe() },
      ],
    });
  }
  if (s.status === 'running' && w.prevStatus !== 'running') w.runningSince = t;
  w.prevStatus = s.status;
  if (s.status !== 'running') {
    w.damage = s.pistonDamage;
    w.fatigue = s.rodFatigue;
    return;
  }

  // ---- knock and the piston ----
  w.knocks = w.knocks.filter((k) => t - k.t < 2);
  const knocking = w.knocks.some((k) => k.i > 0.08);
  const damageRate = (s.pistonDamage - w.damage) / dt;
  w.damage = s.pistonDamage;
  if (knocking && damageRate > 0.002) {
    if (protect && s.pistonDamage > 0.3) {
      rescue(
        'piston',
        `活塞损伤 ${pct(s.pistonDamage)}，还在爆震。我收了油门，点火角退了 4°，把爆震控制打开了。想看它打穿，先关掉保护模式。`,
        { label: '', ecu: { advanceOffset: Math.max(-20, ecu.advanceOffset - 4), knockControl: true } },
      );
    } else if (s.pistonDamage > 0.08) {
      w.warned.set('piston', t);
      say('knock', 'danger', `在爆震，活塞损伤 ${pct(s.pistonDamage)} 并且还在涨。松油门，或者退点火角。${ecu.knockControl ? '' : '爆震控制是关的，没人替你兜底。'}`, {
        head: '认真的。',
        cooldown: 6,
        actions: [
          fixAction({ label: '点火退 4°', ecu: { advanceOffset: Math.max(-20, ecu.advanceOffset - 4) } }, true),
          ...(ecu.knockControl ? [] : [fixAction({ label: '打开爆震控制', ecu: { knockControl: true } })]),
        ],
      });
    }
  }
  if (ecu.knockControl && s.knockRetard > 6 && !tuning) {
    say('retard', 'warn', `ECU 已经退了 ${s.knockRetard.toFixed(1)}° 点火角在压爆震。你加的那点提前角，全被它收回去了，还白挨了几下爆震。`, {
      cooldown: 40,
      actions: [
        fixAction({ label: '点火修正 −3°', ecu: { advanceOffset: Math.max(-20, ecu.advanceOffset - 3) } }, true),
        ...(config.fuelOctane < 102 ? [fixAction({ label: `换 ${Math.min(102, config.fuelOctane + 3)} 号油`, config: { fuelOctane: Math.min(102, config.fuelOctane + 3) } })] : []),
      ],
    });
  }

  // ---- rod and valves ----
  const rodBreak = rodBreakRpm(config);
  const float = valveFloatRpm(config);
  const fatigueRate = (s.rodFatigue - w.fatigue) / dt;
  w.fatigue = s.rodFatigue;
  const safe = safeLimiter(config);
  const limiterFix: Fix = { label: `断火降到 ${fmtRpm(safe)}`, ecu: { limiterRpm: safe } };
  if (protect && (s.rpm > rodBreak * 0.96 || (s.rodFatigue > 0.45 && fatigueRate > 0))) {
    rescue('rod', `连杆疲劳 ${pct(s.rodFatigue)}，${fmtRpm(s.rpm)} rpm 时它挨的拉力已经是极限的 ${pct((s.rpm / rodBreak) ** 2)}。我收了油门，断火降到 ${fmtRpm(safe)}。`, limiterFix);
  } else if (fatigueRate > 0 && s.rodFatigue > 0.1) {
    w.warned.set('rod', t);
    say('rod', 'danger', `连杆疲劳 ${pct(s.rodFatigue)}，还在涨。${fmtRpm(s.rpm)} rpm 每多转一圈都在记账，账满就断，不会提前打招呼。`, {
      head: '认真的。',
      cooldown: 8,
      actions: [fixAction(limiterFix, true)],
    });
  }
  if (protect && s.rpm > float * 1.08) {
    rescue('valve', `${fmtRpm(s.rpm)} rpm，比气门飘浮转速高了 ${pct(s.rpm / float - 1)}，再高 7% 气门就撞活塞。我收了油门，断火降到 ${fmtRpm(safe)}。`, limiterFix);
  } else if (s.rpm > float) {
    w.warned.set('valve', t);
    say('float', 'danger', `${fmtRpm(s.rpm)} rpm，气门已经在飘：弹簧压不住，关得越来越晚。超过 ${fmtRpm(float * 1.15)} 它会被活塞顶弯。`, {
      head: '认真的。',
      cooldown: 8,
      actions: [fixAction(limiterFix, true), fixAction({ label: '弹簧加硬 20%', config: { valveSpringForce: Math.min(1500, Math.ceil((config.valveSpringForce * 1.2) / 10) * 10) } })],
    });
  }

  // ---- heat ----
  if (!bench.coolantConditioner && s.coolantC > 112) {
    const fix: Fix = { label: '接上水温机', bench: { coolantConditioner: true } };
    if (protect && s.coolantC > 126) {
      rescue('headGasket', `水温 ${s.coolantC.toFixed(0)} °C，离缸垫冲坏只剩 ${(135 - s.coolantC).toFixed(0)} 度。我收了油门，把水温机接上了。`, fix);
    } else {
      w.warned.set('headGasket', t);
      say('hot', s.coolantC > 122 ? 'danger' : 'warn', `水温 ${s.coolantC.toFixed(0)} °C 还在爬。135 °C 缸垫就冲了。`, {
        cooldown: 15,
        actions: [fixAction(fix, true), fixAction({ label: `散热器换 ${Math.min(2, config.radiatorCapacity + 0.5).toFixed(1)}×`, config: { radiatorCapacity: Math.min(2, config.radiatorCapacity + 0.5) } })],
      });
    }
  }

  if (tuning) return;
  const throttle = effectiveThrottle(ctl);
  if (throttle >= 0.03) w.lastThrottle = t;

  // ---- noise and fun ----
  w.limiterHits = w.limiterHits.filter((h) => t - h < 4);
  if (w.limiterHits.length >= 8) say('limiter', 'joke', V.pick(V.LIMITER), { cooldown: 45 });

  w.misfires = w.misfires.filter((m) => t - m.t < 3);
  const lean = w.misfires.filter((m) => m.reason === 'lean').length;
  const rich = w.misfires.filter((m) => m.reason === 'rich').length;
  if (lean >= 4) {
    const wot = throttle > 0.85;
    say('misfire', 'warn', `一直在失火，混合气太稀，火花点不着。${wot ? '全油门' : '部分负荷'} λ 现在是 ${(wot ? ecu.wotLambda : ecu.cruiseLambda).toFixed(2)}。`, {
      cooldown: 20,
      actions: [fixAction(wot ? { label: '全油门 λ 改回 0.88', ecu: { wotLambda: 0.88 } } : { label: '部分负荷 λ 改回 1.00', ecu: { cruiseLambda: 1 } }, true)],
    });
  } else if (rich >= 4) {
    say('misfire', 'warn', '浓到点不着了，缸里全是油没有气。', {
      cooldown: 20,
      actions: [fixAction({ label: 'λ 都改回出厂', ecu: { wotLambda: 0.88, cruiseLambda: 1 } }, true)],
    });
  }

  // ---- reading the scope for them ----
  const c = s.cycle;
  const braked = ctl.brakeMode === 'speed';
  w.steadyWot = braked && throttle > 0.9 && c && !c.misfire && c.knock < 0.08 ? w.steadyWot + dt : 0;
  if (w.steadyWot > 2.5 && c && t - w.lastChange > 3) {
    if (c.pmaxDeg < 8) {
      say('pmax', 'say', `示波器上峰值压力在上止点后 ${c.pmaxDeg.toFixed(0)}°，来得太早了，活塞还没下行就被压着。点火可以退一点，扭矩反而会涨。`, {
        cooldown: 60,
        actions: [fixAction({ label: '点火退 3°', ecu: { advanceOffset: Math.max(-20, ecu.advanceOffset - 3) } })],
      });
    } else if (c.pmaxDeg > 20) {
      say('pmax', 'say', `峰值压力在上止点后 ${c.pmaxDeg.toFixed(0)}°，来得太晚，热量都送进排气管了（排温 ${s.egtC.toFixed(0)} °C）。点火能再早一点——盯着爆震。`, {
        cooldown: 60,
        actions: [fixAction({ label: '点火加 3°', ecu: { advanceOffset: Math.min(20, ecu.advanceOffset + 3) } })],
      });
    }
  }

  // ---- dyno held but out of reach ----
  w.brakeShort = braked && throttle > 0.9 && s.rpm < ctl.brakeRpm - 400 ? w.brakeShort + dt : 0;
  if (w.brakeShort > 2) {
    say(
      'brake',
      'say',
      ctl.brakeRpm > ecu.limiterRpm
        ? `测功机定在 ${fmtRpm(ctl.brakeRpm)}，比断火转速还高。它够不着的，按 [ 降下来。`
        : `测功机定在 ${fmtRpm(ctl.brakeRpm)}，全油门也只到 ${fmtRpm(s.rpm)}——不是测功机拖着它，是它在这儿已经没劲了。`,
      { cooldown: 40 },
    );
  }

  // ---- idle quality (after the flare that follows every start) ----
  if (throttle < 0.03 && !braked && t - w.runningSince > 6 && t - w.lastThrottle > 4 && Math.abs(s.rpm - ecu.idleRpm) < 800) {
    w.idleRpm.push(s.rpm);
    if (w.idleRpm.length > 16) w.idleRpm.shift();
    if (w.idleRpm.length === 16) {
      const lo = Math.min(...w.idleRpm);
      const hi = Math.max(...w.idleRpm);
      if (hi - lo > ecu.idleRpm * 0.3) {
        say('hunt', 'say', `怠速在 ${fmtRpm(lo)} 和 ${fmtRpm(hi)} 之间来回游。轻飞轮、大重叠角都会这样，把怠速目标提一点它就踏实了。`, {
          cooldown: 90,
          actions: [fixAction({ label: '怠速 +200', ecu: { idleRpm: ecu.idleRpm + 200 } })],
        });
      }
    }
  } else {
    w.idleRpm = [];
  }
}

function onEvents(events: CoreEvent[]): void {
  const t = now();
  for (const e of events) {
    switch (e.kind) {
      case 'knock':
        w.knocks.push({ t, i: e.intensity });
        break;
      case 'limiter':
        w.limiterHits.push(t);
        break;
      case 'misfire':
        w.misfires.push({ t, reason: e.reason });
        break;
      case 'afterfire':
        w.pops++;
        if (!w.popsTold && w.pops > 3) {
          w.popsTold = true;
          say('pops', 'say', V.POPS_FIRST, { cooldown: 60 });
        } else if (w.pops > 3) {
          say('pops', 'joke', V.pick(V.POPS), { cooldown: 120 });
        }
        break;
      case 'failure':
        onFailure(e.failure);
        break;
      default:
        break;
    }
  }
}

function onFailure(f: Failure): void {
  if (w.lastFailure === f) return;
  w.lastFailure = f;
  if (useMentor.getState().tuning) stopTune('炸了');
  const m = useMentor.getState();
  const failures = m.failures + 1;
  m.set({ failures });
  const warnedAt = w.warned.get(f.kind);
  const ignored = warnedAt !== undefined && now() - warnedAt < 90;
  addDespair(ignored ? 1.2 : 0.8);
  const { config, ecu, bench } = useBench.getState();
  const review = reviewFailure(f, config, ecu, bench);
  say('failure', 'danger', review.cause, {
    head: `${f.title}。`,
    actions: [
      {
        label: '按老周说的改，换新零件',
        primary: true,
        run: () => {
          for (const fix of review.fixes) applyFix(fix);
          restoreEngine();
        },
      },
    ],
  });
  const tail = ignored ? V.pick(V.IGNORED) : '';
  say('failure-tail', 'joke', `${tail}${tail ? ' ' : ''}${V.byDespair(V.FAIL_TAIL, Math.min(failures - 1, 4))}`);
}

/** Fixes the failure review proposes, for the teardown card. */
export function failureFixes(f: Failure): Fix[] {
  const { config, ecu, bench } = useBench.getState();
  return reviewFailure(f, config, ecu, bench).fixes;
}

export function failureCause(f: Failure): string {
  const { config, ecu, bench } = useBench.getState();
  return reviewFailure(f, config, ecu, bench).cause;
}

export function onRestored(): void {
  w.lastFailure = null;
  w.damage = 0;
  w.fatigue = 0;
  say('revive', 'say', V.pick(V.REVIVE));
}

// ---------------------------------------------------------------------------
// Lessons
// ---------------------------------------------------------------------------

export function startLesson(): void {
  w.lesson = freshMemory();
  useMentor.getState().set({ lesson: 0, open: true });
}

export function nextLessonStep(): void {
  const m = useMentor.getState();
  if (m.lesson === null) return;
  const next = m.lesson + 1;
  if (next >= LESSON.length) {
    m.set({ lesson: null, graduated: true });
    say('lesson', 'good', '毕业了。接下来随便折腾，我盯着。搞不定就点「老周调一遍」——不过先自己试试，调出来的才是你的。');
    addDespair(-1);
    return;
  }
  w.lesson = freshMemory();
  m.set({ lesson: next });
}

export function quitLesson(): void {
  useMentor.getState().set({ lesson: null });
  say('lesson', 'say', '行，不上课了。有不懂的随时点「带我入门」。');
}

function watchLesson(dt: number): void {
  const i = useMentor.getState().lesson;
  if (i === null || !w.lesson) return;
  const step = LESSON[i];
  if (step?.done?.(w.lesson, dt)) {
    addDespair(-0.15);
    nextLessonStep();
  }
}

// ---------------------------------------------------------------------------
// Calibration on the live bench
// ---------------------------------------------------------------------------

let cancelReason: string | null = null;

function tuneLog(line: string): void {
  const t = useMentor.getState().tuning;
  if (t) useMentor.getState().set({ tuning: { ...t, log: [...t.log, line].slice(-5) } });
}

function tuneStage(stage: string): void {
  const t = useMentor.getState().tuning;
  if (t) useMentor.getState().set({ tuning: { stage, log: t.log } });
}

const livePort: TunerPort = {
  ecu: () => useBench.getState().ecu,
  setEcu: (patch) => mentorEdit(() => useBench.getState().setEcu(patch)),
  hold: (rpm) => useControls.getState().set({ autoThrottle: 1, brakeMode: 'speed', brakeRpm: rpm, sweeping: false }),
  measure: async (settle, window): Promise<Sample> => {
    await wait(settle * 1000);
    let torque = 0;
    let knock = 0;
    let cycles = 0;
    let last = -1;
    const unsub = useLive.subscribe((s) => {
      const c = s.snapshot?.cycle;
      if (!c || c.index === last) return;
      last = c.index;
      torque += c.brakeTorque;
      knock = Math.max(knock, c.knock);
      cycles++;
    });
    await wait(window * 1000);
    unsub();
    return { torque: cycles ? torque / cycles : 0, knock, cycles };
  },
  stopped: () => cancelReason !== null || useLive.getState().snapshot?.status !== 'running',
};

function sweep(label: string): Promise<DynoRun | null> {
  useControls.getState().set({ autoThrottle: null });
  return new Promise((resolve) => startSweep({ label, onDone: resolve }));
}

function peaks(run: DynoRun): { tq: number; hp: number } {
  let tq = 0;
  let hp = 0;
  for (const [rpm, nm] of run.points) {
    tq = Math.max(tq, nm);
    hp = Math.max(hp, (nm * rpm) / 7121);
  }
  return { tq, hp };
}

export function stopTune(reason = '你喊停'): void {
  if (!useMentor.getState().tuning) return;
  cancelReason = reason;
  if (useControls.getState().sweeping) stopSweep(false);
}

export async function autoTune(): Promise<void> {
  const m = useMentor.getState();
  if (m.tuning) return;
  if (useLive.getState().snapshot?.failure) {
    say('tune', 'joke', '它都碎成这样了，你让我调什么？先换零件。');
    return;
  }
  cancelReason = null;
  m.set({ tuning: { stage: '准备', log: [] }, open: true });
  useUi.getState().setDrawer('dyno');
  const fmtOff = (v: number): string => `${v > 0 ? '+' : ''}${v}°`;
  try {
    say('tune', 'say', '我来。你看着，手别碰油门。');
    if (!(await crankForMe())) throw new Stopped();

    const { config, ecu } = useBench.getState();
    const safe = safeLimiter(config);
    if (ecu.limiterRpm > safe) {
      livePort.setEcu({ limiterRpm: safe });
      tuneLog(`断火转速 ${fmtRpm(ecu.limiterRpm)} 超出零件的安全线，先降到 ${fmtRpm(safe)}。`);
    }

    const last = useBench.getState().runs.at(-1);
    let before: DynoRun | null = null;
    if (last && last.sig === buildSig(useBench.getState().config, useBench.getState().ecu)) {
      before = last;
      tuneLog(`用你刚拉的「${last.label}」当调前曲线。`);
    } else {
      tuneStage('拉一条调前的曲线留底');
      before = await sweep('调前');
      if (cancelReason) throw new Stopped();
    }

    tuneStage('找点火角');
    const spark = await tuneSpark(livePort, tuneLog);
    tuneStage('找全油门混合比');
    const lambda = await tuneLambda(livePort, tuneLog);

    tuneStage('拉一条调后的曲线');
    const after = await sweep('老周调后');
    if (cancelReason || !after) throw new Stopped();

    const parts = [
      spark.from !== spark.to ? `点火修正 ${fmtOff(spark.from)} → ${fmtOff(spark.to)}${spark.knockLimited ? '（被爆震卡住，留了余量）' : ''}` : `点火修正 ${fmtOff(spark.to)} 本来就在最佳点`,
      lambda.from !== lambda.to ? `全油门 λ ${lambda.from.toFixed(2)} → ${lambda.to.toFixed(2)}` : `全油门 λ ${lambda.to.toFixed(2)} 不用动`,
    ];
    let verdict = '';
    if (before) {
      const a = peaks(before);
      const b = peaks(after);
      const gain = b.tq / a.tq - 1;
      verdict =
        Math.abs(gain) < 0.015
          ? `峰值扭矩 ${a.tq.toFixed(1)} → ${b.tq.toFixed(1)} Nm，在测量误差里。这台本来就调得不错，我只是替你确认了一遍。`
          : `峰值扭矩 ${a.tq.toFixed(1)} → ${b.tq.toFixed(1)} Nm（${gain > 0 ? '+' : ''}${(gain * 100).toFixed(1)}%），功率 ${a.hp.toFixed(1)} → ${b.hp.toFixed(1)} hp。`;
    }
    say('tune', 'good', `${parts.join('；')}。${verdict}两条曲线都在测功面板里。`, { head: '调完了。' });
    addDespair(-0.5);
  } catch (e) {
    if (!(e instanceof Stopped)) throw e;
    say('tune', 'say', `停了（${cancelReason ?? '发动机没在转'}）。调到一半的参数我留着，你可以接着看。`);
  } finally {
    if (useControls.getState().sweeping) stopSweep(false);
    useControls.getState().set({ autoThrottle: null, brakeMode: 'off', hand: 0 });
    useMentor.getState().set({ tuning: null });
    cancelReason = null;
  }
}

// ---------------------------------------------------------------------------
// Lifecycle
// ---------------------------------------------------------------------------

let started = false;

export function startMentor(): void {
  if (started) return;
  started = true;
  const m = useMentor.getState();
  const visits = m.visits + 1;
  m.set({ visits, messages: [] });
  if (visits === 1) {
    say('hello', 'say', V.pick(V.GREET));
    startLesson();
  } else {
    say('hello', 'say', V.pick(V.GREET_BACK), {
      actions: m.graduated ? [] : [{ label: '带我入门', run: startLesson, primary: true }],
    });
  }
  const issues = currentIssues().filter((i) => i.level !== 'info');
  for (const i of issues) say(`issue:${i.id}`, issueTone(i), i.text, { actions: i.fixes.map((f, n) => fixAction(f, n === 0)) });

  useBench.subscribe((s, prev) => {
    if (s.config !== prev.config || s.ecu !== prev.ecu || s.bench !== prev.bench) onBuildChange(prev);
  });
  useUi.subscribe((s, prev) => {
    if (s.focus !== prev.focus) explainFocus(s.focus);
  });
  useLive.subscribe((s, prev) => {
    if (prev.snapshot?.failure && !s.snapshot?.failure) onRestored();
  });
  onCoreEvents(onEvents);

  let last = now();
  window.setInterval(() => {
    const t = now();
    const dt = Math.min(1, t - last);
    last = t;
    settleBuild(t);
    watchChaos(t);
    judgeResult(t);
    watchEngine(t, dt);
    watchLesson(dt);
  }, TICK_MS);
}
