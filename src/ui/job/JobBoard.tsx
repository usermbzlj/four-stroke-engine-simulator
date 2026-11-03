import { JOBS } from '../../game/jobs';
import { money } from '../../game/parts';
import { enterJob, enterSandbox } from '../../game/session';
import { isUnlocked, totalStars, useGame } from '../../game/store';
import { PRESETS } from '../../sim/config';
import { useLink } from '../../state/engineLink';
import { openBench } from './openBench';
import { useUi } from '../../state/uiStore';
import { Stars } from './Stars';

export function JobBoard(): React.ReactElement {
  const progress = useGame((s) => s.progress);
  const mode = useGame((s) => s.mode);
  const jobId = useGame((s) => s.jobId);
  const drafts = useGame((s) => s.drafts);
  const started = useLink((s) => s.started);
  const setView = useUi((s) => s.setView);
  const stars = totalStars(progress);

  return (
    <div className="board">
      <header className="board-head">
        <div>
          <p className="board-kicker">老周的修理铺</p>
          <h1>工单</h1>
        </div>
        <div className="board-score">
          <b>{stars}</b>
          <span>/ {JOBS.length * 3} ★</span>
        </div>
        <nav className="board-nav">
          <button type="button" className="btn" onClick={() => void openBench(enterSandbox)}>
            自由试验台
          </button>
          <button type="button" className="btn btn--ghost" onClick={() => setView(started ? 'bench' : 'home')}>
            {started ? '回到台架' : '返回'}
          </button>
        </nav>
      </header>
      <p className="board-lede">
        每单从客户的发动机开始。改零件要花钱，ECU 随便调。改好了点「提交验收」，后台会用一台一样的发动机按固定流程跑一遍：达标一颗星，冲到加分线两颗星，还没超预算三颗星。拿到一颗星就能接下一单。
      </p>
      <ol className="board-grid">
        {JOBS.map((job, i) => {
          const open = isUnlocked(i, progress);
          const p = progress[job.id];
          const current = mode === 'job' && jobId === job.id;
          const engine = PRESETS.find((x) => x.id === job.presetId)?.name ?? '';
          return (
            <li key={job.id}>
              <button
                type="button"
                className={`ticket${open ? '' : ' is-locked'}${p?.stars ? ' is-done' : ''}${current ? ' is-current' : ''}`}
                disabled={!open}
                onClick={() => void openBench(() => enterJob(job.id))}
              >
                <span className="ticket-no">{String(i + 1).padStart(2, '0')}</span>
                <span className="ticket-title">{open ? job.title : '？？？'}</span>
                <span className="ticket-client">{open ? job.client : '先把上一单做完'}</span>
                {open && <span className="ticket-engine">{engine} · 预算 {money(job.budget)}</span>}
                <span className="ticket-foot">
                  <Stars n={p?.stars ?? 0} />
                  {current ? <em>正在做</em> : drafts[job.id] && !p?.stars ? <em>做到一半</em> : null}
                </span>
              </button>
            </li>
          );
        })}
      </ol>
    </div>
  );
}
