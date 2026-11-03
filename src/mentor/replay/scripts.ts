import type { Replay, Session } from './harness';

const lessonStep = (h: Replay): number | null => h.M.store.useMentor.getState().lesson;
const broken = (h: Replay): boolean => h.snap?.status === 'broken';
const lastMsg = (h: Replay, key: string) => h.M.store.useMentor.getState().messages.find((m) => m.key === key);

async function stepPasses(h: Replay, from: number, timeout: number, what: string): Promise<boolean> {
  const ok = await h.until(() => lessonStep(h) !== from, timeout);
  h.check(ok, `第 ${from + 1} 步「${what}」${ok ? '' : `在 ${timeout} s 内没`}过关`);
  return ok;
}

/** Full throttle with the pedal until `stop` or `max` s, then let go. */
async function wot(h: Replay, max: number, stop: () => boolean = () => broken(h)): Promise<void> {
  h.pedal(1);
  await h.until(stop, max);
  h.pedal(0);
}

async function blowUp(h: Replay, n: number): Promise<void> {
  await h.crank();
  await h.wait(1.5);
  await wot(h, 12);
  h.check(broken(h), `第 ${n} 台在 12 s 全油门内炸了`);
  await h.wait(4);
  h.note(h.failureCard());
}

/** Edit and wait for the verdict; undo it if 老周 says it got worse. */
async function tryKnob(h: Replay, param: string, value: number, undoIfWorse = true): Promise<void> {
  const before = h.value(param);
  const lastResult = lastMsg(h, 'result')?.id;
  const tq0 = h.M.live.useLive.getState().metrics?.brakeTorque ?? 0;
  await h.edit(param, value, { steps: 3, seconds: 0.4 });
  await h.wait(7);
  const tq1 = h.M.live.useLive.getState().metrics?.brakeTorque ?? 0;
  const r = lastMsg(h, 'result');
  const judged = !!r && r.id !== lastResult;
  h.check(judged, `改「${param}」后 7 s 内给了判决（台架扭矩 ${tq0.toFixed(2)} → ${tq1.toFixed(2)} Nm，${(((tq1 / tq0) - 1) * 100).toFixed(1)}%）`);
  if (judged && r.tone === 'warn' && undoIfWorse) {
    h.click('撤销');
    await h.wait(0.5);
    h.check(h.value(param) === before, `撤销后 ${param} 回到 ${String(before)}（现在 ${String(h.value(param))}）`);
    await h.wait(4);
  }
}

const tuneDone = (h: Replay, timeout: number) => h.until(() => !h.tuning, timeout, 0.25);

export const SESSIONS: Session[] = [
  {
    id: 's1',
    title: '新手首次进入：按课程走完 7 步',
    opts: { preset: 'street-250', mentor: { visits: 0, graduated: false } },
    run: async (h) => {
      await h.wait(4);
      await h.crank();
      await stepPasses(h, 0, 5, '起动');
      await stepPasses(h, 1, 8, '稳住怠速');
      await h.wait(2);
      h.pedal(1);
      await h.until(() => (h.snap?.rpm ?? 0) > 8000, 4);
      h.pedal(0);
      await stepPasses(h, 2, 5, '轰一脚');
      await h.wait(6);
      h.lesson('manual');
      await h.wait(3);
      h.sweep();
      await stepPasses(h, 4, 40, '上测功机');
      await h.wait(3);
      await h.edit('config.exhaustHeaderLength', 450, { steps: 5, seconds: 1 });
      await h.wait(3);
      h.sweep();
      await stepPasses(h, 5, 40, '改一个零件');
      await h.wait(8);
      h.lesson('manual');
      await h.wait(10);
      h.mark('结束');
    },
  },
  {
    id: 's1b',
    title: '新手发呆：第 1 步、第 3 步什么都不做',
    opts: { preset: 'street-250', mentor: { visits: 0, graduated: false } },
    run: async (h) => {
      h.note('玩家盯着屏幕 45 秒，不按任何键');
      await h.wait(45);
      h.lesson('help');
      await stepPasses(h, 0, 6, '起动（老周代劳）');
      await stepPasses(h, 1, 8, '稳住怠速');
      h.note('第 3 步「轰一脚」：玩家又发呆 40 秒');
      await h.wait(40);
      h.note('玩家用手油门 0.5 代替空格（半油门）');
      h.hand(0.5);
      await h.wait(4);
      h.hand(0);
      await stepPasses(h, 2, 5, '轰一脚（半油门）');
      await h.wait(3);
      h.lesson('quit');
      await h.wait(5);
    },
  },
  {
    id: 's2',
    title: '乱拧型：怠速下 10 s 改 8 个，测功机定速下再来 8 个，然后再补几刀',
    opts: { preset: 'street-250' },
    run: async (h) => {
      await h.crank();
      await h.wait(4);
      h.note('—— A：怠速，10 秒内乱拧 8 个');
      const a: [string, number | string | boolean][] = [
        ['config.intakeDuration', 270],
        ['config.exhaustHeaderLength', 420],
        ['ecu.advanceOffset', 6],
        ['config.intakeRunnerLength', 420],
        ['ecu.cruiseLambda', 1.12],
        ['config.valveSpringForce', 380],
        ['config.muffler', 'open'],
        ['config.flywheelInertia', 0.012],
      ];
      for (const [p, v] of a) {
        await h.edit(p, v, { steps: 3, seconds: 0.3 });
        await h.wait(0.9);
      }
      await h.wait(10);
      h.mark();
      h.note('—— B：测功机定速 6000 全油门，10 秒内再拧 8 个');
      h.hand(1);
      h.brake(6000);
      await h.wait(5);
      const b: [string, number | string | boolean][] = [
        ['config.lobeSeparation', 104],
        ['config.exhaustDuration', 270],
        ['ecu.wotLambda', 0.95],
        ['config.throttleDiameter', 38],
        ['config.exhaustHeaderDiameter', 36],
        ['ecu.limiterRpm', 9800],
        ['config.intakeLift', 10],
        ['ecu.knockControl', false],
      ];
      for (const [p, v] of b) {
        await h.edit(p, v, { steps: 3, seconds: 0.3 });
        await h.wait(0.9);
      }
      await h.wait(8);
      h.note('—— C：再补几刀，每刀之间等 4 s');
      await h.edit('ecu.advanceOffset', 10);
      await h.wait(4);
      await h.edit('config.intakeDuration', 250);
      await h.wait(4);
      await h.edit('config.fuelOctane', 95);
      await h.wait(8);
      h.hand(0);
      h.brake(null);
      await h.wait(8);
      h.mark('结束');
    },
  },
  {
    id: 's3',
    title: '作死型：断火拉过连杆拉断线顶断火；关保护炸；原样换新再炸两台；最后照老周说的改',
    opts: { preset: 'street-250' },
    run: async (h) => {
      await h.crank();
      await h.wait(2);
      await h.edit('ecu.limiterRpm', 10500, { steps: 4, seconds: 1 });
      await h.wait(3);
      h.note('—— 保护开，全油门顶断火');
      await wot(h, 8);
      await h.wait(3);
      h.mark();
      if (!broken(h)) {
        h.note('—— 被救了，玩家又把断火拉回 10500 再来');
        await h.edit('ecu.limiterRpm', 10500, { steps: 2, seconds: 0.5 });
        await h.wait(2);
        await wot(h, 6);
        await h.wait(2);
        h.mark();
      }
      if (!broken(h)) {
        if (!h.click('关掉保护模式')) h.protect(false);
        await h.edit('ecu.limiterRpm', 10500, { steps: 2, seconds: 0.5 });
        await h.wait(2);
        h.note('—— 保护关，再来');
        await wot(h, 12);
        h.check(broken(h), '关保护后 12 s 内炸了');
        await h.wait(5);
        h.note(h.failureCard());
      }
      h.restore();
      await h.wait(2);
      await blowUp(h, 2);
      h.restore();
      await h.wait(2);
      await blowUp(h, 3);
      h.restore();
      await h.wait(2);
      await blowUp(h, 4);
      h.restoreWithFixes();
      await h.wait(2);
      await h.crank();
      await h.wait(1);
      await wot(h, 6);
      await h.wait(5);
      h.check(!broken(h), '照老周说的改之后全油门 6 s 没炸');
      h.mark('结束');
    },
  },
  {
    id: 's4',
    title: '爆震型：压缩比 12.5 + 点火 +8 + 关爆震控制，测功机 4000 全油门；救场后关保护打穿活塞',
    opts: { preset: 'street-250' },
    run: async (h) => {
      h.note('发动机没转，先改缸体件');
      await h.edit('config.compressionRatio', 12.5, { steps: 3, seconds: 0.6 });
      await h.wait(1);
      await h.edit('ecu.advanceOffset', 8);
      await h.wait(1);
      await h.edit('ecu.knockControl', false);
      await h.wait(3);
      await h.crank();
      await h.wait(2);
      h.brake(4000);
      h.hand(1);
      const rescued = await h.until(() => h.M.controls.useControls.getState().autoThrottle !== null || broken(h), 60);
      h.check(rescued && !broken(h), '保护开时 60 s 内被救场且没烧穿');
      await h.wait(6);
      h.mark('救场后');
      h.note('—— 玩家：关保护，把爆震控制再关掉，点火拉回 +8');
      if (!h.click('关掉保护模式')) h.protect(false);
      await h.edit('ecu.knockControl', false);
      await h.wait(0.5);
      await h.edit('ecu.advanceOffset', 8);
      await h.until(() => broken(h), 120);
      h.check(broken(h), '关保护后 120 s 内活塞烧穿');
      h.hand(0);
      await h.wait(5);
      h.note(h.failureCard());
    },
  },
  {
    id: 's4b',
    title: '爆震型（赛机）：race-450 点火修正 −10 → −4、关爆震控制，测功机 8000 全油门，保护开',
    opts: { preset: 'race-450' },
    run: async (h) => {
      await h.edit('ecu.advanceOffset', -4);
      await h.wait(0.5);
      await h.edit('ecu.knockControl', false);
      await h.wait(2);
      await h.crank();
      await h.wait(2);
      h.brake(8000);
      h.hand(1);
      await h.until(() => broken(h), 40);
      h.hand(0);
      h.brake(null);
      await h.wait(5);
      h.check(!broken(h), '保护开时没烧穿');
      h.mark('结束');
    },
  },
  {
    id: 's5',
    title: '调参认真型：测功机定速 6000，逐个改点火 +4、全油门 λ、进气道长度，等判决、试撤销',
    opts: { preset: 'street-250' },
    run: async (h) => {
      await h.crank();
      await h.wait(2);
      h.brake(6000);
      h.hand(1);
      await h.wait(6);
      h.mark('基线');
      await tryKnob(h, 'ecu.advanceOffset', 4);
      h.note('—— 同一个旋钮 4 s 内再拧一下（基线应该还是 +0 那次）');
      await h.wait(0);
      await tryKnob(h, 'ecu.advanceOffset', 6);
      await tryKnob(h, 'ecu.wotLambda', 0.95);
      await tryKnob(h, 'config.intakeRunnerLength', 380);
      h.note('—— 换个影响大的：节气门 32 → 26 mm，应该明显掉扭矩，试撤销');
      await tryKnob(h, 'config.throttleDiameter', 26);
      h.note('—— 改两个（进气持续角 236 → 280，1 s 后节气门 32 → 27），再点撤销：只回退最后一个');
      await h.edit('config.intakeDuration', 280);
      await h.wait(1);
      await h.edit('config.throttleDiameter', 27);
      await h.wait(7);
      const r = lastMsg(h, 'result');
      if (r?.tone === 'warn') {
        h.click('撤销');
        await h.wait(0.5);
      }
      h.mark('撤销后');
      h.note(`现在 进气持续角 ${String(h.value('config.intakeDuration'))}，节气门 ${String(h.value('config.throttleDiameter'))}`);
      h.hand(0);
      h.brake(null);
      await h.wait(4);
    },
  },
  {
    id: 's6a',
    title: '老周调一遍：street-250 点火修正 −10，完整调校',
    opts: { preset: 'street-250', ecu: { advanceOffset: -10 } },
    run: async (h) => {
      await h.wait(2);
      const p = h.autoTune();
      await tuneDone(h, 300);
      await p;
      await h.wait(5);
      const ecu = h.M.bench.useBench.getState().ecu;
      h.note(`调后 ECU：点火修正 ${ecu.advanceOffset}，全油门 λ ${ecu.wotLambda}，爆震控制 ${ecu.knockControl ? '开' : '关'}，断火 ${ecu.limiterRpm}`);
      h.check(lastMsg(h, 'tune')?.tone === 'good', '调校以「调完了」结束');
      h.mark('结束');
    },
  },
  {
    id: 's6b',
    title: '老周调一遍：中途 20 s 按「停下」',
    opts: { preset: 'street-250', ecu: { advanceOffset: -10 } },
    run: async (h) => {
      await h.wait(2);
      const p = h.autoTune();
      await h.wait(20);
      h.stopTune();
      await tuneDone(h, 15);
      await p;
      h.check(!h.tuning && !h.M.controls.useControls.getState().sweeping && h.M.controls.useControls.getState().autoThrottle === null, '停下后不再扫、不再握油门');
      await h.wait(6);
      h.mark('结束');
    },
  },
  {
    id: 's6c',
    title: '老周调一遍：中途玩家拖手油门、踩空格、按 B',
    opts: { preset: 'street-250', ecu: { advanceOffset: -10 } },
    run: async (h) => {
      await h.wait(2);
      const p = h.autoTune();
      await h.wait(8);
      h.hand(0.4);
      await h.wait(10);
      h.pedal(1);
      await h.wait(2);
      h.pedal(0);
      await h.until(() => h.M.store.useMentor.getState().tuning?.stage === '找点火角', 60);
      await h.wait(3);
      h.brakeHere();
      await tuneDone(h, 200);
      await p;
      await h.wait(5);
      h.note(`结束时手油门 ${h.M.controls.useControls.getState().hand}（玩家拖到 0.4 后没再动）`);
      h.mark('结束');
    },
  },
  {
    id: 's6d',
    title: '老周调一遍：race-450 出厂',
    opts: { preset: 'race-450' },
    run: async (h) => {
      await h.wait(2);
      const p = h.autoTune();
      await tuneDone(h, 300);
      await p;
      await h.wait(5);
      const ecu = h.M.bench.useBench.getState().ecu;
      h.note(`调后 ECU：点火修正 ${ecu.advanceOffset}，全油门 λ ${ecu.wotLambda}，断火 ${ecu.limiterRpm}`);
      h.mark('结束');
    },
  },
  {
    id: 's7a',
    title: '气门飘浮：弹簧 350 N + 断火 10000，保护开，空载全油门',
    opts: { preset: 'street-250' },
    run: async (h) => {
      await h.edit('config.valveSpringForce', 350);
      await h.wait(0.5);
      await h.edit('ecu.limiterRpm', 10000);
      await h.wait(3);
      await h.crank();
      await h.wait(2);
      await wot(h, 6);
      await h.wait(4);
      h.check(!broken(h), '保护开时气门没撞活塞');
      h.mark('结束');
    },
  },
  {
    id: 's7b',
    title: '气门飘浮：弹簧 320 N（出厂断火 8800），测功机 8000 全油门，然后松开测功机',
    opts: { preset: 'street-250' },
    run: async (h) => {
      await h.edit('config.valveSpringForce', 320);
      await h.wait(3);
      await h.crank();
      await h.wait(1);
      h.brake(8000);
      h.hand(1);
      await h.wait(6);
      h.brakeHere();
      await h.until(() => broken(h), 4);
      h.hand(0);
      await h.wait(4);
      h.check(!broken(h), '保护开时松开测功机没撞气门');
      h.mark('结束');
    },
  },
  {
    id: 's8',
    title: 'race-450 出厂直接空载全油门 25 s（保护开）',
    opts: { preset: 'race-450' },
    run: async (h) => {
      await h.crank();
      await h.wait(3);
      h.hand(1);
      await h.wait(25);
      h.hand(0);
      await h.wait(6);
      h.mark('结束');
    },
  },
  {
    id: 's9',
    title: '水温：thumper 改 105×95、压缩比 11、散热器 0.6、断开水温机，测功机 5600 全油门 5 分钟',
    opts: { preset: 'thumper-650', config: { bore: 105, stroke: 95, compressionRatio: 11, radiatorCapacity: 0.6 }, bench: { coolantConditioner: false }, sampleEvery: 1 },
    run: async (h) => {
      await h.wait(2);
      await h.crank();
      await h.wait(2);
      for (let i = 0; i < 3 && h.snap?.status !== 'running'; i++) {
        h.note('熄火了，带一点手油门重新起动');
        h.hand(0.15);
        await h.crank();
        await h.wait(2);
      }
      h.brake(5600);
      h.hand(1);
      for (let i = 0; i < 10; i++) {
        await h.wait(30);
        h.mark(`全油门 ${(i + 1) * 30} s`);
        if (broken(h)) break;
      }
      h.hand(0);
      h.brake(null);
      await h.wait(5);
    },
  },
];

/**
 * Protect-mode timing trials: the same run with the throttle opened at 8
 * phases across one 250 ms watch tick, to see how often the rescue is in time.
 */
const TRIALS: [string, string, [string, number][]][] = [
  ['p-rod', '连杆：断火 10500', [['ecu.limiterRpm', 10500]]],
  ['p-valve', '气门：弹簧 350 N + 断火 10000', [['config.valveSpringForce', 350], ['ecu.limiterRpm', 10000]]],
];
for (const [id, what, edits] of TRIALS) {
  for (let k = 0; k < 8; k++) {
    SESSIONS.push({
      id: `${id}-${k}`,
      title: `保护时序试验（${what}），起动后 ${(2 + k * 0.031).toFixed(3)} s 全油门`,
      opts: { preset: 'street-250' },
      run: async (h) => {
        for (const [p, v] of edits) await h.edit(p, v, { steps: 1 });
        await h.wait(2);
        await h.crank();
        await h.wait(2 + k * 0.031);
        await wot(h, 5);
        await h.wait(1);
        h.check(!broken(h), `保护开，${what}，全油门没炸`);
      },
    });
  }
}
