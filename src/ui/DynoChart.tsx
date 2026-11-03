import { hpOf } from '../game/acceptance';

export interface ChartSeries {
  points: [number, number][];
  color: string;
  /** Drawn in the heat colour with a glow, on top. */
  live?: boolean;
  /** Fainter, for reference curves. */
  ghost?: boolean;
  label?: string;
}

export interface ChartMark {
  rpm?: number;
  /** Torque target, Nm. */
  torque?: number;
  /** Power target, hp. */
  hp?: number;
  pass?: boolean | null;
}

const W = 420;
const H = 240;
const PAD = { l: 38, r: 40, t: 22, b: 26 };

export function DynoChart({
  series,
  maxRpm: maxRpmHint,
  marks = [],
  className,
}: {
  series: ChartSeries[];
  maxRpm: number;
  marks?: ChartMark[];
  className?: string;
}): React.ReactElement {
  const all = series.flatMap((s) => s.points);
  const maxRpm = Math.ceil(Math.max(maxRpmHint, ...all.map((p) => p[0])) / 1000) * 1000;
  const tqTop = Math.max(0, ...all.map((p) => p[1]), ...marks.map((m) => m.torque ?? 0));
  const hpTop = Math.max(0, ...all.map((p) => hpOf(p[0], p[1])), ...marks.map((m) => m.hp ?? 0));
  const maxTq = Math.max(20, Math.ceil((tqTop * 1.15) / 10) * 10);
  const maxHp = Math.max(10, Math.ceil((hpTop * 1.15) / 10) * 10);
  const x = (rpm: number): number => PAD.l + (rpm / maxRpm) * (W - PAD.l - PAD.r);
  const yT = (v: number): number => H - PAD.b - (v / maxTq) * (H - PAD.t - PAD.b);
  const yP = (v: number): number => H - PAD.b - (v / maxHp) * (H - PAD.t - PAD.b);
  const line = (pts: [number, number][], f: (p: [number, number]) => number): string =>
    pts.map((p, i) => `${i === 0 ? 'M' : 'L'}${x(p[0]).toFixed(1)},${f(p).toFixed(1)}`).join(' ');

  const rpmTicks = [];
  for (let r = 0; r <= maxRpm; r += maxRpm > 10000 ? 2000 : 1000) rpmTicks.push(r);
  const ordered = [...series.filter((s) => s.ghost), ...series.filter((s) => !s.ghost && !s.live), ...series.filter((s) => s.live)];

  return (
    <svg viewBox={`0 0 ${W} ${H}`} className={`dyno-chart${className ? ` ${className}` : ''}`} role="img" aria-label="扭矩和功率曲线">
      {rpmTicks.map((r) => (
        <g key={r}>
          <line x1={x(r)} x2={x(r)} y1={PAD.t} y2={H - PAD.b} className="grid" />
          <text x={x(r)} y={H - 8} className="axis">
            {r / 1000}k
          </text>
        </g>
      ))}
      <text x={PAD.l - 6} y={PAD.t - 10} className="axis axis--left axis--unit">
        Nm
      </text>
      <text x={W - PAD.r + 6} y={PAD.t - 10} className="axis axis--right axis--unit">
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
      {marks.map((m, i) => {
        const cls = `target${m.pass === true ? ' is-pass' : m.pass === false ? ' is-fail' : ''}`;
        if (m.rpm !== undefined && m.torque !== undefined) {
          return (
            <g key={i} className={cls}>
              <line x1={x(m.rpm)} x2={x(m.rpm)} y1={yT(m.torque)} y2={H - PAD.b} />
              <circle cx={x(m.rpm)} cy={yT(m.torque)} r={4} />
            </g>
          );
        }
        if (m.rpm !== undefined && m.hp !== undefined) {
          return (
            <g key={i} className={`${cls} target--power`}>
              <line x1={x(m.rpm)} x2={x(m.rpm)} y1={yP(m.hp)} y2={H - PAD.b} />
              <circle cx={x(m.rpm)} cy={yP(m.hp)} r={4} />
            </g>
          );
        }
        if (m.hp !== undefined) {
          return <line key={i} x1={PAD.l} x2={W - PAD.r} y1={yP(m.hp)} y2={yP(m.hp)} className={`${cls} target--power`} />;
        }
        if (m.torque !== undefined) {
          return <line key={i} x1={PAD.l} x2={W - PAD.r} y1={yT(m.torque)} y2={yT(m.torque)} className={cls} />;
        }
        return null;
      })}
      {ordered.map((s, i) =>
        s.points.length > 1 ? (
          <g key={i} className={s.live ? 'curve-live' : s.ghost ? 'curve-ghost' : undefined} style={{ color: s.color }}>
            <path d={line(s.points, (p) => yT(p[1]))} className="curve" />
            <path d={line(s.points, (p) => yP(hpOf(p[0], p[1])))} className="curve curve--power" />
          </g>
        ) : null,
      )}
    </svg>
  );
}
