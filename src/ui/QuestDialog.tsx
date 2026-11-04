import { useEffect, useState } from 'react';
import { PARTS, money, type PartId } from '../game/parts';
import { GOAL_ORDER, GOALS, SAFETY, type Goal, type GoalKind } from '../mentor/goals';
import { draftNow, jobDraft, lockedParts, startQuest, useQuest, type Draft } from '../mentor/quest';
import { poolWidth } from '../mentor/pool';
import { useBench } from '../state/benchStore';
import { RACE_EVENTS, RACE_ORDER, type RaceEventId } from '../sim/race';
import { CHASSIS, VEHICLE_PARTS, type VehiclePartId } from '../sim/vehicle';

const STEP: Record<GoalKind, number> = {
  peakHp: 0.5,
  peakTorque: 0.5,
  torqueAt: 0.5,
  hpAt: 0.5,
  limiterMin: 100,
  limiterMax: 100,
  idleMin: 50,
  freeRev: 0.01,
  pops: 10,
  budget: 100,
  ccMax: 5,
  octaneMax: 1,
  piston: 0.5,
  rod: 0.5,
  coolant: 1,
  blipMin: 50,
  raceTime: 0.1,
  topSpeed: 1,
};

/** Kinds that only make sense once. */
const MULTI = new Set<GoalKind>(['torqueAt', 'hpAt', 'raceTime']);

function GoalRow({ g, onChange, onRemove }: { g: Goal; onChange: (g: Goal) => void; onRemove: () => void }): React.ReactElement {
  const m = GOALS[g.kind];
  return (
    <li className="quest-goal">
      <span className="quest-goal-name">{m.hasRpm ? (g.kind === 'torqueAt' ? '扭矩' : '功率') : g.kind === 'raceTime' ? '' : m.name}</span>
      {g.kind === 'raceTime' && (
        <select className="quest-event" value={g.event ?? 'drag100'} onChange={(e) => onChange({ ...g, event: e.target.value as RaceEventId })} aria-label="比赛项目">
          {RACE_ORDER.filter((id) => id !== 'top').map((id) => (
            <option key={id} value={id}>
              {RACE_EVENTS[id].name}
            </option>
          ))}
        </select>
      )}
      {m.hasRpm && (
        <label className="quest-num quest-num--rpm">
          <input
            type="number"
            value={g.rpm ?? 0}
            min={1000}
            max={16000}
            step={250}
            onChange={(e) => onChange({ ...g, rpm: Number(e.target.value) })}
            aria-label="转速"
          />
          <small>rpm 时</small>
        </label>
      )}
      <span className="quest-dir">{m.dir === 'min' ? '≥' : '≤'}</span>
      <label className="quest-num">
        <input
          type="number"
          value={g.value}
          step={STEP[g.kind]}
          onChange={(e) => onChange({ ...g, value: Number(e.target.value) })}
          aria-label={m.name}
        />
        <small>{g.kind === 'budget' ? '¥' : m.unit}</small>
      </label>
      <button
        type="button"
        className={`quest-must${g.must ? ' is-on' : ''}`}
        aria-pressed={g.must}
        onClick={() => onChange({ ...g, must: !g.must })}
        title={g.must ? '必须达到：分量是“最好”的三倍' : '最好达到：做不到也行'}
      >
        {g.must ? '必须' : '最好'}
      </button>
      <button type="button" className="quest-x" onClick={onRemove} aria-label="删掉这个目标">
        ×
      </button>
    </li>
  );
}

export function QuestDialog(): React.ReactElement | null {
  const editing = useQuest((s) => s.editing);
  return editing ? <Editor initial={draftNow()} /> : null;
}

function Editor({ initial }: { initial: Draft }): React.ReactElement {
  const running = useQuest((s) => s.run !== null);
  const [d, setD] = useState<Draft>(initial);
  const [adding, setAdding] = useState<GoalKind | ''>('');
  const ecu = useBench((s) => s.ecu);
  const vehicleChassis = useBench((s) => s.vehicle.chassis);

  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        useQuest.setState({ editing: false });
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, []);

  const close = (): void => {
    useQuest.setState({ editing: false });
  };
  const locked = lockedParts();
  const fromJob = jobDraft();
  const kinds = GOAL_ORDER.filter((k) => MULTI.has(k) || !d.goals.some((g) => g.kind === k));
  const setGoal = (i: number, g: Goal): void => setD({ ...d, goals: d.goals.map((x, j) => (j === i ? g : x)) });
  const add = (kind: GoalKind): void => {
    const ctx = { config: useBench.getState().config, ecu, cost: 0, result: null };
    const g: Goal = {
      kind,
      value: GOALS[kind].suggest(ctx),
      must: kind !== 'budget',
      ...(GOALS[kind].hasRpm ? { rpm: kind === 'torqueAt' ? 3000 : Math.round((ecu.limiterRpm * 0.85) / 250) * 250 } : {}),
      ...(kind === 'raceTime' ? { event: 'drag100' as const } : {}),
    };
    setD({ ...d, goals: [...d.goals, g] });
  };
  const togglePart = (id: PartId): void => setD({ ...d, parts: d.parts.includes(id) ? d.parts.filter((p) => p !== id) : [...d.parts, id] });
  const valid = d.goals.length > 0 && d.goals.every((g) => Number.isFinite(g.value) && (!GOALS[g.kind].hasRpm || (g.rpm ?? 0) > 0));
  const safetyNote = SAFETY.filter((s) => !d.goals.some((g) => g.kind === s.kind))
    .map((s) => (s.kind === 'blipMin' ? '轰油门松开不熄火' : `${GOALS[s.kind].name.replace('至多', '')} ≤ ${s.value}%`))
    .join('、');
  const width = poolWidth();

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="quest-title" onClick={close}>
      <div className="modal-card quest" onClick={(e) => e.stopPropagation()}>
        <header className="quest-head">
          <span className="mentor-face">周</span>
          <div>
            <h2 id="quest-title">给老周定目标</h2>
            <p>
              说清楚要什么、哪些零件能动。老周先体检找毛病，再在台架上逐点标定点火、空燃比、凸轮和增压，对症换零件，算换挡点、试起步，最后细调并换个日子复核（{width} 台同时跑）。轰油门不熄火是他自己守的底线。
            </p>
          </div>
        </header>

        <section className="quest-sec">
          <div className="quest-sec-head">
            <h3>目标</h3>
            {fromJob && (
              <button type="button" className="btn btn--ghost btn--small" onClick={() => setD(fromJob)}>
                按工单要求重填
              </button>
            )}
          </div>
          <ol className="quest-goals">
            {d.goals.map((g, i) => (
              <GoalRow key={i} g={g} onChange={(n) => setGoal(i, n)} onRemove={() => setD({ ...d, goals: d.goals.filter((_, j) => j !== i) })} />
            ))}
          </ol>
          <div className="quest-add">
            <select value={adding} onChange={(e) => setAdding(e.target.value as GoalKind | '')} aria-label="选一个目标">
              <option value="">加一个目标…</option>
              {kinds.map((k) => (
                <option key={k} value={k}>
                  {GOALS[k].name}
                </option>
              ))}
            </select>
            <button
              type="button"
              className="btn btn--small"
              disabled={!adding}
              onClick={() => {
                if (adding) add(adding);
                setAdding('');
              }}
            >
              加上
            </button>
          </div>
          {safetyNote && <p className="quest-note">另外老周自己会守住：验收不坏、{safetyNote}。</p>}
        </section>

        <section className="quest-sec">
          <div className="quest-sec-head">
            <h3>能动的</h3>
            <button
              type="button"
              className="btn btn--ghost btn--small"
              onClick={() => setD({ ...d, parts: d.parts.length >= PARTS.length - locked.length ? [] : PARTS.map((p) => p.id).filter((p) => !locked.includes(p)) })}
            >
              {d.parts.length >= PARTS.length - locked.length ? '全不选' : '全选'}
            </button>
          </div>
          <div className="quest-parts">
            <button type="button" className={`quest-chip${d.ecu ? ' is-on' : ''}`} aria-pressed={d.ecu} onClick={() => setD({ ...d, ecu: !d.ecu })}>
              ECU <small>免费</small>
            </button>
            {PARTS.map((p) => {
              const lock = locked.includes(p.id);
              const on = !lock && d.parts.includes(p.id);
              return (
                <button
                  key={p.id}
                  type="button"
                  className={`quest-chip${on ? ' is-on' : ''}`}
                  aria-pressed={on}
                  disabled={lock}
                  title={lock ? '这单不许动' : p.pitch}
                  onClick={() => togglePart(p.id)}
                >
                  {p.name} <small>{p.price ? money(p.price) : '免费'}</small>
                </button>
              );
            })}
          </div>
          <div className="quest-sec-head">
            <h3>车上能动的（{CHASSIS[vehicleChassis].name}）</h3>
          </div>
          <div className="quest-parts">
            {VEHICLE_PARTS.map((p) => {
              const on = (d.vehicleParts ?? VEHICLE_PARTS.map((x) => x.id)).includes(p.id);
              const toggle = (id: VehiclePartId): void => {
                const cur = d.vehicleParts ?? VEHICLE_PARTS.map((x) => x.id);
                setD({ ...d, vehicleParts: cur.includes(id) ? cur.filter((x) => x !== id) : [...cur, id] });
              };
              return (
                <button key={p.id} type="button" className={`quest-chip${on ? ' is-on' : ''}`} aria-pressed={on} title={p.pitch} onClick={() => toggle(p.id)}>
                  {p.name} <small>{money(p.price)}</small>
                </button>
              );
            })}
          </div>
          <p className="quest-note">只动跟目标有关的地方。零件钱按跟{fromJob ? '接单时' : '出厂'}比换了哪些算。有比赛目标时，老周会在后台把每套方案都拉到赛道上跑一遍。</p>
        </section>

        <footer className="quest-foot">
          <button type="button" className="btn btn--ghost" onClick={close}>
            取消
          </button>
          <button type="button" className="btn btn--mentor" disabled={!valid || running} onClick={() => void startQuest(d)}>
            开始（一般一两分钟，带耐久的要更久）
          </button>
        </footer>
      </div>
    </div>
  );
}
