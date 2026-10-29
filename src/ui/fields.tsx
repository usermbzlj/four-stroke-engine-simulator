import { useId } from 'react';

interface SliderProps {
  label: string;
  value: number;
  min: number;
  max: number;
  step: number;
  unit?: string;
  digits?: number;
  hint?: string;
  onChange: (v: number) => void;
}

export function Slider({ label, value, min, max, step, unit, digits = 0, hint, onChange }: SliderProps): React.ReactElement {
  const id = useId();
  return (
    <div className="field">
      <label htmlFor={id} className="field-label">
        {label}
      </label>
      <output htmlFor={id} className="field-value">
        {value.toFixed(digits)}
        {unit && <small>{unit}</small>}
      </output>
      <input
        id={id}
        type="range"
        min={min}
        max={max}
        step={step}
        value={value}
        onChange={(e) => onChange(Number(e.target.value))}
      />
      {hint && <p className="field-hint">{hint}</p>}
    </div>
  );
}

interface ChoiceProps<T extends string | number | boolean> {
  label: string;
  value: T;
  options: { value: T; label: string }[];
  hint?: string;
  onChange: (v: T) => void;
}

export function Choice<T extends string | number | boolean>({
  label,
  value,
  options,
  hint,
  onChange,
}: ChoiceProps<T>): React.ReactElement {
  return (
    <div className="field">
      <span className="field-label">{label}</span>
      <div className="choice" role="radiogroup" aria-label={label}>
        {options.map((o) => (
          <button
            key={String(o.value)}
            type="button"
            role="radio"
            aria-checked={o.value === value}
            className={o.value === value ? 'is-on' : ''}
            onClick={() => onChange(o.value)}
          >
            {o.label}
          </button>
        ))}
      </div>
      {hint && <p className="field-hint">{hint}</p>}
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
