import { BLOCK_KEYS, CONFIG_LIMITS, DEFAULT_PRESET, PRESETS, maxValveDiameters, type EngineConfig, type MufflerType } from '../sim/config';
import { useBench } from '../state/benchStore';
import { useControls } from '../state/controlStore';
import { useLive } from '../state/liveStore';
import { Choice, Slider } from './fields';

type NumericKey = keyof typeof CONFIG_LIMITS;

const FIELDS: { title: string; keys: [NumericKey, string, string, number, string?][] }[] = [
  {
    title: '缸体',
    keys: [
      ['bore', '缸径', 'mm', 1],
      ['stroke', '行程', 'mm', 1],
      ['rodLength', '连杆中心距', 'mm', 0, '连杆越短，活塞在上止点附近越急，连杆受力也越大。'],
      ['compressionRatio', '压缩比', ':1', 1, '越高热效率越好，也越容易爆震。'],
    ],
  },
  {
    title: '配气',
    keys: [
      ['intakeValveDiameter', '进气门直径', 'mm', 1],
      ['exhaustValveDiameter', '排气门直径', 'mm', 1],
      ['intakeDuration', '进气持续角', '°', 0, '按 5% 升程量，和凸轮卡上的数一致。'],
      ['exhaustDuration', '排气持续角', '°', 0],
      ['intakeLift', '进气升程', 'mm', 1],
      ['exhaustLift', '排气升程', 'mm', 1],
      ['lobeSeparation', '凸轮夹角', '°', 1, '夹角越小，重叠角越大：高转更猛，怠速更抖。'],
      ['intakeCenterline', '进气中心角', '°', 1],
      ['valveSpringForce', '气门弹簧力', 'N', 0, '弹簧越硬，气门飘浮转速越高，摩擦也越大。'],
    ],
  },
  {
    title: '进排气',
    keys: [
      ['throttleDiameter', '节气门直径', 'mm', 0],
      ['intakeRunnerLength', '进气道长度', 'mm', 0, '进气道里的气柱有惯性，长度决定它在哪个转速帮你多灌气。'],
      ['intakeRunnerDiameter', '进气道直径', 'mm', 0],
      ['exhaustHeaderLength', '排气头段长度', 'mm', 0, '排气压力波的往返时间决定扫气在哪个转速最有效。'],
      ['exhaustHeaderDiameter', '排气头段直径', 'mm', 0],
    ],
  },
  {
    title: '曲轴与连杆',
    keys: [
      ['flywheelInertia', '飞轮惯量', 'kg·m²', 3, '轻飞轮升速快，怠速更难稳住。'],
      ['reciprocatingMass', '往复质量', 'kg', 2, '活塞、活塞销、活塞环和连杆小头。'],
      ['rodStrength', '连杆强度', 'N', 0],
    ],
  },
  {
    title: '燃油与冷却',
    keys: [
      ['fuelOctane', '燃油辛烷值', 'RON', 0],
      ['radiatorCapacity', '散热器', '×', 2, '只在关掉台架水温机后起作用。'],
    ],
  },
];

const MUFFLERS: { value: MufflerType; label: string }[] = [
  { value: 'stock', label: '原厂' },
  { value: 'sport', label: '运动' },
  { value: 'open', label: '直通' },
];

const isBlock = (k: string): boolean => (BLOCK_KEYS as readonly string[]).includes(k);

export function BuildSheet(): React.ReactElement {
  const config = useBench((s) => s.config);
  const presetId = useBench((s) => s.presetId);
  const baseId = useBench((s) => s.basePresetId);
  const setConfig = useBench((s) => s.setConfig);
  const loadPreset = useBench((s) => s.loadPreset);
  const status = useLive((s) => s.snapshot?.status ?? 'off');
  const turning = status === 'running' || status === 'cranking';
  const factory = (PRESETS.find((p) => p.id === baseId) ?? DEFAULT_PRESET).engine;
  const fit = maxValveDiameters(config);

  const set = <K extends keyof EngineConfig>(key: K) => (v: EngineConfig[K]) => setConfig({ [key]: v } as Partial<EngineConfig>);

  return (
    <div className="sheet">
      <p className="sheet-intro">除了缸体，所有零件都能在发动机运转时换，扭矩和声音当场就变。滑块上的小刻度是出厂值。</p>
      <Choice
        label="底子"
        value={presetId}
        disabled={turning}
        options={[...PRESETS.map((p) => ({ value: p.id, label: p.name })), ...(presetId === 'custom' ? [{ value: 'custom', label: '自己改的' }] : [])]}
        onChange={(id) => id !== 'custom' && loadPreset(id)}
      />

      {FIELDS.map((g) => {
        const block = g.keys.every(([k]) => isBlock(k));
        const locked = block && turning;
        return (
          <section key={g.title} className="sheet-group">
            <h3>{g.title}</h3>
            {block && turning && (
              <p className="sheet-lock">
                缸体件要熄火才能换。
                <button type="button" className="btn btn--ghost" onClick={() => useControls.getState().set({ ignition: false })}>
                  熄火 <kbd>K</kbd>
                </button>
              </p>
            )}
            <fieldset disabled={locked} className="sheet-body">
              {g.title === '配气' && (
                <>
                  <Choice
                    label="每缸进气门"
                    param="config.intakeValves"
                    value={config.intakeValves}
                    reference={factory.intakeValves}
                    options={[
                      { value: 1, label: '1 个' },
                      { value: 2, label: '2 个' },
                    ]}
                    onChange={set('intakeValves')}
                  />
                  <Choice
                    label="每缸排气门"
                    param="config.exhaustValves"
                    value={config.exhaustValves}
                    reference={factory.exhaustValves}
                    options={[
                      { value: 1, label: '1 个' },
                      { value: 2, label: '2 个' },
                    ]}
                    onChange={set('exhaustValves')}
                  />
                </>
              )}
              {g.keys.map(([key, label, unit, digits, hint]) => {
                const [min, max0, step] = CONFIG_LIMITS[key];
                const max = key === 'intakeValveDiameter' ? fit.intake : key === 'exhaustValveDiameter' ? fit.exhaust : max0;
                return (
                  <Slider
                    key={key}
                    label={label}
                    param={`config.${key}`}
                    value={config[key]}
                    reference={factory[key]}
                    min={min}
                    max={max}
                    step={step}
                    unit={unit}
                    digits={digits}
                    {...(hint ? { hint } : {})}
                    onChange={set(key)}
                  />
                );
              })}
              {g.title === '进排气' && (
                <Choice label="消音器" param="config.muffler" value={config.muffler} reference={factory.muffler} options={MUFFLERS} onChange={set('muffler')} />
              )}
            </fieldset>
          </section>
        );
      })}
    </div>
  );
}
