import { useId } from 'react';
import { useUi } from '../state/uiStore';

/** Thumb width of the range input, px; keeps the factory mark under the thumb's centre. */
const THUMB = 16;

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  digits?: number;
  hint?: string;
  /** `config.*` / `ecu.*` / `bench.*`: lets the bench know which knob is being worked. */
  param?: string;
  /** Factory value, marked on the track. */
  reference?: number;
  onChange: (v: number) => void;
}

function useTouch(param: string | undefined, label: string): [() => void, boolean] {
  const active = useUi((s) => param !== undefined && s.focus?.param === param);
  const touch = (): void => {
    if (param) useUi.getState().touch(param, label);
  };
  return [touch, active];
}

export function Slider({ label, value, min, max, step, unit, digits = 0, hint, param, reference, onChange }: SliderProps): React.ReactElement {
  const id = useId();
  const [touch, active] = useTouch(param, label);
  const hasRef = reference !== undefined && reference >= min && reference <= max;
  const changed = hasRef && Math.abs(value - reference) > step / 2;
  const refPct = hasRef ? ((reference - min) / (max - min)) * 100 : 0;
  return (
    <div className={`field${active ? ' is-active' : ''}${changed ? ' is-changed' : ''}`}>
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      {changed && (
        <button
          type="button"
          className="field-reset"
          onClick={() => {
            touch();
            onChange(reference);
          }}
          title="恢复出厂值"
        >
          出厂 {reference.toFixed(digits)}
        </button>
      )}
      <output htmlFor={id} className="field-value">
        {value.toFixed(digits)}
        {unit && <small>{unit}</small>}
      </output>
      <div className="field-track">
        <input
          id={id}
          type="range"
          min={min}
          max={max}
          step={step}
          value={value}
          onPointerDown={touch}
          onKeyDown={touch}
          onChange={(e) => onChange(Number(e.target.value))}
        />
        {hasRef && (
          <i className="field-ref" style={{ left: `calc(${refPct}% + ${(0.5 - refPct / 100) * THUMB}px)` }} aria-hidden="true" />
        )}
      </div>
      {hint && (active || !param) && <p className="field-hint">{hint}</p>}
    </div>
  );
}

interface ChoiceProps<T extends string | number | boolean> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  hint?: string;
  param?: string;
  reference?: T;
  disabled?: boolean;
  onChange: (v: T) => void;
}

export function Choice<T extends string | number | boolean>({
  label,
  value,
  options,
  hint,
  param,
  reference,
  disabled,
  onChange,
}: ChoiceProps<T>): React.ReactElement {
  const [touch, active] = useTouch(param, label);
  return (
    <div className={`field${active ? ' is-active' : ''}`}>
      <span className="field-label">{label}</span>
      <div className="choice" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            disabled={disabled}
            className={`${o.value === value ? 'is-on' : ''}${o.value === reference ? ' is-ref' : ''}`}
            title={o.value === reference ? '出厂' : undefined}
            onClick={() => {
              touch();
              onChange(o.value);
            }}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && (active || !param) && <p className="field-hint">{hint}</p>}
    </div>
  );
}

export function Fact({ label, value, tone }: { label: string; value: string; tone?: 'alarm' | undefined }): React.ReactElement {
  return (
    <div className={`fact${tone ? ` fact--${tone}` : ''}`}>
      <span>{label}</span>
      <b>{value}</b>
    </div>
  );
}
