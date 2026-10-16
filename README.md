# 四冲程单缸发动机模拟器

浏览器内的单缸四冲程发动机物理沙盒：ECU 调校、改装零件、测功台、生涯合约、Canvas 剖面动画与 Web Audio 实时发声。

## 开发

```bash
npm install
npm run dev        # http://localhost:3000
npm run build      # tsc + vite build
npm test           # vitest
npm run lint
npm run playtest   # 用真实 runtime 跑 9 个平衡/手感场景
npm run balance    # 平衡性报告
```

## 架构

```
src/
  engine/    纯 TS 物理与规则（无 React、无 DOM）：physics / simulation / tune / parts / dyno / career / persistence
  runtime/   EngineRuntime：固定 1/120 s 步长 + 累加器，不可变快照，类型化事件；输入意图与遥测
  store/     zustand：garage（存档/金钱/零件/合约）、log、settings、tutorial
  game.ts    组合根：装配 runtime、store、音频，startGame()
  hooks/     useRuntime（useSyncExternalStore）、useGarage、键盘控制
  components/ 纯展示/交互组件
  utils/     Web Audio 合成
scripts/     playtest / balance-report
```

要点：模拟与渲染解耦；测功台与实时游玩共用同一固定步长；存档防抖写入 localStorage。
