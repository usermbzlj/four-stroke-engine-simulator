import { displacementCc, meanPistonSpeed, overlapDeg, rodBreakRpm, valveFloatRpm, type EcuConfig, type EngineConfig } from '../sim/config';
import { useBench } from '../state/benchStore';
import { useControls } from '../state/controlStore';
import { useLive } from '../state/liveStore';
import { useUi } from '../state/uiStore';
import { toggleBrake } from './useBenchInput';

const rpmText = (v: number): string => Math.round(v).toLocaleString('en-US');

function Delta({ now, before, digits = 1, unit = '', faint }: { now: number; before: number | undefined; digits?: number; unit?: string; faint?: boolean }): React.ReactElement | null {
  if (before === undefined) return null;
  const d = now - before;
  if (Math.abs(d) < Math.pow(10, -digits) / 2) return null;
  return (
    <span className={`delta ${d > 0 ? 'delta--up' : 'delta--down'}${faint ? ' delta--faint' : ''}`}>
      {d > 0 ? '+' : '−'}
      {Math.abs(d).toFixed(digits)}
      {unit}
    </span>
  );
}

function Cell({ label, value, unit, tone, children }: { label: string; value: string; unit?: string; tone?: 'alarm' | 'hot' | undefined; children?: React.ReactNode }): React.ReactElement {
  return (
    <div className={`strip-cell${tone ? ` strip-cell--${tone}` : ''}`}>
      <span className="strip-label">{label}</span>
      <span className="strip-value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {children}
    </div>
  );
}

function buildFacts(c: EngineConfig, e: EcuConfig) {
  return {
    cc: displacementCc(c),
    overlap: overlapDeg(c),
    float: valveFloatRpm(c),
    rod: rodBreakRpm(c),
    speed: meanPistonSpeed(c, e.limiterRpm),
  };
}

/** What the engine is doing right now, and what the last change did to it. */
export function LiveStrip(): React.ReactElement {
  const m = useLive((s) => s.metrics);
  const status = useLive((s) => s.snapshot?.status ?? 'off');
  const damage = useLive((s) => s.snapshot?.pistonDamage ?? 0);
  const fatigue = useLive((s) => s.snapshot?.rodFatigue ?? 0);
  const knockRetard = useLive((s) => s.snapshot?.knockRetard ?? 0);
  const throttle = useLive((s) => s.snapshot?.throttle ?? 0);
  const config = useBench((s) => s.config);
  const ecu = useBench((s) => s.ecu);
  const braked = useControls((s) => s.brakeMode === 'speed');
  const brakeRpm = useControls((s) => s.brakeRpm);
  const fresh = useUi((s) => s.focus);
  const running = status === 'running' && m !== null;
  const torque = m ? (braked ? m.brakeTorque : m.torque) : 0;
  const hp = m ? (Math.max(0, torque) * m.rpm) / 7121 : 0;
  const b = fresh?.before ?? null;
  const fair = b !== null && fresh !== null && fresh.beforeBrake === braked && Math.abs(b.rpm - (m?.rpm ?? 0)) < 150 && Math.abs(fresh.beforeThrottle - throttle) < 0.05;
  const bTorque = b ? (braked ? b.brakeTorque : b.torque) : undefined;
  const bHp = b && bTorque !== undefined ? (Math.max(0, bTorque) * b.rpm) / 7121 : undefined;

  const f = buildFacts(config, ecu);
  const fb = fresh ? buildFacts(fresh.beforeConfig, fresh.beforeEcu) : null;
  const limiter = ecu.limiterRpm;

  return (
    <div className="strip" aria-label="实时影响">
      <div className="strip-row">
        <Cell label={status === 'running' ? '转速' : status === 'cranking' ? '起动中' : status === 'broken' ? '已损坏' : '熄火'} value={running ? rpmText(m.rpm) : '—'} unit="rpm" />
        <Cell label={braked ? '测功扭矩' : '净扭矩'} value={running ? torque.toFixed(1) : '—'} unit="Nm">
          {running && <Delta now={torque} before={bTorque} faint={!fair} />}
        </Cell>
        <Cell label="功率" value={running ? hp.toFixed(1) : '—'} unit="hp">
          {running && <Delta now={hp} before={bHp} faint={!fair} />}
        </Cell>
        <Cell label="充气效率" value={running ? (m.ve * 100).toFixed(0) : '—'} unit="%">
          {running && b && <Delta now={m.ve * 100} before={b.ve * 100} digits={0} faint={!fair} />}
        </Cell>
        <Cell label="λ" value={running ? m.lambda.toFixed(2) : '—'} />
        <Cell label="峰压角" value={running ? m.pmaxDeg.toFixed(0) : '—'} unit="°" tone={running && (m.pmaxDeg < 8 || m.pmaxDeg > 20) ? 'hot' : undefined} />
      </div>

      <div className="strip-row strip-row--facts">
        <Cell label="排量" value={f.cc.toFixed(0)} unit="cc">
          {fb && <Delta now={f.cc} before={fb.cc} digits={0} />}
        </Cell>
        <Cell label="重叠角" value={f.overlap.toFixed(0)} unit="°">
          {fb && <Delta now={f.overlap} before={fb.overlap} digits={0} />}
        </Cell>
        <Cell label="气门飘浮" value={rpmText(f.float)} tone={f.float < limiter ? 'alarm' : undefined}>
          {fb && <Delta now={f.float} before={fb.float} digits={0} />}
        </Cell>
        <Cell label="连杆拉断" value={rpmText(f.rod)} tone={f.rod < limiter * 1.05 ? 'alarm' : undefined}>
          {fb && <Delta now={f.rod} before={fb.rod} digits={0} />}
        </Cell>
        <Cell label="断火时活塞" value={f.speed.toFixed(1)} unit="m/s" tone={f.speed > 25 ? 'alarm' : undefined} />
      </div>

      {(damage > 0.005 || fatigue > 0.005 || knockRetard > 0.3) && (
        <div className="strip-health">
          {damage > 0.005 && <Meter label="活塞损伤" value={damage} />}
          {fatigue > 0.005 && <Meter label="连杆疲劳" value={fatigue} />}
          {knockRetard > 0.3 && <span className="strip-note strip-note--alarm">爆震退角 {knockRetard.toFixed(1)}°</span>}
        </div>
      )}

      <div className="strip-foot">
        {fresh ? (
          <span>
            在调 <b>{fresh.label}</b>
            {b ? (fair ? '，变化是跟你动手前比的。' : '，转速或油门变了，变化只能参考。') : '。'}
          </span>
        ) : (
          <span>动任何一个滑块，这里会显示它带来的变化。</span>
        )}
        {status === 'running' &&
          (braked ? (
            <span className="strip-note">测功机钉在 {rpmText(brakeRpm)} rpm</span>
          ) : (
            <button type="button" className="btn btn--ghost strip-btn" onClick={toggleBrake}>
              想公平比较？钉住转速 <kbd>B</kbd>
            </button>
          ))}
      </div>
    </div>
  );
}

function Meter({ label, value }: { label: string; value: number }): React.ReactElement {
  return (
    <span className={`meter${value > 0.3 ? ' meter--alarm' : ''}`}>
      {label} {(value * 100).toFixed(0)}%
      <i style={{ width: `${Math.min(100, value * 100)}%` }} />
    </span>
  );
}
