import { useEffect, useRef } from 'react';
import { PHASE_TEXT } from '../../game/acceptance';
import { JOBS, jobById } from '../../game/jobs';
import { money } from '../../game/parts';
import { cancelAcceptance, closeAcceptance, enterJob, useAcceptance } from '../../game/session';
import { isUnlocked, useGame } from '../../game/store';
import { useBench } from '../../state/benchStore';
import { useUi } from '../../state/uiStore';
import { DynoChart, type ChartMark } from '../DynoChart';
import { Stars } from './Stars';

const VERDICT = ['没通过', '交车了', '客户很满意', '完美交车'];

export function AcceptanceDialog(): React.ReactElement | null {
  const a = useAcceptance();
  const progress = useGame((s) => s.progress);
  const limiter = useBench((s) => s.ecu.limiterRpm);
  const primary = useRef<HTMLButtonElement | null>(null);
  const job = jobById(a.jobId);

  useEffect(() => {
    if (a.status === 'done') primary.current?.focus();
  }, [a.status]);

  useEffect(() => {
    if (!a.open) return undefined;
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') {
        e.preventDefault();
        closeAcceptance();
      }
    };
    window.addEventListener('keydown', key);
    return () => window.removeEventListener('keydown', key);
  }, [a.open]);

  if (!a.open || !job) return null;
  const g = a.grade;
  const r = a.result;
  const best = a.prevBest;
  const index = JOBS.indexOf(job);
  const next = JOBS[index + 1];
  const nextOpen = next !== undefined && isUnlocked(index + 1, progress);
  const done = a.status === 'done' && g && r;

  const marks: ChartMark[] = [];
  [...job.rules, job.bonus].forEach((c, i) => {
    if (!c.mark) return;
    const pass = done ? (i < job.rules.length ? g.rules[i]!.pass : g.bonus.pass) : null;
    marks.push({ ...c.mark, pass });
  });

  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="acc-title">
      <div className={`modal-card acc${done ? (g.passed ? ' is-pass' : ' is-fail') : ''}`}>
        <header className="acc-head">
          <p className="acc-kicker">验收 · {job.title}</p>
          {done ? (
            <>
              <h2 id="acc-title">{VERDICT[g.stars]}</h2>
              <Stars n={g.stars} big />
              {g.stars > a.prevStars && a.prevStars > 0 && <p className="acc-new">新纪录！比上次多 {g.stars - a.prevStars} 颗星</p>}
            </>
          ) : a.status === 'error' ? (
            <h2 id="acc-title">验收出错了</h2>
          ) : (
            <>
              <h2 id="acc-title">{PHASE_TEXT[a.phase]}…</h2>
              <div className="acc-bar" role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(a.fraction * 100)}>
                <i style={{ width: `${a.fraction * 100}%` }} />
              </div>
            </>
          )}
        </header>

        <DynoChart
          className="acc-chart"
          maxRpm={limiter}
          marks={marks}
          series={[
            ...(best ? [{ points: best.curve, color: 'var(--muted)', ghost: true }] : []),
            { points: a.curve, color: 'var(--heat)', live: true },
          ]}
        />
        <p className="acc-legend">
          <i className="sw sw--live" />
          这次
          {best && (
            <>
              <i className="sw sw--ghost" />
              之前最好（{best.hp.toFixed(1)} hp）
            </>
          )}
          <span>实线扭矩，虚线功率</span>
        </p>

        {a.status === 'error' && <p className="acc-error">{a.error}</p>}

        {done && (
          <>
            {r.failure && (
              <div className="acc-broke">
                <b>验收时坏了：{r.failure.title}</b>
                <span>
                  {PHASE_TEXT[r.failedIn ?? 'sweep']}阶段，{Math.round(r.failure.rpm).toLocaleString('en-US')} rpm。{r.failure.detail}
                </span>
              </div>
            )}
            <ul className="job-checks acc-checks">
              {job.rules.map((c, i) => (
                <li key={c.label} className={g.rules[i]!.pass ? 'is-pass' : 'is-fail'}>
                  <span className={`chk${g.rules[i]!.pass ? ' is-pass' : ' is-fail'}`} aria-hidden="true" />
                  <span className="job-check-label">{c.label}</span>
                  <span className="job-check-val">{g.rules[i]!.actual}</span>
                </li>
              ))}
              <li className={`job-extra${g.bonus.pass ? ' is-pass' : ''}`}>
                <span className="job-star">★★</span>
                <span className="job-check-label">{job.bonus.label}</span>
                <span className="job-check-val">{g.bonus.actual}</span>
              </li>
              <li className={`job-extra${g.withinBudget ? ' is-pass' : ' is-fail'}`}>
                <span className="job-star">★★★</span>
                <span className="job-check-label">零件花费不超过 {money(job.budget)}</span>
                <span className="job-check-val">{money(a.cost)}</span>
              </li>
            </ul>
            <p className="acc-stats">
              最大扭矩 <b>{r.peakTorque.toFixed(1)}</b> Nm @ {r.peakTorqueRpm.toLocaleString('en-US')}{'\u3000'}最大功率 <b>{r.peakHp.toFixed(1)}</b> hp @{' '}
              {r.peakHpRpm.toLocaleString('en-US')}
              {r.knockEvents > 0 && <>{'\u3000'}爆震 {r.knockEvents} 次</>}
              {r.pistonDamage > 0.005 && <>{'\u3000'}活塞损伤 {(r.pistonDamage * 100).toFixed(1)}%</>}
              {r.rodFatigue > 0.005 && <>{'\u3000'}连杆疲劳 {(r.rodFatigue * 100).toFixed(0)}%</>}
            </p>
          </>
        )}

        <footer className="acc-actions">
          {a.status === 'running' ? (
            <button type="button" className="btn" onClick={cancelAcceptance}>
              取消验收
            </button>
          ) : (
            <>
              {done && g.passed && next && nextOpen ? (
                <button ref={primary} type="button" className="btn btn--primary" onClick={() => enterJob(next.id)}>
                  下一单：{next.title}
                </button>
              ) : null}
              <button ref={done && g.passed && nextOpen ? undefined : primary} type="button" className={`btn${done && g.passed && nextOpen ? '' : ' btn--primary'}`} onClick={closeAcceptance}>
                {done && g.stars < 3 ? '回去接着改' : '关闭'}
              </button>
              <button
                type="button"
                className="btn btn--ghost"
                onClick={() => {
                  closeAcceptance();
                  useUi.getState().setView('board');
                }}
              >
                工单列表
              </button>
            </>
          )}
        </footer>
      </div>
    </div>
  );
}
