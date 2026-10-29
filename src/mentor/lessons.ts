import { useBench } from '../state/benchStore';
import { effectiveThrottle, useControls } from '../state/controlStore';
import { startSweep } from '../state/engineLink';
import { useLive } from '../state/liveStore';
import { useUi } from '../state/uiStore';
import { crankForMe, mentorEdit } from './actions';

/** Per-step scratch state, reset when a step starts. */
export interface LessonMemory {
  t0: number;
  /** Seconds the step's condition has held. */
  held: number;
  peak: number;
  runId: number;
  header: number;
  changedRunId: number | null;
}

export interface LessonStep {
  title: string;
  text: () => string;
  /** Called every watch tick with the tick length in seconds. */
  done?: (m: LessonMemory, dt: number) => boolean;
  /** Label of the button that moves on, for steps that are about looking. */
  manual?: string;
  help?: { label: string; run: () => void };
}

const snap = () => useLive.getState().snapshot;
const running = (): boolean => snap()?.status === 'running';
const lastRunId = (): number => useBench.getState().runs.at(-1)?.id ?? 0;

export function freshMemory(): LessonMemory {
  return {
    t0: performance.now(),
    held: 0,
    peak: 0,
    runId: lastRunId(),
    header: useBench.getState().config.exhaustHeaderLength,
    changedRunId: null,
  };
}

async function sweepForMe(): Promise<void> {
  useUi.getState().setDrawer('dyno');
  if (await crankForMe()) startSweep();
}

export const LESSON: LessonStep[] = [
  {
    title: '起动',
    text: () => '按住 S（或下方的「按住起动」），等转速表下面变成「运转」再松手。起动机只管把它带到能自己点着的转速。',
    done: (m, dt) => {
      m.held = running() ? m.held + dt : 0;
      return m.held > 0.8;
    },
    help: { label: '我来起动', run: () => void crankForMe() },
  },
  {
    title: '稳住怠速',
    text: () =>
      `手离开油门，让它怠速 3 秒。转速会停在 ${useBench.getState().ecu.idleRpm.toLocaleString('en-US')} 附近——那是 ECU 在用旁通气门替你扶着。`,
    done: (m, dt) => {
      m.held = running() && effectiveThrottle(useControls.getState()) < 0.03 ? m.held + dt : 0;
      return m.held > 3;
    },
    help: { label: '我来起动', run: () => void crankForMe() },
  },
  {
    title: '轰一脚',
    text: () => '按住空格全油门，冲到红区附近就松开。听声音，也看它爬得有多快。',
    done: (m) => {
      const s = snap();
      if (!s) return false;
      m.peak = Math.max(m.peak, s.rpm);
      return m.peak > useBench.getState().ecu.limiterRpm * 0.8 && s.throttle < 0.1;
    },
  },
  {
    title: '读示波器',
    text: () =>
      '看下方示波器。橙线是缸压，竖线是点火时刻。压力峰落在上止点后 12–16° 时这一下推得最狠；更早是在跟上行的活塞顶牛，更晚热量都进了排气管。',
    manual: '看懂了',
  },
  {
    title: '上测功机',
    text: () => '耳朵会骗人，测功机不会。打开「测功」面板，点「自动扫转速」，二十来秒拉出一条扭矩曲线，全程不用你碰油门。',
    done: (m) => lastRunId() > m.runId,
    help: { label: '帮我打开并开始', run: () => void sweepForMe() },
  },
  {
    title: '改一个零件',
    text: () =>
      '打开「改装单」，把排气头段长度改短 200 mm 左右，再扫一条。改的时候看抽屉顶上的「实时影响」——数字是跟着你的手变的。',
    done: (m) => {
      const header = useBench.getState().config.exhaustHeaderLength;
      if (Math.abs(header - m.header) >= 50 && m.changedRunId === null) m.changedRunId = lastRunId();
      return m.changedRunId !== null && lastRunId() > m.changedRunId;
    },
    help: {
      label: '帮我改短 200 mm',
      run: () => {
        const c = useBench.getState().config;
        mentorEdit(() => useBench.getState().setConfig({ exhaustHeaderLength: c.exhaustHeaderLength - 200 }));
        useUi.getState().setDrawer('build');
      },
    },
  },
  {
    title: '对比',
    text: () =>
      '两条曲线叠在一起了。扭矩峰往哪边挪了？短头段让排气负压波回来得更早，扫气最好的转速就往高处走。这就是调校：一次只动一个，测功机说了算。',
    manual: '毕业',
  },
];
