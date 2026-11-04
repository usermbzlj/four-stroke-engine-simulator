import { useBench } from '../state/benchStore';
import { useControls } from '../state/controlStore';
import { renewParts } from '../state/engineLink';
import { useLive } from '../state/liveStore';

interface ReadingProps {
  label: string;
  value: string;
  unit?: string;
  /** undefined keeps an empty line; null drops it. */
  note?: string | null | undefined;
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
      {/* Reserve the note line even when empty, so the column never jumps. */}
      {note !== null && <span className="reading-note">{note ?? '\u00a0'}</span>}
    </div>
  );
}

export function Readouts(): React.ReactElement {
  const s = useLive((x) => x.snapshot);
  const brake = useControls((x) => x.brakeMode === 'speed');
  const turbo = useBench((x) => x.config.turboSize > 0);
  const vvt = useBench((x) => x.config.vvtRange > 0);
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
        <Reading label="进气压力" value={s ? s.mapKpa.toFixed(0) : '—'} unit="kPa" note={null} />
        <Reading label="充气效率" value={fmt(c ? c.ve * 100 : undefined)} unit="%" note={null} />
        <Reading label="喷油嘴" value={fmt(c ? c.injDuty * 100 : undefined)} unit="%" tone={c && running && c.injDuty > 0.88 ? 'alarm' : undefined} note={null} />
        {turbo ? (
          <Reading label="增压" value={s ? s.boostKpa.toFixed(0) : '—'} unit="kPa" note={s ? `涡轮 ${(s.turboN * 100).toFixed(0)}%` : undefined} />
        ) : vvt ? (
          <Reading label="进气凸轮" value={s ? s.camPhase.toFixed(0) : '—'} unit="°" note={null} />
        ) : null}
      </div>
      <div className="readouts-group">
        <Reading label="排温" value={s ? s.egtC.toFixed(0) : '—'} unit="°C" tone={s && s.egtC > 850 ? 'hot' : undefined} note={null} />
        <Reading label="水温" value={s ? s.coolantC.toFixed(0) : '—'} unit="°C" tone={s && s.coolantC > 110 ? 'alarm' : undefined} note={null} />
        <Reading label="机油" value={s ? s.oilC.toFixed(0) : '—'} unit="°C" note={s ? `${s.oilPressure.toFixed(1)} bar` : undefined} />
      </div>
      <div className="readouts-group">
        <Reading label="活塞损伤" value={s ? (s.pistonDamage * 100).toFixed(1) : '—'} unit="%" tone={s && s.pistonDamage > 0.3 ? 'alarm' : undefined} note={null} />
        <Reading label="连杆疲劳" value={s ? (s.rodFatigue * 100).toFixed(1) : '—'} unit="%" tone={s && s.rodFatigue > 0.3 ? 'alarm' : undefined} note={null} />
        <button
          type="button"
          className="btn btn--small readouts-renew"
          disabled={!s || s.failure !== null || (s.pistonDamage < 0.0005 && s.rodFatigue < 0.0005)}
          onClick={renewParts}
          title="换上新活塞和新连杆，损伤和疲劳清零。只换磨损件，不改规格，不花零件钱。"
        >
          换新活塞连杆
        </button>
      </div>
    </div>
  );
}
