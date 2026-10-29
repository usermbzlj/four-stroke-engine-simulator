import { useControls } from '../state/controlStore';
import { useLive } from '../state/liveStore';

interface ReadingProps {
  label: string;
  value: string;
  unit?: string;
  note?: string | undefined;
  tone?: 'hot' | 'cold' | 'alarm' | undefined;
}

function Reading({ label, value, unit, note, tone }: ReadingProps): React.ReactElement {
  return (
    <div className={`reading${tone ? ` reading--${tone}` : ''}`}>
      <span className="reading-label">{label}</span>
      <span className="reading-value">
        {value}
        {unit && <small>{unit}</small>}
      </span>
      {note && <span className="reading-note">{note}</span>}
    </div>
  );
}

export function Readouts(): React.ReactElement {
  const s = useLive((x) => x.snapshot);
  const brake = useControls((x) => x.brakeMode === 'speed');
  const c = s?.cycle ?? null;
  const running = s?.status === 'running';
  const torque = c ? (brake ? c.brakeTorque : c.torque) : 0;
  const rpm = c?.rpm ?? 0;
  const hp = running ? (Math.max(0, torque) * rpm) / 7121 : 0;

  const fmt = (v: number | undefined, digits = 0): string => {
    if (v === undefined || !running) return '—';
    const text = v.toFixed(digits);
    return Number(text) === 0 ? (0).toFixed(digits) : text;
  };

  return (
    <div className="readouts">
      <div className="readouts-group readouts-group--main">
        <Reading label={brake ? '测功机扭矩' : '曲轴净扭矩'} value={fmt(torque, 1)} unit="Nm" />
        <Reading label="功率" value={running ? hp.toFixed(1) : '—'} unit="hp" note={running ? `${(hp * 0.7457).toFixed(1)} kW` : undefined} />
      </div>
      <div className="readouts-group">
        <Reading
          label="点火提前"
          value={s ? s.advance.toFixed(1) : '—'}
          unit="°"
          note={s && s.knockRetard > 0.3 ? `爆震退角 ${s.knockRetard.toFixed(1)}°` : undefined}
          tone={s && s.knockRetard > 0.3 ? 'alarm' : undefined}
        />
        <Reading label="空燃比 λ" value={fmt(c?.misfire ? undefined : c?.lambda, 2)} note={s ? `目标 ${s.lambdaTarget.toFixed(2)}` : undefined} />
        <Reading label="进气压力" value={s ? s.mapKpa.toFixed(0) : '—'} unit="kPa" />
        <Reading label="充气效率" value={fmt(c ? c.ve * 100 : undefined)} unit="%" />
      </div>
      <div className="readouts-group">
        <Reading label="排温" value={s ? s.egtC.toFixed(0) : '—'} unit="°C" tone={s && s.egtC > 850 ? 'hot' : undefined} />
        <Reading label="水温" value={s ? s.coolantC.toFixed(0) : '—'} unit="°C" tone={s && s.coolantC > 110 ? 'alarm' : undefined} />
        <Reading label="机油" value={s ? s.oilC.toFixed(0) : '—'} unit="°C" note={s ? `${s.oilPressure.toFixed(1)} bar` : undefined} />
      </div>
      <div className="readouts-group">
        <Reading
          label="活塞损伤"
          value={s ? (s.pistonDamage * 100).toFixed(1) : '—'}
          unit="%"
          tone={s && s.pistonDamage > 0.3 ? 'alarm' : undefined}
        />
        <Reading
          label="连杆疲劳"
          value={s ? (s.rodFatigue * 100).toFixed(1) : '—'}
          unit="%"
          tone={s && s.rodFatigue > 0.3 ? 'alarm' : undefined}
        />
      </div>
    </div>
  );
}
