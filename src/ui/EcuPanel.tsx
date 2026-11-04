import { useState } from 'react';
import { safeLimiter } from '../mentor/advice';
import { TABLE_LIMITS } from '../sim/config';
import { CurveEditor, TableEditor } from './TableEditor';
import { useMentor } from '../mentor/store';
import { DEFAULT_BENCH } from '../sim/config';
import { useBench } from '../state/benchStore';
import { Choice, Slider } from './fields';

type Tab = 'base' | 'spark' | 'fuel' | 'cam' | 'boost' | 'idle' | 'cell';
const TABS: { id: Tab; label: string }[] = [
  { id: 'base', label: '基础' },
  { id: 'spark', label: '点火表' },
  { id: 'fuel', label: '空燃比表' },
  { id: 'cam', label: '凸轮表' },
  { id: 'boost', label: '增压' },
  { id: 'idle', label: '怠速与断油' },
  { id: 'cell', label: '台架' },
];

const ON_OFF = [
  { value: true, label: '开' },
  { value: false, label: '关' },
];

export function EcuPanel(): React.ReactElement {
  const ecu = useBench((s) => s.ecu);
  const bench = useBench((s) => s.bench);
  const setEcu = useBench((s) => s.setEcu);
  const setBench = useBench((s) => s.setBench);
  const factory = useBench((s) => s.baseline.ecu);
  const protect = useMentor((s) => s.protect);
  const config = useBench((s) => s.config);
  const guard = safeLimiter(config);
  const [tab, setTab] = useState<Tab>('base');
  const maxLoad = config.turboSize > 0 ? 2 : 1;

  return (
    <div className="sheet">
      <nav className="sheet-tabs" aria-label="ECU 分页">
        {TABS.map((t) => (
          <button key={t.id} type="button" className={tab === t.id ? 'is-on' : ''} onClick={() => setTab(t.id)}>
            {t.label}
          </button>
        ))}
      </nav>

      {tab === 'spark' && (
        <section className="sheet-group">
          <h3>点火修正表（°，加在基础点火图和总修正上）</h3>
          <p className="field-hint">
            横轴转速，纵轴负荷。全油门在负荷 1.0 那一行（有增压就更往上）。正数提前、负数推后。低转全负荷最容易爆震，高转燃烧慢、往往要更多提前。
          </p>
          <TableEditor
            table={ecu.sparkTable}
            lo={TABLE_LIMITS.spark[0]}
            hi={TABLE_LIMITS.spark[1]}
            step={0.5}
            digits={1}
            unit="°"
            maxRpm={ecu.limiterRpm}
            maxLoad={maxLoad}
            onChange={(t) => setEcu({ sparkTable: t })}
          />
        </section>
      )}
      {tab === 'fuel' && (
        <section className="sheet-group">
          <h3>空燃比修正表（λ，加在部分负荷 / 全油门目标上）</h3>
          <p className="field-hint">负数加浓、正数变稀。全油门稍浓出力最大也最凉；巡航稍稀省油。高增压时加浓是给燃烧室降温的保险。</p>
          <TableEditor
            table={ecu.lambdaTable}
            lo={TABLE_LIMITS.lambda[0]}
            hi={TABLE_LIMITS.lambda[1]}
            step={0.01}
            digits={2}
            unit=""
            maxRpm={ecu.limiterRpm}
            maxLoad={maxLoad}
            onChange={(t) => setEcu({ lambdaTable: t })}
          />
        </section>
      )}
      {tab === 'cam' && (
        <section className="sheet-group">
          <h3>进气凸轮提前表（°）</h3>
          {config.vvtRange <= 0 ? (
            <p className="field-hint">没装可变气门正时，这张表不起作用。在「改装单」里装上相位器。</p>
          ) : (
            <p className="field-hint">相位器最多提前 {config.vvtRange}°。提前 = 进气门早开早关：低转扭矩厚、怠速稳；推后（0）留给高转吃气。</p>
          )}
          <TableEditor
            table={ecu.camTable}
            lo={TABLE_LIMITS.cam[0]}
            hi={Math.max(1, config.vvtRange)}
            step={2}
            digits={0}
            unit="°"
            maxRpm={ecu.limiterRpm}
            maxLoad={maxLoad}
            scale="seq"
            onChange={(t) => setEcu({ camTable: t.map((row) => row.map((v) => Math.min(v, Math.max(0, config.vvtRange)))) })}
          />
        </section>
      )}
      {tab === 'boost' && (
        <section className="sheet-group">
          <h3>增压目标（kPa，高于大气压）</h3>
          {config.turboSize <= 0 ? (
            <p className="field-hint">自然吸气，没有涡轮。在「改装单」里装涡轮。</p>
          ) : (
            <p className="field-hint">废气阀弹簧本身就会顶住约 35 kPa。目标再高，要看涡轮够不够大、喷油嘴够不够、会不会爆震。</p>
          )}
          <CurveEditor
            values={ecu.boostTable}
            lo={TABLE_LIMITS.boost[0]}
            hi={TABLE_LIMITS.boost[1]}
            step={5}
            unit=" kPa"
            maxRpm={ecu.limiterRpm}
            onChange={(v) => setEcu({ boostTable: v })}
          />
          <Choice
            label="防迟滞（anti-lag）"
            param="ecu.antiLag"
            value={ecu.antiLag}
            reference={false}
            options={ON_OFF}
            hint="收油和换挡时推后点火、加浓、开旁通，让火在排气管里烧，涡轮不掉转。代价是排温和放炮。"
            onChange={(v) => setEcu({ antiLag: v })}
          />
        </section>
      )}
      {tab === 'idle' && (
        <>
          <section className="sheet-group">
            <h3>怠速</h3>
            <Slider
              label="怠速目标"
              param="ecu.idleRpm"
              value={ecu.idleRpm}
              reference={factory.idleRpm}
              min={800}
              max={3000}
              step={50}
              unit="rpm"
              onChange={(v) => setEcu({ idleRpm: v })}
            />
            <Slider
              label="怠速控制力度"
              param="ecu.idleGain"
              value={ecu.idleGain}
              reference={factory.idleGain ?? 1}
              min={0.3}
              max={3}
              step={0.05}
              digits={2}
              hint="怠速阀对转速偏差的反应。太弱掉转救不回来，太强会来回游车。"
              onChange={(v) => setEcu({ idleGain: v })}
            />
            <Slider
              label="怠速点火储备"
              param="ecu.idleSparkReserve"
              value={ecu.idleSparkReserve}
              reference={factory.idleSparkReserve ?? 0}
              min={0}
              max={15}
              step={0.5}
              digits={1}
              unit="°"
              hint="平时把怠速点火推后一点，转速一掉立刻提前补回扭矩。比怠速阀快得多，是防熄火的快手。"
              onChange={(v) => setEcu({ idleSparkReserve: v })}
            />
            <Slider
              label="节气门缓冲开度"
              param="ecu.dashpot"
              value={ecu.dashpot}
              reference={factory.dashpot ?? 0.3}
              min={0}
              max={0.5}
              step={0.01}
              digits={2}
              hint="猛松油门时先留一点进气，防止进气管真空太深熄火。留太多转速会挂着下不来。"
              onChange={(v) => setEcu({ dashpot: v })}
            />
            <Slider
              label="节气门缓冲时间"
              param="ecu.dashpotTime"
              value={ecu.dashpotTime}
              reference={factory.dashpotTime ?? 0.7}
              min={0.1}
              max={2.5}
              step={0.05}
              digits={2}
              unit="秒"
              onChange={(v) => setEcu({ dashpotTime: v })}
            />
          </section>
          <section className="sheet-group">
            <h3>松油门断油</h3>
            <Choice
              label="松油门断油"
              param="ecu.overrunFuelCut"
              value={ecu.overrunFuelCut}
              reference={factory.overrunFuelCut}
              options={ON_OFF}
              hint="关掉以后，收油时没烧完的混合气会冲进热排气管里放炮。"
              onChange={(v) => setEcu({ overrunFuelCut: v })}
            />
            <Slider
              label="断油：高于怠速"
              param="ecu.overrunCutAbove"
              value={ecu.overrunCutAbove}
              reference={factory.overrunCutAbove ?? 700}
              min={200}
              max={3000}
              step={50}
              unit="rpm"
              onChange={(v) => setEcu({ overrunCutAbove: v })}
            />
            <Slider
              label="恢复供油：高于怠速"
              param="ecu.overrunResumeAbove"
              value={ecu.overrunResumeAbove}
              reference={factory.overrunResumeAbove ?? 350}
              min={100}
              max={2500}
              step={50}
              unit="rpm"
              hint="轻飞轮掉转快，恢复得太晚，来不及点着就熄火了。熄火多半是这个。"
              onChange={(v) => setEcu({ overrunResumeAbove: v })}
            />
            <Slider
              label="断油延时"
              param="ecu.overrunDelay"
              value={ecu.overrunDelay}
              reference={factory.overrunDelay ?? 0.3}
              min={0}
              max={2}
              step={0.05}
              digits={2}
              unit="秒"
              onChange={(v) => setEcu({ overrunDelay: v })}
            />
          </section>
          <section className="sheet-group">
            <h3>起动与过渡</h3>
            <Slider
              label="起动空燃比"
              param="ecu.crankLambda"
              value={ecu.crankLambda}
              reference={factory.crankLambda ?? 0.85}
              min={0.6}
              max={1.1}
              step={0.01}
              digits={2}
              hint="冷车拖转时进气道湿壁吃掉很多油，要喷浓一点。"
              onChange={(v) => setEcu({ crankLambda: v })}
            />
            <Slider
              label="加速加浓"
              param="ecu.accelEnrich"
              value={ecu.accelEnrich}
              reference={factory.accelEnrich ?? 1}
              min={0}
              max={2}
              step={0.05}
              digits={2}
              hint="猛开油门时一部分油糊在进气道壁上，进缸的混合气瞬间变稀、发闷。1 = 正好补上，小于 1 补不够，大于 1 冒黑烟。"
              onChange={(v) => setEcu({ accelEnrich: v })}
            />
          </section>
        </>
      )}

      {tab === 'base' && (
        <>
          <section className="sheet-group">
            <h3>点火</h3>
            <Slider
              label="点火角修正"
              param="ecu.advanceOffset"
              value={ecu.advanceOffset}
              reference={factory.advanceOffset}
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
              param="ecu.knockControl"
              value={ecu.knockControl}
              reference={factory.knockControl}
              options={ON_OFF}
              hint="听到爆震就退点火角，然后慢慢加回来。关掉它才能找到真正的爆震边界，也才能把活塞打穿。"
              onChange={(v) => setEcu({ knockControl: v })}
            />
          </section>

          <section className="sheet-group">
            <h3>空燃比</h3>
            <Slider
              label="部分负荷 λ"
              param="ecu.cruiseLambda"
              value={ecu.cruiseLambda}
              reference={factory.cruiseLambda}
              min={0.7}
              max={1.4}
              step={0.01}
              digits={2}
              onChange={(v) => setEcu({ cruiseLambda: v })}
            />
            <Slider
              label="全油门 λ"
              param="ecu.wotLambda"
              value={ecu.wotLambda}
              reference={factory.wotLambda}
              min={0.7}
              max={1.3}
              step={0.01}
              digits={2}
              hint="稍浓（0.85–0.9）出力最大，也能给燃烧室降温。太稀会烧得慢、排温高、容易爆震。"
              onChange={(v) => setEcu({ wotLambda: v })}
            />
          </section>

          <section className="sheet-group">
            <h3>转速</h3>
            <Slider
              label="断火转速"
              param="ecu.limiterRpm"
              value={ecu.limiterRpm}
              reference={factory.limiterRpm}
              min={2000}
              max={16000}
              step={100}
              unit="rpm"
              hint={protect && ecu.limiterRpm > guard ? `保护开着：老周把实际断火压在 ${guard.toLocaleString('en-US')}。关掉保护才能顶上去。` : undefined}
              onChange={(v) => setEcu({ limiterRpm: v })}
            />
            <Choice
              label="限转方式"
              param="ecu.limiterMode"
              value={ecu.limiterMode}
              reference={factory.limiterMode}
              options={[
                { value: 'spark', label: '断火' },
                { value: 'fuel', label: '断油' },
              ]}
              hint="断火时燃油照喷，未燃混合气进排气管。"
              onChange={(v) => setEcu({ limiterMode: v })}
            />
          </section>
        </>
      )}

      {tab === 'cell' && (
        <section className="sheet-group">
          <h3>台架</h3>
          <Choice
            label="水温机"
            param="bench.coolantConditioner"
            value={bench.coolantConditioner}
            reference={DEFAULT_BENCH.coolantConditioner}
            options={[
              { value: true, label: '接上' },
              { value: false, label: '断开' },
            ]}
            hint="断开以后只能靠发动机自己的散热器。水温过 135 °C 缸垫就会冲坏。"
            onChange={(v) => setBench({ coolantConditioner: v })}
          />
          <Slider
            label="水温设定"
            param="bench.coolantSetpoint"
            value={bench.coolantSetpoint}
            reference={DEFAULT_BENCH.coolantSetpoint}
            min={40}
            max={105}
            step={1}
            unit="°C"
            onChange={(v) => setBench({ coolantSetpoint: v })}
          />
        </section>
      )}
    </div>
  );
}
