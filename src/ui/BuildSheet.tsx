import { useState } from 'react';
import { currentJob } from '../game/session';
import { useGame } from '../game/store';
import { MUFFLER_TEXT } from '../game/jobs';
import { PARTS, money, partChanged, type Part } from '../game/parts';
import { CONFIG_LIMITS, PRESETS, maxValveDiameters, type EngineConfig, type MufflerType } from '../sim/config';
import { useBench } from '../state/benchStore';
import { useControls } from '../state/controlStore';
import { useLive } from '../state/liveStore';
import { Choice, Slider } from './fields';
import { Bill } from './Bill';
import { ENGINE_UNLOCK, PART_REP, isEngineOpen, partOpen, useCareer } from '../game/career';

type NumericKey = keyof typeof CONFIG_LIMITS;

interface FieldMeta {
  label: string;
  unit: string;
  digits: number;
  hint?: string;
}

const META: Record<NumericKey, FieldMeta> = {
  bore: { label: '缸径', unit: 'mm', digits: 1 },
  stroke: { label: '行程', unit: 'mm', digits: 1 },
  rodLength: { label: '连杆中心距', unit: 'mm', digits: 0, hint: '连杆越短，活塞在上止点附近越急，连杆受力也越大。' },
  compressionRatio: { label: '压缩比', unit: ':1', digits: 1, hint: '越高热效率越好，也越容易爆震。' },
  intakeValves: { label: '进气门数', unit: '', digits: 0 },
  exhaustValves: { label: '排气门数', unit: '', digits: 0 },
  intakeValveDiameter: { label: '进气门直径', unit: 'mm', digits: 1 },
  exhaustValveDiameter: { label: '排气门直径', unit: 'mm', digits: 1 },
  intakeDuration: { label: '进气持续角', unit: '°', digits: 0, hint: '越长高转越能吃气，低转越容易倒灌。' },
  exhaustDuration: { label: '排气持续角', unit: '°', digits: 0 },
  intakeLift: { label: '进气升程', unit: 'mm', digits: 1, hint: '升程越大越通，但气门要跑得更快，更容易飘浮。' },
  exhaustLift: { label: '排气升程', unit: 'mm', digits: 1 },
  lobeSeparation: { label: '凸轮夹角', unit: '°', digits: 1, hint: '夹角越小，重叠角越大：高转更猛，怠速更抖。' },
  intakeCenterline: { label: '进气中心角', unit: '°', digits: 1, hint: '数字小 = 进气门早关，扭矩往低转挪。' },
  valveSpringForce: { label: '弹簧力', unit: 'N', digits: 0, hint: '越硬气门飘浮转速越高，摩擦也越大。' },
  throttleDiameter: { label: '节气门直径', unit: 'mm', digits: 0 },
  intakeRunnerLength: { label: '进气道长度', unit: 'mm', digits: 0 },
  intakeRunnerDiameter: { label: '进气道直径', unit: 'mm', digits: 0 },
  exhaustHeaderLength: { label: '排气头段长度', unit: 'mm', digits: 0 },
  exhaustHeaderDiameter: { label: '排气头段直径', unit: 'mm', digits: 0 },
  flywheelInertia: { label: '飞轮惯量', unit: 'kg·m²', digits: 3 },
  reciprocatingMass: { label: '往复质量', unit: 'kg', digits: 2, hint: '活塞、活塞销、活塞环和连杆小头。越轻连杆越轻松。' },
  rodStrength: { label: '连杆强度', unit: 'N', digits: 0 },
  fuelOctane: { label: '燃油辛烷值', unit: 'RON', digits: 0 },
  radiatorCapacity: { label: '散热器', unit: '×', digits: 2, hint: '只在没有台架水温机时起作用。' },
  plenumVolume: { label: '稳压腔容积', unit: '× 排量', digits: 1, hint: '大了进气脉动被抚平、扭矩稳，油门响应变钝；单缸上涡轮最好有 4–5 倍排量。' },
  injectorFlow: { label: '喷油嘴流量', unit: 'cc/min', digits: 0, hint: '喷油嘴占空比到 90% 就喷不出更多了，再往上发动机只会越跑越稀。' },
  vvtRange: { label: '进气相位器行程', unit: '°', digits: 0, hint: '0 = 没有可变正时。装了以后 ECU 的凸轮表才起作用。' },
  turboSize: { label: '涡轮尺寸', unit: '', digits: 2, hint: '0 = 自然吸气。小涡轮起压早、高转憋气；大涡轮迟滞长、顶端猛。' },
  intercooler: { label: '中冷效率', unit: '', digits: 2, hint: '增压后的空气很热，中冷把它降回来，爆震边界和充气量都跟着好。' },
};

const MUFFLERS: { value: MufflerType; label: string }[] = (['stock', 'sport', 'open'] as const).map((m) => ({ value: m, label: MUFFLER_TEXT[m] }));
const COUNT = [
  { value: 1, label: '1 个' },
  { value: 2, label: '2 个' },
];

function summary(part: Part, c: EngineConfig): string {
  return part.keys
    .map((k) => {
      if (k === 'muffler') return MUFFLER_TEXT[c.muffler];
      if (k === 'intakeValves' || k === 'exhaustValves') return `${c[k]}`;
      const m = META[k as NumericKey];
      return `${(c[k] as number).toFixed(m.digits)}${m.unit === ':1' ? '' : m.unit === '' ? '' : ` ${m.unit}`}`;
    })
    .join(' · ')
    .replace(/^(\d) · (\d) · /, '$1 进 $2 排 · ');
}

export function BuildSheet(): React.ReactElement {
  const config = useBench((s) => s.config);
  const baseline = useBench((s) => s.baseline);
  const presetId = useBench((s) => s.presetId);
  const setConfig = useBench((s) => s.setConfig);
  const loadPreset = useBench((s) => s.loadPreset);
  const mode = useGame((s) => s.mode);
  useGame((s) => s.jobId);
  useCareer((s) => s.rep);
  useCareer((s) => s.ownedEngines);
  const job = currentJob();
  const status = useLive((s) => s.snapshot?.status ?? 'off');
  const turning = status === 'running' || status === 'cranking';
  const [open, setOpen] = useState<Record<string, boolean>>({});
  const fit = maxValveDiameters(config);
  const factory = baseline.config;

  const set = <K extends keyof EngineConfig>(key: K) => (v: EngineConfig[K]) => setConfig({ [key]: v } as Partial<EngineConfig>);

  return (
    <div className="sheet">
      <Bill />

      {mode === 'sandbox' && (
        <Choice
          label="换一台发动机"
          value={presetId}
          disabled={turning}
          hint={turning ? '熄火以后才能换整台发动机。' : undefined}
          options={[
            ...PRESETS.map((p) => ({ value: p.id, label: isEngineOpen(p.id) ? p.name : `${p.name}（声望 ${ENGINE_UNLOCK[p.id]?.rep ?? 0}，车库里买）` })),
            ...(presetId === 'custom' ? [{ value: 'custom', label: '自己改的' }] : []),
          ]}
          onChange={(id) => id !== 'custom' && isEngineOpen(id) && loadPreset(id)}
        />
      )}

      <ol className="parts">
        {PARTS.map((part) => {
          const repLocked = mode === 'sandbox' && !partOpen(part.id) && !partChanged(part, factory, config);
          const locked = (job?.locked?.includes(part.id) ?? false) || repLocked;
          const isChanged = partChanged(part, factory, config);
          const stopped = part.block && turning;
          const expanded = open[part.id] ?? false;
          return (
            <li key={part.id} className={`part${isChanged ? ' is-changed' : ''}${locked ? ' is-locked' : ''}${expanded ? ' is-open' : ''}`}>
              <button type="button" className="part-head" aria-expanded={expanded} onClick={() => setOpen({ ...open, [part.id]: !expanded })}>
                <span className="part-name">
                  {part.name}
                  {isChanged && <em>已换</em>}
                  {locked && <em className="part-lock">{repLocked ? `声望 ${PART_REP[part.id]} 解锁` : '这单不许动'}</em>}
                </span>
                <span className="part-price">{part.price > 0 ? money(part.price) : '免费'}</span>
                <span className="part-sum">{summary(part, config)}</span>
                <span className="part-caret" aria-hidden="true" />
              </button>
              {expanded && (
                <div className="part-body">
                  <p className="part-pitch">{part.pitch}</p>
                  {stopped && !locked && (
                    <p className="sheet-lock">
                      这个零件要熄火才能换。
                      <button type="button" className="btn btn--small" onClick={() => useControls.getState().set({ ignition: false })}>
                        熄火 <kbd>K</kbd>
                      </button>
                    </p>
                  )}
                  <fieldset disabled={locked || stopped} className="sheet-body">
                    {part.keys.map((key) => {
                      if (key === 'muffler') {
                        return <Choice key={key} label="消音器" param="config.muffler" value={config.muffler} reference={factory.muffler} options={MUFFLERS} onChange={set('muffler')} />;
                      }
                      if (key === 'intakeValves' || key === 'exhaustValves') {
                        return (
                          <Choice
                            key={key}
                            label={META[key].label}
                            param={`config.${key}`}
                            value={config[key]}
                            reference={factory[key]}
                            options={COUNT}
                            onChange={set(key)}
                          />
                        );
                      }
                      const k = key as NumericKey;
                      const m = META[k];
                      const [min, max0, step] = CONFIG_LIMITS[k];
                      const max = k === 'intakeValveDiameter' ? fit.intake : k === 'exhaustValveDiameter' ? fit.exhaust : max0;
                      return (
                        <Slider
                          key={k}
                          label={m.label}
                          param={`config.${k}`}
                          value={config[k]}
                          reference={factory[k]}
                          min={min}
                          max={max}
                          step={step}
                          unit={m.unit}
                          digits={m.digits}
                          {...(m.hint ? { hint: m.hint } : {})}
                          onChange={set(k)}
                        />
                      );
                    })}
                    {isChanged && !locked && (
                      <button
                        type="button"
                        className="btn btn--small btn--ghost part-revert"
                        onClick={() => setConfig(Object.fromEntries(part.keys.map((k) => [k, factory[k]])) as Partial<EngineConfig>)}
                      >
                        装回原件（退 {money(part.price)}）
                      </button>
                    )}
                  </fieldset>
                </div>
              )}
            </li>
          );
        })}
      </ol>
      <p className="field-hint">
        除了活塞、连杆、缸径和行程，其他零件都能在发动机运转时换，扭矩和声音当场就变。滑块上的小竖线是{mode === 'job' ? '接单时' : '出厂'}的值。
      </p>
    </div>
  );
}
