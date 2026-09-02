# AGENTS.md

> 本文件是所有后续开发（人工或 AI）的**第一入口**。下列内容以**当前代码为准**；原始需求文档已删除，若与本文件或代码冲突，一律以代码与本文件为准。
> 仓库内其它中文文档：`README.md`（项目总览/十分钟启动）、`开发建议.md`、`样式重构与代码审查报告.md`。原始需求文档（`需求文档.md`）与旧问题清单（`代码审查与问题清单.md`）**已删除**，不再维护；要点已并入本文件与 README。根级 `docs/` 目录**已删除**。

---

## 项目概述

「你画我猜 / Draw and Guess —— 局域网联机版」：基于 **Vue 3 + TypeScript + Socket.IO + Express** 的 2～6 人**局域网**实时派对游戏。

- **服务端权威**：身份、房间、阶段、答案、计时、绘画资格与分数全部由服务端裁决；客户端只发操作请求，结果经「角色裁剪快照」回写。
- **公开 / 私密房间**：公开房进入大厅列表；私密房不公开，只能通过服务端生成的短码或定向邀请加入；不支持自定义密码、邀请链接或二维码。游戏中可配置为「观战可加入」（`spectate`）。
- **内存态**：不落数据库，服务重启即清空（含身份、房间、画布、分数）。
- **画板**：高 DPI 实时画布，支持自由画笔、橡皮擦（`destination-out`）与封闭区域洪泛填充；画笔/橡皮擦共用连续粗细，可滚轮调整；支持预设或任意 HEX 颜色，工具可自定义单键切换。
- **头像**：仅允许从 40 个内置 SVG 白名单编号中选择，协议只传编号；禁止上传图片、任意 URL、data URI、SVG 正文、粘贴或拖放头像。
- **应用标识**：名称「你画我猜」、版本 `2.2.0`、协议版本 `protocolVersion: '5'`（见 `config/app.ts`）、本地存储键 `draw-and-guess-profile-v1` / `draw-and-guess-settings-v1`。

### 技术栈与运行环境

- Node.js 当前维护中的 LTS（建议 22 或 24）、pnpm 10+、pnpm workspace 单仓库。
- 现代 Chromium / Edge / Firefox（支持 CSS `container queries`，因为整屏缩放依赖 `cqh/cqw`）。
- 后端子包：`express@5`、`socket.io`、`zod`、`pino`、`tsx`、`helmet`、`cors`。
- 前端子包：`vue@3`、`pinia`、`socket.io-client`、`tailwindcss@4`（`@tailwindcss/vite`）、`lucide-vue-next`，以及 `@tanstack/vue-virtual`（虚拟列表）、`@vueuse/core`（组合式工具）、`nanoid`（短 ID）、`clsx`（类名合并）。

---

## 项目结构

```text
draw_and_guess/
├── package.json                  # 根工程 scripts（dev/build/start/typecheck/lint/format）+ workspace 依赖
├── pnpm-workspace.yaml           # pnpm workspace：apps/* 与 packages/*（勿手改）
├── pnpm-lock.yaml                # 依赖锁文件（勿手改）
├── tsconfig.json                 # 根 TS 严格配置 + 路径别名（@draw-guess/shared / @draw-guess/config / @draw-guess/strings / @/）
├── eslint.config.js              # ESLint 扁平配置（Vue/TS/Node，DOM globals 白名单）
├── .prettierrc.json              # Prettier 格式（无分号/单引号/行宽 100/尾逗号 all）
├── .prettierignore               # 忽略 node_modules/dist/.pi
├── .env.example                  # 部署环境变量示例：HOST/PORT/LOG_LEVEL（仅覆盖部署参数）
├── .gitignore                    # 忽略 node_modules/dist/日志/.pi/.playwright-mcp 等
├── config.ts                     # ★唯一业务配置中心（聚合 export）：APP_CONFIG / PUBLIC_CONFIG / getDeploymentConfig
├── config/                       # 按领域拆分的配置（由 config.ts 聚合；strings.ts 除外）
│   ├── app.ts                    # 应用标识/名称版本/协议版本/storageKey/网络与连接参数（限频、宽限、端口）
│   ├── player.ts                 # 玩家资料：昵称长度、默认昵称、40 个内置 SVG 头像 ID 白名单、颜色正则
│   ├── room.ts                   # 房间默认名、公开性、私密短码长度、允许邀请/暂停、加入策略 joinPolicy
│   ├── game.ts                   # 对局规则：轮数/作画/选词/候选数、提示、分数（基础/速度/顺序/画家）
│   ├── drawing.ts                # 画板：预设色、色正则、粗细区间、填充容差、批次/限频/历史命令预算
│   ├── vocabulary.ts             # 词库：路径、编码、最小/最大词条数、去重与重置策略
│   ├── audio.ts                  # 音效合成 cue（频率序列与时长）与增益
│   ├── settings.ts               # 本地设置（音量/动画/快捷键/发现偏好/自动聚焦）、UI 参数、预设安全短语
│   └── strings.ts                # ★唯一 UI 文案表：展示在界面上的全部中英文字符（客户端 strings / 服务端 serverStrings）；含模板函数不纳入 PUBLIC_CONFIG
├── vocabulary.md                 # ★唯一权威词库：每个非空行一个词/短语（禁止标题/列表符号/编号/注释）
├── README.md                     # 项目总览、十分钟启动、命令与续开发入口
├── AGENTS.md                     # 本文件：导读、硬性限制、启动方法、编码/测试/提交流程
├── 开发建议.md                    # 开发计划/新功能/优化/模块拆分（M0-M3 里程碑）
├── 样式重构与代码审查报告.md      # 最近一次全量样式重构（原生 CSS → 行内 Tailwind）的报告与审查结论
│
├── packages/shared/               # 前后端共享协议（无环境依赖，可在 Node/浏览器直接单测）
│   └── src/
│       ├── index.ts               # 聚合出口：re-export 下列四模块（引用路径保持 @draw-guess/shared）
│       ├── events.ts              # 全部 Socket.IO 事件名常量 EVENTS（前后端唯一事件名来源）
│       ├── types.ts               # 领域类型：房间阶段/成员/规则/快照/绘图命令/邀请等 DTO（含 spectating）
│       ├── schemas.ts             # Zod 运行时校验：注册/资料/建房/规则/绘图等请求载荷
│       └── pure.ts                # 纯函数：答案规范化、遮罩生成、计分、近似判断、状态机转换表
│
├── apps/server/                   # 服务端（Express 5 + Socket.IO + Zod，权威领域）
│   ├── package.json               # 依赖（express/helmet/cors/socket.io/zod/pino/tsx）
│   ├── tsconfig.json              # 继承根配置 + Node 类型
│   └── src/
│       ├── index.ts               # 生产入口：配置校验、局域网 IPv4 探测、监听、优雅关闭
│       ├── app.ts                 # HTTP/Socket.IO 装配：端口、静态托管 dist、SPA 回退、连接入口
│       ├── game-service.ts        # 领域服务编排：会话/成员/房间/邀请/猜词/绘图/快照入口（权威裁决）
│       ├── round-machine.ts       # 回合流转状态机：开局/选词/作画/结算/暂停/弃权/逐步提示
│       ├── scoring.ts             # 计分纯函数：猜中明细、画家得分（可独立单测）
│       ├── snapshot.ts            # 角色裁剪快照构建：画家/观众视角差异化、strokesOmitted 差分（客户端落后自检后 stateResync 拉全量兜底）
│       ├── rate-limit.ts          # 猜词/绘图滑动窗口限频
│       ├── errors.ts              # GameError / success / failure / 日志接口（避免循环依赖）
│       ├── models.ts              # 服务端内存秘密模型（PlayerSecret/RoomSecret/GameSecret…）
│       ├── vocabulary.ts          # 词库加载/解析/去重/版本哈希
│       ├── protocol/binder.ts     # 统一请求绑定：schema 校验、会话限频、幂等缓存、统一 ack
│       └── handlers/              # 按领域分组的事件注册（全部走 binder）
│           ├── session.ts         # 注册/资料/偏好/大厅/状态重同步/ping/断线
│           ├── room.ts            # 公开/私密建房与加入、离房、准备、规则、词库、踢人/移交、邀请
│           ├── game.ts            # 开始/选词/暂停/恢复/提前结束/返回房间
│           ├── chat.ts            # 猜词、预设安全短语
│           └── draw.ts            # 笔画批次/填充/撤销/重做/清空（跳过通用限频）
│
├── apps/client/                   # 客户端（Vue 3 + Pinia + Vite + Tailwind4 + Socket.IO）
│   ├── package.json               # 依赖（vue/pinia/socket.io-client/tailwindcss/lucide-vue-next/@tanstack/vue-virtual/@vueuse/core/nanoid/clsx）
│   ├── tsconfig.json              # 继承根配置 + DOM/vite 类型
│   ├── vite.config.ts             # Vite 配置：@draw-guess/config 虚拟公开模块裁剪、/@ alias、开发代理
│   ├── index.html                 # 入口 HTML（#app 挂载点，移动端缩放/主题色）
│   └── src/
│       ├── main.ts                # 客户端入口：创建 App 并挂载 #app；仅引入 ./style/index.css
│       ├── App.vue                # 根舞台：页面互斥渲染（对局>房间>设置>大厅>资料）、Toast、邀请横幅、竖屏提示
│       ├── style/
│       │   └── index.css          # ★唯一全局样式文件：@import tailwindcss + @theme 令牌 + @layer base（reset/舞台上下文/交互反馈/Vue 过渡钩子/关键帧/竖屏与减少动效）+ @layer components（共享组件类 .btn/.dialog-shell/.field-input/.eyebrow 等，用 @apply 收敛重复行内类）
│       ├── stores/
│       │   ├── game.ts            # Pinia store：本地资料/设置、房间与对局状态、业务操作请求（发送方）
│       │   ├── socket.ts          # Socket 单例 + 推送事件桥接（HMR dispose）
│       │   └── request.ts         # 请求封装：timeout+ack+错误翻译+quiet 静默降级
│       ├── composables/
│       │   ├── useAudioFeedback.ts # Web Audio 合成提示音（自动播放入口解锁、音量实时读取）
│       │   ├── useGameHud.ts      # 对局 HUD 计算：剩余时间/进度/猜词权限/阶段标签/排行
│       │   └── useShortcuts.ts    # 画板快捷键：自定义单键切换工具、撤销/重做组合键
│       ├── components/
│       │   ├── AppButton.vue      # 统一动作按钮（primary/secondary/danger），收敛三色动作长串
│       │   ├── BaseDialog.vue     # 通用弹窗外壳（遮罩+卡片+可选标题栏/底部），含 <Transition name="modal"> 过渡 + Esc 关闭
│       │   ├── ConfirmDialog.vue  # 通用确认弹窗（复用 BaseDialog，红色 danger 确认钮）
│       │   ├── AvatarImage.vue    # 内置 SVG 头像统一安全展示（只接收白名单编号；尺寸由调用处传入）
│       │   ├── AvatarPickerDialog.vue # 40 个 SVG 头像选择模态框
│       │   ├── GameCanvas.vue     # 高 DPI 实时画板：增量绘制、橡皮擦/destination-out、洪泛填充、滚轮线宽
│       │   ├── game/              # 对局组件：GameHud / ChatPanel / DrawingToolbar / PhaseOverlay / ScoreStrip
│       │   ├── room/              # 房间组件：SeatGrid / RuleSummary / RulesDialog / InviteDialog / VocabularyDialog
│       │   └── settings/          # 设置页组件：AudioTab / ShortcutsTab / AccessibilityTab / DiagnosticsTab / SettingSliderRow / SettingSwitchRow
│       ├── views/
│       │   ├── ProfileView.vue    # 资料确认页（随机昵称/内置 SVG 头像选择，无上传）
│       │   ├── LobbyView.vue      # 在线大厅（公开列表/公私建房/私密短码加入/可发现玩家）
│       │   ├── RoomView.vue       # 房间等待（席位/准备/私密码/虚拟词库/规则/邀请/退出）
│       │   ├── GameView.vue       # 对局骨架（HUD/画布/聊天/工具栏/各阶段遮罩/结算）
│       │   └── SettingsView.vue   # 设置页（声音/显示/快捷键/资料诊断）
│       └── utils/
│           ├── avatar.ts          # Vite SVG 静态资源白名单编号到 URL 映射
│           └── createUuid.ts      # 多环境 UUID：randomUUID→getRandomValues→混合兜底
│
└── docs/                          # ❌ 已删除（内容要点已并入 README/AGENTS.md）
```

> **关于客户端样式**：自「样式重构与代码审查报告.md」所述重构后，`apps/client/src/style/` 仅剩 `index.css` 一个文件。它是 **Tailwind 全局配置**（`@theme` 语义色令牌 + `@layer base` 全局 reset、舞台上下文、交互动效、Vue 过渡钩子、关键帧、竖屏/减少动效 + `@layer components` 共享组件类 `AppButton`/`BaseDialog`/`ConfirmDialog` 对应的 `.btn`/`.dialog-shell`/`.field-input`/`.eyebrow` 等，用 `@apply` 收敛重复行内类）。**组件/页面自身视觉样式一律写成 Vue 模板内的行内 Tailwind 类**（依赖 `cqh/cqw` 容器单位 + 语义色 `bg-navy`/`text-muted`/`border-line` 等），长串可复用共享组件或 `@layer components` 类。新增样式时不要新建 CSS 文件、不要写 `@layer components` 之外的原生 CSS 类选择器。

---

## 开发环境与常用命令

### 环境要求

- Node.js 当前维护中的 LTS（建议 22 或 24）、pnpm 10+。
- 现代 Chromium / Edge / Firefox（支持 container queries）。

### 首次安装

```bash
pnpm install
```

### 开发模式（本机联调）

```bash
pnpm dev
```

- 客户端：`http://localhost:5173`（Vite 代理 `/api` 与 `/socket.io` 到 5174）
- 服务端：`http://localhost:5174`（`tsx watch` 热重载）

### 生产局域网模式（正式游玩）

```bash
pnpm build      # 先执行类型检查并构建前端（产出 apps/client/dist）
pnpm start      # 单一 Express + Socket.IO 生产服务（tsx src/index.ts）
```

- 终端会醒目输出主机访问地址、一个或多个 `http://局域网IP:5174` 候选地址、端口与加入说明。
- 其它玩家连接**同一局域网**后在浏览器输入上述地址即可。
- 常见问题：IP/端口与终端输出不一致、设备不在同一网段、防火墙未放行 Node.js 专用网络、版本不兼容（刷新/清缓存）。
- 端口/监听地址/日志级别可用环境变量覆盖：`PORT=5180 pnpm start`、`HOST=0.0.0.0`、`LOG_LEVEL=debug`（复制 `.env.example`）。环境变量**不会**覆盖游戏规则。

### 其它命令（全部通过根 `package.json` scripts）

```bash
pnpm typecheck     # 全 workspace 严格类型检查（vue-tsc + tsc）
pnpm lint          # ESLint（--max-warnings=0，无任何警告才通过）
pnpm format        # Prettier 写入
pnpm format:check  # 仅检查格式
```

> 各子包也带独立脚本：`apps/client` 含 `dev/build/typecheck`；`apps/server` 含 `dev/start/typecheck`；`packages/shared` 含 `typecheck`。

---

## 架构与实现约定

- **依赖方向单向**：`client → shared/config`、`server → shared/config`、`shared → 无运行时依赖`。客户端与服务端都通过 `@draw-guess/shared` 引用协议层；不改动这一分层。
- **服务端权威裁决**：答案、计分、阶段、计时、绘画资格只能由服务端判定；客户端永远不能上传「裁决结果」。客户端只发带 `requestId` 的幂等请求经统一 `ack` 返回。
- **角色裁剪快照**（`snapshot.ts`）：所有公开数据结构按观看者角色生成；服务端秘密字段（答案、恢复令牌、候选词、内部计时器、请求缓存）绝不进快照/事件。私密房短码仅裁剪给当前房主；大厅玩家资料不回显私密房 UUID。
- **统一请求绑定**（`protocol/binder.ts`）：schema 校验、会话限频、幂等缓存、统一 `ack`。非法阶段/角色/序号/频率由 `binder.ts` 与领域服务拒绝。
- **回合状态机**：`round-machine.ts` + `packages/shared/src/pure.ts` 的 `LEGAL_PHASES` 白名单；非法转换由服务端拒绝（`INVALID_TRANSITION`）。
- **计分统一口径**：`scoring.ts` 与 `pure.ts` 的 `calculateGuessScore` 使用同一规则（基础 + 速度 + 顺序；两人局禁用顺序奖）。
- **画布增量绘制**（`GameCanvas.vue`）：坐标一律**归一化 0～1**；绘图序号单调递增，服务端拒绝旧包；橡皮擦/填充只传「点击位置 + 颜色」，不传像素，客户端按同一历史重放；`lastSequence` 用于重连续接。
- **配置单一来源**：业务规则只写在 `config/` + `config.ts` 聚合；UI 文案只写在 `config/strings.ts`；词库只写在 `vocabulary.md`。
- **内存态、无持久化**：服务端不使用数据库、不写运行日志/战绩/聊天/会话/遥测文件；重启即清空。浏览器仅本机保存昵称、头像编号、本地设置与短期恢复令牌。

---

## 编码规范

- **类型**：`strict` + `noUncheckedIndexedAccess`（根 `tsconfig.json`）。避免 `any`（ESLint `@typescript-eslint/no-explicit-any: error`）；未使用变量加 `_` 前缀以通过 `no-unused-vars`。
- **命名**：组件/视图 `PascalCase.vue`；TS 文件 `camelCase.ts` / `kebab-case` 用于辅助资源；事件名用 `EVENTS` 常量；领域模型用「Secret 后缀」标记服务端秘密对象。
- **格式**：Prettier（无分号、单引号、行宽 100、尾逗号 all）。编码前先 `pnpm format`。
- **注释**：中文注释，解释「为什么」而非复述代码；关键算法 / 边界处理要求注释（参考 `GameCanvas.vue`、`pure.ts`、`snapshot.ts` 的注释质量）。
- **错误处理**：服务端用 `GameError` + `errors.ts` 统一错误码与中文文案；客户端经 `request.ts` 统一超时 + ack + 错误翻译 + `quiet` 静默降级。
- **日志**：服务端用 `pino`（结构化内存 logger），不写日志文件；级别经 `LOG_LEVEL` 控制。
- **UI 文案**：**严禁在组件/业务代码里硬编码展示字符**；一律从 `config/strings.ts` 的 `strings`（客户端）或 `serverStrings`（服务端）导入。
- **样式**：组件/页面视觉一律用**行内 Tailwind 类**写在 Vue 模板；重复的长串收敛到共享组件（`AppButton`/`BaseDialog`/`ConfirmDialog`）或 `style/index.css` 的 `@layer components` 共享类（`.btn`/`.dialog-shell`/`.field-input`/`.eyebrow`）。不要新建 CSS 文件、不要写 `@layer components` 之外的原生 CSS 类选择器。语义色用 `@theme` 令牌（`bg-navy`/`text-muted`/`border-line` 等）；容器单位 `cqh/cqw` 用任意值（内部空格用 `_`，如 `shadow-[0_1.2cqh_5cqh_#0009]`）。

---

## 测试规范

> **待确认（当前无自动化测试基建）**：经检索，仓库内**没有** `vitest`/`jest` 配置、没有 `*.test.ts`/`*.spec.ts` 文件，`package.json` 及子包也**没有** `test` 脚本。因此**当前不存在可运行的自动化测试**。

- 可作为将来单测目标的纯函数（注释已注明「可独立单测」）：`packages/shared/src/pure.ts`、`apps/server/src/scoring.ts`、`apps/server/src/snapshot.ts`。
- **修改代码后的最低验证要求**（目前唯一的「测试」手段）：依次运行
  ```bash
  pnpm format
  pnpm lint         # --max-warnings=0，无任何警告
  pnpm typecheck
  pnpm build
  ```
- 涉及关键逻辑（状态机、计分、快照裁剪、画布同步、限频、私有房间访问控制）时，建议额外做人工/浏览器端到端验证（可用 Playwright 等，但当前仓库未锁定其依赖，属 `待确认`）。
- **若未来引入测试框架**：请在本文件登记测试框架、测试文件位置与运行命令，并保持纯函数模块的可测试性。

---

## 修改规则与工作流程

### 修改前应检查

1. 通读本文件「约束与禁止事项」，确认改动不违反硬性限制。
2. 定位改动归属：业务规则 → `config/`；协议/事件 → `packages/shared/`；服务端权威领域 → `apps/server/src/`；客户端视图 → `apps/client/src/`。
3. 若改动会改变公共接口 / 事件名 / DTO，先更新 `types.ts`/`schemas.ts`/`events.ts` 并同步前后端；`protocolVersion` 变更属不兼容变更，必须与客户端同步 `+1`。
4. 查阅 `开发建议.md`，确认是否与既有待办/计划冲突。

### 各类改动的流程

- **新增功能**：
  1. 新增请求事件：`packages/shared/src/events.ts`（事件名）→ `schemas.ts`（校验）→ `game-service.ts` 或对应 handler → `handlers/*.ts` 注册 → `stores/game.ts` 客户端方法。
  2. 业务规则参数先加入 `config/` 对应文件 + `config.ts` 聚合。
  3. UI 文案加入 `config/strings.ts`。
  4. 完成后跑「最低验证命令」。
- **修复缺陷**：先复现、明确根因（多在状态机 / 快照裁剪 / 同步兜底），改最小范围，再验证相关模块与相邻功能。
- **调整接口 / DTO**：同步 `packages/shared` 的 `types.ts` + `schemas.ts`，并检查 `snapshot.ts` 是否需按新字段裁剪；协议版本不兼容时 `protocolVersion +1`。
- **修改依赖**：只在对应子包 `package.json` 添加，**不要**用 `-g` 全局安装；改后运行 `pnpm install` 更新锁文件并跑类型检查。

### 修改完成后必须执行

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm build
```

---

## 约束与禁止事项

> 这些是**明确不允许或强烈不建议**的改动；违背会导致安全问题、无法联机或验收失败。

1. **架构与权威性**
   - 服务端必须保持**权威裁决**：答案、计分、阶段、计时、绘画资格只能由服务端判定；客户端永远不能上传「裁决结果」。
   - 服务端**不使用数据库、不写运行日志文件**（仅结构化内存 + logger），重启即清空——不要擅自引入持久化。
   - 公开房必须进入大厅列表；私密房必须从大厅隐藏，短码只能由服务端安全随机生成并限频校验；禁止客户端自选弱码、自定义密码、邀请链接或二维码。
2. **隐私与安全边界**
   - 带 `Secret` 后缀的服务端数据（恢复令牌、候选词、内部计时器、请求缓存）**绝不**原样出现在任何快照/事件中；一律经 `snapshot.ts` 裁剪。
   - 客户端请求必须带 `requestId`（幂等）与统一 `ack`；非法阶段/角色/序号/频率由 `binder.ts` 与领域服务拒绝。
   - 头像只允许 `config/player.ts` 白名单中的内置 SVG 编号；**禁止上传图片、任意 URL、data URI、SVG 正文、粘贴或拖放头像**。
3. **词库与内容**
   - `vocabulary.md` 每行只能写一个词/短语：**禁止标题、列表符号、编号、注释**；修改后需重启服务。
   - 猜词判定固定用 `normalizeAnswer`（NFKC + 去空白 + 折叠空白 + 忽略拉丁大小写），不要在别处另写一套比较。
4. **配置治理**
   - 业务规则**只允许**写在 `config/` 目录 + `config.ts` 聚合；环境变量仅覆盖 `HOST / PORT / LOG_LEVEL`，禁止环境变量覆盖游戏规则。
   - UI 文案**只允许**写在 `config/strings.ts`，组件与业务代码严禁硬编码展示字符。
   - 不要把配置明文写死进业务代码（应用名、版本、协议版本等集中在 `config/app.ts`）。
5. **联机与部署**
   - 服务监听默认 `0.0.0.0`；前端构建产物托管与 Socket.IO 必须在**同一 Node 服务**（端口分离仅限开发代理）。
   - 服务**不要开放到公网**；若主机被其它设备访问，需保证防火墙放行专用网络并提示同一网段。
   - `protocolVersion` 变更属不兼容变更，必须与客户端同步 `+1`。
6. **画布与体验**
   - 坐标一律**归一化 0～1**；绘图序号必须单调递增，服务端拒绝旧包。
   - 橡皮擦/填充仍需保持「只传点击位置与颜色，不传像素」的约束（客户端按同一历史重放）。
   - 动画化/教学页不在首版范围（新增需另行评审）。
7. **工程约束**
   - 提交前必须通过：`pnpm format` → `pnpm lint`（--max-warnings=0）→ `pnpm typecheck` → `pnpm build`。
   - 目录职责保持现状：shared（协议/纯函数）、server（权威领域）、client（视图）；不要在 client 中裁决游戏逻辑。
   - **不要**新建分片 CSS 文件；组件/页面样式一律行内 Tailwind，重复长串收敛到共享组件或 `@layer components` 共享类。全局层（reset、Vue 过渡钩子、关键帧、容器单位上下文、竖屏/减少动效、组件类）保留在 `apps/client/src/style/index.css`。

---

## 配置、安全与敏感信息

- **环境变量**：仅 `.env.example` 中的 `HOST / PORT / LOG_LEVEL` 可覆盖部署参数；游戏规则一律改 `config.ts`。
- **密钥 / 凭据**：仓库中**不包含**任何真实密钥、Token、密码或个人信息。临时身份恢复令牌由服务端内存生成、仅当前进程有效、只存于内存与客户端 `localStorage`。
- **本地存储**：浏览器仅保存昵称、内置头像编号、本地设置与短期恢复令牌（见 `config/app.ts` 的 `storageKey`/`settingsStorageKey`）。
- **敏感信息纪律**：禁止将真实密钥、Token、密码、私有地址或任何个人信息写入仓库、提交日志或本文件。`.gitignore` 已忽略 `.env` 类本地环境文件（`*.local`、本地环境文件）。
- **对外最小公开**：前端经 Vite 虚拟模块仅打包 `PUBLIC_CONFIG`；`/api/info` 也只返回同一公开子集，避免内部限频与清理策略泄露。

---

## 提交与协作规范

- **提交信息**（从 `git log` 可确认的既有规范）：采用 Conventional Commits 格式：
  `type(scope)：subject`，其中 `type` 为 `feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert` 之一，`scope` 为影响模块（可选），`subject` 用**中文**、且不超过 50 字、不以句号结尾。需要补充说明时加空行写 `body` 说明动机与上下文。
  示例（取自近期提交）：`fix(画布)：修复长笔画在窗口缩放后只显示开头的问题`、`feat(游戏)：接入 SVG 头像、私密房间与体验优化`、`refactor(shared)：按职责拆分共享包为 events/types/schemas/pure`。
- **分支**：当前默认分支为 `main`（`git branch --show-current` = `main`）。仓库中**未发现** PR / Code Review / 分支命名 / CI/CD 规范（未找到 `.github/`、`.gitlab-ci.yml`、`.circleci/` 等配置），**此部分待确认**。
- **协作约定**：遵守「修改完成后必须执行」的命令，保持一次提交聚焦一个改动点，涉及协议/接口变更时同步前后端。

---

## 最近改动

> 本节仅基于**可验证信息**：`git log`（已提交历史）与 `git status`/`git diff`（工作区变更），来源见各条目标注。

### 已提交历史（近期，`git log --oneline`）

- `bf3c8e0` fix(画布)：修复长笔画在窗口缩放后只显示开头的问题
- `c4eedd6` docs：删除不需要的文档
- `5ea1007` feat(游戏)：接入 SVG 头像、私密房间与体验优化
- `8bec8b4` refactor: 创建 string 文件统一管理 UI 展示字符
- `8d449b1` docs(agents)：补充画布快照差分与落后自检修复说明
- `ba1ba7d` fix(会话与画布)：刷新免登录恢复身份、画布同步兜底与交互增强
- `5bbf276` docs(项目)：完善导读与文档并删除 docs 目录
- `36aa30c` chore(client)：删除已拆分的旧 style.css 单文件
- `a6e7d67` refactor(client 与 config)：拆分 store/视图组合式/样式/配置目录
- `97efb04` refactor(server)：拆分游戏服务与传输层为领域模块
- `b5e0b2f` refactor(shared)：按职责拆分共享包为 events/types/schemas/pure
- `9bf5d21` fix(性能与兼容)：修复 E1-E4、F1-F3 问题

### 工作区未提交变更（来源：`git status` / `git diff --stat`）

本次为**全量样式重构**：把客户端所有从原生 CSS 类引用的样式迁移为 **Vue 模板内的行内 Tailwind 类**，并将样式合并为**单一全局文件**。

- 修改：`apps/client/src/App.vue`、`components/{AvatarImage,AvatarPickerDialog,GameCanvas,GameSettingsDialog}.vue`、`views/{Profile,Lobby,Room,Game,Settings}View.vue`。
- 重写：`apps/client/src/style/index.css`（改为 Tailwind 全局配置，删除了分片的 `base/profile/lobby/dialog/room/game/settings/toast/motion.css`）。
- 新增（未跟踪）：`样式重构与代码审查报告.md`（记录本次重构、UI 验证与代码/结构审查结论，含若干待修复项 P1/P2/P3）。
- 详情见 `样式重构与代码审查报告.md`；净变更约 `+1429 / -3301` 行（`git diff --stat`）。

---

## AI 代理操作指南

- **优先阅读**：本 `AGENTS.md` → `README.md` → 目标模块对应文件。改动前先读相关文件头部注释（这些注释通常写明设计意图与边界）。
- **修改范围控制**：只改当前任务相关的文件；不要顺手格式化无关文件、不要改动 `pnpm-lock.yaml`、`.pi/`、`dist/`、`node_modules/`。
- **如何验证修改正确**：改完运行 `pnpm format && pnpm lint && pnpm typecheck && pnpm build`；涉及界面改动可用浏览器手动/Playwright 验证。
- **遇到不确定事项**：
  - 以**代码与当前配置为准**，不被过时的需求文档带偏；冲突时向用户确认。
  - 涉及「约束与禁止事项」里明确禁止/限制的改动时，先向用户说明理由并获得确认，不要擅自引入数据库、私密房逻辑外的访问方式、图片头像、公网暴露或客户端裁决。
  - 一些默认行为（如成员加入即重置全员准备、词库弹窗缺少 `Esc` 关闭、模板中自闭合组件后残留字面 `>` 字符）在 `样式重构与代码审查报告.md` 的 P1/P2/P3 中有记录，属已知问题，改动前先确认是否应一并修复。
- **快速定位速查**：

| 想改什么                       | 去哪个文件                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 应用名/版本/端口/协议/限频参数 | `config/app.ts`（经 `config.ts` 聚合）                                                                                                   |
| 对局轮数/时间/分数/提示        | `config/game.ts`                                                                                                                         |
| 画板颜色/粗细/批次/历史上限    | `config/drawing.ts`                                                                                                                      |
| 词库内容                       | `vocabulary.md`（改后重启服务）                                                                                                          |
| 新增一个请求事件               | `packages/shared/src/events.ts` → `schemas.ts` → `game-service.ts` 或对应 `handler` → `handlers/*.ts` 注册 → `stores/game.ts` 客户端方法 |
| 回合流转/阶段                  | `apps/server/src/round-machine.ts`                                                                                                       |
| 计分规则                       | `apps/server/src/scoring.ts`                                                                                                             |
| 快照裁剪/隐私边界              | `apps/server/src/snapshot.ts`                                                                                                            |
| 画布渲染/增量绘制              | `apps/client/src/components/GameCanvas.vue`                                                                                              |
| 全局样式 / Tailwind 令牌       | `apps/client/src/style/index.css`                                                                                                        |

---

以「服务端权威 + 角色裁剪快照 + 幂等 ack + 增量绘图」为核心原则开发。除非需求/清单明确要求且经得起「约束与禁止事项」核对，否则不要引入数据库、私密房、图片头像、公网暴露或客户端裁决。
