import { failureCause, failureFixes } from '../mentor/brain';
import { applyFix } from '../mentor/actions';
import { useMentor } from '../mentor/store';
import type { Failure } from '../sim/core';
import { restoreEngine } from '../state/engineLink';

const WHERE: Record<Failure['kind'], string> = {
  rod: '连杆',
  valve: '气门',
  piston: '活塞',
  headGasket: '缸垫',
};

function crankText(deg: number): string {
  const d = ((deg % 720) + 720) % 720;
  if (Math.abs(d - 360) < 2) return '换气上止点';
  if (d < 2 || d > 718) return '点火上止点';
  return d < 360 ? `点火上止点后 ${d.toFixed(0)}°` : `点火上止点前 ${(720 - d).toFixed(0)}°`;
}

export function FailureReport({ failure }: { failure: Failure }): React.ReactElement {
  const fixes = failureFixes(failure);
  const tail = useMentor((s) => s.messages.find((m) => m.key === 'failure-tail')?.text);
  return (
    <div className="failure" role="alertdialog" aria-labelledby="failure-title" aria-describedby="failure-detail">
      <div className="failure-card">
        <p className="failure-part">拆机报告：{WHERE[failure.kind]}</p>
        <h2 id="failure-title">{failure.title}</h2>
        <dl className="failure-facts">
          <div>
            <dt>转速</dt>
            <dd>{Math.round(failure.rpm).toLocaleString('en-US')} rpm</dd>
          </div>
          <div>
            <dt>曲轴转角</dt>
            <dd>{crankText(failure.crankDeg)}</dd>
          </div>
        </dl>
        <p id="failure-detail" className="failure-detail">
          {failure.detail}
        </p>
        <div className="failure-mentor">
          <p>
            <b>老周：</b>
            {failureCause(failure)}
          </p>
          {fixes.length > 0 && (
            <ul>
              {fixes.map((f) => (
                <li key={f.label}>{f.label}</li>
              ))}
            </ul>
          )}
          {tail && <p className="failure-tail">{tail}</p>}
        </div>
        <div className="failure-actions">
          {fixes.length > 0 && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => {
                for (const f of fixes) applyFix(f);
                restoreEngine();
              }}
              autoFocus
            >
              按老周说的改，换新零件
            </button>
          )}
          <button type="button" className={`btn${fixes.length > 0 ? '' : ' btn--primary'}`} onClick={restoreEngine}>
            原样换新零件 <kbd>R</kbd>
          </button>
        </div>
      </div>
    </div>
  );
}
