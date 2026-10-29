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
        <button type="button" className="btn btn--primary" onClick={restoreEngine} autoFocus>
          换新零件 <kbd>R</kbd>
        </button>
      </div>
    </div>
  );
}
