import { useState } from 'react';
import { MAP_LOAD, MAP_RPM, type EcuTable } from '../sim/config';
import { useLive } from '../state/liveStore';

interface Props {
  table: EcuTable;
  lo: number;
  hi: number;
  step: number;
  digits: number;
  unit: string;
  /** Columns past this rpm are greyed out (above the limiter). */
  maxRpm: number;
  /** Rows above this load are greyed out (no boost without a turbo). */
  maxLoad: number;
  onChange: (t: EcuTable) => void;
  /** Colour scale: 'diverge' around zero, or 'seq' from lo. */
  scale?: 'diverge' | 'seq';
}

interface Sel {
  r0: number;
  r1: number;
  c0: number;
  c1: number;
}

function cellColor(v: number, lo: number, hi: number, scale: 'diverge' | 'seq'): string {
  if (scale === 'seq') {
    const t = Math.max(0, Math.min(1, (v - lo) / (hi - lo || 1)));
    return `rgba(255,122,26,${0.08 + t * 0.62})`;
  }
  const m = Math.max(Math.abs(lo), Math.abs(hi)) || 1;
  const t = Math.max(-1, Math.min(1, v / m));
  return t >= 0 ? `rgba(255,122,26,${0.06 + t * 0.66})` : `rgba(111,168,220,${0.06 - t * 0.66})`;
}

/** Where the engine sits on the map right now. */
function Cursor({ maxRpm }: { maxRpm: number }): React.ReactElement | null {
  const rpm = useLive((s) => s.snapshot?.rpm ?? 0);
  const map = useLive((s) => s.snapshot?.mapKpa ?? 101);
  const running = useLive((s) => s.snapshot?.status === 'running');
  if (!running) return null;
  const load = map / 101.325;
  const colOf = (x: number): number => {
    if (x <= MAP_RPM[0]!) return 0;
    for (let i = 1; i < MAP_RPM.length; i++) if (x <= MAP_RPM[i]!) return i - 1 + (x - MAP_RPM[i - 1]!) / (MAP_RPM[i]! - MAP_RPM[i - 1]!);
    return MAP_RPM.length - 1;
  };
  const rowOf = (x: number): number => {
    if (x <= MAP_LOAD[0]!) return 0;
    for (let i = 1; i < MAP_LOAD.length; i++) if (x <= MAP_LOAD[i]!) return i - 1 + (x - MAP_LOAD[i - 1]!) / (MAP_LOAD[i]! - MAP_LOAD[i - 1]!);
    return MAP_LOAD.length - 1;
  };
  const cols = MAP_RPM.length;
  const x = ((colOf(Math.min(rpm, maxRpm + 1000)) + 0.5) / cols) * 100;
  const y = ((MAP_LOAD.length - 1 - rowOf(load) + 0.5) / MAP_LOAD.length) * 100;
  return <i className="tbl-cursor" style={{ left: `${x}%`, top: `${y}%` }} aria-hidden="true" />;
}

export function TableEditor({ table, lo, hi, step, digits, unit, maxRpm, maxLoad, onChange, scale = 'diverge' }: Props): React.ReactElement {
  const [sel, setSel] = useState<Sel>({ r0: MAP_LOAD.indexOf(1), r1: MAP_LOAD.length - 1, c0: 2, c1: 5 });
  const [anchor, setAnchor] = useState<[number, number] | null>(null);
  const rows = MAP_LOAD.map((_, i) => MAP_LOAD.length - 1 - i);
  const inSel = (r: number, c: number): boolean => r >= sel.r0 && r <= sel.r1 && c >= sel.c0 && c <= sel.c1;
  const apply = (fn: (v: number, r: number, c: number) => number): void =>
    onChange(table.map((row, r) => row.map((v, c) => (inSel(r, c) ? Math.round(Math.max(lo, Math.min(hi, fn(v, r, c))) * 1000) / 1000 : v))));
  const pick = (r: number, c: number, extend: boolean): void => {
    if (extend && anchor) setSel({ r0: Math.min(anchor[0], r), r1: Math.max(anchor[0], r), c0: Math.min(anchor[1], c), c1: Math.max(anchor[1], c) });
    else {
      setAnchor([r, c]);
      setSel({ r0: r, r1: r, c0: c, c1: c });
    }
  };
  const avg = (() => {
    let s = 0;
    let n = 0;
    table.forEach((row, r) => row.forEach((v, c) => inSel(r, c) && ((s += v), n++)));
    return n ? s / n : 0;
  })();
  const [typed, setTyped] = useState('');
  const applyTyped = (): void => {
    if (typed !== '' && Number.isFinite(Number(typed))) {
      apply(() => Number(typed));
      setTyped('');
    }
  };

  return (
    <div className="tbl">
      <div className="tbl-grid-wrap">
        <div className="tbl-ylabel">负荷（进气压力 / 大气压）</div>
        <div className="tbl-body">
          <table className="tbl-grid" onMouseLeave={() => undefined}>
            <tbody>
              {rows.map((r) => (
                <tr key={r} className={MAP_LOAD[r]! > maxLoad + 1e-6 ? 'is-off' : ''}>
                  <th>{MAP_LOAD[r]!.toFixed(1)}</th>
                  {MAP_RPM.map((rpm, c) => {
                    const v = table[r]![c]!;
                    const off = rpm > maxRpm + 1000 || MAP_LOAD[r]! > maxLoad + 1e-6;
                    return (
                      <td
                        key={c}
                        className={`${inSel(r, c) ? 'is-sel' : ''}${off ? ' is-off' : ''}`}
                        style={{ background: cellColor(v, lo, hi, scale) }}
                        onMouseDown={(e) => pick(r, c, e.shiftKey)}
                        onMouseEnter={(e) => e.buttons === 1 && anchor && pick(r, c, true)}
                        title={`${rpm} rpm · 负荷 ${MAP_LOAD[r]} · ${v.toFixed(digits)}${unit}`}
                      >
                        {Math.abs(v) < 1e-9 ? '·' : v.toFixed(digits)}
                      </td>
                    );
                  })}
                </tr>
              ))}
              <tr className="tbl-xaxis">
                <th />
                {MAP_RPM.map((rpm) => (
                  <th key={rpm}>{rpm / 1000}k</th>
                ))}
              </tr>
            </tbody>
          </table>
          <div className="tbl-cursor-layer" aria-hidden="true">
            <Cursor maxRpm={maxRpm} />
          </div>
        </div>
      </div>
      <div className="tbl-tools">
        <span className="tbl-info">
          选中 {(sel.r1 - sel.r0 + 1) * (sel.c1 - sel.c0 + 1)} 格 · 平均 {avg.toFixed(digits)}
          {unit}
        </span>
        <button type="button" className="btn btn--small" onClick={() => apply((v) => v - step)}>
          −{step}
          {unit}
        </button>
        <button type="button" className="btn btn--small" onClick={() => apply((v) => v + step)}>
          +{step}
          {unit}
        </button>
        <input
          className="tbl-input"
          type="number"
          step={step}
          value={typed}
          placeholder="设为"
          onChange={(e) => setTyped(e.target.value)}
          onKeyDown={(e) => {
            if (e.key === 'Enter') applyTyped();
          }}
          aria-label="选中格子设为"
        />
        <button type="button" className="btn btn--small" disabled={typed === '' || !Number.isFinite(Number(typed))} onClick={applyTyped}>
          应用
        </button>
        <button
          type="button"
          className="btn btn--small"
          title="和相邻格子取平均，去掉台阶"
          onClick={() =>
            apply((v, r, c) => {
              const around = [table[r]?.[c - 1], table[r]?.[c + 1], table[r - 1]?.[c], table[r + 1]?.[c]].filter((x): x is number => x !== undefined);
              return (v * 2 + around.reduce((a, b) => a + b, 0)) / (2 + around.length);
            })
          }
        >
          抹平
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => apply(() => 0)}>
          清零
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => setSel({ r0: 0, r1: MAP_LOAD.length - 1, c0: 0, c1: MAP_RPM.length - 1 })}>
          全选
        </button>
      </div>
      <p className="field-hint">点选格子，按住拖动或 Shift 点选一片。橙色圆圈是发动机此刻在表上的位置。</p>
    </div>
  );
}

/** One row of values against rpm (the boost target). */
export function CurveEditor({ values, lo, hi, step, unit, maxRpm, onChange }: { values: number[]; lo: number; hi: number; step: number; unit: string; maxRpm: number; onChange: (v: number[]) => void }): React.ReactElement {
  const [sel, setSel] = useState<[number, number]>([2, 8]);
  const set = (fn: (v: number) => number): void => onChange(values.map((v, i) => (i >= sel[0] && i <= sel[1] ? Math.max(lo, Math.min(hi, fn(v))) : v)));
  return (
    <div className="tbl">
      <div className="curve-bars">
        {values.map((v, i) => (
          <button
            key={i}
            type="button"
            className={`curve-bar${i >= sel[0] && i <= sel[1] ? ' is-sel' : ''}${MAP_RPM[i]! > maxRpm + 1000 ? ' is-off' : ''}`}
            onMouseDown={(e) => setSel(e.shiftKey ? [Math.min(sel[0], i), Math.max(sel[1], i)] : [i, i])}
            title={`${MAP_RPM[i]} rpm · ${v}${unit}`}
          >
            <i style={{ height: `${(v / hi) * 100}%` }} />
            <b>{v}</b>
            <small>{MAP_RPM[i]! / 1000}k</small>
          </button>
        ))}
      </div>
      <div className="tbl-tools">
        <button type="button" className="btn btn--small" onClick={() => set((v) => v - step)}>
          −{step}
          {unit}
        </button>
        <button type="button" className="btn btn--small" onClick={() => set((v) => v + step)}>
          +{step}
          {unit}
        </button>
        <button type="button" className="btn btn--ghost btn--small" onClick={() => setSel([0, values.length - 1])}>
          全选
        </button>
      </div>
    </div>
  );
}
