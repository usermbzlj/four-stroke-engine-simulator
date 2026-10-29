/**
 * What each knob does physically, and where on the bench its effect shows.
 * Keys are `config.*`, `ecu.*` or `bench.*`.
 */
export interface ParamNote {
  what: string;
  watch: string;
}

export const PARAM_NOTES: Record<string, ParamNote> = {
  'config.bore': {
    what: '缸径大，能塞下更大的气门，高转喘得过气；代价是火焰要跑更远，更容易爆震。',
    watch: '排量、爆震记录。',
  },
  'config.stroke': {
    what: '行程长，低转扭矩厚；但活塞跑得更快，连杆挨的拉力也跟着涨。',
    watch: '连杆拉断转速、断火时活塞均速。',
  },
  'config.rodLength': {
    what: '连杆长，活塞在上止点附近走得从容，侧推力小；短连杆在上止点附近更急，也更受罪。',
    watch: '连杆拉断转速。',
  },
  'config.compressionRatio': {
    what: '压缩比是白捡的热效率，每加 1 大约多 3% 扭矩，但爆震边界跟着往回退。',
    watch: '示波器上的峰值压力、爆震记录。高压缩要配高标号油。',
  },
  'config.intakeValves': {
    what: '双气门总流通面积更大，高转更能喘；单个气门更小更轻，也更不容易飘浮。',
    watch: '高转扭矩、气门飘浮转速。',
  },
  'config.exhaustValves': {
    what: '双排气门让废气走得更快，高转扫气更干净。',
    watch: '高转扭矩、排温。',
  },
  'config.intakeValveDiameter': {
    what: '进气门越大高转越能吸；低转气流变慢，扭矩反而略软。气门越重，越容易飘浮。',
    watch: '充气效率、气门飘浮转速。',
  },
  'config.exhaustValveDiameter': {
    what: '排气门大，废气排得干净；太大了占进气门的地方。',
    watch: '高转扭矩、排温。',
  },
  'config.intakeDuration': {
    what: '进气持续角越长，高转越猛、低转越软、怠速越抖。这是凸轮最核心的一刀。',
    watch: '扭矩峰往哪个转速挪。按 B 把转速钉住再比，或者扫一条曲线。',
  },
  'config.exhaustDuration': {
    what: '排气门开得早，膨胀功少拿一点，但高转排得干净。',
    watch: '高转扭矩、排温、重叠角。',
  },
  'config.intakeLift': {
    what: '升程大就灌得多；但气门加速度跟着涨，弹簧压不住的转速会下降。',
    watch: '充气效率、气门飘浮转速。',
  },
  'config.exhaustLift': {
    what: '排气升程大，排气更顺；同样会拉低飘浮转速。',
    watch: '气门飘浮转速。',
  },
  'config.lobeSeparation': {
    what: '夹角越小，重叠角越大：高转扫气猛，怠速发抖，进气真空变差。',
    watch: '顶上的重叠角、怠速稳不稳。',
  },
  'config.intakeCenterline': {
    what: '进气中心角小（凸轮提前）扭矩往低转挪；大（推迟）往高转挪。',
    watch: '扭矩峰的位置。',
  },
  'config.valveSpringForce': {
    what: '弹簧越硬，气门越晚飘浮；但每转都要多交一份摩擦。',
    watch: '气门飘浮转速要高过断火转速。',
  },
  'config.throttleDiameter': {
    what: '节气门大，全油门不憋；太大了小开度很难控。',
    watch: '全油门时进气压力能不能接近 100 kPa。',
  },
  'config.intakeRunnerLength': {
    what: '进气道里的气柱有惯性，长度决定它在哪个转速撞进缸里多灌一口：长偏低转，短偏高转。',
    watch: '扭矩峰的位置，最直观是扫一条曲线对比。',
  },
  'config.intakeRunnerDiameter': {
    what: '进气道粗，流速慢、冲压弱；细了高转憋。',
    watch: '充气效率。',
  },
  'config.exhaustHeaderLength': {
    what: '排气负压波反射回来的时机决定扫气在哪个转速最有效：长偏低转，短偏高转。',
    watch: '扭矩峰的位置、声音的音色。',
  },
  'config.exhaustHeaderDiameter': {
    what: '头段粗，高转排得顺；太粗了流速低，低转扫气弱。',
    watch: '低转和高转扭矩此消彼长。',
  },
  'config.muffler': {
    what: '原厂消音器憋但安静；直通最顺最吵，收油时放炮也最响。',
    watch: '高转扭矩、你的耳朵。',
  },
  'config.flywheelInertia': {
    what: '轻飞轮升速快、响应灵；代价是怠速难稳，起步容易熄火。',
    watch: '轰油门升速多快、怠速转速表抖不抖。',
  },
  'config.reciprocatingMass': {
    what: '活塞组每重一克，高转时拽连杆的力都按转速平方往上涨。',
    watch: '连杆拉断转速。',
  },
  'config.rodStrength': {
    what: '连杆能扛的拉力。锻造件更结实。',
    watch: '连杆拉断转速至少要比断火转速高一成多。',
  },
  'config.fuelOctane': {
    what: '高标号油不是更有劲，而是更抗爆，让你敢多给点火角和压缩比。',
    watch: '爆震记录、ECU 的爆震退角。',
  },
  'config.radiatorCapacity': {
    what: '只在台架水温机断开后起作用。',
    watch: '水温。',
  },
  'ecu.advanceOffset': {
    what: '点火早了，压力峰来得太早，在跟上行的活塞对着干，还容易爆震；晚了，压力峰太晚，热量全进了排气管。',
    watch: '示波器：峰值落在上止点后 12–16° 最出力。按 B 钉住转速，看扭矩的变化。',
  },
  'ecu.knockControl': {
    what: '爆震控制听到爆震就退点火角，是活塞的保险丝。关掉它才能找到真正的边界——也才能把活塞打穿。',
    watch: '读数里的爆震退角。',
  },
  'ecu.cruiseLambda': {
    what: '部分负荷的混合比。1.0 最干净，太稀会失火，太浓会冒黑烟。',
    watch: '空燃比读数、失火记录。',
  },
  'ecu.wotLambda': {
    what: '全油门的混合比。0.85–0.9 出力最大，也顺便给燃烧室降温；太稀烧得慢、排温高、容易爆震。',
    watch: '扭矩、排温。',
  },
  'ecu.limiterRpm': {
    what: '断火转速是最后一道闸，必须低于气门飘浮和连杆疲劳的转速。',
    watch: '改装单顶上的飘浮转速和拉断转速。',
  },
  'ecu.limiterMode': {
    what: '断火时燃油照喷，没烧的混合气冲进热排气管就会放炮；断油安静，也更省。',
    watch: '撞断火时的声音。',
  },
  'ecu.idleRpm': {
    what: 'ECU 用旁通气门把转速稳在这里。轻飞轮、大重叠角的机器需要高一点。',
    watch: '松开油门后转速表停在哪、抖不抖。',
  },
  'ecu.overrunFuelCut': {
    what: '松油门断油，省油、不放炮。关掉它，收油时就会噼啪响。',
    watch: '收油时的声音、台架记录里的放炮。',
  },
  'bench.coolantConditioner': {
    what: '台架水温机把水温钉死在设定值。断开以后只能靠发动机自己的散热器。',
    watch: '水温，过 135 °C 缸垫就会冲坏。',
  },
  'bench.coolantSetpoint': {
    what: '水温低，进气更凉、更抗爆，但摩擦大；水温高，摩擦小，爆震风险高。',
    watch: '水温、爆震记录。',
  },
};
