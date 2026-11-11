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
    what: '压缩比是白捡的热效率。不爆震的转速每加 1 大约多 3–5%；低转贴着爆震线时，多出来的会被退角吃掉。',
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
    what: '进气持续角加长，低转先软。高转能不能赚回来，要看断火够不够高、进气中心角跟没跟着推。',
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
    what: '进气道里的气柱有惯性。长度主要改六千以上和功率峰，扭矩峰不怎么挪。',
    watch: '高转扭矩、功率峰。最直观是扫一条曲线对比。',
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
  'config.plenumVolume': {
    what: '稳压腔大，进气脉动被抚平、稳态好调，油门初段变钝；单缸上涡轮最好有 4–5 倍排量兜着。',
    watch: '进气压力波动、涡轮稳态增压。',
  },
  'config.injectorFlow': {
    what: '喷油嘴流量决定了大功率、高增压时喷不喷得够。占空比过 90% 就会开始变稀。',
    watch: '右边的喷油嘴占空比、空燃比读数。',
  },
  'config.vvtRange': {
    what: '给进气凸轮装上相位器以后，ECU 可以按转速和负荷实时提前进气门——低转和怠速兼顾高转。',
    watch: '低转扭矩和「ECU → 凸轮表」。',
  },
  'config.turboSize': {
    what: '涡轮越大高转能憋出的气越多，但需要更多废气才吹得起来，低转迟滞也长。',
    watch: '增压压力、涡轮转速、高转扭矩和排温。',
  },
  'config.intercooler': {
    what: '压气机把空气压热了，中冷把它降回凉快——进气密度更高，也更不容易爆震。',
    watch: '进气温度对应的爆震退角、高增压功率。',
  },
  'ecu.advanceOffset': {
    what: '点火早了，压力峰来得太早，在跟上行的活塞对着干，还容易爆震；晚了，压力峰太晚，热量全进了排气管。',
    watch: '示波器：低转大约 14–16°，转速越高越靠前。别死盯一个数——按 B 钉住，前后各拧 2° 看扭矩。',
  },
  'ecu.knockControl': {
    what: '爆震控制听到爆震就退点火角，是活塞的保险丝。这台低转本来就靠它兜着。关掉才能找边界——也才能把活塞打穿。',
    watch: '读数里的爆震退角、活塞损伤。',
  },
  'ecu.cruiseLambda': {
    what: '部分负荷的混合比。1.0 最干净，太稀会失火，太浓会冒黑烟。',
    watch: '空燃比读数、失火记录。',
  },
  'ecu.wotLambda': {
    what: '全油门的混合比。这台上 λ 0.75 到 1.0 出力差不多；再稀才掉劲。它不怎么抗爆。',
    watch: '扭矩、失火记录。',
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
  'ecu.idleGain': {
    what: '怠速阀对转速偏差的反应快慢：太软救不回来掉转，太硬会来回游车。',
    watch: '怠速转速稳不稳。',
  },
  'ecu.idleSparkReserve': {
    what: '怠速时故意留几度点火提前量在手里，转速刚往下掉就先靠提前点火抢一把，比空气阀快得多。',
    watch: '轰油门落回怠速时稳不稳。',
  },
  'ecu.dashpot': {
    what: '猛收油门时怠速阀先托住一点风量，防止真空猛吸把机器憋灭。',
    watch: '收油落转时掉不掉到熄火。',
  },
  'ecu.dashpotTime': {
    what: '缓冲开度慢慢关回来的时间。太长转速挂在高处下不来，太短托不住。',
    watch: '松油门后转速回落的节奏。',
  },
  'ecu.overrunFuelCut': {
    what: '松油门断油，省油、不放炮。关掉它，收油时就会噼啪响。',
    watch: '收油时的声音、台架记录里的放炮。',
  },
  'ecu.overrunCutAbove': {
    what: '转速高出怠速这么多且关了油门才开始断油。设太低会误 cut 掉怠速救火。',
    watch: '收油断油介入的转速。',
  },
  'ecu.overrunResumeAbove': {
    what: '掉到离怠速这么近时恢复喷油。轻飞轮、大凸轮必须早点恢复，不然来不及点着就熄火。',
    watch: '轰油门松开后会不会憋熄火。',
  },
  'ecu.overrunDelay': {
    what: '关油门后等多久才真断油。留一点延时，换挡或轻点油门不至于一顿一顿。',
    watch: '收油放炮和落转手感。',
  },
  'ecu.crankLambda': {
    what: '起动拖转时转速低、进气道壁又冷，油会糊在壁上，喷浓一点才好打着。',
    watch: '按住 S 起动着车的速度。',
  },
  'ecu.accelEnrich': {
    what: '急开油门瞬间多喷的那一把，用来补偿粘在进气道壁上的湿壁油膜。',
    watch: '猛拧油门时有没有瞬间发闷、失火。',
  },
  'ecu.antiLag': {
    what: '防迟滞：收油或换挡时推迟点火并加浓，让废气在排气管里继续烧，保住涡轮转速。',
    watch: '排温、放炮声和赛道换挡后的增压响应。',
  },
  'ecu.launchRpm': {
    what: '弹射限转：起步读秒全油门时把转速稳在这个点，有涡轮时还能原地先憋起正压。',
    watch: '赛道 60 英尺起步时间、打滑和抬头情况。',
  },
  'ecu.shiftRpm': {
    what: '最佳换挡转速不是越高越好——当下一挡的轮上推力超过当前挡时，就该升挡。',
    watch: '「整车」各挡极速图里的升挡落点、赛道成绩。',
  },
  'ecu.quickShiftMs': {
    what: '快排断火时间。短了换挡脆，长了损失加速时间；必须在装了快排时才起作用。',
    watch: '赛道升挡时的速度衔接。',
  },
  'ecu.tractionControl': {
    what: '限制后轮滑移率。抓地比空转快得多，大约 10% 左右滑移是轮胎抓地顶峰。',
    watch: '赛道上的「打滑」提示和 60 英尺时间。',
  },
  'ecu.wheelieControl': {
    what: '前轮一离地就主动收扭矩，不至于抬头翻车；代价是限制了一点起步极限定推力。',
    watch: '赛道「抬头」时间、最大俯仰角。',
  },
  'bench.coolantConditioner': {
    what: '台架水温机把水温钉死在设定值。断开以后只能靠发动机自己的散热器。',
    watch: '水温，过 135 °C 缸垫就会冲坏。',
  },
  'bench.coolantSetpoint': {
    what: '水温低，进气更凉、更抗爆，但摩擦大；水温高，摩擦小，爆震风险高。',
    watch: '水温、爆震记录。',
  },
  'vehicle.finalDrive': {
    what: '主减速比大，每一挡加速度都变凶，极速也跟着往下掉——是最划算的赛道调法。',
    watch: '各挡极速条、赛道有没有提前撞断火。',
  },
  'vehicle.gears': {
    what: '各挡齿比靠得越密，升挡后转速落回扭矩带越多，加速越连贯。',
    watch: '各挡极速图里的「升挡后转速」。',
  },
  'vehicle.tireGrip': {
    what: '抓地系数高，大扭矩和弹射起步时更推得出去；但也更容易把车头顶起来抬头。',
    watch: '赛道打滑时间、抬头时间和 60 英尺成绩。',
  },
  'vehicle.tireRadius': {
    what: '滚动半径直接改最终车速和每个挡的等效齿比，也会影响车轮转动惯量负载。',
    watch: '各挡极速、加速体感。',
  },
  'vehicle.mass': {
    what: '整车与车手总重。少一公斤，加速和爬坡的净推重比都多一分，尤其前段最明显。',
    watch: '赛道加速成绩、爬坡时间。',
  },
  'vehicle.cgHeight': {
    what: '重心越低，急加速时载荷往后转移得越少，越不容易抬头翻车。',
    watch: '赛道抬头时间。',
  },
  'vehicle.wheelbase': {
    what: '轴距加长让后轮推力更难把车头掀起来，能把更大的起步扭矩压在地面上。',
    watch: '赛道抬头时间、稳定性。',
  },
  'vehicle.rearShare': {
    what: '静止时后轮分担的车重比例。压在后轮越重越抓地，但也更容易一拧就抬头。',
    watch: '起步打滑和抬头平衡。',
  },
  'vehicle.cdA': {
    what: '风阻面积。一百公里以后空气阻力按速度平方暴涨，跑极速和四百米全看它和马力。',
    watch: '高车速区间加速、极速成绩。',
  },
  'vehicle.clutchCapacity': {
    what: '离合器能传住的最大扭矩。上大排量或涡轮后不够用，一弹射就会先打滑烧片。',
    watch: '起步转速有没有空冲、成绩。',
  },
  'vehicle.clutchRelease': {
    what: '起步放离合的快慢：太快容易打滑、抬头甚至憋熄火；太慢全磨成热量。',
    watch: '起步 60 英尺和打滑时间。',
  },
  'vehicle.quickshifter': {
    what: '不用捏离合、不松油门靠极短断火直接升挡，换挡几乎不掉速、增压也不容易掉压。',
    watch: '四百米和加速换挡衔接。',
  },
};

export function noteForParam(param: string): ParamNote | undefined {
  const key = param.startsWith('vehicle.gear') && /^vehicle\.gear\d+$/.test(param)
    ? 'vehicle.gears'
    : /^ecu\.shiftRpm\d+$/.test(param)
      ? 'ecu.shiftRpm'
      : param;
  return PARAM_NOTES[key];
}

const NON_TORQUE_PREFIXES = ['vehicle.', 'bench.', 'ecu.shiftRpm', 'ecu.idle', 'ecu.dashpot', 'ecu.overrun'];
const NON_TORQUE_KEYS = new Set([
  'config.flywheelInertia',
  'config.radiatorCapacity',
  'ecu.limiterRpm',
  'ecu.limiterMode',
  'ecu.crankLambda',
  'ecu.accelEnrich',
  'ecu.antiLag',
  'ecu.launchRpm',
  'ecu.quickShiftMs',
  'ecu.tractionControl',
  'ecu.wheelieControl',
]);

/** Whether a knob changes steady-state WOT brake torque on the dyno. */
export function isTorqueParam(param: string): boolean {
  if (NON_TORQUE_KEYS.has(param)) return false;
  return !NON_TORQUE_PREFIXES.some((p) => param.startsWith(p));
}
