import { useBench } from '../state/benchStore';
import { Choice, Slider } from './fields';

export function EcuPanel(): React.ReactElement {
  const ecu = useBench((s) => s.ecu);
  const bench = useBench((s) => s.bench);
  const setEcu = useBench((s) => s.setEcu);
  const setBench = useBench((s) => s.setBench);

  return (
    <div className="sheet">
      <section className="sheet-group">
        <h3>点火</h3>
        <Slider
          label="点火角修正"
          value={ecu.advanceOffset}
          min={-20}
          max={20}
          step={0.5}
          unit="°"
          digits={1}
          hint="加在出厂点火图上。出厂图只按燃烧速度算，不知道你的油和压缩比会不会爆震。看示波器上峰值压力落在上止点后哪里。"
          onChange={(v) => setEcu({ advanceOffset: v })}
        />
        <Choice
          label="爆震控制"
          value={ecu.knockControl}
          options={[
            { value: true, label: '开' },
            { value: false, label: '关' },
          ]}
          hint="听到爆震就退点火角，然后慢慢加回来。关掉它才能找到真正的爆震边界，也才能把活塞打穿。"
          onChange={(v) => setEcu({ knockControl: v })}
        />
      </section>

      <section className="sheet-group">
        <h3>喷油</h3>
        <Slider
          label="部分负荷 λ"
          value={ecu.cruiseLambda}
          min={0.7}
          max={1.4}
          step={0.01}
          digits={2}
          onChange={(v) => setEcu({ cruiseLambda: v })}
        />
        <Slider
          label="全油门 λ"
          value={ecu.wotLambda}
          min={0.7}
          max={1.3}
          step={0.01}
          digits={2}
          hint="稍浓（0.85–0.9）出力最大，也能给燃烧室降温。太稀会烧得慢、排温高、容易爆震。"
          onChange={(v) => setEcu({ wotLambda: v })}
        />
        <Choice
          label="松油门断油"
          value={ecu.overrunFuelCut}
          options={[
            { value: true, label: '开' },
            { value: false, label: '关' },
          ]}
          hint="关掉以后，收油时没烧完的混合气会冲进热排气管里放炮。"
          onChange={(v) => setEcu({ overrunFuelCut: v })}
        />
      </section>

      <section className="sheet-group">
        <h3>转速</h3>
        <Slider
          label="断火转速"
          value={ecu.limiterRpm}
          min={2000}
          max={16000}
          step={100}
          unit="rpm"
          onChange={(v) => setEcu({ limiterRpm: v })}
        />
        <Choice
          label="限转方式"
          value={ecu.limiterMode}
          options={[
            { value: 'spark', label: '断火' },
            { value: 'fuel', label: '断油' },
          ]}
          hint="断火时燃油照喷，未燃混合气进排气管。"
          onChange={(v) => setEcu({ limiterMode: v })}
        />
        <Slider
          label="怠速目标"
          value={ecu.idleRpm}
          min={800}
          max={3000}
          step={50}
          unit="rpm"
          onChange={(v) => setEcu({ idleRpm: v })}
        />
      </section>

      <section className="sheet-group">
        <h3>台架</h3>
        <Choice
          label="水温机"
          value={bench.coolantConditioner}
          options={[
            { value: true, label: '接上' },
            { value: false, label: '断开' },
          ]}
          hint="断开以后只能靠发动机自己的散热器。水温过 135 °C 缸垫就会冲坏。"
          onChange={(v) => setBench({ coolantConditioner: v })}
        />
        <Slider
          label="水温设定"
          value={bench.coolantSetpoint}
          min={40}
          max={105}
          step={1}
          unit="°C"
          onChange={(v) => setBench({ coolantSetpoint: v })}
        />
      </section>
    </div>
  );
}
