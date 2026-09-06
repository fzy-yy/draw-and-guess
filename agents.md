# AGENTS.md

> 本文件是所有后续开发（人工或 AI）的**第一入口**。下列内容以**当前代码为准**；原始需求文档已删除，若与本文件或代码冲突，一律以代码与本文件为准。
> 仓库内其它根级文档：`README.md`（项目总览/十分钟启动）、`vocabulary/`（SQLite 词库目录）。**注意：`README.md` 部分章节（依赖清单、持久化/日志说明、已被删除的文档引用）已过时，与代码不一致时以本文件与代码为准。**

---

## 项目概述

「你画我猜 / Draw and Guess —— 局域网联机版」：基于 **Vue 3 + TypeScript + Socket.IO + Express** 的 2～6 人**局域网**实时派对游戏。

- **服务端权威**：身份、房间、阶段、答案、计时、绘画资格与分数全部由服务端裁决；客户端只发操作请求，结果经「角色裁剪快照」回写。
- **公开 / 私密房间**：公开房进入大厅列表；私密房不公开，只能通过服务端生成的短码或定向邀请加入；不支持自定义密码、邀请链接或二维码。游戏中可配置为「观战可加入」（`spectate`）。
- **内存态 + 低频持久化**：高频瞬态（画布笔画、聊天消息、计时器、对局实时状态）全部在内存，重启即清空；**低频关键态**（玩家身份/恢复令牌/偏好、房间配置、完成局的战报）经 **SQLite（better-sqlite3，WAL）** 落盘：重启后身份可凭令牌在宽限内恢复、进行中房间作废关闭、历史战报可查。数据库文件位于 `apps/server/data/game.db`（已忽略入库）。
- **日志文件化**：服务端日志**不输出到控制台**（规避 Windows 控制台 GBK 解码 UTF-8 中文乱码），默认写入 `apps/server/log/app-<秒级时间戳>.log`（每次启动新建一个、最多保留 `LOG_MAX_FILES` 条）；可通过 `.env` 的 `LOG_ENABLED` 完全关闭（零内存开销）。
- **画板**：高 DPI 实时画布，支持自由画笔、橡皮擦（`destination-out`）与封闭区域洪泛填充；画笔/橡皮擦共用连续粗细，可滚轮调整；支持预设或任意 HEX 颜色，工具可自定义单键切换。**渲染模型为「归一化点列 + 直线段描边」增量同步**（不引入轮廓填充型平滑库，曾因此导致白边/闪烁/空心缺陷）。
- **头像**：仅允许从 40 个内置 SVG 白名单编号中选择，协议只传编号；禁止上传图片、任意 URL、data URI、SVG 正文、粘贴或拖放头像。
- **应用标识**：名称「你画我猜」、版本 `2.3.0`、协议版本 `protocolVersion: '8'`（见 `config/app.ts`）、本地存储键 `draw-and-guess-profile-v1` / `draw-and-guess-settings-v1`。

### 技术栈与运行环境

- Node.js 当前维护中的 LTS（建议 22 或 24）、pnpm 10+、pnpm workspace 单仓库。
- 现代 Chromium / Edge / Firefox（支持 CSS `container queries`，因为整屏缩放依赖 `cqh/cqw`）。
- 后端子包依赖（`apps/server/package.json`）：`express@5`、`socket.io`、`zod`、`pino`、`tsx`、`helmet`、`cors`、**`better-sqlite3`（本地持久化，WAL）**、**`compression`（静态 gzip）**；开发依赖 `@types/better-sqlite3`、`@types/compression` 等。
- 前端子包依赖（`apps/client/package.json`）：`vue@3`、`pinia`、`socket.io-client`、`tailwindcss@4`（`@tailwindcss/vite`）、`lucide-vue-next`、`@tanstack/vue-virtual`（虚拟列表）、`@vueuse/core` + `@vueuse/integrations`（组合式工具，含 `useFocusTrap`）、`nanoid`、`clsx` + `tailwind-merge`（类名合并 `cn()`）、`focus-trap`（弹窗焦点陷阱 peer）。**Toast 为自建组件（`components/common/AppToaster.vue` + `composables/useToasts.ts`）**，不依赖第三方通知库。
- 共享包子包：`zod`（唯一运行时依赖）。
- 已移除依赖（勿回引入）：`perfect-freehand`（轮廓填充渲染与增量同步架构冲突）、`pino-pretty`（改为文件 JSON 日志后不再使用）、`vue-sonner`（Toast 已由自建 AppToaster/useToasts 替换，未来统一走自建方案）。

---

## 项目结构

```text
draw_and_guess/
├── package.json                  # 根工程 scripts（dev/build/start/typecheck/lint/format + test:e2e/test:unit）
├── pnpm-workspace.yaml           # pnpm workspace：apps/* 与 packages/*（勿手改）
├── pnpm-lock.yaml                # 依赖锁文件（勿手改）
├── tsconfig.json                 # 根 TS 严格配置 + 路径别名（@draw-guess/shared / @draw-guess/config / @draw-guess/strings / @/）
├── eslint.config.js              # ESLint 扁平配置（Vue/TS/Node，DOM globals 白名单 + 自有 sfc 惯例规则）
├── .prettierrc.json              # Prettier 格式（无分号/单引号/行宽 100/尾逗号 all）
├── .prettierignore               # 忽略 node_modules/dist/.pi
├── .env.example                  # 部署环境变量示例：HOST/PORT/LOG_LEVEL/LOG_ENABLED/LOG_MAX_FILES（复制为 .env 使用）
├── .env                          # 本地部署覆盖（已被 .gitignore 忽略，不入库）
├── .gitignore                    # 忽略 node_modules/dist/日志/数据库/.env/.pi/.playwright-mcp 等
├── config/                       # 按领域拆分的配置（由 config/index.ts 聚合）
│   ├── app.ts                    # 应用标识/名称版本/协议版本/storageKey/网络与连接参数（限频、宽限、端口、恢复令牌窗口）
│   ├── player.ts                 # 玩家资料：昵称长度、默认昵称、40 个内置 SVG 头像 ID 白名单
│   ├── room.ts                   # 房间默认名、公开性、私密短码长度、允许邀请/暂停、加入策略 joinPolicy
│   ├── game.ts                   # 对局规则：轮数/作画/选词/候选数、提示阈值、分数（基础/速度/顺序/画家）
│   ├── drawing.ts                # 画板：预设色、色正则、粗细区间、填充容差、批次/限频/历史命令与点数预算
│   ├── vocabulary.ts             # 词库来源/路径/校验预算/去重/Provider 标识（扩展点）
│   ├── audio.ts                  # 音效合成 cue（频率序列与时长）与增益
│   ├── settings.ts               # 本地设置（音量/动画/快捷键/发现偏好/自动聚焦）、UI 参数、预设安全短语
├── string/                       # ★唯一 UI 文案表：客户端 strings / 服务端 serverStrings
├── vocabulary/                   # ★唯一权威词库目录：SQLite 数据库（metadata/words 表）
├── vitest.config.ts               # 单测配置：test/unit/**/*.spec.ts、node 环境、复刻 @draw-guess/* 别名
├── test/                          # 自动化测试目录（隔离环境）
│   ├── unit/                      # Vitest 单元/规则测试（test:unit）
│   │   ├── game.deadline.spec.ts  # 假时钟下 submitGuess 截止校验示例
│   │   └── helpers/               # fake-clock.ts / in-memory-repositories.ts / mini-vocabulary.ts
│   └── e2e/                       # Playwright 端到端（test:e2e）
│       ├── playwright.config.ts   # 独立端口(5199)、reuseExistingServer=false、指向 launcher
│       ├── launcher.mts           # 隔离 webServer：临时目录 + fixture 词库 + 前端构建 + 清理/清扫
│       ├── pages/                 # 页面封装（profile/lobby/room/game）
│       ├── fixtures/test-base.ts  # 测试基类（建玩家/连接）
│       └── specs/                 # 01-profile-session / 02-lobby-room-seats / 03-game-drawing / 04-game-guessing / 05-game-lifecycle
│   └── draw_guess_words.db
├── README.md                     # 项目总览、十分钟启动（注意：部分章节已过时，见顶部声明）
├── AGENTS.md                     # 本文件：导读、硬性限制、启动方法、编码/测试/提交流程
│
├── packages/shared/               # 前后端共享协议（无环境依赖，可在 Node/浏览器直接单测）
│   └── src/
│       ├── index.ts               # 聚合出口：re-export 下列四模块（引用路径保持 @draw-guess/shared）
│       ├── events.ts              # 全部 Socket.IO 事件名常量 EVENTS（前后端唯一事件名来源）
│       ├── types.ts               # 领域类型：房间阶段/成员/规则/快照/绘图命令/邀请等 DTO（含 spectating）
│       ├── schemas.ts             # Zod 运行时校验：请求载荷 + 全部版本化服务端推送信封
│       └── pure.ts                # 纯函数：答案规范化、遮罩生成、计分、状态机转换表
│
├── apps/server/                   # 服务端（Express 5 + Socket.IO + Zod + SQLite，权威领域）
│   ├── package.json               # 依赖见「技术栈与运行环境」
│   ├── tsconfig.json              # 继承根配置 + Node 类型
│   ├── data/                      # 运行期生成：SQLite 数据库文件（game.db，已忽略入库，仅保留 .gitkeep）
│   ├── log/                       # 运行期生成：日志文件（app-<秒级时间戳>.log，已忽略入库，仅保留 .gitkeep）
│   └── src/
│       ├── index.ts               # 生产入口：加载 .env（loadEnvFile）、配置校验、日志初始化（LOG_ENABLED/LOG_MAX_FILES）、局域网 IPv4 探测、监听、优雅关闭
│       ├── app.ts                 # HTTP/Socket.IO 装配：端口、compression 静态托管 dist、SPA 回退、连接入口（含建库迁移）；createApplication 可注入 dbFile/clientDist/vocabulary/logger
│       ├── game-service.ts        # 领域服务编排：会话/成员/房间/邀请/猜词/绘图/快照入口（权威裁决）+ 持久化接入
│       ├── round-machine.ts       # 回合流转状态机：开局/选词/作画/结算/暂停/弃权/逐步提示/战报落盘
│       ├── scoring.ts             # 计分纯函数：猜中明细、画家得分（可独立单测）
│       ├── snapshot.ts            # 角色裁剪快照构建：画家/观众视角差异化、strokesOmitted 差分（客户端落后自检后 stateResync 拉全量兜底）
│       ├── rate-limit.ts          # 猜词/绘图滑动窗口限频
│       ├── errors.ts              # GameError / success / failure / RuntimeLogger / SILENT_LOGGER（避免循环依赖）
│       ├── models.ts              # 服务端内存秘密模型（PlayerSecret/RoomSecret/GameSecret/InviteSecret…）
│       ├── runtime.ts             # 统一 Clock/Scheduler/RandomSource（生产实现与测试注入边界）
│       ├── vocabulary/            # 词库 Provider 架构：contract（接口）/normalize（共享纯函数）/sqlite.provider（SQLite 实现）/index（分发入口，loadVocabulary 可传目录）；test-fixture.ts 生成隔离测试词库
│       ├── db/                    # SQLite 持久化：连接（WAL + 事务辅助，setDbFile 供测试注入临时库）/ 版本化迁移（db/index.ts、db/migrate.ts）
│       ├── repositories/          # 仓储接口 + SQLite 实现（player/room/archive，领域层只依赖接口）
│       ├── protocol/binder.ts     # 统一请求绑定：schema 校验、会话限频、幂等缓存、统一 ack
│       └── handlers/              # 按领域分组的事件注册（全部走 binder）
│           ├── session.ts         # 注册/资料/偏好/大厅/状态重同步/ping/断线
│           ├── room.ts            # 公开/私密建房与加入、离房、准备、规则、词库、踢人/移交、邀请
│           ├── game.ts            # 开始/选词/暂停/恢复/提前结束/返回房间
│           ├── chat.ts            # 猜词、预设安全短语
│           └── draw.ts            # 笔画批次/填充/撤销/重做/清空（跳过通用限频）
│
├── apps/client/                   # 客户端（Vue 3 + Pinia + Vite + Tailwind4 + Socket.IO）
│   ├── package.json               # 依赖见「技术栈与运行环境」
│   ├── tsconfig.json              # 继承根配置 + DOM/vite 类型
│   ├── vite.config.ts             # Vite 配置：@draw-guess/config 虚拟公开模块裁剪、/@、@draw-guess/strings 别名、开发代理（/api 与 /socket.io → 5174）；build.outDir 可经 CLIENT_OUT_DIR 覆盖（测试用）
│   ├── index.html                 # 入口 HTML（#app 挂载点，标题/描述由 vite.config 从 strings.ts 注入）
│   └── src/
│       ├── main.ts                # 客户端入口：创建 App 并挂载 #app；仅引入 ./style/index.css（Toast 为自建，无需第三方样式）
│       ├── App.vue                # 根舞台：页面互斥渲染（对局>房间>设置>大厅>资料）、自建 `<AppToaster/>`、邀请横幅、竖屏提示、断线恢复阻断框
│       ├── canvas/                # 画布纯逻辑：直线段渲染、固定 backing size、DPR 无关洪泛填充
│       │   ├── rendering.ts
│       │   ├── viewport.ts
│       │   └── flood-fill.ts
│       ├── style/                 # 全局样式模块目录（由 index.css 聚合导出）
│       │   ├── index.css          # ★主入口：依次导入 tailwindcss 与各分模块样式
│       │   ├── tokens.css         # 设计令牌：@theme（字体、10 语义色、黑色变量、阴影令牌）
│       │   ├── base.css           # 全局 base：reset、表单控件基础状态、舞台外壳与容器单位上下文、全屏
│       │   ├── components.css     # 共享组件类（.dialog-shell/.eyebrow/.eyebrow-light/.round-icon-btn）
│       │   ├── utilities.css      # Tailwind 组合类（.ui-feedback/.hover-tint 等交互修饰类）
│       │   ├── animations.css     # 交互反馈动效、Vue 过渡钩子、关键帧与减弱动画
│       │   └── other.css          # 设备方向（竖屏警告）等未分类规则
│       ├── stores/
│       │   ├── index.ts           # ★Store 统一 Barrel 出口（re-export 领域 stores 与统一 Facade）
│       │   ├── game.ts            # 组合 Facade Store：聚合所有领域 Store，提供向后兼容、单一引用的统一接口 useGameStore()
│       │   ├── profile.ts         # 玩家个人资料 Store（持久化存储与修改）
│       │   ├── settings.ts        # 本地偏好设置 Store（音量/动画/快捷键等）
│       │   ├── session.ts         # 连接与服务端会话 Store（注册、鉴权、在线状态）
│       │   ├── lobby.ts           # 大厅与房间发现 Store（公开房间列表、在线玩家、刷新与加入）
│       │   ├── room.ts            # 房间内生命周期 Store（成员席位、准备、房主权限与规则变动）
│       │   ├── gameplay.ts        # 实时对局业务 Store（回合状态、词语选项、实时猜词流）
│       │   ├── vocabulary.ts      # 词库选择与配置 Store
│       │   ├── socket.ts          # Socket 单例 + 推送事件桥接（HMR dispose）
│       │   ├── request.ts         # 请求封装：timeout+同 requestId 自动重试+ack+错误翻译
│       │   ├── push-protocol.ts   # 主动推送 Zod 解码与脱敏诊断记录
│       │   ├── snapshot-gate.ts   # 房间/对局/回合/版本/画布修订统一门禁
│       │   └── vocabulary-request-context.ts # 词库异步请求上下文与失效控制
│       ├── composables/
│       │   ├── useAudioFeedback.ts # Web Audio 合成提示音（自动播放入口解锁、音量实时读取）
│       │   ├── useGameHud.ts      # 对局 HUD 计算（useTimestamp 驱动）：剩余时间/进度/猜词权限/阶段标签/排行
│       │   ├── useShortcuts.ts    # 画板快捷键：自定义单键切换工具、撤销/重做组合键
│       │   └── useToasts.ts       # 自建 Toast 状态层：队列/去重合并(key=type:text)/超时消失/弹跳事件（小条配色统一走橙色派生）
│       ├── components/
│       │   ├── AppButton.vue      # 统一动作按钮（primary/secondary/danger），内置类与外部类用 cn() 合并
│       │   ├── BaseDialog.vue     # 通用弹窗外壳，v-model:open 控制，焦点陷阱用 useFocusTrap + Esc 关闭 + 多弹窗顶层仲裁
│       │   ├── ConfirmDialog.vue  # 通用确认弹窗（复用 BaseDialog，v-model:open 控制，红色 danger 确认钮）
│       │   ├── AvatarImage.vue    # 内置 SVG 头像统一安全展示（只接收白名单编号）
│       │   ├── AvatarPickerDialog.vue # 40 个 SVG 头像选择模态框（v-model:open）
│       │   ├── ActionPopover.vue  # 悬浮操作面板（聊天快捷互动用）
│       │   ├── AppToaster.vue     # 自建 Toast 堆栈渲染：画框内右上角、白色长条+橙色小条+加粗文字、样式闭环在组件内、点击消失、淡入淡出、去重左弹跳（WAAPI）
│       │   ├── GameCanvas.vue     # 高 DPI 实时画板：直线段描边增量绘制、橡皮擦/destination-out、洪泛填充、滚轮线宽（v-model:width）
│       │   ├── game/              # 对局组件（提供 index.ts）：GameHud / ChatPanel / DrawingToolbar / PhaseOverlay / OverlayCard / ScoreStrip
│       │   ├── room/              # 房间组件（提供 index.ts）：SeatGrid / RuleSummary / RuleRow / RulesDialog / InviteDialog / VocabularyDialog
│       │   ├── lobby/             # 大厅组件（提供 index.ts）：CreateRoomDialog / JoinPrivateDialog
│       │   ├── common/            # 通用原语组件（提供 index.ts）：AppInput / SearchInput / DataTable / DifficultyStars / MultiSelectPopover / IconButton / ToolButton / RoundIconButton / SectionHeader / SideNav / SettingSliderRow / SettingSwitchRow / RuleSliderField / RuleToggleField
│       │   └── settings/          # 设置页组件（提供 index.ts）：AudioTab / ShortcutsTab / AccessibilityTab / DiagnosticsTab
│       ├── views/
│       │   ├── ProfileView.vue    # 资料确认页（随机昵称/内置 SVG 头像选择，无上传）
│       │   ├── LobbyView.vue      # 在线大厅（公开列表/公私建房/私密短码加入/可发现玩家）
│       │   ├── RoomView.vue       # 房间等待（席位/准备/私密码/词库/规则/邀请/退出）
│       │   ├── GameView.vue       # 对局骨架（HUD/画布/聊天/工具栏/各阶段遮罩/结算；useFullscreen 全屏）
│       │   └── SettingsView.vue   # 设置页（声音/显示/快捷键/资料诊断）
│       └── utils/
│           ├── avatar.ts          # Vite SVG 静态资源白名单编号到 URL 映射
│           ├── cn.ts              # 类名合并：clsx + tailwind-merge（注册 @theme 自定义语义色）
│           └── createUuid.ts      # 多环境 UUID：nanoid 十六进制 + RFC 4122 v4 位点（兼容服务端 z.string().uuid()）
```

> **关于客户端样式**：`apps/client/src/style/` 采用模块化分层管理，由 `index.css` 统一聚合导入各模块（`tokens.css` 设计令牌、`base.css` 全局 reset 与舞台上下文、`components.css` 共享组件类、`utilities.css` Tailwind 组合类、`animations.css` 交互动效与过渡钩子、`other.css` 设备方向规则）。Toast 专用样式收敛于 `AppToaster.vue` 内封闭维护。**组件/页面自身视觉样式一律写成 Vue 模板内的行内 Tailwind 类**（依赖 `cqh/cqw` 容器单位 + 语义色 `bg-navy`/`text-muted`/`border-line` 等）。不要写共享层之外的原生 CSS 类选择器。

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

- 终端会醒目输出主机访问地址、一个或多个 `http://局域网IP:5174` 候选地址、端口与加入说明（横幅保留在控制台；业务日志只在日志文件）。
- 其它玩家连接**同一局域网**后在浏览器输入上述地址即可。
- 常见问题：IP/端口与终端输出不一致、设备不在同一网段、防火墙未放行 Node.js 专用网络、版本不兼容（刷新/清缓存）。
- 部署参数可覆盖：`PORT=5180 pnpm start`、`HOST=0.0.0.0`、`LOG_LEVEL=debug`、`LOG_ENABLED=false`（关闭则完全不创建日志记录器、不写日志文件）、`LOG_MAX_FILES=3`（日志文件保留上限）。服务启动时会自动加载项目根目录 `.env`（复制 `.env.example` 即可）；进程已有环境变量优先级高于 `.env`。环境变量**不会**覆盖游戏规则。

### 其它命令（全部通过根 `package.json` scripts）

```bash
pnpm typecheck     # 全 workspace 严格类型检查（vue-tsc + tsc）
pnpm lint          # ESLint（--max-warnings=0，无任何警告才通过）
pnpm format        # Prettier 写入
pnpm format:check  # 仅检查格式
```

> 各子包也带独立脚本：`apps/client` 含 `dev/build/typecheck`；`apps/server` 含 `dev/start/typecheck`；`packages/shared` 含 `typecheck`。根工程提供 `test:unit` 与 `test:e2e`。

---

## 架构与实现约定

- **依赖方向单向**：`client → shared/config`、`server → shared/config`、`shared → 无运行时依赖`。客户端与服务端都通过 `@draw-guess/shared` 引用协议层；不改动这一分层。
- **服务端权威裁决**：答案、计分、阶段、计时、绘画资格只能由服务端判定；客户端永远不能上传「裁决结果」。客户端只发带 `requestId` 的幂等请求经统一 `ack` 返回。
- **角色裁剪快照**（`snapshot.ts`）：所有公开数据结构按观看者角色生成；服务端秘密字段（答案、恢复令牌、候选词、内部计时器、请求缓存）绝不进快照/事件。私密房短码仅裁剪给当前房主；大厅玩家资料不回显私密房 UUID。
- **统一请求绑定**（`protocol/binder.ts`）：schema 校验、会话限频、幂等缓存、统一 `ack`。非法阶段/角色/序号/频率由 `binder.ts` 与领域服务拒绝。
- **幂等传输重试**：普通客户端请求发生超时/断线等传输故障时，以同一 `requestId` 自动重试；服务端只缓存成功 ack，并让并发重复请求共享同一个执行 Promise。高频 `quiet` 绘图请求默认不重试。
- **版本化主动推送**：服务端主动事件一律使用 `createServerPush()` 包装；客户端先经 `SERVER_PUSH_SCHEMAS` 完整 Zod 解码，再通过 `snapshot-gate.ts` 校验房间、对局、回合、`stateVersion` 与 `drawingRevision`。非法推送只记录脱敏诊断，并以冷却窗口触发一次全量重同步。
- **统一运行时依赖**：`GameService`、`RoundMachine`、`rate-limit.ts`、`protocol/binder.ts` 的领域时间、定时器与随机数统一来自 `runtime.ts` 的 `Clock` / `Scheduler` / `RandomSource`；这些领域文件禁止直接调用系统时间、随机数或定时器，ESLint 会阻止回退。
- **回合状态机**：`round-machine.ts` + `packages/shared/src/pure.ts` 的 `LEGAL_PHASES` 白名单；非法转换由服务端拒绝（`INVALID_TRANSITION`）。
- **计分统一口径**：`scoring.ts` 与 `pure.ts` 的 `calculateGuessScore` 使用同一规则（基础 + 速度 + 顺序；两人局禁用顺序奖）。
- **画布增量绘制**（`GameCanvas.vue`）：坐标一律**归一化 0～1**；绘图序号单调递增，服务端拒绝旧包；橡皮擦/填充只传「点击位置 + 颜色」，不传像素，客户端按同一历史重放；`lastSequence` 用于重连续接。**渲染为直线段描边（`stroke()` + `round` 线帽），增量只补画新增段（fromIndex）**。
- **持久化分层**：`db/` 管连接与迁移（`runMigrations` 幂等）；`repositories/` 提供 `PlayerRepository`/`RoomRepository`/`ArchiveRepository` 接口 + SQLite 实现，领域层（`game-service.ts`）只依赖接口。游戏结束时经 `finishGame → persistGameResult` 落盘战报；重启时 `recoverOnStartup` 标记玩家断线（身份可宽限恢复）并作废进行中房间。
- **配置单一来源**：业务规则只写在 `config/` + `config/index.ts` 聚合；UI 文案只写在 `string/`；词库只写在 `vocabulary/`（SQLite，经 Provider 加载）；部署覆盖只写在 `.env`（HOST/PORT/LOG_LEVEL/LOG_ENABLED/LOG_MAX_FILES）。

---

## 编码规范

- **类型**：`strict` + `noUncheckedIndexedAccess`（根 `tsconfig.json`）。避免 `any`（ESLint `@typescript-eslint/no-explicit-any: error`）；未使用变量加 `_` 前缀以通过 `no-unused-vars`。
- **命名**：组件/视图 `PascalCase.vue`；TS 文件 `camelCase.ts`；事件名用 `EVENTS` 常量；领域模型用「Secret 后缀」标记服务端秘密对象。
- **格式**：Prettier（无分号、单引号、行宽 100、尾逗号 all）。编码前先 `pnpm format`。
- **注释**：中文注释，解释「为什么」而非复述代码；关键算法 / 边界处理要求注释（参考 `GameCanvas.vue`、`pure.ts`、`snapshot.ts`、`game-service.ts` 的注释质量）。
- **错误处理**：服务端用 `GameError` + `errors.ts` 统一错误码与中文文案；客户端经 `request.ts` 统一超时 + ack + 错误翻译 + `quiet` 静默降级。
- **日志**：由 `.env` 的 `LOG_ENABLED` 控制（默认 true）：关闭时完全不创建日志记录器、不写日志文件（零内存开销）；开启时服务端用 `pino`（默认结构化 JSON，无 ANSI 色码），**每次启动写一个新的日志文件**（`apps/server/log/app-YYYY-MM-DD-HH-mm-ss.log`，精确到秒），目录最多保留最近 `LOG_MAX_FILES` 条（默认 10，超出删除最老）；控制台只保留启动横幅，不输出业务日志；级别经 `LOG_LEVEL` 控制。
- **UI 文案**：**严禁在组件/业务代码里硬编码展示字符**；一律从 `string/` 的 `strings`（客户端）或 `serverStrings`（服务端）导入。
- **样式**：组件/页面视觉一律用**行内 Tailwind 类**写在 Vue 模板；重复长串收敛到共享组件（`AppButton`/`BaseDialog`/`ConfirmDialog`/`IconButton`/`ToolButton`/`OverlayCard`/`RuleRow`/`RoundIconButton`）或 `style/` 共享模块类。不要写共享层之外的原生 CSS 类选择器。语义色用 `@theme` 令牌；容器单位 `cqh/cqw` 用任意值（内部空格用 `_`，如 `shadow-[0_1.2cqh_5cqh_#0009]`）。
- **配色（≤10 色）**：全应用自定义颜色**只取自 `style/tokens.css` `@theme` 里固定的 10 个语义变量**（`navy`/`muted`/`line`/`paper`/`blue`/`sky`/`yellow`/`green`/`red`/`purple`），`config/room.ts` 的 `seatColors` 取其中 6 个；`#fff`/`#000`（及黑色变量 `--color-black`）与透明度衍生（如 `bg-blue/10`）不计入调色板。**禁止**在组件/模板中硬编码任意 HEX（`bg-[#...]`/`text-[#...]`）或 Tailwind 默认色阶（`slate-*` 等）。`config/drawing.ts` 的 `colors` 是**画板工具色**（画家可选画笔色），属功能性工具配置，非 UI 主题色，不纳入 10 色限制。
- **动画一致性**：按钮/卡片交互动效统一为 160ms（复用 `.ui-feedback` / `.hover-tint` 共享类，或依赖 `@layer base` 中 `.game-stage button` 的全局过渡）；同类控件应复用同一动画，避免各自定制造成手感不一。
- **布局规范（外 Grid 骨架，内 Flex 排版）**：
  - **Grid 宏观骨架与二维矩阵**：主页面二维行列骨架（`ProfileView`/`LobbyView`/`RoomView`/`GameView`/`SettingsView`）、二维固定席位/头像/卡片矩阵（`SeatGrid` 2×3、`AvatarPickerDialog` 8×5、`ShortcutsTab` 3 列、`RulesDialog` 3 列表单、`ChatPanel` 3 列表情）、三列对称顶栏（`StageHeader` `grid grid-cols-[1fr_auto_1fr]`）；
  - **Flex 微观流式排版**：一维线性排列（水平按钮内容 `inline-flex items-center gap-[...]`、导航 Tab、工具栏工具条、输入框组合；垂直消息流 `flex flex-col`、规则行列表、Toast 堆叠）；
  - **单元素绝对居中**：严格使用 `grid place-items-center`（如圆形头像底座 `AvatarImage`、独立图标按钮 `IconButton`/`RoundIconButton`、徽章 `HostCrownBadge`、模态遮罩居中），杜绝单元素使用 `flex items-center justify-center` 导致子项伸缩变形；
  - **保留专用布局**：弹窗/画布状态遮罩（`BaseDialog`/`ConfirmDialog`/`OverlayCard`/`PhaseOverlay`）与 Toast 悬浮层（`AppToaster`）保留 `absolute`/`fixed` 定位；吸顶表头保留 `sticky`；数据表格（`DataTable.vue`）保留原生 `table`/`table-fixed`；
  - **反模式禁令**：严禁单子项容器使用 `grid-cols-1` 伪网格；严禁单元素容器使用无意义的 `flex`；严禁一维简单按钮使用 Grid；严禁二维页面大框架采用多层嵌套 flex。
- **字体与排印规范（统一字号标尺、二元字重、统一字体族）**：
  - **字体家族统管**：字体族集中在 `apps/client/src/style/tokens.css` 的 `@theme` 中声明 `--font-sans`（默认无衬线系统字体）与 `--font-mono`（等宽数字/房间码/快捷键字体），全站经 Tailwind `font-sans` / `font-mono` 类统一调用，严禁在模板中临时编写私有 `font-[...]` 字体栈；
  - **偶数字号标尺（`text-fs-*`）**：全站字号均为偶数，集中定义于 `tokens.css`（并在 `apps/client/src/utils/cn.ts` 注册 `CUSTOM_FONT_SIZES` 参与 TailwindMerge 冲突消解）。底层采用相对单位 `em` 随舞台等比缩放（基准 1em = 16px @ 1080p）：
    - `text-fs-10` (0.625em)：徽章、辅助微标签、工具条小字、倒计时小角标；
    - `text-fs-12` (0.75em)：表格单元格、辅助说明段、次要标签、表头眉题、状态胶囊；
    - `text-fs-14` (0.875em)：弹窗正文、表单 label、次级操作按钮、Toast 提示内容；
    - `text-fs-16` (1em)：标准正文基准、输入框文本、通用按钮文字；
    - `text-fs-18` (1.125em)：卡片标题、弹窗关闭按钮、小标题、列表操作项；
    - `text-fs-20` (1.25em)：三级标题（h3）、选词卡片大字、私密房间码输入框、设置页顶栏大字；
    - `text-fs-24` (1.5em)：二级标题（h2）、顶栏回合与倒计时大数字、画家昵称高亮、题目答案展示；
    - `text-fs-28` (1.75em)：一级主标题（h1）、主页面弹窗标题、资料卡问号大标；
    - `text-fs-36` (2.25em)：品牌主展示区副标/展示标题；
    - `text-fs-48` (3em)：首页品牌超大主标；
    - `text-fs-96` (6em)：全屏开局倒计时特大数字；
    - **禁止硬编码**：严禁在组件内书写 `text-[0.68em]`、`text-[1.85cqh]` 等任意数值的临时字号；
  - **二元字重规范（非 normal 即 bold）**：全项目字重仅允许两种状态：常规（默认或 `font-normal`，400）与加粗（`font-bold`，700）。**严禁**使用 `font-semibold` (600)、`font-extrabold` (800)、`font-black` (900) 或 `font-[1000]`。所有历史极端字重均收敛为 `font-bold`，所有次要正文为常规字重，确保视觉层级分明、渲染抗锯齿细腻、不同操作系统字体表现一致。
- **Vue 3.4+ `defineModel()` 统一双向绑定规范**：
  - 表单组件值绑定（`AppInput` / `SearchInput` 的 `modelValue`、`RuleSliderField` / `SettingSliderRow` 的数字值、`RuleToggleField` / `SettingSwitchRow` 的布尔值）；
  - 模态弹窗显隐控制统一命名为 `open`（`v-model:open="isOpen"`），所有弹窗组件（`BaseDialog` / `ConfirmDialog` / `AvatarPickerDialog` / `RulesDialog` / `VocabularyDialog` / `InviteDialog` / `CreateRoomDialog` / `JoinPrivateDialog`）均遵循该标准宏接口；
  - 工具参数绑定（`DrawingToolbar` 与 `GameCanvas` 的 `v-model:width="strokeWidth"`）；
  - **严禁**使用已淘汰的手写 `props: { modelValue }` + `emit('update:modelValue')` 样板代码。
- **统一 Barrel 导出（`index.ts`）与模块化消费**：
  - 各组件子目录（`components/common`、`components/lobby`、`components/room`、`components/game`、`components/settings`）均维护单一 `index.ts` 集中导出；
  - 视图与组件引用时优先通过目录 Barrel 导入（如 `import { AppButton, AppInput } from '@/components/common'`），提高引用整洁度与重构灵活性；
  - `stores/` 提供 `index.ts` 导出所有领域 store 及组合 facade。
- **Pinia Store 领域解耦与 Facade 架构**：
  - 状态按领域边界拆分为微 store：`useProfileStore`（资料/头像）、`useSettingsStore`（本地偏好）、`useSessionStore`（连接与会话鉴权）、`useLobbyStore`（大厅房间与玩家）、`useRoomStore`（房间生命周期与席位）、`useGameplayStore`（实时对局与消息）、`useVocabularyStore`（词库配置）；
  - `stores/game.ts` 保留作为统一 Facade（`useGameStore()`），聚合所有子 store 的 state、getters 与 actions，提供向后兼容、无破坏性的单一入口，同时允许新代码按需细粒度注入微 store；
  - 业务通信严格通过 store actions，禁止在组件中直接跨层调用底层 socket 发送未经校验的裸事件。
- **Vue 模板原生 `:class` 对象规范**：
  - Vue SFC 模板中条件样式严格使用 Vue 原生语法（例如 `:class="{ 'text-muted': isDisabled }"` 或数组形式）；
  - **严禁**在模板表达式中直接调用 `clsx(...)` 或 `cn(...)`；
  - `cn()`（`clsx + tailwind-merge`）仅允许在组件根节点与外部类名透传/覆盖合并时（如 `<div :class="cn('base-class', props.class)">`）在 `<script setup>` 或受限属性绑定中调用。
- **表单输入原语规范（`AppInput` / `SearchInput`）**：
  - 全站表单输入框、房间短码、玩家昵称、搜索框一律使用 `AppInput.vue` 或 `SearchInput.vue` 原语组件；
  - 集中管理输入框边框色、圆角、背景色、焦点发光环（focus ring）、禁用态与字号；严禁在视图或业务弹窗中裸写 `<input>` 及私有边框/焦点类。
- **无深浅色主题切换约束**：
  - 本项目为固定纸墨手绘视觉风格（米白/纸张底色 + 深蓝/藏青字 + 粗线条边框），**不支持且未来绝不引入明暗/深浅色主题切换（No Dark Mode）**；
  - 禁止引入 `dark:` 前缀类或相关检测代码；所有颜色严格走 `@theme` 10 个语义色。

---

## 测试规范

> **测试框架已登记**：分两层——① 单元/规则测试用 **Vitest（v5，根 devDependency）**，入口 `test/unit/**/*.spec.ts`，运行 `pnpm test:unit`；② 端到端用 **@playwright/test（已锁定）**，入口 `test/e2e/`，运行 `pnpm test:e2e`。二者均为**隔离环境**：单测默认使用内存仓储 + 假运行时；SQLite 用例只写系统临时目录；E2E 每次生成唯一临时目录（临时 game.db + 词库 fixture + 前端构建产物），以独立端口监听，`reuseExistingServer=false`，**不连接/不停真实 5174 服务、不改真实数据库与词库**。

- **单元测试（`pnpm test:unit`，Vitest）**：`vitest.config.ts` 通过 `resolve.alias` 复刻 `@draw-guess/*` 与 `@/` 路径。内存仓储与完整假运行时见 `test/unit/helpers/`；`fake-clock.ts` 同时控制 Clock/Scheduler/RandomSource，可同步推进完整对局。`persistence.spec.ts` 使用系统临时 SQLite 并在每例后关闭、删除；`documentation.consistency.spec.ts` 校验 AGENTS 关键路径与根质量命令存在性。单元测试已纳入 `pnpm typecheck`。
- **端到端测试（`pnpm test:e2e`，Playwright）**：launcher 承担 webServer（构建前端 → 生成 fixture → 建库 → 监听）。默认词库 fixture 含 5,000 词，用于虚拟表格压力验收；兼容性项目覆盖 Chromium DPR 1/1.5/2、Firefox DPR 2、触屏输入和后台标签页恢复。页面封装在 `test/e2e/pages/`，fixtures 在 `test/e2e/fixtures/test-base.ts`，spec 在 `test/e2e/specs/`。
- 可作为将来单测目标的纯函数（注释已注明「可独立单测」）：`packages/shared/src/pure.ts`、`apps/server/src/scoring.ts`、`apps/server/src/snapshot.ts`；仓储接口（`repositories/`）可注入内存实现测试。
- **修改代码后的最低验证要求**：依次运行
  ```bash
  pnpm format
  pnpm lint         # --max-warnings=0，无任何警告
  pnpm typecheck
  pnpm build
  ```
  涉及规则/状态机/绘图/持久化等关键逻辑时，额外运行 `pnpm test:unit` 与 `pnpm test:e2e`（隔离环境，不污染真实数据）。
- 涉及关键逻辑（状态机、计分、快照裁剪、画布同步、限频、私有房间访问控制、持久化落盘）时，建议额外做人工/浏览器端到端验证（可用 Playwright MCP 等驱动真实浏览器）。
- **Windows 注意**：Playwright 结束 webServer 时用 `taskkill /T /F` 强杀进程树，launcher 收不到 SIGTERM，因此「先前运行」的临时目录由**下一次运行启动时的清扫**回收（`launcher.mts` 会清除超过 5 分钟的旧 `draw-guess-e2e-*` 目录）。

---

## 修改规则与工作流程

### 修改前应检查

1. 通读本文件「约束与禁止事项」，确认改动不违反硬性限制。
2. 定位改动归属：业务规则 → `config/`；协议/事件 → `packages/shared/`；服务端权威领域 → `apps/server/src/`；客户端视图 → `apps/client/src/`。
3. 若改动会改变公共接口 / 事件名 / DTO，先更新 `types.ts`/`schemas.ts`/`events.ts` 并同步前后端；`protocolVersion` 变更属不兼容变更，必须与客户端同步 `+1`。
4. 涉及持久化/日志/部署的改动，先确认 `.env`、`db/migrate.ts`、`repositories/`、`index.ts` 的现状与约束。

### 各类改动的流程

- **新增功能**：
  1. 新增请求事件：`packages/shared/src/events.ts`（事件名）→ `schemas.ts`（校验）→ `game-service.ts` 或对应 handler → `handlers/*.ts` 注册 → `stores/game.ts` 客户端方法。
  2. 业务规则参数先加入 `config/` 对应文件，由 `config/index.ts` 聚合。
  3. UI 文案加入 `string/`。
  4. 完成后跑「最低验证命令」。
- **修复缺陷**：先复现、明确根因（多在状态机 / 快照裁剪 / 同步兜底 / 画布渲染），改最小范围，再验证相关模块与相邻功能。
- **调整接口 / DTO**：同步 `packages/shared` 的 `types.ts` + `schemas.ts`，并检查 `snapshot.ts` 是否需按新字段裁剪；协议版本不兼容时 `protocolVersion +1`。
- **修改依赖**：只在对应子包 `package.json` 添加，**不要**用 `-g` 全局安装；改后运行 `pnpm install` 更新锁文件并跑类型检查。移除依赖时同步清理 `package.json`/`pnpm-lock.yaml` 并检查引用。
- **修改持久化**（新增表/字段）：改 `db/migrate.ts` 追加迁移（勿改已应用的旧迁移）；仓储接口/实现同步；注意只持久化低频关键态。

### 修改完成后必须执行

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm build
```

---

## 约束与禁止事项

> 这些是**明确不允许或强烈不建议**的改动；违背会导致安全问题、无法联机或验收失败。

1. **架构与权威性**
   - 服务端必须保持**权威裁决**：答案、计分、阶段、计时、绘画资格只能由服务端判定；客户端永远不能上传「裁决结果」。
   - 服务端**不把业务日志输出到控制台**（避免 Windows 控制台 GBK 解码 UTF-8 中文乱码），每次启动写一个新日志文件（`apps/server/log/app-<秒级时间戳>.log`），保留条数由 `LOG_MAX_FILES` 控制（默认 10）。持久化边界固定如下，**禁止擅自扩大**：
     - ✅ 允许落盘：玩家身份/恢复令牌/偏好（`players`）、房间配置与成员席位（`rooms`/`room_members`）、完成局战报（`game_archive`/`game_results`/`rounds`）；
     - ❌ 禁止落盘：画布笔画、聊天消息、内部计时器、幂等请求缓存、限频时间窗等高频瞬态；
     - 数据库经 `db/migrate.ts` 版本化迁移建表，仓储接口在 `repositories/`，领域层只依赖接口；服务重启时 `recoverOnStartup` 标记玩家断线（身份可宽限恢复）并作废进行中房间。
   - 公开房必须进入大厅列表；私密房必须从大厅隐藏，短码只能由服务端安全随机生成并限频校验；禁止客户端自选弱码、自定义密码、邀请链接或二维码。
2. **隐私与安全边界**
   - 带 `Secret` 后缀的服务端数据（恢复令牌、候选词、内部计时器、请求缓存）**绝不**原样出现在任何快照/事件中；一律经 `snapshot.ts` 裁剪。
   - 客户端请求必须带 `requestId`（幂等）与统一 `ack`；非法阶段/角色/序号/频率由 `binder.ts` 与领域服务拒绝。
   - 头像只允许 `config/player.ts` 白名单中的内置 SVG 编号；**禁止上传图片、任意 URL、data URI、SVG 正文、粘贴或拖放头像**。
3. **词库与内容**
   - `vocabulary/draw_guess_words.db` 是唯一词库来源（SQLite）：`metadata` 表存 version/updated_at/category_enum/difficulty_enum/time_limit_enum/score_weight_enum/default_time_limit/default_score_weight；`words` 表词条含 id/text/**category**（单词条仅一个分类）/difficulty/enabled/time_limit/score_weight/aliases（JSON）。**分类必须 ⊆ category_enum**、difficulty 必须在合法区间、enabled=0 词条不进入候选池；修改后需重启服务，异常数据以中文错误阻止启动。
   - **猜词提示使用词条分类**：结构化提示揭示的是 `category` 字段（单条），而非旧版 `hint` 列表；词库已不再包含 `type/hint/tags/lang` 字段。
   - 猜词判定固定用 `normalizeAnswer`（NFKC + 去空白 + 折叠空白 + 忽略拉丁大小写），不要在别处另写一套比较。
4. **配置治理**
   - 业务规则**只允许**写在 `config/` 目录 + `config/index.ts` 聚合；环境变量仅覆盖 `HOST / PORT / LOG_LEVEL / LOG_ENABLED / LOG_MAX_FILES`，禁止环境变量覆盖游戏规则。
   - UI 文案**只允许**写在 `string/`，组件与业务代码严禁硬编码展示字符。
   - 不要把配置明文写死进业务代码（应用名、版本、协议版本等集中在 `config/app.ts`）。
5. **联机与部署**
   - 服务监听默认 `0.0.0.0`；前端构建产物托管与 Socket.IO 必须在**同一 Node 服务**（端口分离仅限开发代理）。
   - 服务**不要开放到公网**；若主机被其它设备访问，需保证防火墙放行专用网络并提示同一网段。
   - `protocolVersion` 变更属不兼容变更，必须与客户端同步 `+1`。
6. **画布与体验**
   - 坐标一律**归一化 0～1**；绘图序号必须单调递增，服务端拒绝旧包。
   - 橡皮擦/填充仍需保持「只传点击位置与颜色，不传像素」的约束（客户端按同一历史重放）。
   - **渲染模型固定为直线段描边增量同步**；不要引入轮廓填充型平滑库（曾导致白边/闪烁/空心缺陷，已回退）。
   - 动画化/教学页不在首版范围（新增需另行评审）。
7. **工程约束**
   - 提交前必须通过：`pnpm format` → `pnpm lint`（--max-warnings=0）→ `pnpm typecheck` → `pnpm build`。
   - 目录职责保持现状：shared（协议/纯函数）、server（权威领域）、client（视图）；不要在 client 中裁决游戏逻辑。
   - **不要**新建分片 CSS 文件；组件/页面样式一律行内 Tailwind，重复长串收敛到共享组件或 `@layer components` 共享类。
   - **不要**手改 `pnpm-lock.yaml`、`pnpm-workspace.yaml`；**不要**回滚已应用的 `db/migrate.ts` 迁移（新变更只能追加新迁移）。

---

## 配置、安全与敏感信息

- **环境变量**：仅 `.env.example` 中的 `HOST / PORT / LOG_LEVEL / LOG_ENABLED / LOG_MAX_FILES` 可覆盖部署参数；游戏规则一律改 `config/`。`.env` 已被 `.gitignore` 忽略，不入库。
- **密钥 / 凭据**：仓库中**不包含**任何真实密钥、Token、密码或个人信息。临时身份恢复令牌由服务端内存生成、仅当前进程有效、只存于内存与客户端 `localStorage`（同时有选择地落盘到 `players.token` 以支持跨重启宽限恢复；均非公开快照字段）。
- **本地存储**：浏览器仅保存昵称、内置头像编号、本地设置与短期恢复令牌（见 `config/app.ts` 的 `storageKey`/`settingsStorageKey`）。
- **敏感信息纪律**：禁止将真实密钥、Token、密码、私有地址或任何个人信息写入仓库、提交日志或本文件。`.gitignore` 已忽略 `.env`、`*.local`、日志与数据库文件。
- **对外最小公开**：前端经 Vite 虚拟模块仅打包 `PUBLIC_CONFIG`；`/api/info` 也只返回同一公开子集，避免内部限频与清理策略泄露。

---

## 提交与协作规范

- **提交信息**（从 `git log` 可确认的既有规范）：采用 Conventional Commits 格式：
  `type(scope)：subject`，其中 `type` 为 `feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert` 之一，`scope` 为影响模块（可选），`subject` 用**中文**、且不超过 50 字、不以句号结尾。需要补充说明时加空行写 `body` 说明动机与上下文。
  示例（取自近期提交）：`fix(画布)：回退 perfect-freehand 轮廓渲染，彻底修复白边/闪烁/空心`、`feat(server)：日志开关与保留条数改为 .env 配置并使其真正生效`、`feat(server)：引入 SQLite 持久化并重构持久化层`。
- **分支与 CI**：实际工作分支以 `git branch --show-current` 为准，不在文档中写死当前分支。`.github/workflows/quality.yml` 在 push/PR 上执行格式、Lint、类型、单测、构建及 Chromium/Firefox E2E。
- **协作约定**：遵守「修改完成后必须执行」的命令，保持一次提交聚焦一个改动点，涉及协议/接口变更时同步前后端。

## AI 代理操作指南

- **优先阅读**：本 `AGENTS.md` → `README.md`（注意其部分章节过时）→ 目标模块对应文件。改动前先读相关文件头部注释（这些注释通常写明设计意图与边界）。
- **修改范围控制**：只改当前任务相关的文件；不要顺手格式化无关文件、不要改动 `pnpm-lock.yaml`、`pnpm-workspace.yaml`、`.pi/`、`dist/`、`node_modules/`、`.env`。
- **如何验证修改正确**：改完运行 `pnpm format && pnpm lint && pnpm typecheck && pnpm build`；涉及界面/流程改动可用浏览器（含 Playwright MCP）端到端验证。
- **遇到不确定事项**：
  - 以**代码与当前配置为准**，不被过时的 README/文档带偏；冲突时向用户确认。
  - 涉及「约束与禁止事项」里明确禁止/限制的改动时，先向用户说明理由并获得确认，不要擅自扩大持久化边界、改变画布渲染模型、引入图片头像、公网暴露或客户端裁决。
  - 找不到依据的规范（如 PR/CI 约定、测试框架）一律标「待确认」，不要自行编造。
- **快速定位速查**：

| 想改什么                       | 去哪个文件                                                                                                                               |
| ------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------- |
| 应用名/版本/端口/协议/限频参数 | `config/app.ts`（经 `config/index.ts` 聚合）                                                                                             |
| 对局轮数/时间/分数/提示        | `config/game.ts`                                                                                                                         |
| 画板颜色/粗细/批次/历史上限    | `config/drawing.ts`                                                                                                                      |
| 词库内容                       | `vocabulary/draw_guess_words.db`（SQLite；改后重启服务）                                                                                 |
| 新增词库来源                   | `apps/server/src/vocabulary/` 实现 VocabularyProvider → `config/vocabulary.ts` 切 provider                                               |     |
| 新增一个请求事件               | `packages/shared/src/events.ts` → `schemas.ts` → `game-service.ts` 或对应 `handler` → `handlers/*.ts` 注册 → `stores/game.ts` 客户端方法 |
| 回合流转/阶段                  | `apps/server/src/round-machine.ts`                                                                                                       |
| 计分规则                       | `apps/server/src/scoring.ts`                                                                                                             |
| 快照裁剪/隐私边界              | `apps/server/src/snapshot.ts`                                                                                                            |
| SQLite 建表/迁移               | `apps/server/src/db/migrate.ts`（新变更追加新迁移）                                                                                      |
| 持久化仓储（玩家/房间/战报）   | `apps/server/src/repositories/`                                                                                                          |
| 日志开关/保留条数              | `.env`（`LOG_ENABLED`/`LOG_MAX_FILES`）→ `config/index.ts` `getDeploymentConfig` → `apps/server/src/index.ts`                            |
| 画布渲染/增量绘制              | `apps/client/src/components/GameCanvas.vue`（直线段描边，勿引入轮廓填充平滑库）                                                          |
| 全局样式 / Tailwind 令牌       | `apps/client/src/style/index.css`                                                                                                        |
| 类名合并 cn()                  | `apps/client/src/utils/cn.ts`                                                                                                            |

---

以「服务端权威 + 角色裁剪快照 + 幂等 ack + 增量绘图 + 低频持久化」为核心原则开发。除非需求/清单明确要求且经得起「约束与禁止事项」核对，否则不要擅自扩大持久化边界、改变画布渲染模型、引入图片头像、公网暴露或客户端裁决。
