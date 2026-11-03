import { JOBS } from '../game/jobs';
import { enterJob, enterSandbox } from '../game/session';
import { isUnlocked, totalStars, useGame } from '../game/store';
import { PRESETS, displacementCc } from '../sim/config';
import { useBench } from '../state/benchStore';
import { useUi } from '../state/uiStore';
import { openBench } from './job/openBench';

export function StartScreen(): React.ReactElement {
  const progress = useGame((s) => s.progress);
  const mode = useGame((s) => s.mode);
  const jobId = useGame((s) => s.jobId);
  const presetId = useBench((s) => s.presetId);
  const setView = useUi((s) => s.setView);
  const stars = totalStars(progress);
  const nextIndex = JOBS.findIndex((j, i) => isUnlocked(i, progress) && !progress[j.id]?.stars);
  const resume = mode === 'job' && jobId ? JOBS.find((j) => j.id === jobId) : undefined;
  const target = resume ?? JOBS[nextIndex >= 0 ? nextIndex : 0]!;

  const sandbox = (id?: string): void => {
    void openBench(() => {
      enterSandbox();
      if (id) useBench.getState().loadPreset(id);
    });
  };

  return (
    <div className="start">
      <div className="start-inner">
        <p className="start-kicker">单缸四冲程 · 物理试验台</p>
        <h1 className="start-title">老周的台架</h1>
        <p className="start-lede">
          气缸压力、进排气管里来回撞的气柱、你听到的排气声，全部按曲轴每转零点几度算一次。改一个零件，扭矩曲线和声音一起变；改过头，它会坏给你看。
        </p>

        <div className="start-modes">
          <button type="button" className="mode mode--main" onClick={() => void openBench(() => enterJob(target.id))}>
            <span className="mode-kicker">{resume ? '继续工单' : stars > 0 ? '下一单' : '从第一单开始'}</span>
            <span className="mode-title">{target.title}</span>
            <span className="mode-text">{target.client}：{target.brief}</span>
            <span className="mode-foot">
              {JOBS.length} 张工单 · 已拿 {stars} / {JOBS.length * 3} ★
            </span>
          </button>
          <div className="mode-side">
            <button type="button" className="mode" onClick={() => setView('board')}>
              <span className="mode-title">工单列表</span>
              <span className="mode-text">挑一单做，或者回去刷三星。</span>
            </button>
            <div className="mode mode--sandbox">
              <span className="mode-title">自由试验台</span>
              <span className="mode-text">没有客户，没有预算。随便改，随便炸。</span>
              <div className="mode-engines">
                {PRESETS.map((p) => (
                  <button key={p.id} type="button" className="btn btn--small" onClick={() => sandbox(p.id)} title={p.blurb}>
                    {p.name}
                    <small>{displacementCc(p.engine).toFixed(0)} cc</small>
                  </button>
                ))}
                {presetId === 'custom' && mode === 'sandbox' && (
                  <button type="button" className="btn btn--small" onClick={() => sandbox()}>
                    上次改的
                  </button>
                )}
              </div>
            </div>
          </div>
        </div>

        <p className="start-keys">
          <kbd>S</kbd> 按住起动{'\u3000'}<kbd>空格</kbd> 全油门{'\u3000'}<kbd>↑</kbd>
          <kbd>↓</kbd> 手油门{'\u3000'}<kbd>B</kbd> 测功机定速{'\u3000'}<kbd>?</kbd> 全部按键。戴耳机效果最好。
        </p>
      </div>
    </div>
  );
}
