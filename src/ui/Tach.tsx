import { useMemo } from 'react';
import { rodBreakRpm } from '../sim/config';
import { useBench } from '../state/benchStore';
import { useLive } from '../state/liveStore';

const START = 225;
const SWEEP = 270;
const R = 120;

function polar(a: number, r: number): [number, number] {
  const rad = ((a - 90) * Math.PI) / 180;
  return [150 + r * Math.cos(rad), 150 + r * Math.sin(rad)];
}

function arc(from: number, to: number, r: number): string {
  const [x0, y0] = polar(from, r);
  const [x1, y1] = polar(to, r);
  const large = to - from > 180 ? 1 : 0;
  return `M ${x0} ${y0} A ${r} ${r} 0 ${large} 1 ${x1} ${y1}`;
}

export function Tach(): React.ReactElement {
  const config = useBench((s) => s.config);
  const limiter = useBench((s) => s.ecu.limiterRpm);
  const rpm = useLive((s) => s.snapshot?.rpm ?? 0);
  const floatRpm = useLive((s) => s.snapshot?.floatRpm ?? 0);
  const limiterCut = useLive((s) => s.snapshot?.limiterCut ?? false);
  const status = useLive((s) => s.snapshot?.status ?? 'off');

  const top = Math.ceil((Math.max(limiter, 6000) * 1.25) / 1000) * 1000;
  const angle = (v: number): number => START + (Math.min(Math.max(v, 0), top) / top) * SWEEP;
  const rodRpm = useMemo(() => rodBreakRpm(config), [config]);

  const ticks = [];
  for (let v = 0; v <= top; v += 500) {
    const major = v % 1000 === 0;
    const a = angle(v);
    const [x0, y0] = polar(a, R);
    const [x1, y1] = polar(a, R - (major ? 14 : 7));
    ticks.push(<line key={v} x1={x0} y1={y0} x2={x1} y2={y1} className={major ? 'tick tick--major' : 'tick'} />);
    if (major) {
      const [tx, ty] = polar(a, R - 28);
      ticks.push(
        <text key={`t${v}`} x={tx} y={ty + 5} className="tick-label">
          {v / 1000}
        </text>,
      );
    }
  }

  const marker = (v: number, cls: string): React.ReactElement | null => {
    if (v <= 0 || v > top) return null;
    const a = angle(v);
    const [x0, y0] = polar(a, R + 3);
    const [x1, y1] = polar(a, R + 16);
    return <line x1={x0} y1={y0} x2={x1} y2={y1} className={cls} />;
  };

  const needle = angle(rpm);
  const [nx, ny] = polar(needle, R - 6);

  return (
    <div className="tach">
      <svg viewBox="-10 -10 320 290" role="img" aria-label={`转速 ${Math.round(rpm)} rpm`}>
        <path d={arc(START, START + SWEEP, R)} className="tach-track" />
        <path d={arc(angle(limiter), START + SWEEP, R)} className="tach-red" />
        {ticks}
        {marker(floatRpm, 'tach-marker tach-marker--float')}
        {marker(rodRpm, 'tach-marker tach-marker--rod')}
        <line x1={150} y1={150} x2={nx} y2={ny} className={`tach-needle${limiterCut ? ' is-cut' : ''}`} />
        <circle cx={150} cy={150} r={7} className="tach-hub" />
      </svg>
      <div className="tach-readout">
        <span className="tach-rpm">{Math.round(Math.max(0, rpm)).toLocaleString('en-US')}</span>
        <span className="tach-unit">rpm</span>
        <span className={`tach-status tach-status--${status}`}>{STATUS_TEXT[status]}</span>
      </div>
      <dl className="tach-legend">
        <div className="tach-legend--float">
          <dt>气门飘浮</dt>
          <dd>{Math.round(floatRpm).toLocaleString('en-US')}</dd>
        </div>
        <div className="tach-legend--rod">
          <dt>连杆拉断</dt>
          <dd>{Math.round(rodRpm).toLocaleString('en-US')}</dd>
        </div>
      </dl>
    </div>
  );
}

const STATUS_TEXT: Record<string, string> = {
  off: '停机',
  cranking: '起动机拖动中',
  running: '运转',
  broken: '已损坏',
};
