# 四冲程活塞发动机物理拟真模拟器

> 4-Stroke Internal Combustion Reciprocating Engine Cross-Section Simulator

一个基于 **React 19 + Vite 6 + TypeScript + Tailwind v4** 的交互式单缸四冲程汽油发动机物理仿真器。实时模拟曲柄连杆机构运动、缸内热力学、缸压做功、部件磨损与失效，并配有 Web Audio 合成的发动机声浪、测功机 (Dyno) 拉力测试与挑战任务玩法。

## ✨ 核心特性

### 物理拟真
- **真实曲柄连杆几何**：精确的活塞位移与曲拐扭矩方程。
- **三套可切换发动机平台**：原厂 250cc / 高转赛用 450cc / 大排量低扭 650cc，各自独立的缸径、行程、压缩比、飞轮惯量、红线与热容，切换即彻底改变手感。
- **容积效率 (VE) 扭矩曲线**：不对称钟形曲线塑造真实的低扭/高转特性。
- **缸内热力学**：进气/压缩/做功/排气四冲程的多变过程压力与温度，MBT 点火提前角、空燃比 (λ) 燃烧极限与失火。
- **温度/压缩比依赖的爆震 (Knocking) 模型**。
- **机油压力模型** + **冷却液/机油双温度系统**（冷却泵流量可调）。
- **节气门蝶阀惯性**（油门一阶滞后响应）。
- **部件磨损与失效**：活塞环、缸壁、连杆轴瓦、曲轴主轴颈、火花塞、气门 —— 可拉缸抱死 (SEIZED) 或炸缸 (EXPLODED)。

### 玩法系统
- **挑战任务**：稳定怠速、爆改马力赛、红线冲刺、耐久挑战（含个人最佳记录）。
- **测功机 Dyno**：全转速域扫描，绘制扭矩 / 马力双曲线。
- **信用点经济 + 积分系统**：跑 Dyno、过挑战赚取 CR / 积分，用于局部维修与完整大修。
- **ECU 调校预设**：保存 / 载入空燃比、点火角、限速等参数组合。

### 视听
- **Canvas 实时剖面渲染**：活塞、连杆、曲轴、气门、火花塞、粒子特效（进气喷雾 / 燃烧火焰 / 排气烟）、转速表 / 水温 / 油压仪表群。
- **Web Audio 声浪合成**：单缸离散排气脉冲、进气声、限速断火放炮、冷却风扇、爆震金属声、炸缸轰鸣。

## 🚀 快速开始

需要已安装 [Node.js](https://nodejs.org/)（建议 18+）。

```bash
# 安装依赖
npm install

# 启动开发服务器 (http://localhost:3000)
npm run dev

# 生产构建
npm run build

# 预览构建产物
npm run preview
```

Windows 用户可直接双击 `start.bat` 一键安装依赖并启动。

## 🎮 操作说明

1. 按住「起动电机」按钮拖动曲轴，达到怠速后松开即可自持运转。
2. 调节油门、空燃比、点火提前角、机油液位、冷却泵、阻风门等参数观察发动机响应。
3. 在 Canvas 上可用鼠标/手势拖动曲轴，或点击火花塞强制跳火。
4. 跑一次 Dyno 拉力测试或挑战任务赚取信用点，用于维修与大修。

## 🛠 技术栈

| 技术 | 用途 |
| --- | --- |
| React 19 | UI 框架 |
| Vite 6 | 构建 / 开发服务器 |
| TypeScript | 类型安全 |
| Tailwind CSS v4 | 样式 |
| lucide-react | 图标 |
| Canvas 2D API | 发动机剖面渲染 |
| Web Audio API | 声浪合成 |

## 📁 项目结构

```
src/
├── App.tsx                  # 主应用 + 60fps 物理积分循环 + 玩法编排
├── types.ts                 # 类型定义
├── components/
│   ├── EngineCanvas.tsx     # Canvas 剖面渲染 + 仪表群
│   ├── TelemetryDashboard.tsx  # 实时遥测仪表盘
│   ├── ControlPanel.tsx     # 参数控制台
│   ├── WearTracker.tsx      # 磨损诊断与大修
│   ├── DynoPanel.tsx        # 测功机拉力曲线
│   └── ChallengePanel.tsx   # 挑战任务 / 调校车库
└── utils/
    ├── enginePhysics.ts     # 发动机规格 + 热力学 + 扭矩模型
    └── engineAudio.ts       # Web Audio 声浪合成
```

## 📄 License

Apache-2.0
