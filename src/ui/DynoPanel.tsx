import { useBench } from '../state/benchStore';
import { useControls } from '../state/controlStore';
import { clearPull, pullPoints, savePull, startSweep, stopSweep, useLink } from '../state/engineLink';
import { useLive } from '../state/liveStore';

const W = 420;
const H = 240;
const PAD = { l: 38, r: 40, t: 12, b: 26 };
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
  const current = pullPoints(pull);

  const all = [...runs.flatMap((r) => r.points), ...current];
  const maxRpm = Math.ceil(Math.max(limiter, ...all.map((p) => p[0])) / 1000) * 1000;
  const maxTq = Math.max(20, Math.ceil((Math.max(0, ...all.map((p) => p[1])) * 1.15) / 10) * 10);
  const maxHp = Math.max(10, Math.ceil((Math.max(0, ...all.map((p) => hp(p[0], p[1]))) * 1.15) / 10) * 10);
  const x = (rpm: number): number => PAD.l + (rpm / maxRpm) * (W - PAD.l - PAD.r);
  const yT = (v: number): number => H - PAD.b - (v / maxTq) * (H - PAD.t - PAD.b);
  const yP = (v: number): number => H - PAD.b - (v / maxHp) * (H - PAD.t - PAD.b);
  const line = (pts: [number, number][], f: (p: [number, number]) => number): string =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p[0]).toFixed(1)},${f(p).toFixed(1)}`).join(' ');

  const rpmTicks = [];
  for (let r = 0; r <= maxRpm; r += maxRpm > 10000 ? 2000 : 1000) rpmTicks.push(r);

  return (
    <div className="sheet">
      <p className="sheet-intro">
        测功机把转速钉在设定值上，你踩全油门，它记下需要多大的制动扭矩。自动扫转速会从低到高慢慢放开，一条完整的扭矩曲线大约二三十秒。
      </p>
      <div className="dyno-actions">
        {sweeping ? (
          <button type="button" className="btn" onClick={() => stopSweep(false)}>
            停止扫转速
          </button>
        ) : (
          <button type="button" className="btn btn--primary" disabled={!running} onClick={startSweep}>
            自动扫转速
          </button>
        )}
        <button type="button" className="btn" disabled={current.length < 3 || sweeping} onClick={savePull}>
          保存当前曲线
        </button>
        <button type="button" className="btn" disabled={current.length === 0 || sweeping} onClick={clearPull}>
          清掉当前
        </button>
      </div>
      {!running && !sweeping && <p className="field-hint">先把发动机起动起来。</p>}

      <svg viewBox={`0 0 ${W} ${H}`} className="dyno-chart" role="img" aria-label="扭矩和功率曲线">
        {rpmTicks.map((r) => (
          <g key={r}>
            <line x1={x(r)} x2={x(r)} y1={PAD.t} y2={H - PAD.b} className="grid" />
            <text x={x(r)} y={H - 8} className="axis">
              {r / 1000}k
            </text>
          </g>
        ))}
        <text x={4} y={PAD.t + 8} className="axis axis--left">
          Nm
        </text>
        <text x={W - 4} y={PAD.t + 8} className="axis axis--right">
          hp
        </text>
        {[0.25, 0.5, 0.75, 1].map((f) => (
          <g key={f}>
            <line x1={PAD.l} x2={W - PAD.r} y1={yT(maxTq * f)} y2={yT(maxTq * f)} className="grid" />
            <text x={PAD.l - 6} y={yT(maxTq * f) + 4} className="axis axis--left">
              {Math.round(maxTq * f)}
            </text>
            <text x={W - PAD.r + 6} y={yP(maxHp * f) + 4} className="axis axis--right">
              {Math.round(maxHp * f)}
            </text>
          </g>
        ))}
        {runs.map((r, i) => (
          <g key={r.id} style={{ color: RUN_COLORS[i % RUN_COLORS.length] }}>
            <path d={line(r.points, (p) => yT(p[1]))} className="curve" />
            <path d={line(r.points, (p) => yP(hp(p[0], p[1])))} className="curve curve--power" />
          </g>
        ))}
        {current.length > 1 && (
          <g className="curve-live">
            <path d={line(current, (p) => yT(p[1]))} className="curve" />
            <path d={line(current, (p) => yP(hp(p[0], p[1])))} className="curve curve--power" />
          </g>
        )}
      </svg>
      <p className="field-hint">实线是扭矩，虚线是功率。橙色是正在测的这一条。</p>

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
