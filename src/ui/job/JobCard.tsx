import { useState } from 'react';
import { say, useMentor } from '../../mentor/store';
import { money } from '../../game/parts';
import { resetJob, startAcceptance, useAcceptance } from '../../game/session';
import { useGame } from '../../game/store';
import { JOBS } from '../../game/jobs';
import { useLive } from '../../state/liveStore';
import { Stars } from './Stars';
import { useJob } from './useJob';

function Mark({ pass }: { pass: boolean | null }): React.ReactElement {
  return <span className={`chk${pass === true ? ' is-pass' : pass === false ? ' is-fail' : ''}`} aria-hidden="true" />;
}

export function JobCard(): React.ReactElement | null {
  const view = useJob();
  const running = useAcceptance((s) => s.status === 'running');
  const tipSeen = useGame((s) => (view ? s.tips[view.job.id] : false));
  const broken = useLive((s) => s.snapshot?.failure != null);
  const [briefOpen, setBriefOpen] = useState(true);
  const [confirmReset, setConfirmReset] = useState(false);
  if (!view) return null;
  const { job, index, cost, grade, last, fresh, stars } = view;
  const overBudget = cost > job.budget;

  const showTip = (): void => {
    const g = useGame.getState();
    g.set({ tips: { ...g.tips, [job.id]: true } });
    say(`tip-${job.id}`, 'say', job.tip, { head: '这单的门道：' });
    useMentor.getState().set({ open: true });
  };

  return (
    <section className="job" aria-label="当前工单">
      <header className="job-head">
        <span className="job-no">
          工单 {index + 1}/{JOBS.length}
        </span>
        <Stars n={stars} />
      </header>
      <h2 className="job-title">{job.title}</h2>
      <button type="button" className="job-client" onClick={() => setBriefOpen(!briefOpen)} aria-expanded={briefOpen}>
        {job.client}
        <span>{briefOpen ? '收起' : '客户要求'}</span>
      </button>
      {briefOpen && <p className="job-brief">“{job.brief}”</p>}

      <ul className="job-checks">
        {job.rules.map((c, i) => {
          const g = grade.rules[i]!;
          const stale = c.needsTest && !fresh && last !== null;
          const prevActual = stale ? c.eval({ config: null as never, ecu: null as never, cost: 0, result: last.result }).actual : null;
          return (
            <li key={c.label} className={g.pass === false ? 'is-fail' : g.pass ? 'is-pass' : ''}>
              <Mark pass={g.pass} />
              <span className="job-check-label">{c.label}</span>
              <span className="job-check-val">{prevActual ? <s title="上次验收的结果，你改过以后还没重新验收">{prevActual}</s> : g.actual}</span>
            </li>
          );
        })}
        <li className={`job-extra${grade.bonus.pass ? ' is-pass' : ''}`}>
          <span className="job-star">★★</span>
          <span className="job-check-label">{job.bonus.label}</span>
          <span className="job-check-val">{grade.bonus.pass === null ? '' : grade.bonus.actual}</span>
        </li>
        <li className={`job-extra${overBudget ? ' is-fail' : ' is-pass'}`}>
          <span className="job-star">★★★</span>
          <span className="job-check-label">零件花费不超过 {money(job.budget)}</span>
          <span className="job-check-val">{money(cost)}</span>
        </li>
      </ul>

      {job.locked && job.locked.length > 0 && <p className="job-note">这单有些零件不许动，改装单里会锁上。</p>}

      <div className="job-actions">
        <button type="button" className="btn btn--primary" onClick={startAcceptance} disabled={running}>
          {running ? '验收中…' : fresh ? '再验收一次' : '提交验收'}
        </button>
        <button type="button" className={`btn${tipSeen ? '' : ' btn--mentor'}`} onClick={showTip}>
          问老周
        </button>
        {confirmReset ? (
          <span className="job-confirm">
            全部改回接单时？
            <button
              type="button"
              className="btn btn--small"
              onClick={() => {
                resetJob();
                setConfirmReset(false);
              }}
            >
              是
            </button>
            <button type="button" className="btn btn--small btn--ghost" onClick={() => setConfirmReset(false)}>
              否
            </button>
          </span>
        ) : (
          <button type="button" className="btn btn--ghost" onClick={() => setConfirmReset(true)}>
            重来
          </button>
        )}
      </div>
      <p className="job-foot">
        验收在后台用一台一模一样的发动机按固定流程跑：起动、怠速、全油门扫转速{job.plan.freeRev ? '、空轰' : ''}
        {job.plan.endurance ? `、红线耐久 ${job.plan.endurance.seconds} 秒` : ''}
        {job.plan.overrun ? '、收油放炮' : ''}。不开保护，扛不住就会坏{broken ? '' : '，但不会弄坏你台架上这台'}。
      </p>
    </section>
  );
}
