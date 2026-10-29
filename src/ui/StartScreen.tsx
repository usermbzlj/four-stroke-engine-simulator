import { useState } from 'react';
import { PRESETS, displacementCc } from '../sim/config';
import { useBench } from '../state/benchStore';
import { startBench } from '../state/engineLink';

export function StartScreen(): React.ReactElement {
  const presetId = useBench((s) => s.presetId);
  const config = useBench((s) => s.config);
  const loadPreset = useBench((s) => s.loadPreset);
  const [busy, setBusy] = useState(false);

  const enter = async (): Promise<void> => {
    setBusy(true);
    try {
      await startBench();
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="start">
      <div className="start-inner">
        <h1 className="start-title">单缸试验台</h1>
        <p className="start-lede">
          气缸压力、进排气管里来回撞的气柱、你听到的排气声，全部按曲轴每转零点几度算一次。改一个零件，扭矩曲线和声音一起变；改过头，它会坏给你看。
        </p>

        <div className="start-engines" role="radiogroup" aria-label="选择发动机">
          {PRESETS.map((p) => (
            <button
              key={p.id}
              type="button"
              role="radio"
              aria-checked={presetId === p.id}
              className={`start-engine${presetId === p.id ? ' is-on' : ''}`}
              onClick={() => loadPreset(p.id)}
            >
              <span className="start-engine-name">{p.name}</span>
              <span className="start-engine-spec">
                {displacementCc(p.engine).toFixed(0)} cc，{p.engine.bore}×{p.engine.stroke} mm，压缩比 {p.engine.compressionRatio}
              </span>
              <span className="start-engine-blurb">{p.blurb}</span>
            </button>
          ))}
          {presetId === 'custom' && (
            <div className="start-engine is-on">
              <span className="start-engine-name">上次改装的发动机</span>
              <span className="start-engine-spec">
                {displacementCc(config).toFixed(0)} cc，{config.bore}×{config.stroke} mm，压缩比 {config.compressionRatio}
              </span>
            </div>
          )}
        </div>

        <button type="button" className="btn btn--primary btn--big" onClick={enter} disabled={busy}>
          {busy ? '正在接通…' : '进入试验台'}
        </button>
        <p className="start-keys">
          <kbd>S</kbd> 按住起动，<kbd>空格</kbd> 全油门，<kbd>↑</kbd><kbd>↓</kbd> 或数字键调手油门，<kbd>B</kbd> 测功机定速，<kbd>K</kbd> 点火开关。戴耳机效果最好。
        </p>
      </div>
    </div>
  );
}
