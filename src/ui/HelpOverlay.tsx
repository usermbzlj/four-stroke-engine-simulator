import { useEffect } from 'react';
import { useUi } from '../state/uiStore';

const KEYS: [string[], string][] = [
  [['S'], '按住起动机，转速表下面变成「运转」再松手'],
  [['K'], '点火开关（熄火后才能换活塞、连杆、缸径、行程）'],
  [['空格'], '按住全油门'],
  [['↑', '↓'], '手油门 ±2%（滚轮也行，在发动机画面上）'],
  [['0', '–', '9'], '手油门直接到 0%–90%'],
  [['B'], '测功机：把转速钉在当前转速 / 脱开'],
  [['[', ']'], '测功机定速 −/+ 250 rpm'],
  [['Q', 'W', 'A', 'E', 'G'], '打开改装单 / ECU / 整车 / 测功 / 车库'],
  [['T'], '台架 ↔ 赛道'],
  [['Enter'], '赛道上：开跑（灯灭起步）'],
  [['↑', '↓'], '赛道上「我来骑」时：升挡 / 降挡'],
  [['Esc'], '赛道上：放弃这一趟'],
  [['P'], '发动机画面暂停 / 继续'],
  [['←', '→'], '暂停后逐 2° 转曲轴（加 Shift 每次 10°），也可以在画面上拖动'],
  [['L'], '给零件标上名字'],
  [['Esc'], '收起面板、关闭对话框'],
  [['R'], '发动机坏了以后换新零件'],
  [['?'], '这张说明'],
];

export function HelpOverlay(): React.ReactElement {
  const setHelp = useUi((s) => s.setHelp);
  useEffect(() => {
    const key = (e: KeyboardEvent): void => {
      if (e.key === 'Escape' || e.key === '?') {
        e.preventDefault();
        e.stopPropagation();
        setHelp(false);
      }
    };
    window.addEventListener('keydown', key, true);
    return () => window.removeEventListener('keydown', key, true);
  }, [setHelp]);
  return (
    <div className="modal" role="dialog" aria-modal="true" aria-labelledby="help-title" onClick={() => setHelp(false)}>
      <div className="modal-card help" onClick={(e) => e.stopPropagation()}>
        <h2 id="help-title">按键</h2>
        <dl>
          {KEYS.map(([k, text]) => (
            <div key={text}>
              <dt>
                {k.map((x) => (x === '–' ? <span key={x}>–</span> : <kbd key={x}>{x}</kbd>))}
              </dt>
              <dd>{text}</dd>
            </div>
          ))}
        </dl>
        <p className="field-hint">手柄：右扳机是油门，A 键是起动。</p>
        <button type="button" className="btn btn--primary" onClick={() => setHelp(false)} autoFocus>
          知道了
        </button>
      </div>
    </div>
  );
}
