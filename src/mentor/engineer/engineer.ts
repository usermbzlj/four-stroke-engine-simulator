/**
 * 老周 as an engineer rather than a dial-twiddler.
 *
 *   1. 体检   run the build, read the logs, say what limits it and why
 *   2. 标定   map the ECU point by point the way a calibrator does on a cell:
 *             spark to MBT or the knock line, mixture, cam phase, boost;
 *             idle and fuel cut until a blip comes back without stalling
 *   3. 对症   try the remedies each finding points to, several at once,
 *             keep what works, re-map after anything that moves the knock line
 *   4. 整车   shift points from the torque curve, launch rpm and clutch,
 *             gearing for the event
 *   5. 细调   pattern search over everything relevant for what is left
 *   6. 复核   the full schedule, then again on a different day; never hand
 *             back something worse than what came in
 */

import { hpOf, torqueAt } from '../../game/acceptance';
import { MAP_RPM, rodBreakRpm, safeLimiterRpm, valveFloatRpm, type EcuConfig, type EngineConfig } from '../../sim/config';
import { overallRatio, type VehicleConfig } from '../../sim/vehicle';
import { effectiveGoals, eventsFor, gap, GOALS, planFor, quickPlanFor, score, type Brief, type Goal } from '../goals';
import { rodStrengthFor, springFor } from '../advice';
import { costOf, ctxOf, goalName, repair, search, summary, type Build, type EvalJob, type SearchHooks, type SearchOutcome, type Tried } from '../search';
import { idleVerdict, stressSpecs, verdictText } from './idle';
import { columnsFor, setColumn, wotFrom, type TaskOut, type TaskSpec } from './tasks';

export interface EngineerHooks extends SearchHooks {
  tasks: (config: EngineConfig, ecu: EcuConfig, specs: TaskSpec[]) => Promise<TaskOut[]>;
}

export interface Finding {
  id: string;
  text: string;
}

interface Remedy {
  text: string;
  build: Build;
  /** Moves the knock line: re-map the spark if kept. */
  remap?: boolean;
}

const RACE_EVENTS_ROLLING = new Set(['overtake', 'top']);
const has = (brief: Brief, part: string): boolean => (brief.parts as string[]).includes(part) || (brief.vehicleParts as string[]).includes(part);
const fmt = (v: number): string => Math.round(v).toLocaleString('en-US');
const powerGoal = (goals: Goal[]): boolean => goals.some((g) => ['peakHp', 'hpAt', 'peakTorque', 'torqueAt', 'raceTime', 'topSpeed'].includes(g.kind));

/** Read a run like an engineer reads a log sheet. */
export function diagnose(t: Tried, brief: Brief): Finding[] {
  const out: Finding[] = [];
  const r = t.result;
  const pts = r.points;
  const c = t.config;
  const e = t.ecu;
  if (!r.started) out.push({ id: 'nostart', text: '打不着。' });
  if (r.failure) out.push({ id: 'broke', text: `验收中坏了：${r.failure.title}。` });
  if (r.blip?.stalled || (r.blip && r.blip.min < 500)) {
    out.push({
      id: 'stall',
      text: e.overrunFuelCut
        ? `轰一脚油门松开就熄火：松油门断油恢复得太晚（怠速上 ${fmt(e.overrunResumeAbove)} 转才回油），飞轮 ${c.flywheelInertia.toFixed(3)} 掉转太快。`
        : '轰一脚油门松开就熄火：转速掉下来的时候扭矩接不上。',
    });
  } else if (r.blip && r.blip.end > e.idleRpm + 900) out.push({ id: 'hang', text: `松油门以后转速挂在 ${fmt(r.blip.end)} 下不来，节气门缓冲留的气太多。` });
  if (r.idle && r.idle.min > 0 && r.idle.max - r.idle.min > 500) out.push({ id: 'hunt', text: `怠速在 ${fmt(r.idle.min)}–${fmt(r.idle.max)} 之间游车。` });
  if (r.idle && r.idle.min <= 0) out.push({ id: 'idlestall', text: '怠速自己就熄了。' });
  else {
    const want = brief.goals.find((g) => g.kind === 'idleMin');
    if (r.idle && ((want && r.idle.min < want.value) || r.idle.min < e.idleRpm * 0.75))
      out.push({ id: 'idlelow', text: `怠速最低掉到 ${fmt(r.idle.min)}${want ? `，客户要不低于 ${fmt(want.value)}` : `，目标是 ${fmt(e.idleRpm)}`}。` });
  }

  if (pts.length) {
    const knocky = pts.filter((p) => p.retard > 2 || p.knock > 0.1);
    if (knocky.length) {
      const lo = knocky[0]!.rpm;
      const hi = knocky[knocky.length - 1]!.rpm;
      out.push({ id: 'knock', text: `${fmt(lo)}${hi > lo ? `–${fmt(hi)}` : ''} 转爆震，ECU 退了最多 ${Math.max(...knocky.map((p) => p.retard)).toFixed(1)}°，这段的劲被点火角吃掉了。` });
    }
    const veMax = Math.max(...pts.map((p) => p.ve));
    const top = pts[pts.length - 1]!;
    if (top.ve < veMax * 0.75) out.push({ id: 'breathe', text: `高转喘不上气：充气效率从 ${(veMax * 100).toFixed(0)}% 掉到 ${fmt(top.rpm)} 转的 ${(top.ve * 100).toFixed(0)}%。` });
    const peakIdx = pts.reduce((bi, p, i) => (hpOf(p.rpm, p.torque) > hpOf(pts[bi]!.rpm, pts[bi]!.torque) ? i : bi), 0);
    if (peakIdx >= pts.length - 1 && pts.length > 2) {
      const safe = safeLimiterRpm(c);
      const float = valveFloatRpm(c);
      const rod = rodBreakRpm(c) * 0.89;
      out.push({
        id: 'revs',
        text:
          e.limiterRpm < safe - 300
            ? `功率到断火 ${fmt(e.limiterRpm)} 还在涨，零件能扛到 ${fmt(safe)}：断火可以往上放。`
            : `功率到断火还在涨，但再往上${float < rod ? `气门会飘（${fmt(float)}）：要更硬的弹簧` : `连杆扛不住（${fmt(rod)}）：要更结实的连杆、更轻的活塞`}。`,
      });
    }
    const duty = Math.max(...pts.map((p) => p.injDuty));
    if (duty > 0.85) out.push({ id: 'injector', text: `喷油嘴占空比 ${(duty * 100).toFixed(0)}%，已经喷到头了，再加劲只会变稀。` });
    const lean = pts.filter((p) => p.lambda > e.wotLambda + 0.08);
    if (lean.length) out.push({ id: 'lean', text: `${fmt(lean[0]!.rpm)} 转以上实际空燃比偏稀（λ ${lean[0]!.lambda.toFixed(2)}）。` });
    if (c.turboSize > 0) {
      const low = pts.filter((p) => p.rpm <= 4000);
      const maxTarget = Math.max(...e.boostTable, 35);
      if (low.length && Math.max(...low.map((p) => p.boostKpa)) < maxTarget * 0.5) out.push({ id: 'lag', text: '低转涡轮没起来，迟滞重。' });
      if (top.boostKpa < maxTarget * 0.7 && top.rpm > 5000) out.push({ id: 'choke', text: `高转增压掉到 ${top.boostKpa.toFixed(0)} kPa：涡轮太小，喘不过气。` });
    }
  }
  if (r.coolantMax > 110) out.push({ id: 'hot', text: `水温到了 ${r.coolantMax.toFixed(0)} °C。` });
  const need = revsNeeded(brief);
  if (need > 0 && need > safeLimiterRpm(c) - 50) {
    const float = valveFloatRpm(c) * 0.97;
    const rod = rodBreakRpm(c) * 0.876;
    out.push({
      id: 'ceiling',
      text: `要转到 ${fmt(need)}，这套零件只扛得住 ${fmt(safeLimiterRpm(c))}：气门 ${fmt(float)} 开始飘${float < need ? '（不够）' : ''}，连杆 ${fmt(rod)} 开始疲劳${rod < need ? '（不够）' : ''}。`,
    });
  }
  const weak = brief.goals.filter((g) => ['peakHp', 'hpAt', 'peakTorque', 'torqueAt', 'raceTime', 'topSpeed'].includes(g.kind) && (gap(g, ctxOf(t)) ?? 0) > 0);
  if (weak.length && !out.some((f) => f.id === 'breathe'))
    out.push({ id: 'power', text: `${[...new Set(weak.map((g) => goalName(g)))].join('、')}还差：要么多吸气（凸轮、气门、进排气管），要么转得更高，要么排量更大。` });

  for (const [id, rr] of Object.entries(t.races)) {
    if (!rr) continue;
    if (rr.dnf === 'stall') out.push({ id: 'launchstall', text: '起步憋熄火了：起步转速太低或者离合放太快。' });
    if (rr.dnf === 'crash') out.push({ id: 'loop', text: '起步抬头翻了。' });
    if (rr.dnf === 'limiter') out.push({ id: 'short', text: '最高挡撞断火了还没到速度：末挡太短。' });
    if (rr.spinTime > 0.35) out.push({ id: 'spin', text: `起步后轮空转了 ${rr.spinTime.toFixed(2)} 秒。` });
    if (rr.wheelieTime > 0.4 || rr.maxPitch > 0.25) out.push({ id: 'wheelie', text: `车头抬起来 ${rr.wheelieTime.toFixed(2)} 秒，劲都用来抬头了。` });
    // How much of the run the engine spent where it makes its power.
    if (rr.trace.length > 20 && r.peakHpRpm > 0 && !RACE_EVENTS_ROLLING.has(id)) {
      const run = rr.trace.filter((p) => p[0]! > 1.5);
      const inBand = run.filter((p) => p[3]! >= r.peakHpRpm * 0.8).length / Math.max(1, run.length);
      if (inBand < 0.65) out.push({ id: 'band', text: `跑的时候只有 ${Math.round(inBand * 100)}% 的时间待在功率带（${fmt(r.peakHpRpm * 0.8)} 转以上）：齿比太长或者挡位间隔太大。` });
    }
    const peakTq = r.peakTorqueRpm;
    const drops = rr.shifts.filter((s) => s.rpmAfter < peakTq * 0.75);
    if (drops.length) out.push({ id: 'gaps', text: `换挡后转速掉到 ${fmt(Math.min(...drops.map((s) => s.rpmAfter)))}，掉出了扭矩带。` });
    if (id === 'top' && !rr.dnf && brief.goals.some((g) => g.kind === 'topSpeed' && (gap(g, ctxOf(t)) ?? 0) > 0)) {
      const v = rr.topKmh / 3.6;
      const dragKw = (0.6 * t.vehicle.cdA * v * v * v) / 1000;
      out.push({ id: 'drag', text: `极速 ${rr.topKmh.toFixed(0)} km/h 时光风阻就吃掉 ${dragKw.toFixed(1)} kW：要么减风阻，要么让末挡正好落在功率峰。` });
    }
    if (id === 'top' && !rr.dnf) {
      const rpmTop = (rr.topKmh / 3.6 / t.vehicle.tireRadius) * overallRatio(t.vehicle, t.vehicle.gears.length) * (30 / Math.PI);
      if (rpmTop > e.limiterRpm - 250) out.push({ id: 'topshort', text: `极速 ${rr.topKmh.toFixed(0)} km/h 时已经顶着断火：末挡太短。` });
      else if (rpmTop < r.peakHpRpm * 0.85) out.push({ id: 'toplong', text: `极速时才 ${fmt(rpmTop)} 转，离功率峰 ${fmt(r.peakHpRpm)} 还远：末挡太长。` });
    }
  }
  void brief;
  return out;
}

/** The rpm the goals need the engine to reach (with a little margin), 0 if none. */
function revsNeeded(brief: Brief): number {
  let need = 0;
  for (const g of brief.goals) {
    if (g.kind === 'limiterMin') need = Math.max(need, g.value + 150);
    if ((g.kind === 'hpAt' || g.kind === 'torqueAt') && g.rpm) need = Math.max(need, g.rpm + 400);
  }
  return need;
}

/** What each finding suggests, as concrete builds to try. */
function remedies(t: Tried, f: Finding[], brief: Brief): Remedy[] {
  const out: Remedy[] = [];
  const b: Build = { config: t.config, ecu: t.ecu, vehicle: t.vehicle, wish: t.wish };
  const cfg = (patch: Partial<EngineConfig>): Build => ({ ...b, config: { ...b.config, ...patch } });
  const ecu = (patch: Partial<EcuConfig>): Build => ({ ...b, ecu: { ...b.ecu, ...patch } });
  const veh = (patch: Partial<VehicleConfig>): Build => ({ ...b, vehicle: { ...b.vehicle, ...patch } });
  const ids = new Set(f.map((x) => x.id));
  const c = t.config;
  const want = powerGoal(brief.goals);
  const ecuOk = brief.ecu;

  if (ids.has('knock')) {
    const cap = brief.goals.find((g) => g.kind === 'octaneMax' && g.must)?.value ?? 102;
    if (has(brief, 'fuel') && c.fuelOctane + 3 <= cap) out.push({ text: '换高 3 号的油', build: cfg({ fuelOctane: c.fuelOctane + 3 }), remap: true });
    if (has(brief, 'piston')) out.push({ text: '压缩比降 0.6', build: cfg({ compressionRatio: c.compressionRatio - 0.6 }), remap: true });
    if (c.turboSize > 0 && has(brief, 'intercooler')) out.push({ text: '中冷加大', build: cfg({ intercooler: Math.min(0.85, c.intercooler + 0.25) }), remap: true });
    if (ecuOk) out.push({ text: '全油门加浓 0.04', build: ecu({ wotLambda: Math.max(0.75, t.ecu.wotLambda - 0.04) }) });
  }
  if ((ids.has('breathe') || ids.has('power')) && want) {
    if (has(brief, 'cam')) out.push({ text: '凸轮持续角各加 12°', build: cfg({ intakeDuration: c.intakeDuration + 12, exhaustDuration: c.exhaustDuration + 12 }), remap: true });
    if (has(brief, 'head')) out.push({ text: '气门加大 2 mm', build: cfg({ intakeValveDiameter: c.intakeValveDiameter + 2, exhaustValveDiameter: c.exhaustValveDiameter + 1.5 }) });
    if (has(brief, 'throttle')) out.push({ text: '节气门加大 4 mm', build: cfg({ throttleDiameter: c.throttleDiameter + 4 }) });
    if (has(brief, 'intake')) out.push({ text: '进气道缩短 60 mm', build: cfg({ intakeRunnerLength: c.intakeRunnerLength - 60 }) });
    if (has(brief, 'header')) out.push({ text: '排气头段缩短 120 mm', build: cfg({ exhaustHeaderLength: c.exhaustHeaderLength - 120 }) });
    if (ids.has('power')) {
      if (has(brief, 'cam')) out.push({ text: '凸轮升程加大、夹角收紧', build: cfg({ intakeLift: c.intakeLift + 1.5, exhaustLift: c.exhaustLift + 1.5, lobeSeparation: c.lobeSeparation - 3 }), remap: true });
      if (has(brief, 'header')) out.push({ text: '排气头段加长 250 mm', build: cfg({ exhaustHeaderLength: c.exhaustHeaderLength + 250 }) });
      if (has(brief, 'intake')) out.push({ text: '进气道加长 80 mm', build: cfg({ intakeRunnerLength: c.intakeRunnerLength + 80 }) });
      if (has(brief, 'muffler') && c.muffler === 'stock' && (!brief.mufflers || brief.mufflers.includes('sport'))) out.push({ text: '换运动消音器', build: cfg({ muffler: 'sport' }) });
      if (has(brief, 'piston') && !ids.has('knock')) out.push({ text: '压缩比加 1', build: cfg({ compressionRatio: c.compressionRatio + 1 }), remap: true });
      if (ecuOk && t.ecu.limiterRpm < safeLimiterRpm(c) - 300) out.push({ text: '断火往上放到零件能扛的地方', build: { ...b, wish: safeLimiterRpm(c) } });
    }
  }
  if (ids.has('revs') && want) {
    const safe = safeLimiterRpm(c);
    if (t.ecu.limiterRpm < safe - 300 && ecuOk) out.push({ text: `断火放到 ${fmt(Math.floor(safe / 50) * 50)}`, build: { ...b, wish: safe } });
    else {
      if (has(brief, 'springs')) out.push({ text: '气门弹簧加硬 150 N，断火跟着上', build: { ...cfg({ valveSpringForce: c.valveSpringForce + 150 }), wish: b.wish + 800 } });
      if (has(brief, 'rod')) out.push({ text: '换锻造连杆，断火跟着上', build: { ...cfg({ rodStrength: c.rodStrength + 3000 }), wish: b.wish + 800 } });
      if (has(brief, 'piston')) out.push({ text: '换轻活塞，断火跟着上', build: { ...cfg({ reciprocatingMass: c.reciprocatingMass - 0.05 }), wish: b.wish + 600 }, remap: true });
    }
  }
  if (ids.has('ceiling')) {
    // Size the parts for the speed, the way an engine builder would.
    // Held at the limiter for a while: fatigue needs more margin than a quick sweep.
    const need = (revsNeeded(brief) + 200) * (brief.plan.endurance ? 1.03 : 1);
    const springs = springFor(c, need / 0.97);
    const rodNeed = rodStrengthFor(c, need);
    const floatShort = valveFloatRpm(c) * 0.97 < need;
    const rodShort = rodBreakRpm(c) * 0.876 < need;
    let pkg: Partial<EngineConfig> = {};
    const words: string[] = [];
    if (floatShort && has(brief, 'springs')) {
      pkg = { ...pkg, valveSpringForce: springs };
      words.push(`弹簧 ${fmt(springs)} N`);
    }
    if (rodShort) {
      // Lighter piston first (cheaper), else a stronger rod.
      const lighter = c.reciprocatingMass * Math.pow(rodBreakRpm(c) * 0.876 / need, 2);
      if (has(brief, 'piston') && lighter >= 0.15) {
        pkg = { ...pkg, reciprocatingMass: Math.floor(lighter * 100) / 100 };
        words.push(`活塞减到 ${(Math.floor(lighter * 100) * 10).toFixed(0)} g`);
      } else if (has(brief, 'rod')) {
        pkg = { ...pkg, rodStrength: rodNeed };
        words.push(`连杆强度 ${fmt(rodNeed)} N`);
      }
    }
    if (words.length) out.push({ text: `按 ${fmt(need)} 转配零件：${words.join('、')}，断火跟上`, build: { ...cfg(pkg), wish: need } });
    if (floatShort && has(brief, 'cam')) out.push({ text: '凸轮升程降 1.5 mm（气门跑得慢就不飘）', build: { ...cfg({ intakeLift: c.intakeLift - 1.5, exhaustLift: c.exhaustLift - 1.5 }), wish: need } });
    if (rodShort && has(brief, 'rod')) out.push({ text: `连杆强度加到 ${fmt(rodNeed)} N`, build: { ...cfg({ rodStrength: rodNeed }), wish: need } });
    if (rodShort && has(brief, 'piston')) {
      for (const k of [1, 0.94]) {
        const m = Math.floor(c.reciprocatingMass * Math.pow((rodBreakRpm(c) * 0.876) / need, 2) * k * 100) / 100;
        if (m >= 0.15) out.push({ text: `只换轻活塞（${Math.round(m * 1000)} g）`, build: { ...cfg({ reciprocatingMass: m }), wish: need } });
      }
    }
    if (floatShort && has(brief, 'springs')) out.push({ text: `弹簧加到 ${fmt(springs)} N`, build: { ...cfg({ valveSpringForce: springs }), wish: need } });
  }
  if (ids.has('injector') || ids.has('lean')) {
    if (has(brief, 'injector')) out.push({ text: '喷油嘴加大 35%', build: cfg({ injectorFlow: Math.round((c.injectorFlow * 1.35) / 10) * 10 }) });
  }
  if (ids.has('lag')) {
    if (has(brief, 'turbo')) out.push({ text: '换小一号涡轮', build: cfg({ turboSize: Math.max(0.4, c.turboSize - 0.25) }), remap: true });
    if (ecuOk && !t.ecu.antiLag) out.push({ text: '开防迟滞', build: ecu({ antiLag: true }) });
  }
  if (ids.has('choke') && has(brief, 'turbo')) out.push({ text: '换大一号涡轮', build: cfg({ turboSize: Math.min(2, c.turboSize + 0.3) }), remap: true });
  if (ids.has('hot') && has(brief, 'radiator')) out.push({ text: '散热器加大', build: cfg({ radiatorCapacity: Math.min(2, c.radiatorCapacity + 0.4) }) });

  // A big shortfall on power with forced induction allowed: the whole package at once.
  const short = effectiveGoals(brief.goals).filter((g) => ['peakHp', 'hpAt', 'peakTorque', 'torqueAt', 'raceTime'].includes(g.kind) && (gap(g, ctxOf(t)) ?? 0) > 0.15);
  // Big-ticket packages only when the money is there (or nobody set a budget).
  const budget = brief.goals.find((g) => g.kind === 'budget')?.value ?? Infinity;
  const spare = budget - t.cost;
  if (want && short.length && c.turboSize <= 0 && has(brief, 'turbo') && has(brief, 'injector') && ecuOk && spare >= 5000) {
    const pkg: Partial<EngineConfig> = { turboSize: 0.8, injectorFlow: Math.round((c.injectorFlow * 1.7) / 10) * 10 };
    if (has(brief, 'intercooler')) pkg.intercooler = 0.65;
    if (has(brief, 'piston')) pkg.compressionRatio = Math.max(8, c.compressionRatio - 1.5);
    out.push({ text: '上涡轮套件：涡轮、中冷、大喷油嘴、低压缩活塞', build: { ...cfg(pkg), ecu: { ...t.ecu, boostTable: t.ecu.boostTable.map(() => 60), advanceOffset: t.ecu.advanceOffset - 4 } }, remap: true });
  }
  if (want && short.length && c.vvtRange <= 0 && has(brief, 'vvt') && ecuOk && spare >= 1600) out.push({ text: '装可变气门正时', build: cfg({ vvtRange: 30 }), remap: true });

  // On the strip.
  if (ids.has('spin') || ids.has('launchstall') || ids.has('loop') || ids.has('wheelie')) {
    if (ecuOk) {
      if (ids.has('spin')) out.push({ text: '开牵引力控制（滑移 12%）', build: ecu({ tractionControl: 0.12 }) });
      if (ids.has('wheelie') || ids.has('loop')) out.push({ text: '开防抬头', build: ecu({ wheelieControl: true }) });
    }
    out.push({ text: '离合放慢 0.3 秒', build: veh({ clutchRelease: Math.min(2, t.vehicle.clutchRelease + 0.3) }) });
    if (has(brief, 'tires') && ids.has('spin')) out.push({ text: '换更粘的胎', build: veh({ tireGrip: Math.min(1.7, t.vehicle.tireGrip + 0.15) }) });
    if (has(brief, 'geometry') && (ids.has('wheelie') || ids.has('loop'))) out.push({ text: '加长轴距、降低重心', build: veh({ wheelbase: Math.min(1.7, t.vehicle.wheelbase + 0.08), cgHeight: Math.max(0.2, t.vehicle.cgHeight - 0.06) }) });
  }
  if (ids.has('band')) {
    if (has(brief, 'sprocket')) {
      out.push({ text: '主减速比缩短 8%', build: veh({ finalDrive: t.vehicle.finalDrive * 1.08 }) });
      out.push({ text: '主减速比缩短 15%', build: veh({ finalDrive: t.vehicle.finalDrive * 1.15 }) });
    }
    if (has(brief, 'gearbox')) {
      const g = t.vehicle.gears;
      const spread = Math.pow(g[0]! / g[g.length - 1]!, 1 / (g.length - 1));
      out.push({ text: '齿比收紧（挡位靠近）', build: veh({ gears: g.map((_x, i) => g[0]! / Math.pow(spread * 0.93, i)) }) });
    }
  }
  if (ids.has('gaps') && has(brief, 'gearbox')) out.push({ text: '齿比收紧', build: veh({ gears: t.vehicle.gears.map((_g, i) => t.vehicle.gears[0]! / Math.pow(Math.pow(t.vehicle.gears[0]! / t.vehicle.gears[t.vehicle.gears.length - 1]!, 1 / (t.vehicle.gears.length - 1)) * 0.95, i)) }) });
  if ((ids.has('short') || ids.has('topshort')) && has(brief, 'sprocket')) out.push({ text: '主减速比放长 8%', build: veh({ finalDrive: t.vehicle.finalDrive * 0.92 }) });
  if (ids.has('drag')) {
    if (has(brief, 'fairing')) out.push({ text: '装整流罩', build: veh({ cdA: Math.max(0.25, t.vehicle.cdA - 0.1) }) });
    if (has(brief, 'sprocket')) {
      out.push({ text: '主减速比放长 5%', build: veh({ finalDrive: t.vehicle.finalDrive * 0.95 }) });
      out.push({ text: '主减速比缩短 5%', build: veh({ finalDrive: t.vehicle.finalDrive * 1.05 }) });
    }
  }
  if (ids.has('toplong') && has(brief, 'sprocket')) out.push({ text: '主减速比缩短 8%', build: veh({ finalDrive: t.vehicle.finalDrive * 1.08 }) });
  if (ids.has('stall') || ids.has('idlestall') || ids.has('idlelow') || ids.has('hang') || ids.has('hunt')) out.push(...idleRemedies(t, ids, brief));
  return out;
}

/** ECU changes that stop a stall, smallest first. */
export function stallVariants(e: EcuConfig): { text: string; patch: Partial<EcuConfig> }[] {
  return [
    { text: '恢复供油提早 500 转', patch: { overrunResumeAbove: e.overrunResumeAbove + 500, overrunCutAbove: Math.max(e.overrunCutAbove, e.overrunResumeAbove + 800) } },
    { text: '加 6° 怠速点火储备', patch: { idleSparkReserve: Math.max(6, e.idleSparkReserve) } },
    { text: '节气门缓冲多留一点', patch: { dashpot: Math.min(0.5, e.dashpot + 0.12) } },
    { text: '怠速控制力度加大', patch: { idleGain: Math.min(3, e.idleGain * 1.6) } },
    { text: '怠速提高 200 转', patch: { idleRpm: e.idleRpm + 200 } },
    { text: '恢复供油提早 1000 转', patch: { overrunResumeAbove: e.overrunResumeAbove + 1000, overrunCutAbove: Math.max(e.overrunCutAbove, e.overrunResumeAbove + 1300) } },
    {
      text: '断油晚回 + 点火储备 + 怠速 +200',
      patch: { overrunResumeAbove: e.overrunResumeAbove + 700, overrunCutAbove: Math.max(e.overrunCutAbove, e.overrunResumeAbove + 1000), idleSparkReserve: 6, idleRpm: e.idleRpm + 200 },
    },
    { text: '起动和怠速加浓一点', patch: { crankLambda: Math.max(0.7, e.crankLambda - 0.08), cruiseLambda: Math.max(0.85, e.cruiseLambda - 0.05), idleRpm: e.idleRpm + 150 } },
  ];
}

function idleRemedies(t: Tried, ids: Set<string>, brief: Brief): Remedy[] {
  if (!brief.ecu) return [];
  const e = t.ecu;
  const b: Build = { config: t.config, ecu: e, vehicle: t.vehicle, wish: t.wish };
  const ecu = (patch: Partial<EcuConfig>): Build => ({ ...b, ecu: { ...e, ...patch } });
  const out: Remedy[] = [];
  if (ids.has('stall') || ids.has('idlestall')) for (const v of stallVariants(e)) out.push({ text: v.text, build: ecu(v.patch) });
  if (ids.has('idlelow')) {
    const want = brief.goals.find((g) => g.kind === 'idleMin')?.value ?? 0;
    const target = Math.max(e.idleRpm + 200, Math.ceil((want + 250) / 50) * 50);
    out.push({ text: `怠速目标提到 ${fmt(target)}`, build: ecu({ idleRpm: target }) });
    out.push({ text: `怠速提到 ${fmt(target)}，部分负荷 λ 回到 1.0`, build: ecu({ idleRpm: target, cruiseLambda: 1 }) });
    out.push({ text: '怠速控制力度加大', build: ecu({ idleGain: Math.min(3, e.idleGain * 1.5) }) });
    out.push({ text: '加 5° 怠速点火储备', build: ecu({ idleSparkReserve: Math.max(5, e.idleSparkReserve) }) });
  }
  if (ids.has('hang')) out.push({ text: '节气门缓冲少留、快放', build: ecu({ dashpot: Math.max(0, e.dashpot - 0.12), dashpotTime: Math.max(0.1, e.dashpotTime * 0.6) }) });
  if (ids.has('hunt')) out.push({ text: '怠速控制收柔一点', build: ecu({ idleGain: Math.max(0.3, e.idleGain * 0.7) }) });
  return out;
}

/** Fastest up-shift per gear: where the next gear's wheel thrust overtakes this one's. */
export function shiftPoints(curve: [number, number][], v: VehicleConfig, limiter: number): number[] {
  const out: number[] = [];
  for (let g = 1; g < v.gears.length; g++) {
    const k = overallRatio(v, g + 1) / overallRatio(v, g);
    let best = limiter - 150;
    for (let rpm = Math.max(3000, curve[0]?.[0] ?? 3000); rpm <= limiter - 150; rpm += 50) {
      // Same road speed: the next gear turns the engine slower (×k) and multiplies its torque less (×k).
      const now = torqueAt(curve, rpm);
      const after = torqueAt(curve, rpm * k) * k;
      if (now > 0 && after > now) {
        best = rpm;
        break;
      }
    }
    out.push(Math.round(best / 50) * 50);
  }
  return out;
}

const chunk = <T,>(xs: T[], n: number): T[][] => {
  const out: T[][] = Array.from({ length: Math.max(1, Math.min(n, xs.length)) }, () => []);
  xs.forEach((x, i) => out[i % out.length]!.push(x));
  return out.filter((c) => c.length);
};

/** Map the ECU on the current hardware: spark, mixture, cam, boost. */
async function calibrate(b: Build, hooks: EngineerHooks, brief: Brief, what: ('spark' | 'lambda' | 'cam' | 'boost')[]): Promise<Build> {
  let ecu = b.ecu;
  const cols = columnsFor(ecu);
  const width = Math.max(1, hooks.width);
  for (const kind of what) {
    if (hooks.stopped()) break;
    if (kind === 'cam' && b.config.vvtRange <= 0) continue;
    if (kind === 'boost' && b.config.turboSize <= 0) continue;
    const specs: TaskSpec[] = chunk(cols, width).map((rpms) => (kind === 'boost' ? { kind, rpms, max: 200 } : { kind, rpms }));
    const outs = await hooks.tasks(b.config, ecu, specs);
    const colsOut = outs.flatMap((o) => (o.kind === 'columns' ? o.columns : []));
    if (colsOut.length === 0) continue;
    const say: string[] = [];
    for (const c of colsOut) {
      if (kind === 'spark') ecu = { ...ecu, sparkTable: setColumn(ecu.sparkTable, c.rpm, c.value, wotFrom(c.load)) };
      if (kind === 'lambda') ecu = { ...ecu, lambdaTable: setColumn(ecu.lambdaTable, c.rpm, c.value, wotFrom(c.load)) };
      if (kind === 'cam') ecu = { ...ecu, camTable: setColumn(ecu.camTable, c.rpm, c.value, 0.6) };
      if (kind === 'boost') ecu = { ...ecu, boostTable: ecu.boostTable.map((x, j) => (MAP_RPM[j] === c.rpm ? c.value : x)) };
    }
    // Fill the columns beyond the measured ones with their neighbours.
    if (kind === 'boost') {
      const last = colsOut.reduce((a, c2) => (c2.rpm > a.rpm ? c2 : a)).value;
      ecu = { ...ecu, boostTable: ecu.boostTable.map((x, j) => (MAP_RPM[j]! > Math.max(...colsOut.map((c2) => c2.rpm)) ? last : x)) };
    }
    const knockCols = colsOut.filter((c) => c.limitedBy === 'knock').map((c) => c.rpm);
    if (kind === 'spark')
      say.push(
        `点火逐点找完：${colsOut
          .sort((a, b2) => a.rpm - b2.rpm)
          .map((c) => `${c.rpm / 1000}k ${c.value > 0 ? '+' : ''}${c.value}°`)
          .join('、')}${knockCols.length ? `（${knockCols.map((r) => r / 1000 + 'k').join('、')} 是爆震线卡住的）` : ''}。`,
      );
    if (kind === 'lambda') say.push('空燃比逐点找完：取出力最好里最浓的那档，燃烧室凉一点。');
    if (kind === 'cam') say.push(`凸轮相位逐点找完：${colsOut.map((c) => `${c.rpm / 1000}k ${c.value}°`).join('、')}。`);
    if (kind === 'boost') {
      const walls = colsOut.filter((c) => c.limitedBy === 'knock' || c.limitedBy === 'injector');
      say.push(`增压逐点加到头：最高 ${Math.max(...colsOut.map((c) => c.value))} kPa${walls.length ? `，${walls.some((w) => w.limitedBy === 'injector') ? '喷油嘴' : '爆震'}卡住了一部分` : ''}。`);
    }
    for (const line of say) hooks.log(line);
  }
  void brief;
  return { ...b, ecu };
}

export async function engineer(brief: Brief, from: Build, hooks: EngineerHooks, budget = 300): Promise<SearchOutcome> {
  const goals = brief.goals;
  const all = effectiveGoals(goals);
  const events = eventsFor(goals);
  const quick = quickPlanFor(all, brief.plan);
  const full = planFor(all, brief.plan);
  let tried = 0;
  const cache = new Map<string, Tried>();
  const sig = (b: Build): string => JSON.stringify([b.config, b.ecu, b.vehicle]);

  const run = async (builds: Build[], plan = quick, reuse?: Tried): Promise<Tried[]> => {
    const fixed = builds.map((b) => repair(b, brief));
    const todo = fixed.filter((b) => plan !== quick || !cache.has(sig(b)));
    const jobs: EvalJob[] = todo.map((b) => ({ config: b.config, ecu: b.ecu, vehicle: b.vehicle, plan, events, ...(reuse ? { reuse: reuse.result } : {}) }));
    const outs = jobs.length ? await hooks.evaluate(jobs) : [];
    tried += todo.length;
    const fresh = todo.map((b, i): Tried => {
      const cost = costOf(brief, b);
      const { result, races } = outs[i]!;
      return { ...b, result, races, cost, score: score(goals, { config: b.config, ecu: b.ecu, cost, result, races }) };
    });
    if (plan !== quick) return fresh;
    for (const t of fresh) cache.set(sig(t), t);
    return fixed.map((b) => cache.get(sig(b))!);
  };

  // ---- 1. 体检 ----
  hooks.stage('体检：先按验收流程跑一遍原样');
  const [q0, f0] = await Promise.all([run([from]), run([from], full)]);
  const start0 = q0[0]!;
  const startFull = f0[0]!;
  let cur = start0;
  hooks.log(`原样：${summary(goals, cur)}`);
  hooks.progress(cur, tried, budget);
  const findings = diagnose(cur, brief);
  if (findings.length === 0) hooks.log('诊断：没看到明显毛病，直接往目标上凑。');
  for (const f of findings) hooks.log(`诊断：${f.text}`);

  const accept = (next: Tried, why: string): boolean => {
    if (next.score.loss < cur.score.loss - 1e-6) {
      hooks.log(`${why}：${summary(goals, next)}`);
      cur = next;
      hooks.progress(cur, tried, budget);
      return true;
    }
    return false;
  };

  // ---- 2. 标定 ----
  const wot = powerGoal(goals) || goals.some((g) => g.kind === 'piston' || g.kind === 'pops');
  if (brief.ecu && !hooks.stopped() && wot) {
    hooks.stage('标定：在台架上逐点找点火、空燃比、凸轮、增压');
    const mapped = await calibrate(cur, hooks, brief, ['spark', 'lambda', 'cam', 'boost', 'spark']);
    const [t] = await run([mapped]);
    if (!accept(t!, '按逐点标定的表跑')) hooks.log('逐点标定的表没比原来的好，先不换。');
  }

  // ---- 3. 对症 ----
  for (let round = 0; round < 4 && !hooks.stopped() && tried < budget * 0.5; round++) {
    const f = diagnose(cur, brief);
    const tries = remedies(cur, f, brief).filter((r) => sig(repair(r.build, brief)) !== sig(cur));
    if (tries.length === 0) break;
    hooks.stage(`对症下药：同时试 ${tries.length} 个办法（第 ${round + 1} 轮）`);
    const res = await run(tries.map((r) => r.build));
    // Within budget first: a cheap fix that helps beats a dear one that helps more.
    const cap = goals.find((g) => g.kind === 'budget')?.value ?? Infinity;
    const better = res.map((r, i) => ({ r, i })).filter(({ r }) => r.score.loss < cur.score.loss - 1e-6);
    const pool = better.some(({ r }) => r.cost <= cap) ? better.filter(({ r }) => r.cost <= cap) : better;
    const bi = pool.length ? pool.reduce((a, b2) => (b2.r.score.loss < a.r.score.loss ? b2 : a)).i : -1;
    if (bi < 0) {
      hooks.log(`这一轮 ${tries.length} 个办法都没让它更好：${tries.map((r) => r.text).join('、')}。`);
      break;
    }
    // Combine the winners, like a mechanic who found two things that both help.
    const winners = pool;
    let pick = res[bi]!;
    let text = tries[bi]!.text;
    let remap = tries[bi]!.remap ?? false;
    if (winners.length >= 2) {
      let merged: Build = { config: cur.config, ecu: cur.ecu, vehicle: cur.vehicle, wish: cur.wish };
      for (const { i } of winners) {
        const w = tries[i]!.build;
        merged = {
          config: { ...merged.config, ...Object.fromEntries(Object.entries(w.config).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify((cur.config as unknown as Record<string, unknown>)[k]))) },
          ecu: { ...merged.ecu, ...Object.fromEntries(Object.entries(w.ecu).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify((cur.ecu as unknown as Record<string, unknown>)[k]))) },
          vehicle: { ...merged.vehicle, ...Object.fromEntries(Object.entries(w.vehicle).filter(([k, v]) => JSON.stringify(v) !== JSON.stringify((cur.vehicle as unknown as Record<string, unknown>)[k]))) },
          wish: Math.max(merged.wish, w.wish),
        };
      }
      const [m] = await run([merged]);
      if (m && m.score.loss < pick.score.loss) {
        pick = m;
        text = winners.map(({ i }) => tries[i]!.text).join(' + ');
        remap = winners.some(({ i }) => tries[i]!.remap);
      }
    }
    accept(pick, text);
    if (remap && brief.ecu && !hooks.stopped()) {
      hooks.stage('零件动了爆震线：重新找点火');
      const re = await calibrate(cur, hooks, brief, ['spark', 'boost']);
      const [t] = await run([re]);
      accept(t!, '按新零件重标点火');
    }
  }

  // ---- 4. 整车 ----
  if (events.length && !hooks.stopped()) {
    hooks.stage('整车：按扭矩曲线算换挡点，试起步');
    if (brief.ecu && cur.result.curve.length > 2) {
      const pts = shiftPoints(cur.result.curve, cur.vehicle, cur.ecu.limiterRpm);
      const [t] = await run([{ ...cur, ecu: { ...cur.ecu, shiftRpm: pts } }]);
      if (accept(t!, `换挡点按轮上推力交叉算：${pts.map((r, i) => `${i + 1}→${i + 2} ${fmt(r)}`).join('、')}`) === false) hooks.log('算出来的换挡点没比撞断火再换快，保持原样。');
    }
    const standing = events.some((e) => e !== 'overtake' && e !== 'top');
    if (standing) {
      const lim = cur.ecu.limiterRpm;
      const grid: Build[] = [];
      for (const share of brief.ecu ? [0, 0.35, 0.5, 0.65, 0.8] : [0]) {
        for (const rel of [0.3, 0.6, 1.0]) {
          for (const tc of brief.ecu ? [0, 0.12] : [cur.ecu.tractionControl]) {
            grid.push({ ...cur, ecu: { ...cur.ecu, launchRpm: share ? Math.round((lim * share) / 100) * 100 : 0, tractionControl: tc }, vehicle: { ...cur.vehicle, clutchRelease: rel } });
          }
        }
      }
      const res = await run(grid, quick, cur);
      let bi = -1;
      for (let i = 0; i < res.length; i++) if (res[i]!.score.loss < (bi < 0 ? cur.score.loss - 1e-6 : res[bi]!.score.loss)) bi = i;
      if (bi >= 0) {
        const g = res[bi]!;
        accept(g, `起步试了 ${grid.length} 种：${g.ecu.launchRpm ? `弹射 ${fmt(g.ecu.launchRpm)} 转` : '不用弹射'}、离合 ${g.vehicle.clutchRelease} 秒放完${g.ecu.tractionControl ? '、牵引力控制 12%' : ''}`);
      } else hooks.log(`起步试了 ${grid.length} 种组合，原来的就是最好的。`);
    }
  }

  // ---- 5. 细调 + 6. 复核 (the pattern search does both) ----
  const left = Math.max(60, budget - tried);
  hooks.stage('细调');
  const out = await search(brief, { config: cur.config, ecu: cur.ecu, vehicle: cur.vehicle, wish: cur.wish }, hooks, left);
  tried += out.tried;
  let verified = out.verified;

  // A different day: other cycle-to-cycle scatter. Back off if it does not hold.
  if (!hooks.stopped() && verified.score.survived) {
    hooks.stage('换个日子再跑一遍，看稳不稳');
    const [other] = await run([verified], { ...full, seed: 11 });
    const bad = !other!.score.survived || (other!.result.pistonDamage * 100 > 3 && verified.result.pistonDamage * 100 <= 3);
    if (bad) {
      hooks.log(`换个日子跑${other!.result.failure ? `坏了（${other!.result.failure.title}）` : '活塞伤得多'}，点火退 2°、增压降 10% 留余量。`);
      const safer: Build = {
        ...verified,
        ecu: { ...verified.ecu, advanceOffset: verified.ecu.advanceOffset - 2, boostTable: verified.ecu.boostTable.map((x) => Math.round(x * 0.9)) },
      };
      const [v2] = await run([safer], full);
      if (v2!.score.survived) verified = v2!;
    } else hooks.log('换个日子也稳。');
  }

  // Idle that holds once is not idle that holds: every day, warm and cold, blipped and revved.
  if (!hooks.stopped() && brief.ecu && verified.score.survived) {
    hooks.stage('怠速压力测试：不同日子、冷车热车、轻轰猛轰');
    const specs = stressSpecs({ ...(brief.plan.bench ? { bench: { coolantConditioner: true, coolantSetpoint: 85, ...brief.plan.bench } } : {}) });
    const v0 = await idleVerdict(hooks.tasks, verified.config, verified.ecu, specs);
    if (v0.ok) hooks.log(`怠速压力测试：${verdictText(v0)}。稳。`);
    else {
      hooks.log(`怠速压力测试：${verdictText(v0)}。正式验收那一趟碰巧过了，这不算稳，接着治。`);
      const fly = verified.config.flywheelInertia;
      const variants: { text: string; patch: Partial<EcuConfig>; config?: Partial<EngineConfig> }[] = [
        ...stallVariants(verified.ecu),
        ...(has(brief, 'flywheel') ? [{ text: `飞轮加重到 ${(fly + 0.006).toFixed(3)}`, patch: {}, config: { flywheelInertia: fly + 0.006 } }] : []),
        ...(has(brief, 'flywheel')
          ? [{ text: `飞轮加重到 ${(fly + 0.006).toFixed(3)}，断油晚回 500 转`, patch: { overrunResumeAbove: verified.ecu.overrunResumeAbove + 500, overrunCutAbove: Math.max(verified.ecu.overrunCutAbove, verified.ecu.overrunResumeAbove + 800) }, config: { flywheelInertia: fly + 0.006 } }]
          : []),
      ];
      const verdicts = await Promise.all(variants.map((x) => idleVerdict(hooks.tasks, { ...verified.config, ...x.config }, { ...verified.ecu, ...x.patch }, specs)));
      // Smallest change that holds everywhere; then the one that holds best.
      const order = variants.map((x, i) => ({ x, v: verdicts[i]! })).sort((a, b2) => Number(b2.v.ok) - Number(a.v.ok) || a.v.stalls - b2.v.stalls);
      let fixed = false;
      for (const { x, v } of order.slice(0, 3)) {
        if (v.stalls >= v0.stalls && v.worstDip <= v0.worstDip) break;
        const [t] = await run([{ ...verified, config: { ...verified.config, ...x.config }, ecu: { ...verified.ecu, ...x.patch } }], full);
        const keeps = t!.score.survived && (t!.score.mustMet || !verified.score.mustMet);
        if (keeps) {
          hooks.log(`${x.text}：${verdictText(v)}，正式验收 ${summary(goals, t!)}。`);
          verified = t!;
          fixed = v.ok;
          break;
        }
      }
      if (!fixed) hooks.log('光调 ECU 压不住所有情况：飞轮太轻或者凸轮太野。要更稳，放开飞轮或凸轮让我换。');
    }
  }

  // Never hand back worse than what came in.
  if (verified.score.loss > startFull.score.loss + 1e-6) {
    hooks.log('折腾一圈，正式跑下来不如原样。原样还给你。');
    verified = startFull;
  }
  void GOALS;
  return { best: out.best, start: startFull, verified, tried, stoppedEarly: out.stoppedEarly };
}
