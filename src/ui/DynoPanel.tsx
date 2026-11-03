import { useBench } from '../state/benchStore';
import { useControls } from '../state/controlStore';
import { clearPull, pullPoints, savePull, startSweep, stopSweep, useLink } from '../state/engineLink';
import { useLive } from '../state/liveStore';
import { stopTune } from '../mentor/brain';
import { useMentor } from '../mentor/store';
import { DynoChart, type ChartMark } from './DynoChart';
import { useJob } from './job/useJob';

const RUN_COLORS = ['#6fa8dc', '#b7a5ff', '#7fd1b9', '#e8e2d6'];

const hp = (rpm: number, nm: number): number => (nm * rpm) / 7121;

function peak(points: [number, number][]): { tq: [number, number]; hp: [number, number] } | null {
  if (points.length === 0) return null;
  let tq = points[0]!;
  let pw: [number, number] = [tq[0], hp(tq[0], tq[1])];
  for (const p of points) {
    if (p[1] > tq[1]) tq = p;
    const h = hp(p[0], p[1]);
    if (h > pw[1]) pw = [p[0], h];
  }
  return { tq, hp: pw };
}

export function DynoPanel(): React.ReactElement {
  const runs = useBench((s) => s.runs);
  const removeRun = useBench((s) => s.removeRun);
  const limiter = useBench((s) => s.ecu.limiterRpm);
  const pull = useLink((s) => s.pull);
  const sweeping = useControls((s) => s.sweeping);
  const running = useLive((s) => s.snapshot?.status === 'running');
  const tuning = useMentor((s) => s.tuning !== null);
  const current = pullPoints(pull);
  const job = useJob();
  const marks: ChartMark[] = job ? [...job.job.rules, job.job.bonus].flatMap((c) => (c.mark ? [{ ...c.mark, pass: null }] : [])) : [];
  const lastCurve = job?.last?.result.curve ?? [];

  return (
    <div className="sheet">
      <p className="sheet-intro">
        测功机把转速钉在设定值上，你踩全油门，它记下需要多大的制动扭矩。自动扫转速会从低到高慢慢放开，一条完整的扭矩曲线大约二三十秒。
      </p>
      <div className="dyno-actions">
        {sweeping ? (
          <button type="button" className="btn" onClick={() => (tuning ? stopTune() : stopSweep(false))}>
            停止扫转速
          </button>
        ) : (
          <button type="button" className="btn btn--primary" disabled={!running || tuning} onClick={() => startSweep()}>
            自动扫转速
          </button>
        )}
        <button type="button" className="btn" disabled={current.length < 3 || sweeping} onClick={() => savePull()}>
          保存当前曲线
        </button>
        <button type="button" className="btn" disabled={current.length === 0 || sweeping} onClick={() => clearPull()}>
          清掉当前
        </button>
      </div>
      {!running && !sweeping && <p className="field-hint">先把发动机起动起来。</p>}

      <DynoChart
        maxRpm={limiter}
        marks={marks}
        series={[
          ...(lastCurve.length > 1 ? [{ points: lastCurve, color: 'var(--muted)', ghost: true }] : []),
          ...runs.map((r, i) => ({ points: r.points, color: RUN_COLORS[i % RUN_COLORS.length]! })),
          { points: current, color: 'var(--heat)', live: true },
        ]}
      />
      <p className="field-hint">
        实线是扭矩，虚线是功率。橙色是正在测的这一条。
        {marks.length > 0 && ' 黄色虚线和圆圈是这单的目标。'}
        {lastCurve.length > 1 && ' 灰色是上次验收的曲线。'}
      </p>

      <ul className="runs">
        {runs.map((r, i) => {
          const pk = peak(r.points);
          return (
            <li key={r.id}>
              <i style={{ background: RUN_COLORS[i % RUN_COLORS.length] }} />
              <span className="runs-name">{r.label}</span>
              {pk && (
                <span className="runs-peak">
                  {pk.tq[1].toFixed(1)} Nm @ {pk.tq[0]}，{pk.hp[1].toFixed(1)} hp @ {pk.hp[0]}
                </span>
              )}
              <button type="button" className="btn btn--ghost" onClick={() => removeRun(r.id)} aria-label={`删除${r.label}`}>
                删除
              </button>
            </li>
          );
        })}
      </ul>
    </div>
  );
}
