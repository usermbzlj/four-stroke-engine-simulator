import { useState } from 'react';
import { money } from '../game/parts';
import { useGame } from '../game/store';
import { SHIFT_COUNT } from '../sim/config';
import { gearSpeeds } from '../sim/race';
import { CHASSIS, GEAR_LIMITS, VEHICLE_LIMITS, VEHICLE_PARTS, overallRatio, vehiclePartChanged, type ChassisId, type VehicleConfig } from '../sim/vehicle';
import { baseVehicle, useBench } from '../state/benchStore';
import { isChassisOpen } from '../game/career';
import { Choice, Slider } from './fields';
import { Bill } from './Bill';
import { VEHICLE_PART_REP, vehiclePartOpen, useCareer } from '../game/career';

const ON_OFF = [
  { value: true, label: '开' },
  { value: false, label: '关' },
];

type NumKey = keyof typeof VEHICLE_LIMITS;
const META: Partial<Record<NumKey, { label: string; unit: string; digits: number; hint?: string }>> = {
  finalDrive: { label: '主减速比', unit: '', digits: 2, hint: '后链轮齿数 ÷ 前链轮齿数。大 = 每个挡都短。' },
  tireGrip: { label: '轮胎抓地系数', unit: 'μ', digits: 2 },
  tireRadius: { label: '轮胎滚动半径', unit: 'm', digits: 3 },
  mass: { label: '整车 + 车手', unit: 'kg', digits: 0 },
  cgHeight: { label: '重心高度', unit: 'm', digits: 2, hint: '越低越不容易抬头。' },
  wheelbase: { label: '轴距', unit: 'm', digits: 2, hint: '越长越不容易抬头，也越稳。' },
  rearShare: { label: '后轮静态载荷', unit: '', digits: 2, hint: '后轮压得越多起步越抓地，前轮也越轻。' },
  cdA: { label: '风阻面积', unit: 'm²', digits: 2 },
  clutchCapacity: { label: '离合器传扭', unit: 'Nm', digits: 0, hint: '要比发动机扭矩大不少，不然大扭矩时会打滑。' },
};

/** Speed in each gear against rpm: the classic saw-tooth, drawn as bars to the limiter. */
function GearChart({ v, limiter, shift }: { v: VehicleConfig; limiter: number; shift: number[] }): React.ReactElement {
  const speeds = gearSpeeds(v, limiter);
  const top = Math.max(...speeds);
  return (
    <div className="gear-chart" aria-label="各挡极速">
      {speeds.map((s, i) => {
        const up = shift[i] && shift[i]! > 0 ? shift[i]! : limiter - 150;
        const next = i < speeds.length - 1 ? (up * overallRatio(v, i + 2)) / overallRatio(v, i + 1) : null;
        return (
          <div key={i} className="gear-row">
            <span>{i + 1} 挡</span>
            <i style={{ width: `${(s / top) * 100}%` }} />
            <b>{s.toFixed(0)} km/h</b>
            {next !== null && <small>升挡后 {Math.round(next).toLocaleString('en-US')} rpm</small>}
          </div>
        );
      })}
    </div>
  );
}

export function CarSheet(): React.ReactElement {
  const v = useBench((s) => s.vehicle);
  const ecu = useBench((s) => s.ecu);
  const baseline = useBench((s) => s.baseline);
  const setVehicle = useBench((s) => s.setVehicle);
  const setEcu = useBench((s) => s.setEcu);
  const mode = useGame((s) => s.mode);
  const [open, setOpen] = useState<Record<string, boolean>>({ sprocket: true });
  const base = baseVehicle(baseline, v);
  useCareer((s) => s.rep);
  useCareer((s) => s.ownedChassis);
  const num = (k: NumKey): React.ReactElement => {
    const m = META[k]!;
    const [min, max, step] = VEHICLE_LIMITS[k];
    return (
      <Slider
        key={k}
        label={m.label}
        param={`vehicle.${k}`}
        value={v[k] as number}
        reference={base[k] as number}
        min={k === 'mass' ? CHASSIS[v.chassis].minMass : min}
        max={max}
        step={step}
        unit={m.unit}
        digits={m.digits}
        {...(m.hint ? { hint: m.hint } : {})}
        onChange={(x) => setVehicle({ [k]: x } as Partial<VehicleConfig>)}
      />
    );
  };

  return (
    <div className="sheet">
      <Bill />

      <Choice
        label="车型"
        value={v.chassis}
        options={(Object.keys(CHASSIS) as ChassisId[]).map((id) => ({ value: id, label: `${CHASSIS[id].name}${mode === 'sandbox' && !isChassisOpen(id) ? '（未解锁）' : ''}` }))}
        hint={CHASSIS[v.chassis].blurb}
        onChange={(id) => {
          if (mode === 'sandbox' && !isChassisOpen(id)) return;
          setVehicle({ ...CHASSIS[id].base });
        }}
      />

      <GearChart v={v} limiter={ecu.limiterRpm} shift={ecu.shiftRpm} />

      <ol className="parts">
        {VEHICLE_PARTS.map((part) => {
          const isChanged = vehiclePartChanged(part, base, v);
          const expanded = open[part.id] ?? false;
          const locked = mode === 'sandbox' && !vehiclePartOpen(part.id) && !isChanged;
          return (
            <li key={part.id} className={`part${isChanged ? ' is-changed' : ''}${locked ? ' is-locked' : ''}${expanded ? ' is-open' : ''}`}>
              <button type="button" className="part-head" aria-expanded={expanded} onClick={() => setOpen({ ...open, [part.id]: !expanded })}>
                <span className="part-name">
                  {part.name}
                  {isChanged && <em>已换</em>}
                  {locked && <em className="part-lock">声望 {VEHICLE_PART_REP[part.id]} 解锁</em>}
                </span>
                <span className="part-price">{money(part.price)}</span>
                <span className="part-sum">
                  {part.keys
                    .map((k) => (k === 'gears' ? v.gears.map((g) => g.toFixed(2)).join('/') : k === 'quickshifter' ? (v.quickshifter ? '有' : '没有') : String(Number(v[k]).toFixed(k === 'mass' ? 0 : 2))))
                    .join(' · ')}
                </span>
                <span className="part-caret" aria-hidden="true" />
              </button>
              {expanded && (
                <div className="part-body">
                  <p className="part-pitch">{part.pitch}</p>
                  <fieldset className="sheet-body" disabled={locked}>
                    {part.keys.map((k) => {
                      if (k === 'quickshifter') return <Choice key={k} label="快排" param="vehicle.quickshifter" value={v.quickshifter} reference={base.quickshifter} options={ON_OFF} onChange={(x) => setVehicle({ quickshifter: x })} />;
                      if (k === 'gears')
                        return (
                          <div key={k}>
                            {v.gears.map((g, i) => (
                              <Slider
                                key={i}
                                label={`${i + 1} 挡`}
                                param={`vehicle.gear${i + 1}`}
                                value={g}
                                reference={base.gears[i]}
                                min={GEAR_LIMITS[0]}
                                max={GEAR_LIMITS[1]}
                                step={GEAR_LIMITS[2]}
                                digits={3}
                                onChange={(x) => setVehicle({ gears: v.gears.map((y, j) => (j === i ? x : y)) })}
                              />
                            ))}
                          </div>
                        );
                      return num(k as NumKey);
                    })}
                    {isChanged && (
                      <button
                        type="button"
                        className="btn btn--small btn--ghost part-revert"
                        onClick={() => setVehicle(Object.fromEntries(part.keys.map((k) => [k, base[k]])) as Partial<VehicleConfig>)}
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

      <section className="sheet-group">
        <h3>车手</h3>
        <Slider
          label="起步放离合"
          param="vehicle.clutchRelease"
          value={v.clutchRelease}
          reference={base.clutchRelease}
          min={VEHICLE_LIMITS.clutchRelease[0]}
          max={VEHICLE_LIMITS.clutchRelease[1]}
          step={VEHICLE_LIMITS.clutchRelease[2]}
          unit="秒"
          digits={2}
          hint="放得快，轮胎打滑或者抬头；放得慢，白白磨离合。转速低又放得快，会憋熄火。"
          onChange={(x) => setVehicle({ clutchRelease: x })}
        />
      </section>

      <section className="sheet-group">
        <h3>整车电子（ECU）</h3>
        <Slider
          label="弹射起步转速"
          param="ecu.launchRpm"
          value={ecu.launchRpm}
          reference={baseline.ecu.launchRpm ?? 0}
          min={0}
          max={Math.min(14000, ecu.limiterRpm)}
          step={100}
          unit="rpm"
          hint="0 = 关。开着时起步前油门拧到底，ECU 把转速卡在这里；有涡轮时还会先把增压憋起来。"
          onChange={(x) => setEcu({ launchRpm: x })}
        />
        {Array.from({ length: SHIFT_COUNT }, (_, i) => (
          <Slider
            key={i}
            label={`${i + 1}→${i + 2} 换挡转速`}
            param={`ecu.shiftRpm${i}`}
            value={ecu.shiftRpm[i] ?? 0}
            reference={0}
            min={0}
            max={ecu.limiterRpm}
            step={100}
            unit="rpm"
            hint="0 = 撞到断火前才换。最快的换挡点在下一挡的轮上推力超过这一挡的地方。"
            onChange={(x) => setEcu({ shiftRpm: ecu.shiftRpm.map((y, j) => (j === i ? x : y)) })}
          />
        ))}
        <Slider label="快排断火时间" param="ecu.quickShiftMs" value={ecu.quickShiftMs} reference={70} min={30} max={150} step={5} unit="ms" hint="太短挂不进去会顿，太长白白损失动力。只在装了快排时有用。" onChange={(x) => setEcu({ quickShiftMs: x })} />
        <Slider
          label="牵引力控制"
          param="ecu.tractionControl"
          value={ecu.tractionControl}
          reference={0}
          min={0}
          max={0.4}
          step={0.01}
          digits={2}
          hint="允许后轮打滑的比例，超过就断火。0 = 关。轮胎在 10% 左右滑移时抓得最紧。"
          onChange={(x) => setEcu({ tractionControl: x })}
        />
        <Choice label="防抬头" param="ecu.wheelieControl" value={ecu.wheelieControl} reference={false} options={ON_OFF} hint="前轮一轻就断火。不开的话，抬太高会翻。" onChange={(x) => setEcu({ wheelieControl: x })} />
      </section>
    </div>
  );
}
