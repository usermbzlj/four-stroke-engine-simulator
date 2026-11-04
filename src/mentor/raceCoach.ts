/**
 * 老周 at the strip: after every run, what went wrong and the knob for it.
 */

import { RACE_EVENTS } from '../sim/race';
import { useBench } from '../state/benchStore';
import { onRaceResult } from '../state/engineLink';
import { scoreText } from '../state/raceStore';
import { applyFix } from './actions';
import { shiftPoints } from './engineer/engineer';
import { saveDraft, draftNow, useQuest } from './quest';
import { say, type MentorAction } from './store';

let started = false;

export function startRaceCoach(): void {
  if (started) return;
  started = true;
  onRaceResult((rec, isBest, prev) => {
    const r = rec.result;
    const ev = RACE_EVENTS[r.event];
    const { ecu, vehicle, runs } = useBench.getState();
    const lines: string[] = [];
    const actions: MentorAction[] = [];
    if (r.dnf === 'stall') {
      lines.push('起步憋熄火了：转速太低就把离合放了。');
      actions.push({ label: '弹射转速设到 55%', run: () => applyFix({ label: '', ecu: { launchRpm: Math.round((ecu.limiterRpm * 0.55) / 100) * 100 } }), primary: true });
    }
    if (r.dnf === 'crash') {
      lines.push('抬头翻了。车头一起来劲全用来抬头了。');
      actions.push({ label: '开防抬头', run: () => applyFix({ label: '', ecu: { wheelieControl: true } }), primary: true });
    }
    if (r.dnf === 'limiter') {
      lines.push('末挡撞断火还没到速度：齿比太短。');
      actions.push({ label: '主减速比放长 8%', run: () => useBench.getState().setVehicle({ finalDrive: vehicle.finalDrive * 0.92 }), primary: true });
    }
    if (!r.dnf) {
      if (r.spinTime > 0.35) {
        lines.push(`起步后轮空转了 ${r.spinTime.toFixed(2)} 秒，烧的是胎不是时间。`);
        actions.push({ label: '牵引力控制 12%', run: () => applyFix({ label: '', ecu: { tractionControl: 0.12 } }) });
        actions.push({ label: '离合慢放 0.3 秒', run: () => useBench.getState().setVehicle({ clutchRelease: Math.min(2, vehicle.clutchRelease + 0.3) }) });
      }
      if (r.wheelieTime > 0.4) {
        lines.push(`车头抬了 ${r.wheelieTime.toFixed(2)} 秒。`);
        if (!ecu.wheelieControl) actions.push({ label: '开防抬头', run: () => applyFix({ label: '', ecu: { wheelieControl: true } }) });
      }
      const curve = runs.at(-1)?.points ?? [];
      const peakRpm = curve.length ? curve.reduce((a, b) => (b[1] > a[1] ? b : a))[0] : 0;
      const low = r.shifts.filter((s) => peakRpm && s.rpmAfter < peakRpm * 0.7);
      if (low.length) {
        lines.push(`换挡后掉到 ${Math.round(Math.min(...low.map((s) => s.rpmAfter))).toLocaleString('en-US')} 转，出了扭矩带。`);
        if (curve.length > 3)
          actions.push({ label: '按扭矩曲线算换挡点', run: () => applyFix({ label: '', ecu: { shiftRpm: shiftPoints(curve, vehicle, ecu.limiterRpm) } }) });
      }
    }
    const head = r.dnf ? `${ev.name}没跑完。` : `${ev.name} ${scoreText(r)}${isBest && prev ? '，破了自己的纪录' : ''}。`;
    if (lines.length === 0 && !r.dnf) lines.push(r.t60ft !== null ? `60 英尺 ${r.t60ft.toFixed(2)} 秒，起步${r.t60ft < 2 ? '很干净' : '还能更快'}。` : '');
    if (!r.dnf && r.time) {
      actions.push({
        label: '让老周把它调快',
        run: () => {
          const d = draftNow();
          const goal = ev.measure === 'topSpeed' ? { kind: 'topSpeed' as const, value: Math.ceil(r.topKmh * 1.06), must: true } : { kind: 'raceTime' as const, event: r.event, value: Math.round(r.time! * 0.92 * 100) / 100, must: true };
          saveDraft({ ...d, goals: [goal, ...d.goals.filter((g) => g.kind === 'budget')] });
          useQuest.setState({ editing: true });
        },
      });
    }
    say('race', r.dnf ? 'warn' : 'say', lines.filter(Boolean).join(''), { head, actions, cooldown: 0 });
  });
}
