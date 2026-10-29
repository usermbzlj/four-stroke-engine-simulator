import { effectiveThrottle, useControls } from '../state/controlStore';
import { nudgeBrake, toggleBrake } from './useBenchInput';

export function ControlStrip(): React.ReactElement {
  const c = useControls();
  const throttle = effectiveThrottle(c);
  const hold = (on: boolean) => () => c.set({ starter: on });

  return (
    <div className="controls" role="group" aria-label="台架操作">
      <button
        type="button"
        className={`ctl ctl--starter${c.starter ? ' is-on' : ''}`}
        onPointerDown={hold(true)}
        onPointerUp={hold(false)}
        onPointerLeave={hold(false)}
        onPointerCancel={hold(false)}
      >
        按住起动 <kbd>S</kbd>
      </button>
      <button
        type="button"
        className={`ctl ctl--toggle${c.ignition ? ' is-on' : ''}`}
        onClick={() => c.set({ ignition: !c.ignition })}
        aria-pressed={c.ignition}
      >
        点火{c.ignition ? '开' : '关'} <kbd>K</kbd>
      </button>

      <label className="ctl-throttle">
        <span className="ctl-throttle-label">
          油门 <b>{Math.round(throttle * 100)}%</b>
          <span className="ctl-hint">
            <kbd>空格</kbd> 全开 <kbd>↑↓</kbd> <kbd>0–9</kbd> 手油门
          </span>
        </span>
        <span className="ctl-throttle-track">
          <span className="ctl-throttle-fill" style={{ width: `${throttle * 100}%` }} />
          <input
            type="range"
            min={0}
            max={1}
            step={0.01}
            value={c.hand}
            onChange={(e) => c.set({ hand: Number(e.target.value) })}
            aria-label="手油门"
          />
        </span>
      </label>

      <div className={`ctl-brake${c.brakeMode === 'speed' ? ' is-on' : ''}`}>
        <button type="button" className="ctl ctl--toggle" onClick={toggleBrake} aria-pressed={c.brakeMode === 'speed'}>
          测功机{c.brakeMode === 'speed' ? '定速' : '脱开'} <kbd>B</kbd>
        </button>
        <button type="button" className="ctl ctl--small" onClick={() => nudgeBrake(-250)} aria-label="定速降低 250 rpm">
          −
        </button>
        <span className="ctl-brake-rpm">{c.brakeRpm.toLocaleString('en-US')}</span>
        <button type="button" className="ctl ctl--small" onClick={() => nudgeBrake(250)} aria-label="定速提高 250 rpm">
          +
        </button>
      </div>
    </div>
  );
}
