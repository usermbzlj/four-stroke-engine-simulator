import { DNF_TEXT, RACE_EVENTS, RACE_ORDER, type RaceResult } from '../sim/race';
import { CHASSIS } from '../sim/vehicle';
import { useBench } from '../state/benchStore';
import { abortRun, startRun } from '../state/engineLink';
import { useLive } from '../state/liveStore';
import { bestKey, scoreText, useRace } from '../state/raceStore';

const f2 = (v: number | null): string => (v === null ? '—' : `${v.toFixed(2)} 秒`);

function SpeedPlot({ a, b }: { a: RaceResult; b?: RaceResult | undefined }): React.ReactElement {
  const all = [...a.trace, ...(b?.trace ?? [])];
  const tMax = Math.max(1, ...all.map((p) => p[0]!));
  const vMax = Math.max(20, ...all.map((p) => p[2]!));
  const line = (tr: number[][]): string => tr.map((p) => `${((p[0]! / tMax) * 300).toFixed(1)},${(90 - (p[2]! / vMax) * 85).toFixed(1)}`).join(' ');
  return (
    <svg className="race-plot" viewBox="0 0 300 92" preserveAspectRatio="none" aria-label="车速曲线">
      {b && <polyline points={line(b.trace)} className="race-plot-best" />}
      <polyline points={line(a.trace)} className="race-plot-last" />
    </svg>
  );
}

export function RacePanel(): React.ReactElement {
  const race = useRace();
  const chassis = useBench((s) => s.vehicle.chassis);
  const running = useLive((s) => s.snapshot?.status === 'running');
  const last = race.last;
  const best = race.bests[bestKey(chassis, race.event)];
  const ev = RACE_EVENTS[race.event];

  return (
    <section className="race-panel" aria-label="比赛">
      <div className="race-top">
        <nav className="race-events" aria-label="项目">
          {RACE_ORDER.map((id) => {
            const b = race.bests[bestKey(chassis, id)];
            return (
              <button key={id} type="button" className={race.event === id ? 'is-on' : ''} disabled={race.live} onClick={() => race.set({ event: id })}>
                <b>{RACE_EVENTS[id].name}</b>
                <small>{b ? scoreText(b.result) : '—'}</small>
              </button>
            );
          })}
        </nav>
        <div className="race-actions">
          <div className="choice" role="radiogroup" aria-label="谁来骑">
            {(['auto', 'manual'] as const).map((r) => (
              <button key={r} type="button" role="radio" aria-checked={race.rider === r} className={race.rider === r ? 'is-on' : ''} disabled={race.live} onClick={() => race.set({ rider: r })}>
                {r === 'auto' ? '车手骑' : '我来骑'}
              </button>
            ))}
          </div>
          <label className="race-ghost">
            <input type="checkbox" checked={race.ghost} onChange={(e) => race.set({ ghost: e.target.checked })} /> 影子
          </label>
          {race.live ? (
            <button type="button" className="btn" onClick={abortRun}>
              放弃 <kbd>Esc</kbd>
            </button>
          ) : (
            <button type="button" className="btn btn--primary" disabled={!running} onClick={startRun} title={running ? '' : '先把发动机打着（S）'}>
              开跑 <kbd>Enter</kbd>
            </button>
          )}
        </div>
      </div>
      <p className="race-blurb">
        <b>{CHASSIS[chassis].name}</b> · {ev.blurb}
        {race.rider === 'manual' && ' 我来骑：空格拧油门，↑ 升挡 ↓ 降挡，起步自动放离合。'}
      </p>
      {last && last.result.event === race.event ? (
        <div className="race-result">
          <div className="race-big">
            <span>{last.result.dnf ? DNF_TEXT[last.result.dnf] : scoreText(last.result)}</span>
            {best && best !== last && !last.result.dnf && !best.result.dnf && (
              <small
                className={
                  ev.measure === 'time' && best.result.time !== null && last.result.time !== null
                    ? last.result.time <= best.result.time
                      ? 'is-good'
                      : 'is-bad'
                    : ev.measure === 'topSpeed'
                      ? last.result.topKmh >= best.result.topKmh
                        ? 'is-good'
                        : 'is-bad'
                      : ''
                }
              >
                最佳 {scoreText(best.result)}
              </small>
            )}
            {best === last && !last.result.dnf && <small className="is-good">新纪录</small>}
          </div>
          <dl className="race-splits">
            <div><dt>60 英尺</dt><dd>{f2(last.result.t60ft)}</dd></div>
            <div><dt>100 米</dt><dd>{f2(last.result.t100m)}</dd></div>
            <div><dt>0-100</dt><dd>{f2(last.result.t100kmh)}</dd></div>
            <div><dt>{ev.measure === 'topSpeed' ? '极速' : '过线'}</dt><dd>{(ev.measure === 'topSpeed' ? last.result.topKmh : last.result.trapKmh).toFixed(1)} km/h</dd></div>
            <div><dt>起步转速</dt><dd>{Math.round(last.result.launchRpm).toLocaleString('en-US')}</dd></div>
            <div><dt>打滑 / 抬头</dt><dd>{last.result.spinTime.toFixed(2)} / {last.result.wheelieTime.toFixed(2)} 秒</dd></div>
            <div><dt>换挡</dt><dd>{last.result.shifts.length} 次{last.result.shifts.length ? `，落到 ${Math.round(Math.min(...last.result.shifts.map((s) => s.rpmAfter))).toLocaleString('en-US')}` : ''}</dd></div>
            {last.result.maxBoostKpa > 1 && <div><dt>最高增压</dt><dd>{last.result.maxBoostKpa.toFixed(0)} kPa</dd></div>}
          </dl>
          <SpeedPlot a={last.result} b={best && best !== last ? best.result : undefined} />
        </div>
      ) : (
        <p className="race-empty">{running ? '按 Enter 开跑。灯灭起步，成绩和车速曲线会出现在这里。' : '先把发动机打着（按住 S），再开跑。'}</p>
      )}
    </section>
  );
}
