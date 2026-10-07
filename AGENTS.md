# AGENTS.md

> 本文件是所有后续开发（人工或 AI）的**第一入口**。下列内容以**当前代码为准**；原始需求文档已删除，若与本文件或代码冲突，一律以代码与本文件为准。
> 仓库内其它文档：`README.md`（项目总览/十分钟启动）、`CONTEXT.md`（领域词表）、`docs/README.md`（文档地图：专题文档 / ADR / 工程技能配置）、`vocabulary/`（SQLite 词库目录）。
> `README.md` 的依赖清单、组件目录、样式分层、持久化与版本章节已按当前代码校正；两份文档与本文件的一致性由 `test/unit/documentation.consistency.spec.ts` 交叉校验。

---

## 项目概述

「你画我猜 / draw-and-guess」：基于 **Vue 3 + TypeScript + Socket.IO + Express** 的 2～6 人实时派对游戏。

- **服务端权威**：身份、房间、阶段、答案、计时、绘画资格与分数全部由服务端裁决；客户端只发操作请求，结果经「角色裁剪快照」回写。
- **公开 / 私密房间**：公开房进入大厅列表；私密房不公开，只能通过服务端生成的短码或定向邀请加入；不支持自定义密码、邀请链接或二维码。房间容量固定为 **6 人**（`PLAYER_PROTOCOL_LIMITS.maxPlayers`），房主不可调整；开局后不可加入——公开房、私密短码与定向邀请三条路径一律被拒，大厅与房间内的加入入口置灰显示「游戏中」。
- **玩法模式（建房时选定，房间内不可改）**：**经典模式**轮流当画家、一轮一题；**接龙模式**下 N 名玩家并行开出 N 条链，每条链固定 4 步「画 → 猜 → 画 → 猜」，四步走完后按链发起人席位顺序逐条复盘（每半场「重播 → 停顿 → 揭晓」，每链 24 秒）并对「初始词与最终答案是否匹配」投票（固定 10 秒、无弃权、赞同严格多于反对才通过，通过后该链每名参与者得「赞同票数 × 10」分）。接龙开局门槛为在线可玩 ≥ 4 人（`RELAY_MIN_PLAYERS`）且全员准备；玩家只能看到自己本棒所需的内容，作答与聊天是两条独立通道（见 `docs/adr/0058-relay-mode-authoritative-flow-and-reuse.md`）。
- **内存态 + 低频持久化**：房间、成员席位、画布笔画、聊天消息、计时器与对局实时状态全部在内存，重启即清空；仅**玩家短期身份**（恢复令牌/资料/偏好）和**完成局战报**经 **SQLite（better-sqlite3，WAL）** 落盘：重启后身份可凭令牌在宽限内恢复到大厅，历史战报可查。数据库文件位于 `apps/server/data/game.db`（已忽略入库）。
- **日志文件化**：服务端日志**不输出到控制台**（规避 Windows 控制台 GBK 解码 UTF-8 中文乱码），通过 Pino 异步缓冲写入 `apps/server/log/app-<秒级时间戳>.log`（每次启动新建一个、最多保留 `LOG_MAX_FILES` 条），优雅关闭时 flush/close；可通过 `.env` 的 `LOG_ENABLED` 完全关闭（零内存开销）。
- **画板**：高 DPI 实时画布，支持自由画笔、橡皮擦（`destination-out`）与封闭区域洪泛填充；画笔/橡皮擦共用连续粗细，可滚轮调整；支持预设或任意 HEX 颜色，工具可自定义单键切换。**渲染模型为「归一化点列 + 直线段描边」增量同步**（不引入轮廓填充型平滑库，曾因此导致白边/闪烁/空心缺陷）。
- **头像**：仅允许从 40 个内置 SVG 白名单编号中选择，协议只传编号；禁止上传图片、任意 URL、data URI、SVG 正文、粘贴或拖放头像。
- **应用标识**：名称「你画我猜」、版本 `1.0.0`、协议版本 `protocolVersion: '20'`（见 `packages/shared/src/protocol/constants.ts`）、本地存储键 `draw-and-guess-profile-v1` / `draw-and-guess-settings-v1`。**应用版本的唯一权威源是 `packages/config/src/app.ts` 的 `app.version`**；各 `package.json` 均为 `private: true` 的 workspace 包、不发布到 npm，其 `version` 只是占位，**不要**当作产品版本依据（一致性由单测守护）。
- **Windows 分发包**：`pnpm package:dist` 把服务端打成 **ESM 单文件 `server.mjs`**（依赖内联、`better-sqlite3` 外置），产出**单一自带 Node 的包**——附 `client/`、`vocabulary/`（含空白词库样板 `vocabulary/templates/example.db`）、`better-sqlite3` Node-API 预编译、`runtime/node.exe`（内置 **Node 24 LTS** 运行时 + 其 LICENSE）与 `start.cmd`（直用内置运行时，不检测系统 Node）。数据（`game.db`/`logs/`/`vocabulary/custom/`/可选 `.env`）写在产物旁 `data/`；内置 Node 默认从国内镜像下载（`NODE_DIST_MIRROR` 可切官网、`NODE_VERSION` 可钉版本），**下载经同源 SHASUMS256 sha256 校验、缓存损坏自动重下一次**。产物模式自动顺延端口并打开默认浏览器（`DRAW_GUESS_OPEN_BROWSER=false` 关闭后者）。仅 Windows x64，详见 `docs/adr/0034-node-single-file-distribution.md` 与 `docs/adr/0050-single-dist-package.md`。

### 技术栈与运行环境

- Node.js 当前维护中的 LTS（建议 22 或 24）、pnpm 11+（版本由 `packageManager` 钉定 11.25.0）、pnpm workspace 单仓库。
- 现代 Chromium / Edge / Firefox（支持 CSS `container queries`，因为整屏缩放依赖 `cqh/cqw`）。
- 后端子包依赖（`apps/server/package.json`）：`express@5`、`socket.io`、`zod`、`pino`、`tsx`、`helmet`、`cors`、**`better-sqlite3`（本地持久化，WAL）**、**`compression`（静态 gzip）**；开发依赖 `@types/better-sqlite3`、`@types/compression`、**`esbuild`（`pnpm package:dist` 打服务端单文件）** 等。
- 前端子包依赖（`apps/client/package.json`）：`vue@3`、`pinia`、`socket.io-client`、`tailwindcss@4`（`@tailwindcss/vite`）、`lucide-vue-next`、`@tanstack/vue-virtual`（虚拟列表）、`@vueuse/core` + `@vueuse/integrations`（组合式工具，含 `useFocusTrap`）、`nanoid`、`canvas-confetti`（猜中礼花）、`clsx` + `tailwind-merge`（类名合并 `cn()`）、`focus-trap`（弹窗焦点陷阱 peer）。**Toast 为自建组件（`components/common/AppToaster.vue` + `composables/useToasts.ts`）**，不依赖第三方通知库。
- 共享包子包：`zod`（唯一运行时依赖）。
- 已移除依赖（勿回引入）：`perfect-freehand`（轮廓填充渲染与增量同步架构冲突）、`pino-pretty`（改为文件 JSON 日志后不再使用）、`vue-sonner`（Toast 已由自建 AppToaster/useToasts 替换，未来统一走自建方案）。

---

## 项目结构

```text
draw-and-guess/
├── package.json                  # 根工程 scripts（开发/质量 + unit/component/integration/ci/e2e）
├── pnpm-workspace.yaml           # pnpm workspace：apps/* 与 packages/*（勿手改）
├── pnpm-lock.yaml                # 依赖锁文件（勿手改）
├── tsconfig.json                 # 根 TS 严格配置 + 路径别名（@draw-guess/shared / @draw-guess/config / @draw-guess/strings / @/）
├── tsconfig.test.json            # test/ 目录编译闸（pnpm typecheck 的组成）
├── scripts/                      # benchmark-flood-fill.mts（填充性能基准）/ check-client-bundle-boundary.mjs（客户端产物边界扫描）/ with-local-temp.mjs（构建临时目录固定到仓库内）
├── eslint.config.js              # ESLint 扁平配置（Vue/TS/Node，console/运行时依赖/SFC 文案等工程规则）
├── .prettierrc.json              # Prettier 格式（无分号/单引号/行宽 100/尾逗号 all）
├── .prettierignore               # 忽略依赖/构建产物/词库/数据库/日志/测试产物等
├── .env.example                  # 部署变量：HOST/PORT/日志开关、HEALTH_METRICS_ENABLED 与浏览器开关（复制为 .env 使用）
├── .env                          # 本地部署覆盖（已被 .gitignore 忽略，不入库）
├── .gitignore                    # 忽略 node_modules/dist/日志/数据库/.env/.pi/.playwright-mcp 等
├── packages/config/              # @draw-guess/config：仅浏览器安全的应用默认值与 UI/音频配置（含接龙三时长默认值与复盘四时长 `relay.ts`）
├── packages/strings/             # @draw-guess/strings：唯一展示文案表（strings.ui 可见 / strings.a11y 无障碍 / serverStrings 服务端）
├── vocabulary/                   # ★唯一权威词库目录：SQLite 数据库（metadata/words 表）
├── vitest.config.ts               # Vitest projects：Node 单元 + happy-dom 组件/集成
├── test/                          # 自动化测试目录（隔离环境）
│   ├── unit/                      # Vitest 单元/规则测试（test:unit）
│   │   ├── game.deadline.spec.ts  # 假时钟下 submitGuess 截止校验示例
│   │   └── helpers/               # fake-clock.ts / in-memory-repositories.ts / mini-vocabulary.ts / fake-audio.ts / game-harness.ts（GameService 全栈假运行时）/ relay-game-fixture.ts（接龙装配缝：一次调用得到 4 人接龙房与已开局，并可推进到指定幕）
│   ├── client/                    # happy-dom 公共 setup（DOM 清理、媒体/焦点边界 mock）
│   ├── component/                 # Vue Testing Library / Test Utils 组件测试
│   ├── integration/               # Pinia + MSW 客户端集成测试与网络边界；store-contracts.ts 为 Facade/composable 成员契约的编译期快照（非 spec，由 vue-tsc 把关）
│   ├── type/                      # 纯编译期断言（schema-first.ts 正/负向配对与 error-codes.ts 错误码↔文案配对，由 pnpm typecheck 把关，不运行）
│   └── e2e/                       # Playwright 端到端（test:e2e）
│       ├── playwright.config.ts   # 独立端口(5199)、reuseExistingServer=false、指向 launcher
│       ├── launcher.mts           # 隔离 webServer：临时目录 + fixture 词库 + 前端构建 + 清理/清扫
│       ├── pages/                 # 页面封装（profile/lobby/room/game）+ responsive.page.ts（响应式与触控验收断言辅助）+ dropdown.ts（手写下拉操作封装）
│       ├── fixtures/              # 测试基类 test-base.ts（建玩家/连接）与 canvas-probe.ts（逻辑栅格哈希探针）
│       └── specs/                 # 01-profile-session / 02-lobby-room-seats / 03-game-drawing / 04-game-guessing / 05-game-lifecycle / 06-browser-compatibility / 07-responsive-touch / 08-static-asset-cache / 09-drawing-history-limit / 10-relay-mode / 11-end-early-after-departure（有玩家退出后提前结束立即结算）/ 12-relay-chat（接龙聊天可用与推进）
├── README.md                     # 项目总览、十分钟启动（依赖/结构/样式/持久化/版本章节与代码保持一致）
├── docs/adr/                     # 架构决策记录：每条含背景 / 决策 / 后果，源码注释只链接此处
├── AGENTS.md                     # 本文件：导读、硬性限制、启动方法、编码/测试/提交流程
│
├── packages/shared/               # 前后端共享协议（无环境依赖，可在 Node/浏览器直接单测）
│   └── src/
│       ├── index.ts               # 聚合出口（直连再导出 types/ 与 protocol/）；引用路径保持 @draw-guess/shared
│       ├── events.ts              # Socket.IO 事件名及客户端请求/响应类型契约（前后端唯一事件名来源）
│       ├── error-codes.ts         # ERROR_CODES / ErrorCode：线上与客户端合成错误码唯一注册表
│       ├── types/                 # common/drawing/gameplay/room/session/vocabulary/invite/relay 分域 DTO
│       ├── protocol/              # 分域 Zod 协议（含 constants.ts 版本/头像/昵称/房间/接龙档位约束、relay.ts 接龙请求载荷、push.ts 接龙视图契约、response.ts ack 响应边界）
│       └── pure.ts                # 纯函数：答案规范化、遮罩生成、计分、状态机转换表
│
├── apps/server/                   # 服务端（Express 5 + Socket.IO + Zod + SQLite，权威领域）
│   ├── package.json               # 依赖见「技术栈与运行环境」
│   ├── tsconfig.json              # 继承根配置 + Node 类型
│   ├── scripts/                   # package-dist.ts：构建 Windows 分发包（esbuild 单文件 + 资源 + 内置 Node + zip）
│   ├── data/                      # 运行期生成：SQLite 数据库文件（game.db，已忽略入库，仅保留 .gitkeep）
│   ├── log/                       # 运行期生成：日志文件（app-<秒级时间戳>.log，已忽略入库，仅保留 .gitkeep）
│   └── src/
│       ├── index.ts               # 生产入口：加载 .env、环境校验、监听与优雅关闭生命周期
│       ├── server.ts              # ★唯一组合根（Composition Root）：纯构造函数依赖装配与生命周期管理
│       ├── core/                  # ★核心机制层：config 配置加载与校验、errors 统一 AppError 错误模型、runtime 运行时契约
│       ├── infra/                 # ★技术基础设施：sqlite（PRAGMA 严格顺序与 StatementCache 预编译缓存、迁移）、logging 文件日志
│       ├── modules/               # ★业务模块纵切：session / room / gameplay / relay / drawing / chat / vocabulary / archive
│       ├── http/                  # ★HTTP 入口适配：Express 5 app 组装、RFC 9457 统一错误中间件、API 路由与静态资源托管
│       ├── ws/                    # ★WebSocket 入口适配：泛型 contracts、handler-kit 统一包装器与跨模块网关装配
│       ├── runtime-layout.ts      # 源码 / 分发产物两种资源布局（data、client、vocabulary、.env；产物模式端口顺延+开浏览器）
│       ├── build/node-dist.ts     # 分发内置 Node 版本解析与下载校验（纯函数：挑最新稳定 v24、拼地址、提 SHASUMS 条目，可单测）
│       ├── build/dist-templates.ts # 分发文本模板（start.cmd / 使用说明纯函数，两包启动差异由单测锁定）
│       ├── config/                 # 兼容导出：服务端私有配置
│       ├── app.ts                 # 兼容导出：HTTP/Socket.IO/DatabaseContext 装配入口
│       ├── game-service.ts        # 兼容 Facade：模块服务协调与对局跨用例编排
│       ├── round-machine.ts       # 经典回合流转状态机（转发至 modules/gameplay/round-machine.ts）
│       ├── scoring.ts             # 计分纯函数（转发至 modules/gameplay/scoring.ts）
│       ├── hint-scheduler.ts      # 逐步提示调度（转发至 modules/gameplay/hint-scheduler.ts）
│       ├── snapshot.ts            # 角色裁剪快照构建（SnapshotViewPort 窄端口）：画家/观众视角差异化、strokesOmitted 差分
│       ├── rate-limit.ts          # 猜词/绘图滑动窗口限频
│       ├── errors.ts              # 兼容导出：统一 AppError / GameError 类层级
│       ├── models.ts              # 服务端内存秘密模型（PlayerSecret/RoomSecret/GameSecret/InviteSecret…）
│       ├── security/              # 恢复令牌摘要与旋转（recovery-token.ts）
│       ├── runtime.ts             # 统一 Clock/Scheduler/RandomSource 契约
│       ├── socket-types.ts        # 兼容导出：AppServer/AppSocket 泛型别名与 AppSocketData
│       ├── application/           # 应用协作者：room-publisher 发布快照；room-persistence-coordinator 映射低频仓储记录
│       ├── domain/                # 领域兼容导出：session / room / drawing / invite / vocabulary / relay
│       ├── startup/               # 启动期配置校验、环境加载、局域网地址与本机名枚举、端口顺延、自动开浏览器、优雅关闭
│       ├── logging/               # 兼容导出：文件日志初始化与保留策略
│       ├── observability/         # 有界进程指标：连接/房间/ack/错误/重同步（仅安全聚合）
│       ├── vocabulary/            # 词库 Provider 架构（contract / normalize / sqlite-provider / index）
│       ├── db/                    # 兼容导出：SQLite 实例上下文与迁移
│       ├── repositories/          # 兼容导出：仓储接口与实现
│       ├── protocol/binder.ts     # 统一请求绑定包装器
│       └── handlers/              # 兼容导出：Socket.IO 各领域事件注册
├── apps/client/                   # 客户端（Vue 3 + Pinia + Vite + Tailwind4 + Socket.IO）
│   ├── package.json               # 依赖见「技术栈与运行环境」
│   ├── tsconfig.json              # 继承根配置 + DOM/vite 类型
│   ├── vite.config.ts             # Vite 配置：@draw-guess/config 虚拟公开模块裁剪、/@、@draw-guess/strings 别名、开发代理（/api 与 /socket.io → 5174）；build.outDir 可经 CLIENT_OUT_DIR 覆盖（测试用）
│   ├── index.html                 # 入口 HTML（#app 挂载点，标题/描述由 vite.config 从 strings.ts 注入）
│   └── src/
│       ├── main.ts                # 客户端入口：创建 App 并挂载 #app；仅引入 ./style/index.css（Toast 为自建，无需第三方样式）
│       ├── vite-env.d.ts          # ImportMetaEnv 扩展：自定义 Vite 旗标登记处（读取 import.meta.env 前先在此声明）
│       ├── vue-augmentations.d.ts # strictTemplates 透传放行：aria-*/title/role/onXxx/data-*/lucide key（见 ADR-0016）
│       ├── App.vue                # 根舞台：页面互斥渲染（对局>房间>设置>大厅>资料）、自建 `<AppToaster/>`、邀请横幅、竖屏提示、断线恢复阻断框
│       ├── canvas/                # 双层画布：固定短边 720 的逻辑重放/填充层 + DPR 封顶的 DOM 展示层
│       │   ├── replay-machine.ts  # 画布重放状态机：增量/整帧决策、世代取代、后备缓冲原子提交（ADR-0018）
│       │   ├── rendering.ts
│       │   ├── geometry.ts        # 坐标几何单口径：(size-1) 映射/clamp/线宽恒等式/单点补偿（ADR-0022，零 import 供 Worker 与探针共用）
│       │   ├── viewport.ts
│       │   ├── flood-fill.ts      # 洪泛填充纯函数（扫描线 span 种子）与测量入口
│       │   ├── flood-fill-worker.ts      # 填充 Worker 客户端：失败降级一次
│       │   ├── flood-fill.worker-entry.ts # 填充 Worker 入口（独立 chunk，仅取协议常量子路径）
│       │   └── fill-diagnostics.ts       # 填充失败的有界脱敏诊断（ADR-0026）
│       ├── audio/                 # HTML5 Audio 音效层：资源发现、清单校验、端口契约、运行时组装、音效路由、管理器与浏览器适配器
│       ├── style/                 # 全局样式模块目录（由 index.css 聚合导出）
│       │   ├── index.css          # ★主入口：依次导入 tailwindcss 与各分模块样式
│       │   ├── tokens.css         # 设计令牌：@theme（字体、10 语义色、黑色变量、阴影令牌）
│       │   ├── base.css           # 全局 base：reset、表单控件基础状态、舞台外壳与容器单位上下文、全屏
│       │   ├── components.css     # 共享组件类（.dialog-shell/.eyebrow/.eyebrow-light/.round-icon-btn）
│       │   ├── utilities.css      # Tailwind 组合类（.ui-feedback/.hover-tint；紧凑布局契约类已删除）
│       │   ├── animations.css     # 交互反馈动效、Vue 过渡钩子、关键帧与减弱动画
│       │   └── other.css          # 设备方向（竖屏警告）等未分类规则
│       ├── application/           # game-transport.ts：io() 构造与连接/请求/推送装配（stores 只经 socket.ts 窄端口依赖，ADR-0019）
│       ├── stores/
│       │   ├── game.ts            # 组合 Facade Store：聚合所有领域 Store，提供向后兼容、单一引用的统一接口 useGameStore()
│       │   ├── profile.ts         # 玩家个人资料 Store（持久化存储与修改）
│       │   ├── settings.ts        # 本地偏好设置 Store（音量/动画/快捷键等）
│       │   ├── session.ts         # 连接与服务端会话 Store（注册、鉴权、在线状态）
│       │   ├── lobby.ts           # 大厅与房间发现 Store（公开房间列表、在线玩家、刷新与加入）
│       │   ├── room.ts            # 房间内生命周期 Store（成员席位、准备、房主权限与规则变动）
│       │   ├── resync.ts          # 重连/重同步 Store（受限全量重同步与会话失效跨域重置，ADR-0025）
│       │   ├── gameplay.ts        # 实时对局业务 Store（回合状态、词语选项、实时猜词流）
│       │   ├── relay.ts           # 接龙对局 Store（接龙绘图/提交/投票/独立聊天 + 本棒画布镜像自补）
│       │   ├── vocabulary.ts      # 词库选择与配置 Store
│       │   ├── socket.ts          # Socket 窄端口类型 + 推送事件绑定/解绑（io() 构造在 application/game-transport；注册/解绑由推送清单派生；HMR dispose）
│       │   ├── request.ts         # 请求封装：timeout+同 requestId 自动重试+ack 运行时校验+错误翻译
│       │   ├── error-recovery.ts  # 错误码 → 客户端恢复动作映射登记表（如 warn-drawing-limit 容量告警口径）
│       │   ├── response-protocol.ts # 请求响应 ack 的统一解码与脱敏诊断（非法响应不重试、不写入 Pinia）
│       │   ├── push-protocol.ts   # 主动推送 Zod 解码与脱敏诊断记录
│       │   ├── snapshot-gate.ts   # 房间/对局/回合/版本/画布修订统一门禁
│       │   └── vocabulary-request-context.ts # 词库异步请求上下文与失效控制
│       ├── composables/
│       │   ├── useAppBootstrap.ts # Socket 监听、连接生命周期、ping 与 HMR 清理
│       │   ├── useRoomSync.ts     # 快照门禁、画布增量合并与受限全量重同步
│       │   ├── useAudioFeedback.ts # 全局音效反馈（HTML5 Audio 驱动阶段入场音与倒计时警示）
│       │   ├── useCanvasViewport.ts / useCanvasCursor.ts / useStrokeSession.ts / useFillSession.ts # 画布视口、光标、笔画与填充会话（提交态锁；渲染态在 replay-machine）
│       │   ├── useGameHud.ts      # 对局 HUD 计算（useTimestamp 驱动）：剩余时间/进度/猜词权限/阶段标签/排行
│       │   ├── useInviteQueue.ts / useFullscreenPrompt.ts # 根 Shell 的邀请倒计时与全屏提示生命周期
│       │   ├── useVirtualTableRows.ts # DataTable 专用：单行高实测、占位与滚动归零
│       │   ├── useVirtualRows.ts # 通用行级虚拟化封装（@tanstack/vue-virtual；估算行高由调用方实测驱动）
│       │   ├── useTableSort.ts / useSelectAllState.ts / useCopyWithFeedback.ts # 表格排序、全选三态与复制反馈（数据表格/词库表共用原语）
│       │   ├── useShortcuts.ts    # 画板快捷键：自定义单键切换工具、撤销/重做组合键
│       │   ├── usePanelShortcuts.ts # 面板显隐快捷键：C 开关聊天面板，回车固定只打开聊天（ADR-0044、ADR-0054）
│       │   ├── useGuessConfetti.ts # 猜中礼花反馈：严格跃迁触发、不枚举阶段（ADR-0031）
│       │   ├── useContextMenu.ts  # 右键菜单单例状态层：任意场景 open(event, items)，配合 components/common/ContextMenu.vue
│       │   ├── useVocabularyDialogSession.ts / useVocabularyQuery.ts / useVocabularySelection.ts / useVocabularyPackages.ts # 词库弹窗会话生命周期（打开/拉取/失效/关闭/保存）与查询、选择、包管理
│       │   └── useToasts.ts       # 自建 Toast 状态层：队列/去重合并(key=type:text)/超时消失/弹跳事件（小条配色统一走橙色派生）
│       ├── components/
│       │   ├── AppButton.vue      # 统一动作按钮（primary/secondary/danger），内置类与外部类用 cn() 合并
│       │   ├── BaseDialog.vue     # 通用弹窗外壳，v-model:open 控制，焦点陷阱用 useFocusTrap + Esc 关闭 + 多弹窗顶层仲裁
│       │   ├── ConfirmDialog.vue  # 通用确认弹窗（复用 BaseDialog，v-model:open 控制，红色 danger 确认钮）
│       │   ├── AvatarImage.vue    # 内置 SVG 头像统一安全展示（只接收白名单编号）
│       │   ├── AvatarPickerDialog.vue # 40 个 SVG 头像选择模态框（v-model:open）
│       │   ├── ActionPopover.vue  # 悬浮操作面板（聊天快捷互动用）
│       │   ├── AppToaster.vue     # 自建 Toast 堆栈渲染：画框内右上角、白色长条+橙色小条+加粗文字、样式闭环在组件内、点击消失、淡入淡出、去重左弹跳（WAAPI）
│       │   ├── game/              # 对局组件（提供 index.ts）：GameCanvas / GameHud / ChatPanel / PlayerPanel / FloatingPanel / CanvasToolbar / BrushSizeField / PhaseOverlay / OverlayCard / HudPill / RelayPlayerChip；relay/ 子目录为接龙专属内容（顶栏两形态 / 作答浮层 / 投票卡 / 玩家状态行）；scale-fade.ts 为浮层出入场过渡（对局布局见 docs/adr/0056-three-column-layout-and-canvas-menu.md）
│       │   ├── room/              # 房间组件（提供 index.ts）：SeatGrid / RuleSummary / RuleRow / RulesDialog / InviteDialog / VocabularyDialog / VocabTableView / VocabPackageTableView
│       │   ├── lobby/             # 大厅组件（提供 index.ts）：CreateRoomDialog / JoinPrivateDialog
│       │   ├── common/            # 通用原语组件（提供 index.ts）：含 DataTable 与 DataTableHeader、ContextMenu（右键菜单，白底浮层）、SelectDropdown（手写下拉，替代原生 select）、ActionCard / AlertDialog / AvatarPickerField / RadioCardGroup / SquareIconButton / ColorSwatchButton / GroupDivider 等共享原语、各输入/按钮/规则原语
│       │   └── settings/          # 设置页组件（提供 index.ts）：AudioTab / ShortcutsTab / AccessibilityTab / DiagnosticsTab / SettingsSectionHeader
│       ├── views/
│       │   ├── ProfileView.vue    # 资料确认页（随机昵称/内置 SVG 头像选择，无上传）
│       │   ├── LobbyView.vue      # 在线大厅（公开列表/公私建房/私密短码加入/可发现玩家）
│       │   ├── RoomView.vue       # 房间等待（席位/准备/私密码/词库/规则/邀请/退出）
│       │   ├── GameView.vue       # 对局骨架：全局统领顶栏 + 16cqw 玩家榜 + 62cqw 4:3 黄金画板 + 20cqw 常驻聊天 + 底部横向工具条 + 各阶段遮罩/结算（布局见 docs/adr/0056-three-column-layout-and-canvas-menu.md）
│       │   └── SettingsView.vue   # 设置页（声音/显示/快捷键/资料诊断）
│       └── utils/
│           ├── avatar.ts          # Vite SVG 静态资源白名单编号到 URL 映射
│           ├── cn.ts              # 类名合并：clsx + tailwind-merge（注册 @theme 自定义语义色）
│           ├── bounded-diagnostics.ts # 有界诊断列表与 Zod 问题格式化统一内核（ADR-0026）
│           ├── phase-text.ts      # 阶段文案统一映射（HUD 标签与阶段播报共用，ADR-0028）
│           ├── role-text.ts       # 成员局内角色文案统一映射（玩家面板与聊天标签共用）
│           ├── keyboard.ts        # 单键快捷键共享判定（画板工具 + 面板显隐；捕获校验与触发匹配同一规则，防「能存不能触发」死键）
│           ├── confetti.ts        # 礼花特效（canvas-confetti 静态导入 + 主线程渲染，ADR-0031/0033）
│           ├── room-facts.ts      # 客户端房间事实：可玩成员谓词与玩家人数选项（ADR-0028）
│           └── create-uuid.ts     # 多环境 UUID：nanoid 十六进制 + RFC 4122 v4 位点（兼容服务端 z.string().uuid()）
```

> **关于客户端样式**：`apps/client/src/style/` 采用模块化分层管理，由 `index.css` 统一聚合导入各模块（`tokens.css` 设计令牌、`base.css` 全局 reset 与舞台上下文、`components.css` 共享组件类、`utilities.css` Tailwind 组合类、`animations.css` 交互动效与过渡钩子、`other.css` 设备方向规则）。Toast 专用样式收敛于 `AppToaster.vue` 内封闭维护。**组件/页面自身视觉样式一律写成 Vue 模板内的行内 Tailwind 类**（依赖 `cqh/cqw` 容器单位 + 语义色 `bg-navy`/`text-muted`/`border-line` 等）。不要写共享层之外的原生 CSS 类选择器。

---

## 开发环境与常用命令

### 环境要求

- Node.js 当前维护中的 LTS（建议 22 或 24）、pnpm 11+（版本由 `packageManager` 钉定 11.25.0）。
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
- 部署参数可覆盖：`PORT=5180 pnpm start`、`HOST=0.0.0.0`、`LOG_LEVEL=error`、`LOG_ENABLED=false`（关闭则完全不创建日志记录器、不写日志文件）、`LOG_MAX_FILES=3`（日志文件保留上限）、`HEALTH_METRICS_ENABLED=true`（仅允许本机查看详细健康指标）、`DRAW_GUESS_OPEN_BROWSER=false`（仅分发产物模式：关闭启动后自动打开浏览器）。服务启动时会自动加载项目根目录 `.env`（复制 `.env.example` 即可）；进程已有环境变量优先级高于 `.env`。环境变量**不会**覆盖游戏规则。
- **配置写法严格校验**：`PORT` 只接受纯十进制正整数、`HOST` 只接受 IP 字面量或 RFC1123 主机名、布尔项只接受 `true`/`false`（大小写不敏感），写法或取值不对**启动即中止**；带 UTF-8 BOM 的 `.env` 整份拒绝加载。不静默降级、不静默取默认值（见 `docs/adr/0035-startup-config-fail-fast.md`）。

### Windows 分发包

```bash
pnpm package:dist   # 构建前端 + 服务端单文件 + 内置 Node，产出一个可运行目录与 zip
```

- **产物**：`release/draw-and-guess/` → `release/draw-and-guess-<version>-win-x64.zip`（约 37MB，自带 Node 24 LTS，零依赖）。
- **内容**：`server.mjs`（依赖内联，`better-sqlite3` 外置）+ `client/` 前端 + `vocabulary/` 内置词库 +
  `node_modules/better-sqlite3/`（Node-API 预编译，仅 win32-x64）+ `runtime/node.exe`（内置 Node 运行时 + 其 LICENSE）+
  `start.cmd` + `使用说明.txt`。
- **启动**：`start.cmd` 直接用 `runtime\node.exe`，不检测系统 Node。产物启动后自动打开浏览器，`DRAW_GUESS_OPEN_BROWSER=false` 可关闭。
- **数据目录**：产物旁 `data/`（`game.db`、`logs/`、用户自定义词库 `vocabulary/custom/`、可选 `.env`）。
- **端口**：默认 5174，被占用时产物模式自动顺延（源码模式固定端口以配合 Vite 代理；探测与监听间存在已接受的微秒级 TOCTOU 竞态，见 ADR-0034）。
- **内置 Node 下载**：默认国内镜像 `https://npmmirror.com/mirrors/node/`，可用 `NODE_DIST_MIRROR` 切官网、
  `NODE_VERSION` 钉死版本；缓存于 `release/.cache/`，**写入与命中都经同源 SHASUMS256.txt 做 sha256 比对**，
  不符自动删缓存重下一次（二次仍不符报错；校验文件缺失按 fail-fast 中止）。CI（`windows-latest`）显式设
  `NODE_DIST_MIRROR=https://nodejs.org/dist/`，避免境外 runner 走国内镜像不稳定。
- **发布**：`.github/workflows/windows-release.yml` 打 `v*` tag 触发 Windows 构建并发布 Release；手动触发只出 artifact。

### 其它命令（全部通过根 `package.json` scripts）

```bash
pnpm typecheck     # 全 workspace 严格类型检查（vue-tsc + tsc）
pnpm lint          # ESLint（--max-warnings=0，无任何警告才通过）
pnpm format        # Prettier 写入
pnpm format:check  # 仅检查格式
```

> 各子包也带独立脚本：`apps/client` 含 `dev/build/typecheck`；`apps/server` 含 `dev/start/typecheck`；`packages/shared` 含 `typecheck`。根工程提供 `test:unit`、`test:component`、`test:integration`、`test:ci` 与 `test:e2e`。
>
> **构建临时目录固定在仓库内**：客户端 `build` 经 `scripts/with-local-temp.mjs` 包装，把子进程的
> `TEMP`/`TMP`/`TMPDIR` 指向仓库内 `node_modules/.cache/draw-guess-tmp`（已被忽略）。原因是部分
> Windows 机器上系统 `%TEMP%` 上的安全软件会按进程拦下 esbuild 删除自身临时文件（其临时文件只在
> 单次 transform 输入超过 1 MiB 时才产生，而主 chunk 压缩前源码正好超过），使 `vite build` 必然失败。
> 根 `build`/`test:e2e`/`package:dist` 都汇入这条命令，故一处包装即全覆盖；**不要**移除该包装或改用
> `cross-env`，取舍见 `docs/adr/0038-repo-local-build-temp-dir.md`。

---

## 架构与实现约定

- **依赖方向单向**：`client → shared/config`、`server → shared/config`、`shared → 无运行时依赖`。客户端与服务端都通过 `@draw-guess/shared` 引用协议层；不改动这一分层。
- **服务端权威裁决**：答案、计分、阶段、计时、绘画资格只能由服务端判定；客户端永远不能上传「裁决结果」。客户端只发带 `requestId` 的幂等请求经统一 `ack` 返回。
- **角色裁剪快照**（`snapshot.ts`）：所有公开数据结构按观看者角色生成；服务端秘密字段（答案、恢复令牌、候选词、内部计时器、请求缓存）绝不进快照/事件。私密房短码仅裁剪给当前房主；大厅玩家资料不回显私密房 UUID。`SnapshotBuilder` 依赖收窄为 `SnapshotViewPort` 六成员窄端口（GS 结构满足、类型环断开）；隐私回归由 `test/unit/snapshot.matrix.spec.ts` 的角色×阶段穷举矩阵保证（strict schema 闸门 + 秘密键清单 + 可见性真值表三重守卫，见 `docs/adr/0021-snapshot-view-port-and-matrix.md`）。新增 Secret 字段必须同步登记矩阵的 FORBIDDEN_KEYS。
- **统一请求绑定**（`protocol/binder.ts`）：schema 校验、会话限频、幂等缓存、统一 `ack`。非法阶段/角色/序号/频率由 `binder.ts` 与领域服务拒绝。
- **Schema-first 线协议**：`packages/shared/src/protocol/` 的 Zod Schema 是公开 DTO 与请求 payload 的权威来源；`PublicPlayer`、`RoomSnapshot`、`GameView`、`Invite` 等通过 `z.infer` 导出，推送事件类型由 `SERVER_PUSH_SCHEMAS` 自动映射。服务端 Secret 与仓储记录继续独立手写，禁止依赖 Zod 推导。
- **幂等传输重试**：普通客户端请求发生超时/断线等传输故障时，以同一 `requestId` 自动重试；服务端只缓存成功 ack，并让并发重复请求共享同一个执行 Promise。传输重试（`retry`，默认开）与失败 Toast（`notify: 'silent'` 抑制）是两个正交开关——高频绘图与画布控制请求显式 `retry: false`（旧 `quiet` 一符双义已拆分，见 `docs/adr/0022-geometry-single-source-and-request-flags.md`）。
- **请求响应运行时边界**：`CLIENT_RESPONSE_SCHEMAS` 为每个请求事件声明完整 ack Schema（成功 data、`requestId`、已登记 `ErrorCode` 的失败外壳，均为 strict），响应类型由 Schema 推导。`createRequester` 对每次 `emitWithAck` 结果先经 `response-protocol.ts` 解码并核对 `requestId`：解析失败或不匹配返回 `failureKind: 'protocol'`（不重试、不写入 Pinia、只显示统一安全文案并记录脱敏诊断），只有传输故障才自动重试。
- **版本化主动推送**：服务端主动事件一律使用 `createServerPush()` 包装；客户端先经 `SERVER_PUSH_SCHEMAS` 完整 Zod 解码，再通过 `snapshot-gate.ts` 校验房间、对局、回合、`stateVersion` 与 `drawingRevision`。非法推送只记录脱敏诊断，并以冷却窗口触发一次全量重同步。**推送事件在客户端只有唯一登记处**：`useAppBootstrap` 的 `push: PushHandlerMap` 注册表按协议事件逐条登记 `{ on, recovery }`（载荷整体透传、解码层零字段知识；非法载荷恢复策略即原「门禁域」与 handler 同条目共存）；注册/解绑清单由 `SERVER_PUSH_EVENT_NAMES`（schema 键派生）循环生成，`stores/socket.ts` 内不再有事件名单（见 `docs/adr/0020-push-registry.md`）。
- **统一运行时依赖**：`GameService`、`RoundMachine`、`rate-limit.ts`、`snapshot.ts`、`scoring.ts`、`hint-scheduler.ts` 及 `apps/server/src/domain/`、`application/`、`protocol/` 全目录的领域时间、定时器与随机数统一来自 `runtime.ts` 的 `Clock` / `Scheduler` / `RandomSource`；这些作用域禁止直接调用系统时间、随机数或定时器，只有 `runtime.ts` 生产适配层放行，ESLint 会阻止回退。
- **回合状态机**：`round-machine.ts` + `packages/shared/src/pure.ts` 的 `LEGAL_PHASES` 白名单；非法转换由服务端拒绝（`INVALID_TRANSITION`）。**阶段写入、准备失效、对局消息/系统通知与候选抽取、画家轮换、逐步提示计时器只归 `round-machine.ts` 所有**（阶段写入静态守卫见 `test/unit/room-phase-transition.spec.ts`）；`RoundContext` 是运行时/副作用窄端口，`GameService` 退为请求 API 与装配适配（见 `docs/adr/0024-round-machine-ownership.md`）。
- **计分统一口径（固定 100 分制）**：`scoring.ts` 与 `pure.ts` 的 `guessScoreForOrder` 使用同一规则——猜词者按本回合猜中顺序得 100/80/60/40/20（第 5 名及以后取最低档），画家每名猜中者 20 分、单回合上限 100；速度奖、顺序奖、全员猜中奖、词条权重与「统一猜词基础分」均已删除（见 `docs/adr/0047-fixed-100-point-scoring.md`）。
- **接龙状态机（与回合状态机平级）**：`apps/server/src/domain/relay/` 承载接龙的开局门禁、选词、四步换手、复盘轮播、投票结算、终局与代交兜底，只依赖窄端口、不反向依赖整机服务；装配层按 `room.gameMode` 委托给回合状态机或接龙状态机（经典回归路径零改动）。三条必须守住的边界：**绘图发布策略按模式分流**（经典＝全房广播、接龙＝不广播、命令只写入链内权威历史，由 `DrawingPublisher` 单点注入）；**接龙快照按观看者下发最小集**（其余链的画作与答案、未揭晓答案及其长度绝不出现）；**计分与复盘时序单口径**（「赞同严格多于反对」才通过、通过后 4 名参与者每人得「赞同票数 × 10」，复盘重播 3 / 停顿 1 / 揭晓 3 / 投票 10 秒取自 `packages/config/src/relay.ts`，每链 24 秒）。取舍见 `docs/adr/0058-relay-mode-authoritative-flow-and-reuse.md`。
- **成员事实单一口径**：房间内「占席 / 可玩 / 在线可玩 / 进榜」与连接三态、阶段标称时长只写在 `apps/server/src/domain/room/member-facts.ts`（纯函数，连通性经显式 `isOnline` 入参注入），其他模块经具名谓词 / 选择器调用；守护测试 `test/unit/member-facts-boundaries.spec.ts` 防止已删字段与加入策略回潮（取舍见 `docs/adr/0023-member-facts-single-source.md`）。
- **画布增量绘制**（`GameCanvas.vue` + `canvas/replay-machine.ts`）：坐标一律**归一化 0～1**；绘图序号单调递增，服务端拒绝旧包；橡皮擦/填充只传「点击位置 + 颜色」，不传像素，客户端按同一历史重放；`lastSequence` 用于重连续接。**渲染为直线段描边（`stroke()` + `round` 线帽），增量只补画新增段（fromIndex）**。**权威重放原子提交**：重放只画进后备 canvas，整帧成功后一次换入逻辑层——中止/取消的重放不得触碰逻辑层，`drawnPoints` 簿记与后备内容同口径（见 `docs/adr/0017-drawing-replay-atomic-commit.md`）。**「历史 → 栅格」的全部决策归画布重放状态机 `DrawingReplayMachine`**：唯一入口 `sync({commands, undoneIds, roundId})` + `resize/replay/预览方法`，增量 vs 整帧、undone 可见性过滤、世代取代、原子提交都是机器内政；组件与笔画会话不得直接绘制或清空逻辑层（见 `docs/adr/0018-canvas-replay-machine.md`）。
- **持久化分层**：每个应用由 `createDatabase(filePath)` 创建独占 `DatabaseContext`，迁移、身份/战报仓储和事务显式绑定同一连接，不允许模块级数据库单例或路径覆盖；恢复令牌落盘时只存 SHA-256 摘要且成功恢复必须旋转，运行期房间禁止写穿数据库。`RunningApplication.close()` 负责关闭自身 Socket、HTTP 和数据库。
- **注销是持久化优先的原子操作**：先原子删除持久化记录（失败即整体不生效：内存身份与当前连接保持可用，抛统一 `INTERNAL_ERROR` 并记白名单日志），再离房、最后清内存；注销只允许身份当前所属的连接执行（被接管的旧 socket 迟到注销只解绑自己）。顺序与取舍见 `docs/adr/0011-session-logout-atomicity.md`，禁止改回「先清内存、再尽力删库」。
- **本地运维指标**：服务端只在进程内按有限事件名/错误码聚合连接数、房间数、invalid push/resync、绘图预算拒绝和平均 ack 延迟，不保存 ID 列表、恢复令牌、答案、聊天正文或完整 payload。`/api/health` 默认仅返回安全摘要；详细指标必须显式开启且仅回环请求可见（见 `docs/adr/0007-local-observability-privacy.md`）。
- **配置单一来源**：线上协议范围只写在 `packages/shared/src/protocol/constants.ts`；浏览器安全默认值写在 `packages/config/src/`；限频、数据库路径与清理策略写在 `apps/server/src/config/`；UI 文案只写在 `packages/strings/src/`（`ui/` 为界面可见文案、`a11y/` 为 aria/悬浮文案、`server.ts` 为服务端文案）；词库数据只写在 `vocabulary/`。

---

## 编码规范

- **类型**：`strict` + `noUncheckedIndexedAccess` + `noImplicitReturns` + `noFallthroughCasesInSwitch` + `noImplicitOverride` + `noUncheckedSideEffectImports` + `verbatimModuleSyntax`（根 `tsconfig.json`），客户端 vue-tsc 另开 `strictTemplates`（模板未声明 props/事件即编译失败；合法透传统一在 `vue-augmentations.d.ts` 放行，新增旗标先登记 `vite-env.d.ts`）。避免 `any`（ESLint `no-explicit-any: error`）；未使用变量加 `_` 前缀以通过 `no-unused-vars`。
- **类型护栏分层**（取舍见 `docs/adr/0016-type-aware-guardrails.md`）：
  - Socket.IO 两端必须经 `socket-types.ts` 的 `AppServer`/`AppSocket`（server）与 `stores/socket.ts` 的窄端口（client：`PushBindingTarget` 监听绑定 / `GameTransportSocket` transport 视图 / `request.ts` 的 `RequestAckTransport`）引用，**禁止**裸 `import('socket.io').Socket`，消费者与测试替身都不得依赖全量 Socket 类型（`GameSocket` 仅用于 io() 构造边界断言，见 `docs/adr/0019-socket-narrow-ports.md`）；`socket.data` 只允许 `AppSocketData` 声明的字段；
  - 服务端推送一律 `createServerPush(EVENTS.x, data)`（事件名↔载荷编译期配对）；客户端入站仍按 `unknown` 走 Zod 解码，不因类型接入而信任线路数据；
  - type-checked ESLint 仅覆盖 `apps/server/src` 与 `packages/*/src`（typescript-eslint 无法解析跨文件 .vue 类型）；客户端类型严格性由 vue-tsc + strictTemplates 把关；`test/**` 不启用 type-checked 层（配置块级豁免，测试替身 `as unknown as` 属惯例）；
  - 生产代码禁用非空断言（`no-non-null-assertion: error`）：以守卫重排/可选链/类型谓词消除；确需保留（热点循环、接口适配）必须带中文理由的定点 `eslint-disable-next-line`；泛型边界适配断言（binder `on`、GameService 推送、game-transport `io()` 构造、request payload 展开 cast）须注释说明「延迟条件类型不可证」的原因；
  - `useGameStore` Facade 与 `useGameHud`/`useRoomSync`/`useToasts` 的成员名单由 `test/integration/store-contracts.ts` 编译期快照锁定：增删成员必须同步该名单（提醒机制，非阻力）。
- **Lint 护栏**：类型感知层（`apps/server/src`、`packages/*/src`）额外强制联合类型 `switch` 穷尽（`@typescript-eslint/switch-exhaustiveness-check`）；全仓启用 `eqeqeq`（smart）、`no-only-tests`（防误提交 `it.only`/`fdescribe`）与 `linterOptions.reportUnusedDisableDirectives: error`（过期的 `eslint-disable` 直接报错）；`eslint-plugin-vue` 预设只作用于 `.vue`，客户端类型严格性仍由 vue-tsc + strictTemplates 把关（见 `docs/adr/0016-type-aware-guardrails.md`）。
- **命名**：组件/视图 `PascalCase.vue`；TS 文件 **kebab-case**（`data-table-layout.ts`），例外仅三类——Vue 组合式函数 `useXxx.ts`、工具链配置 `*.config.ts`、测试 `*.spec.ts` / `*.page.ts`；事件名用 `EVENTS` 常量；领域模型用「Secret 后缀」标记服务端秘密对象。命名由 `test/unit/documentation.consistency.spec.ts` 静态校验，不要新增 camelCase 的普通模块文件。
- **格式**：Prettier（无分号、单引号、行宽 100、尾逗号 all）。编码前先 `pnpm format`。
- **换行**：由根目录 `.gitattributes` 统一管理；默认文本文件提交为 LF，`.bat`/`.cmd` 保留 CRLF，数据库、音频等二进制文件禁止换行转换。新增文件类型时同步确认其 Git 属性，不依赖开发者本机的 `core.autocrlf` 设置。
- **注释**：中文注释，解释「为什么」而非复述代码；关键算法 / 边界处理要求注释（参考 `GameCanvas.vue`、`pure.ts`、`snapshot.ts`、`game-service.ts` 的注释质量）。**禁止引用不可追溯的编号**（如「缺陷报告 #n」）：涉及取舍的修复要写进 `docs/adr/`，源码只留一句原因 + `docs/adr/NNNN-*.md` 链接。
- **错误处理**：所有可观察错误码先登记到 shared 的 `ERROR_CODES` / `ErrorCode`；服务端用 `GameError` + `errors.ts` 生成统一 ack，默认中文文案必须满足 `Record<ErrorCode, string>`；客户端经 `request.ts` 统一超时，失败 Toast 归属由 `notify: 'always' | 'silent'` 显式声明（静默请求的选择性补弹走调用方对 `ok:false` 结果的错误码分支），其余展示服务端安全文案。
- **日志**：由 `.env` 的 `LOG_ENABLED` 控制（默认 true）：关闭时完全不创建日志记录器、不写日志文件（零内存开销）；开启时服务端用 `pino`（默认结构化 JSON，无 ANSI 色码）异步缓冲写入，**每次启动写一个新的日志文件**（`apps/server/log/app-YYYY-MM-DD-HH-mm-ss.log`，精确到秒），目录最多保留最近 `LOG_MAX_FILES` 条（默认 10，超出删除最老）；优雅关闭必须 flush/close，异常退出仅做尽力同步 flush。日志正文与上下文字段采用静态白名单，禁止记录恢复令牌、答案、聊天全文或 payload；控制台只保留启动横幅，不输出业务日志；日志级别只有 `info`/`error` 两档（与 `RuntimeLogger` 通道一致），经 `LOG_LEVEL` 控制。ESLint 默认禁止 `console`，仅进程入口、启动提示、客户端开发期资源诊断与测试运行器等明确适配层放行。
- **UI 文案**：**严禁在组件/业务代码里硬编码展示字符**；一律从 `@draw-guess/strings` 的 `strings`（客户端）或 `serverStrings`（服务端）导入。SFC ESLint 规则覆盖 template 纯文本、静态 `aria-*` / `title` / `placeholder`、字符串与模板字符串；注释、class 名、不含硬编码文案的动态绑定、测试夹具与仅供开发者定位问题的技术诊断不视为 UI 文案。
- **样式**：组件/页面视觉一律用**行内 Tailwind 类**写在 Vue 模板；重复长串收敛到共享组件（`AppButton`/`BaseDialog`/`ConfirmDialog`/`IconButton`/`RoundIconButton`/`SquareIconButton`/`ColorSwatchButton`/`OverlayCard`/`RuleRow`）或 `style/` 共享模块类。不要写共享层之外的原生 CSS 类选择器。语义色用 `@theme` 令牌；容器单位 `cqh/cqw` 用任意值（内部空格用 `_`，如 `shadow-[0_1.2cqh_5cqh_#0009]`）。
- **配色与对比度**：品牌基色固定为 `navy`/`muted`/`line`/`paper`/`blue`/`sky`/`yellow`/`green`/`red`/`purple`；为满足 WCAG AA，可使用 `success-fg`/`success-on-dark`/`warning-fg`/`danger-on-dark`/`control`/`focus` 等集中定义于 `style/tokens.css` 的无障碍语义令牌。`packages/config/src/room.ts` 的 `seatColors` 仍只取品牌基色；`#fff`/`#000`（及黑色变量 `--color-black`）与透明度衍生（如 `bg-blue/10`）不计入调色板。普通文字至少 4.5:1，大字号与非文字控件边界至少 3:1。**禁止**在组件/模板中硬编码任意 HEX（`bg-[#...]`/`text-[#...]`）或 Tailwind 默认色阶（`slate-*` 等）。`packages/config/src/drawing.ts` 的 `colors` 是**画板工具色**，属功能性工具配置，不纳入品牌调色板限制。
- **动画一致性**：按钮/卡片交互动效统一为 160ms（复用 `.ui-feedback` / `.hover-tint` 共享类，或依赖 `@layer base` 中 `.game-stage button` 的全局过渡）；同类控件应复用同一动画，避免各自定制造成手感不一。浮层出入场（`FloatingPanel`/`CanvasToolbar` 的淡入淡出 + 缩放，进入 180ms / 退出 140ms）为独立动效，不属按钮/卡片交互动效，保留其手感。
- **布局规范（外 Grid 骨架，内 Flex 排版）**：
  - **Grid 宏观骨架与二维矩阵**：主页面二维行列骨架（`ProfileView`/`LobbyView`/`RoomView`/`SettingsView`）、二维固定席位/头像/卡片矩阵（`SeatGrid` 2×3、`AvatarPickerDialog` 8×5、`ShortcutsTab` 3 列、`RulesDialog` 3 列表单、`ChatPanel` 3 列表情）、三列对称顶栏（`StageHeader` `grid grid-cols-[1fr_auto_1fr]`）。**对局页 `GameView` 不属此类二维骨架**：它是「全局统领顶栏 + 16cqw 玩家榜 + 62cqw 4:3 黄金画板 + 20cqw 常驻聊天 + 底部横向工具条」；顶栏高度与大厅/房间/设置页一致（均为舞台高度约 `10%`，见 `docs/adr/0056-three-column-layout-and-canvas-menu.md` 与 `docs/adr/0044-panel-shortcuts-and-unified-topbar.md`）；
  - **Flex 微观流式排版**：一维线性排列（水平按钮内容 `inline-flex items-center gap-[...]`、导航 Tab、工具栏工具条、输入框组合；垂直消息流 `flex flex-col`、规则行列表、Toast 堆叠）；
  - **单元素绝对居中**：严格使用 `grid place-items-center`（如圆形头像底座 `AvatarImage`、独立图标按钮 `IconButton`/`RoundIconButton`、徽章 `HostCrownBadge`、模态遮罩居中），杜绝单元素使用 `flex items-center justify-center` 导致子项伸缩变形；
  - **保留专用布局**：弹窗/画布状态遮罩（`BaseDialog`/`ConfirmDialog`/`OverlayCard`/`PhaseOverlay`）、对局浮层面板与底部工具条（`FloatingPanel`/`CanvasToolbar`）与 Toast 悬浮层（`AppToaster`）保留 `absolute`/`fixed` 定位；吸顶表头保留 `sticky`；数据表格（`DataTable.vue`）保留原生 `table`/`table-fixed`；
  - **反模式禁令**：严禁单子项容器使用 `grid-cols-1` 伪网格；严禁单元素容器使用无意义的 `flex`；严禁一维简单按钮使用 Grid；严禁二维页面大框架采用多层嵌套 flex。
- **顶栏按钮文案与呈现规范（对局内 vs 对局外）**：
  - **对局游戏内（`GameView` / `GameHud`）**：顶栏操作按钮（全屏切换、对局设置、提前结束等）应该无文案而只有 icon（使用 `IconButton`，尺寸紧凑、零文字冗余），将空间最大化让渡给回合进度、题目遮罩与倒计时；
  - **对局外（如大厅 `LobbyView`、房间 `RoomView`、设置 `SettingsView`）**：顶栏的操作与状态按钮应该有文案（使用 `StageHeaderButton`，采用「图标 + 文本」水平排列，如设置、全屏、退出房间），确保操作语义直观明确。
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
  - 表单组件值绑定（`AppInput` / `SearchInput` 的 `modelValue`、`RuleSelectField` / `SettingSliderRow` 的数字值、`RuleToggleField` / `SettingSwitchRow` 的布尔值）；
  - 模态弹窗显隐控制统一命名为 `open`（`v-model:open="isOpen"`），所有弹窗组件（`BaseDialog` / `ConfirmDialog` / `AvatarPickerDialog` / `RulesDialog` / `VocabularyDialog` / `InviteDialog` / `CreateRoomDialog` / `JoinPrivateDialog`）均遵循该标准宏接口；
  - 工具参数绑定（`CanvasToolbar` 与 `GameCanvas` 的 `v-model:width="strokeWidth"`）；
  - **严禁**使用已淘汰的手写 `props: { modelValue }` + `emit('update:modelValue')` 样板代码。
- **统一 Barrel 导出（`index.ts`）与模块化消费**：
  - 各组件子目录（`components/common`、`components/lobby`、`components/room`、`components/game`、`components/settings`）均维护单一 `index.ts` 集中导出；
  - 视图与组件引用时优先通过目录 Barrel 导入（如 `import { AppButton, AppInput } from '@/components/common'`），提高引用整洁度与重构灵活性；
  - `stores/` 不做 barrel：领域 store 由消费者具名直连，统一入口是 `stores/game.ts` 的 `useGameStore()` Facade。
- **右键菜单统一走单例状态层**：
  - 需要右键菜单的场景一律调用 `useContextMenu().open(event, items)`（菜单项文案同样来自 `@draw-guess/strings`），由 `App.vue` 挂载的唯一 `ContextMenu` 实例渲染；
  - **不要**在视图里另建菜单实例或直接写右键浮层：单例保证同一时刻只有一个菜单、菜单不被中间 `overflow` 容器裁剪，且键盘/定位/关闭行为只有一处实现；
  - 原因与取舍（为什么不用 Teleport、点外点击为何穿透）见 `docs/adr/0008-context-menu-singleton-vs-teleport.md`。
- **Pinia Store 领域解耦与 Facade 架构**：
  - 状态按领域边界拆分为微 store：`useProfileStore`（资料/头像）、`useSettingsStore`（本地偏好）、`useSessionStore`（连接与会话鉴权）、`useLobbyStore`（大厅房间与玩家）、`useRoomStore`（房间生命周期与席位）、`useGameplayStore`（实时对局与消息）、`useVocabularyStore`（词库配置）、`useResyncStore`（重连/重同步与会话失效重置）；
  - `stores/game.ts` 保留作为统一 Facade（`useGameStore()`），聚合所有子 store 的 state、getters 与 actions，提供向后兼容、无破坏性的单一入口；
  - **消费边界**：视图/组件统一消费 Facade；组合式函数（`useAppBootstrap`/`useRoomSync`）为精确订阅可直接注入微 store。**跨领域编排（如注销后的房间/词库清理、注册恢复后的房间落位）只允许写在 Facade 或所属领域 action 中**，组合式函数与组件不得串联多个 store 自行编排；
  - 会话域 action 只处理会话/资料/连接，`localStorage` 读写必须收敛在 `profile`/`settings` store 内，其他模块不得直接访问；
  - 业务通信严格通过 store actions，禁止在组件中直接跨层调用底层 socket 发送未经校验的裸事件。
- **Vue 模板原生 `:class` 对象规范**：
  - Vue SFC 模板中条件样式严格使用 Vue 原生语法（例如 `:class="{ 'text-muted': isDisabled }"` 或数组形式）；
  - **严禁**在模板表达式中直接调用 `clsx(...)` 或 `cn(...)`；
  - `cn()`（`clsx + tailwind-merge`）仅允许在组件根节点与外部类名透传/覆盖合并时（如 `<div :class="cn('base-class', props.class)">`）在 `<script setup>` 或受限属性绑定中调用。
- **表单输入原语规范（`AppInput` / `SearchInput` / `SelectDropdown`）**：
  - 全站表单输入框、房间短码、玩家昵称、搜索框一律使用 `AppInput.vue` 或 `SearchInput.vue` 原语组件；
  - 集中管理输入框边框色、圆角、背景色、焦点发光环（focus ring）、禁用态与字号；严禁在视图或业务弹窗中裸写 `<input>` 及私有边框/焦点类；
  - 表单下拉一律使用 `SelectDropdown.vue`（字段行经 `RuleSelectField.vue` 组合），**禁止**回退原生 `<select>`；键盘导航、Esc 仅关下拉（不连带关弹窗）与点外关闭均由该原语统一实现；展开面板为 **fixed 视口锚定**（打开时按触发按钮矩形定位、宽度与按钮等宽、空间不足向上翻转），祖先滚动/窗口 resize 即关闭，不 Teleport（取舍见 `docs/adr/0015`）。
- **无深浅色主题切换约束**：
  - 本项目为固定纸墨手绘视觉风格（米白/纸张底色 + 深蓝/藏青字 + 粗线条边框），**不支持且未来绝不引入明暗/深浅色主题切换（No Dark Mode）**；
  - 禁止引入 `dark:` 前缀类或相关检测代码；所有颜色严格走 `@theme` 10 个语义色。

---

## 测试规范

> **测试框架已登记**：① Node 单元/规则测试使用 **Vitest 5**；② Vue 组件测试使用 **happy-dom + @vue/test-utils + @testing-library/vue + user-event**；③ 客户端集成测试使用 **@pinia/testing + MSW**；④ 端到端使用 **Playwright**。全部测试均为隔离环境：SQLite 用例只写系统临时目录；MSW 拒绝未声明的真实 HTTP 请求；Socket 使用测试替身；E2E 使用唯一临时数据库、词库与前端产物，**不连接/不停真实 5174 服务、不改真实数据库与词库**。

- **单元测试（`pnpm test:unit`，Vitest）**：`vitest.config.ts` 通过 `resolve.alias` 复刻 `@draw-guess/*` 与 `@/` 路径。内存仓储与完整假运行时见 `test/unit/helpers/`；`fake-clock.ts` 同时控制 Clock/Scheduler/RandomSource，可同步推进完整对局。`persistence.spec.ts` 使用系统临时 SQLite 并在每例后关闭、删除；`documentation.consistency.spec.ts` 校验 AGENTS 关键路径与根质量命令存在性。单元测试已纳入 `pnpm typecheck`。
- **组件测试（`pnpm test:component`）**：运行于 happy-dom，优先用 Testing Library 的角色/名称查询与 `userEvent.setup()` 模拟真实操作；只有需要精确校验 Vue emit / v-model 契约时使用 Vue Test Utils。音频播放与 focus-trap 已有独立测试，组件 setup 只验证调用意图。
- **集成测试（`pnpm test:integration`）**：使用真实 Pinia 或 `createTestingPinia({ createSpy: vi.fn })`；Socket.IO 由统一替身隔离，MSW 以 `onUnhandledRequest: 'error'` 守住 HTTP 边界。禁止访问真实服务。
- **全量运行（`pnpm test:ci`）**：一次跑完 unit / component / integration 三个 Vitest projects，并输出 JUnit 供 CI 失败诊断；覆盖率采集与阈值门禁已移除（见 `docs/adr/0049-lan-first-drop-size-and-coverage-gates.md`）。
- **端到端测试（`pnpm test:e2e`，Playwright）**：launcher 承担 webServer（构建前端 → 生成 fixture → 建库 → 监听）。默认词库 fixture 含 5,000 词，用于虚拟表格压力验收；兼容性项目覆盖 Chromium DPR 1/1.5、Firefox DPR 2 和后台标签页恢复（设备向触屏验收已随手机/平板适配一并移除）。页面封装在 `test/e2e/pages/`，fixtures 在 `test/e2e/fixtures/test-base.ts`，spec 在 `test/e2e/specs/`。CI 上 `retries=1`（本地 0 重试以暴露不稳定用例）；launcher 构建时注入 `VITE_EXPOSE_LOGICAL_CANVAS=1` 开启跨端栅格哈希探针（默认生产构建不包含该探针）。
- 可作为将来单测目标的纯函数（注释已注明「可独立单测」）：`packages/shared/src/pure.ts`、`apps/server/src/scoring.ts`、`apps/server/src/snapshot.ts`；仓储接口（`repositories/`）可注入内存实现测试。
- **修改代码后的最低验证要求**：依次运行
  ```bash
  pnpm format
  pnpm lint         # --max-warnings=0，无任何警告
  pnpm typecheck
  pnpm build
  ```
  修改客户端组件/Store/组合式函数时额外运行 `pnpm test:component` 与 `pnpm test:integration`。
  涉及规则/状态机/绘图/持久化等关键逻辑时，额外运行 `pnpm test:unit` 与 `pnpm test:e2e`（隔离环境，不污染真实数据）。
- 涉及关键逻辑（状态机、计分、快照裁剪、画布同步、限频、私有房间访问控制、持久化落盘）时，建议额外做人工/浏览器端到端验证（可用 Playwright MCP 等驱动真实浏览器）。
- **Windows 注意**：Playwright 结束 webServer 时用 `taskkill /T /F` 强杀进程树，launcher 收不到 SIGTERM，因此「先前运行」的临时目录由**下一次运行启动时的清扫**回收（`launcher.mts` 会清除超过 5 分钟的旧 `draw-guess-e2e-*` 目录）。

---

## 响应式与触控验收标准

> 阈值唯一来源：`packages/config/src/settings.ts` 的 `responsive`。样式实现分落两处：`style/tokens.css`（字号像素下限）、`style/base.css`（舞台基准字号）。两处与本文档由 `test/unit/responsive-standards.spec.ts` 强制一致，改动任一处必须同步其余两处。
>
> **核心口径（2026-09 二次修订）**：**主要适配电脑网页端浏览器**。界面 UI 一律使用相对尺寸（`cqh`/`cqw`/`em`），随舞台视口**等比缩放**；已**废除**「44px 触控命中区契约」（`.touch-target` 外扩与 `.compact-control` 视觉保底），**控件命中区即视觉尺寸**，普通控件不设像素下限；已**删除紧凑布局（compact）模式**——不再按舞台高度切换任何布局行为（收紧留白/折叠说明/局部滚动/弹性行高/换行/单列化全部不存在），所有屏幕共用同一套正常布局。手机/平板横屏不做特意适配、不排除使用（等比缩放自然覆盖），竖屏仍由 `style/other.css` 旋转提示拦截。

### 验收基准视口

| 基准 | 视口（CSS px） | 舞台尺寸 | 布局     |
| ---- | -------------- | -------- | -------- |
| 桌面 | 1280×720       | 1267×713 | 唯一布局 |

- 舞台固定 16:9 居中，不因视口变化破坏比例；竖屏由旋转提示接管（非验收范围）。
- `test/e2e/specs/07-responsive-touch.spec.ts` 在桌面基准下逐屏截图并断言；
  末尾另有用例以两个桌面窗口尺寸（1280×720 / 1024×576）对比，守卫「控件随舞台等比缩放、
  无像素保底回潮」（cqh 定高控件与舞台高度比值恒定、绝对尺寸随窗口变小）。

### 控件尺寸与命中区

- **普通交互控件**（动作按钮 `AppButton`、图标按钮 `IconButton`/`RoundIconButton`/`SquareIconButton`、开关行、弹窗按钮与关闭钮、席位角标、搜索清除钮）：尺寸**随舞台等比缩放，不设像素下限**；命中区即视觉尺寸，不经任何覆盖层外扩。
- **密集控件**（画板色板、自定义取色、表情反应、表格表头与行复选框、筛选弹层复选框）：仅保留 `responsive.minDenseTargetPx`（**16px**）视觉下限，防止小窗下缩到看不见；除此之外仍等比缩放。
- **滑块 `<input type="range">`**：命中区由滑块自身承担（`h-[2.75em]`，随字号缩放）。**禁止**在包裹 range 的 `label` 上挂任何覆盖层类——伪元素会盖住 range，而 range 只响应指针按下/拖拽（label 只转发 click），滑块将彻底无法拖动。
- **下拉框 `<select>`**：是替换元素，**禁止**在其所属 `label` 上挂覆盖层类——`::after` 会拦截指针事件导致下拉框收不到点击、彻底无法展开（曾因此产生「建房/规则弹窗下拉失效」缺陷）。字段行仅保持原生 `label` 关联。
- **文本输入框**：按「可读字号 + 可见性」验收，不纳入固定命中区下限。

### 字号可读阈值

**字号是唯一保留像素下限的维度**（保证小窗下仍可读）。舞台基准字号为 `clamp(12px, 2cqh, 18px)`，每档字号再用 `max()` 声明像素下限（低高度舞台下不再无限缩小）：

| 档位                        | 用途           | 下限                           |
| --------------------------- | -------------- | ------------------------------ |
| `text-fs-16` 及以上         | 正文           | ≥ 12px（`minBodyFontPx`）      |
| `text-fs-12` / `text-fs-14` | 次级与辅助说明 | ≥ 10px（`minSecondaryFontPx`） |
| `text-fs-10`                | 徽章与微标签   | ≥ 9px（`minMicroFontPx`）      |

### 禁止事项

- **禁止**重新引入紧凑布局（`@container` 断点、`.compact-*` 类）或任何按设备/窗口高度切换的布局模式；极小窗口下内容溢出/裁切属已接受的取舍。
- **禁止**重新引入像素尺寸保底类（`.compact-control` / `.touch-target` 均已删除）。
- **禁止**为手机/平板编写设备专属分支（UA 嗅探、媒体查询断点、`viewport` meta 等）；画布 `touch-none` 属 Pointer Events 通用写法，不在此列。

---

## 静态资源缓存

> 时长唯一来源：`packages/config/src/settings.ts` 的 `staticAssets`；
> 断言在 `test/e2e/specs/08-static-asset-cache.spec.ts`（真实响应头）与 `test/unit/bundle-boundary.spec.ts`（静态守卫）。

`apps/server/src/app.ts` 按文件名是否含内容哈希分流：

- `/assets/**` 中形如 `name-<hash8>.ext` 的产物 → `Cache-Control: public, max-age=31536000, immutable`（内容变则改名，可安全长缓存）；
- `index.html` 与 SPA 回退 → `no-cache`（入口必须每次校验，否则发版后仍会引用已删除的旧哈希产物）。

首屏体积预算与组件级懒加载已随「局域网优先」移除（见 `docs/adr/0049-lan-first-drop-size-and-coverage-gates.md`）：
前端不再有动态 import 的视图或组件，新增模块一律静态导入；也不再为 chunk 切分维护 barrel 约定。

**独立 bundle 的轻量导入约束**：Worker、独立 HTML 入口等会被单独打成一个 chunk 的模块，只允许从
`@draw-guess/shared/protocol/constants` 子路径取协议常量，**禁止**在此基础上引入 `@draw-guess/config` /
`@draw-guess/strings` barrel 或 `@draw-guess/shared` barrel——后两者会把整份配置与 zod schema 复制进
独立 chunk（洪泛填充 Worker 曾因此多出 21.4 KiB gzip）。守卫在 `test/unit/bundle-boundary.spec.ts`；
这三个 workspace 包已声明 `sideEffects: false`。

---

## 修改规则与工作流程

### 修改前应检查

1. 通读本文件「约束与禁止事项」，确认改动不违反硬性限制。
2. 定位改动归属：协议约束/事件 → `packages/shared/`；公开默认值 → `packages/config/`；服务端私有策略/权威领域 → `apps/server/src/`；客户端视图 → `apps/client/src/`。
3. 若改动会改变公共接口 / 事件名 / DTO，先更新 `packages/shared` 的 `events.ts`、`types/` 与 `protocol/` Schema 并同步前后端；`protocolVersion` 变更属不兼容变更，必须与客户端同步 `+1`。
4. 涉及持久化/日志/部署的改动，先确认 `.env`、`db/migrate.ts`、`repositories/`、`index.ts` 的现状与约束。

### 各类改动的流程

- **新增功能**：
  1. 新增请求事件：`packages/shared/src/events.ts`（事件名）→ `protocol/`（Schema 校验）→ `game-service.ts` 或对应 handler → `handlers/*.ts` 注册 → `stores/game.ts` 客户端方法。
  2. 新增推送事件：`packages/shared/src/protocol/push.ts` 的 `SERVER_PUSH_SCHEMAS` +1（事件清单 `SERVER_PUSH_EVENT_NAMES` 自动派生）→ 客户端 `useAppBootstrap` 的 `push` 注册表补一条 `{ on, recovery }`——监听注册、解绑与非法载荷恢复自动生效，`stores/socket.ts` 零改动；漏登记（载荷处理或恢复策略任一缺项）编译失败。
  3. 协议范围加入 shared constants；公开默认值加入 `packages/config/`，服务端私有策略加入 `apps/server/src/config/`。
  4. UI 文案加入 `packages/strings/src/`。
  5. 完成后跑「最低验证命令」。
- **修复缺陷**：先复现、明确根因（多在状态机 / 快照裁剪 / 同步兜底 / 画布渲染），改最小范围，再验证相关模块与相邻功能。
- **调整接口 / DTO**：同步 `packages/shared` 的 `types/` 领域 DTO 与 `protocol/` Schema，并检查 `snapshot.ts` 是否需按新字段裁剪；协议版本不兼容时 `protocolVersion +1`。
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
     - ✅ 允许落盘：玩家身份/恢复令牌/偏好（`players`）、完成局战报（`game_archive`/`game_results`/`rounds`）；
     - ❌ 禁止落盘：运行期房间配置与成员席位；
     - ❌ 禁止落盘：画布笔画、聊天消息、内部计时器、幂等请求缓存、限频时间窗等高频瞬态；
     - 数据库经 `db/migrate.ts` 版本化迁移建表，仓储接口在 `repositories/`，领域层只依赖接口；服务重启时 `recoverOnStartup` 标记玩家断线（身份可宽限恢复），房间因纯内存模型自然清空。
   - 公开房必须进入大厅列表；私密房必须从大厅隐藏，短码只能由服务端安全随机生成并限频校验；禁止客户端自选弱码、自定义密码、邀请链接或二维码。
2. **隐私与安全边界**
   - 带 `Secret` 后缀的服务端数据（恢复令牌、候选词、内部计时器、请求缓存）**绝不**原样出现在任何快照/事件中；一律经 `snapshot.ts` 裁剪。
   - 客户端请求必须带 `requestId`（幂等）与统一 `ack`；非法阶段/角色/序号/频率由 `binder.ts` 与领域服务拒绝。
   - 头像只允许 `packages/shared/src/protocol/constants.ts` 白名单中的内置 SVG 编号；**禁止上传图片、任意 URL、data URI、SVG 正文、粘贴或拖放头像**。
3. **词库与内容**
   - `vocabulary/` 目录下的 SQLite 词库包是仓库的权威词库来源（当前仅 `base_words.db`，可并存多个 `.db`，服务启动时全部加载并从中选默认包；分发产物模式另有产物 `data/vocabulary/custom/` 自定义目录与内置目录合并加载，同名包 ID 追加序号唯一化，见 `docs/adr/0034-node-single-file-distribution.md` 决策四）：`metadata` 表只存 name/description/version/updated_at（`version`/`updated_at` 是词库包自身的版本与更新日期，仍由词库包列表展示）；`words` 表词条只含 id/text/**collection**（单词条归属一个合集）/aliases（JSON）。**分类白名单（category_enum）与难度、可绘制性、提示、难度级配置与「是否启用」位已退出领域模型并从库表删列**（见 `docs/adr/0046-vocabulary-slimming-and-unified-round-time.md`、`docs/adr/0048-vocabulary-schema-slimming.md`、`docs/adr/0053-vocabulary-collection-and-toolbar-redesign.md`）；所有词条一律进入候选池，合集由服务端自动检测聚合供前端筛选。**玩家自定义词库的空白样板**是 `vocabulary/templates/example.db`（与基础词库同字段、0 词条；说明见 `vocabulary/templates/README.md`）——它放在子目录而不是 `vocabulary/` 根，因为扫描只认根目录下的 `*.db`，0 词库若被扫描会触发词数门槛让服务启动失败。校验为 fail-fast：合集非空、词面长度 ≤ `maxWordLength`、别称数量与长度、主键与词面不重复、词条数 ≥ `minWords`；目录内没有任何 `.db` 时按 `apps/server/src/config/private.ts` 的 `dbPath` 兜底探测（默认文件名 `base_words.db`）。修改后需重启服务，异常数据以中文错误阻止启动。
   - **猜词提示只靠逐字遮罩**：结构化提示已从对局链路移除（见 `docs/adr/0042-remove-structured-hints.md`），猜词者只根据题目遮罩按节奏逐格揭示字符推理（保留末尾非标点字符，调度归 `apps/server/src/hint-scheduler.ts`）；选词卡对画家只显示候选词面（`wordOptions` 只带 `id/text`）与自定义入口。
   - **画家自定义题目**：房主开关 `allowCustomWord`（默认关闭）；开启时画家可在选词阶段输入去空白后 1~12 个 grapheme 的词直接开画，服务端把它合成为一条无元数据词条并拒绝与本局已用词或当前候选重复（见 `docs/adr/0045-custom-word-and-untimed-choosing.md`）。选词阶段恒有倒计时：由 `chooseSeconds` 驱动（默认 15 秒），超时由服务端随机挑一个候选词直接开画（见 `docs/adr/0059-remove-game-pause-and-unified-offline-handling.md`）。
   - 猜词判定固定用 `normalizeAnswer`（NFKC + 去空白 + 折叠空白 + 忽略拉丁大小写），不要在别处另写一套比较。
4. **配置治理**
   - 协议公开约束**只允许**写在 shared protocol constants；公开默认值与服务端私有策略按包边界分别维护，禁止复制同一协议常量。
   - UI 文案**只允许**写在 `packages/strings/src/`，组件与业务代码严禁硬编码展示字符。文案分 `strings.a11y`（aria-* 与悬浮 `title`）与 `strings.ui`（界面可见）两个命名空间，由 `test/unit/strings-layering.spec.ts` 源码扫描守护：无障碍绑定不得引用 `strings.ui.*`；双用途文本拆成两个 key。
   - 不要把配置明文写死进业务代码（协议版本集中在 shared constants，应用默认值集中在 `@draw-guess/config`）。
5. **联机与部署**
   - 服务监听默认 `0.0.0.0`；前端构建产物托管与 Socket.IO 必须在**同一 Node 服务**（端口分离仅限开发代理）。
   - 服务**不要开放到公网**；若主机被其它设备访问，需保证防火墙放行专用网络并提示同一网段。
   - `protocolVersion` 变更属不兼容变更，必须与客户端同步 `+1`。
6. **画布与体验**
   - 坐标一律**归一化 0～1**；绘图序号必须单调递增，服务端拒绝旧包。
   - 橡皮擦/填充仍需保持「只传点击位置与颜色，不传像素」的约束（客户端按同一历史重放）。
   - **渲染模型固定为直线段描边增量同步**；不要引入轮廓填充型平滑库（曾导致白边/闪烁/空心缺陷，已回退）。
   - **画布重放必须原子提交、且只经画布重放状态机**：一切历史变化只经 `DrawingReplayMachine.sync()` 单入口，重放只画进后备 canvas，整帧成功后一次性换入逻辑层；中止/取消的重放与逻辑层直接 `clearRect` 一律禁止（曾致填充空白窗口与 e2e 随机红，见 `docs/adr/0017-*.md`、`docs/adr/0018-canvas-replay-machine.md`）。
   - **画布渲染入口唯一**：对逻辑栅格的绘制只能经 `DrawingReplayMachine` 的 `sync/resize/replay/预览方法`；任何组件或 composable 不得直接持有/绘制逻辑画布上下文与簿记 Map（决策归属见 `docs/adr/0018-canvas-replay-machine.md`）。
   - **绘图历史只增不删**：达到 `maxHistoryCommands` 后服务端**拒绝**新命令（`DRAW_HISTORY_LIMIT_REACHED`，撤销或清空释放名额），服务端与客户端都**不得**为容量压力静默丢弃最旧命令——FIFO 丢弃会让早期封闭边界消失、后续填充重放时吞掉整张画布，并使各客户端镜像与权威历史错位（见 `docs/adr/0010-drawing-history-cap.md`）。
   - 动画化/教学页不在首版范围（新增需另行评审）。
7. **工程约束**
   - 提交前必须通过：`pnpm format` → `pnpm lint`（--max-warnings=0）→ `pnpm typecheck` → `pnpm build`。
   - 目录职责保持现状：shared（协议/纯函数）、server（权威领域）、client（视图）；不要在 client 中裁决游戏逻辑。
   - **不要**新建分片 CSS 文件；组件/页面样式一律行内 Tailwind，重复长串收敛到共享组件或 `@layer components` 共享类。
   - **不要**手改 `pnpm-lock.yaml`、`pnpm-workspace.yaml`；**不要**回滚已应用的 `db/migrate.ts` 迁移（新变更只能追加新迁移）。

---

## 配置、安全与敏感信息

- **环境变量**：仅 `.env.example` 中的 `HOST / PORT / LOG_LEVEL / LOG_ENABLED / LOG_MAX_FILES / HEALTH_METRICS_ENABLED / DRAW_GUESS_OPEN_BROWSER` 可覆盖部署参数（浏览器开关仅产物模式生效）；游戏规则按 shared/public/server-private 边界修改。显式写下的取值或写法非法（`PORT=1e3`、`.env` 带 BOM、布尔项拼错等）一律启动即中止，不静默取默认值（ADR-0035）。`.env` 已被 `.gitignore` 忽略，不入库。
- **密钥 / 凭据**：仓库中**不包含**任何真实密钥、Token、密码或个人信息。临时身份恢复令牌由服务端生成，明文只返回客户端并在当前服务会话内短暂持有；SQLite 仅保存 `players.token_digest` 的 SHA-256 摘要。每次成功恢复必须旋转令牌并使旧摘要失效，令牌仍不是公开快照字段。
- **本地存储**：浏览器仅保存昵称、内置头像编号、本地设置与短期恢复令牌（见 `packages/config/src/app.ts` 的存储键）。
- **敏感信息纪律**：禁止将真实密钥、Token、密码、私有地址或任何个人信息写入仓库、提交日志或本文件。`.gitignore` 已忽略 `.env`、`*.local`、日志与数据库文件。
- **对外最小公开**：前端只能依赖 `@draw-guess/config`；服务端私有字段位于应用内部，生产构建后由 bundle 边界脚本扫描。`/api/info` 只返回 `PUBLIC_CONFIG` 子集。

---

## 提交与协作规范

- **提交信息**（从 `git log` 可确认的既有规范）：采用 Conventional Commits 格式：
  `type(scope)：subject`，其中 `type` 为 `feat/fix/docs/style/refactor/perf/test/build/ci/chore/revert` 之一，`scope` 为影响模块（可选），`subject` 用**中文**、且不超过 50 字、不以句号结尾。需要补充说明时加空行写 `body` 说明动机与上下文。
  示例（取自近期提交）：`fix(画布)：回退 perfect-freehand 轮廓渲染，彻底修复白边/闪烁/空心`、`feat(server)：日志开关与保留条数改为 .env 配置并使其真正生效`、`feat(server)：引入 SQLite 持久化并重构持久化层`。
- **分支与 CI**：实际工作分支以 `git branch --show-current` 为准，不在文档中写死当前分支。`.github/workflows/quality.yml` 在 **push 到 `main`** 与所有 PR 上执行格式、Lint、类型、单测（含组件/集成）、构建、Chromium/Firefox E2E 与 **Windows 构建冒烟**；`pnpm audit` 与洪泛填充基准**不作为门禁**——外部 registry 与机器差异不应误伤质量门禁（见 `docs/adr/0039-ci-gate-scope-and-trigger.md`）。
- **协作约定**：遵守「修改完成后必须执行」的命令，保持一次提交聚焦一个改动点，涉及协议/接口变更时同步前后端。

## AI 代理操作指南

- **优先阅读**：本 `AGENTS.md` → `README.md` → 目标模块对应文件。改动前先读相关文件头部注释（这些注释通常写明设计意图与边界）。
- **修改范围控制**：只改当前任务相关的文件；不要顺手格式化无关文件、不要改动 `pnpm-lock.yaml`、`pnpm-workspace.yaml`、`.pi/`、`dist/`、`node_modules/`、`.env`。
- **如何验证修改正确**：改完运行 `pnpm format && pnpm lint && pnpm typecheck && pnpm build`；涉及界面/流程改动可用浏览器（含 Playwright MCP）端到端验证。
- **遇到不确定事项**：
  - 以**代码与当前配置为准**，不被过时的 README/文档带偏；冲突时向用户确认。
  - 涉及「约束与禁止事项」里明确禁止/限制的改动时，先向用户说明理由并获得确认，不要擅自扩大持久化边界、改变画布渲染模型、引入图片头像、公网暴露或客户端裁决。
  - 找不到依据的规范（如 PR/CI 约定、测试框架）一律标「待确认」，不要自行编造。
- **快速定位速查**：

| 想改什么                                       | 去哪个文件                                                                                                                                                                                                                                                                                                                                                        |
| ---------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| 应用名/版本/公开连接参数                       | `packages/config/src/app.ts`                                                                                                                                                                                                                                                                                                                                      |
| 协议版本/头像/载荷范围                         | `packages/shared/src/protocol/constants.ts`                                                                                                                                                                                                                                                                                                                       |
| 服务端端口/限频/清理/数据库路径                | `apps/server/src/config/`                                                                                                                                                                                                                                                                                                                                         |
| 对局轮数/时间/分数/逐步提示比例                | `packages/config/src/game.ts`                                                                                                                                                                                                                                                                                                                                     |
| 画板颜色/粗细/批次/历史上限                    | `packages/config/src/drawing.ts`（历史上限语义见 `docs/adr/0010-drawing-history-cap.md`）                                                                                                                                                                                                                                                                         |
| 词库内容                                       | `vocabulary/` 目录下的 SQLite 词库包（改后重启服务）                                                                                                                                                                                                                                                                                                              |
| 新增词库来源                                   | `apps/server/src/vocabulary/` 实现 VocabularyProvider → 在 `apps/server/src/vocabulary/index.ts` 的 loadVocabulary 构造点接入（无配置分发开关）                                                                                                                                                                                                                   |
| 新增一个请求事件                               | `packages/shared/src/events.ts` 契约 → `packages/shared/src/protocol/` Schema → `game-service.ts` 或对应领域协作者 → `handlers/*.ts` 注册 → 客户端领域 Store                                                                                                                                                                                                      |
| 回合流转/阶段                                  | `apps/server/src/round-machine.ts`                                                                                                                                                                                                                                                                                                                                |
| 计分规则                                       | `apps/server/src/scoring.ts`                                                                                                                                                                                                                                                                                                                                      |
| 玩法模式 / 接龙规则字段（三时长档位与默认值）  | `packages/config/src/relay.ts`（默认值与复盘四时长）+ `packages/shared/src/protocol/constants.ts`（档位白名单）+ `packages/shared/src/protocol/room.ts`（房间设置 Schema）                                                                                                                                                                                        |
| 接龙状态机 / 复盘轮播 / 投票结算 / 视图裁剪    | `apps/server/src/domain/relay/relay-machine.ts` + `apps/server/src/domain/relay/relay-snapshot.ts`（取舍见 `docs/adr/0058-relay-mode-authoritative-flow-and-reuse.md`）                                                                                                                                                                                           |
| 接龙客户端（Store / 组件 / 协议契约）          | `apps/client/src/stores/relay.ts` + `apps/client/src/components/game/relay/` + `packages/shared/src/protocol/relay.ts`（接龙请求）+ `packages/shared/src/protocol/push.ts`（接龙视图）                                                                                                                                                                            |
| 成员状态判定（占席/可玩/在线/进榜）            | `apps/server/src/domain/room/member-facts.ts`（ADR-0023）                                                                                                                                                                                                                                                                                                         |
| 重连/重同步与自愈                              | `apps/client/src/stores/resync.ts`（冷却/在途/世代校验与会话失效重置，ADR-0025）                                                                                                                                                                                                                                                                                  |
| 快照裁剪/隐私边界                              | `apps/server/src/snapshot.ts`（端口与裁剪）+ `test/unit/snapshot.matrix.spec.ts`（角色×阶段穷举矩阵）                                                                                                                                                                                                                                                             |
| 对局界面布局（顶栏/画布/三栏/工具条）          | `apps/client/src/views/GameView.vue` + `apps/client/src/components/game/`（布局见 `docs/adr/0056-three-column-layout-and-canvas-menu.md`）                                                                                                                                                                                                                        |
| SQLite 建表/迁移                               | `apps/server/src/db/migrate.ts`（新变更追加新迁移）                                                                                                                                                                                                                                                                                                               |
| 持久化仓储（玩家/战报）                        | `apps/server/src/repositories/`                                                                                                                                                                                                                                                                                                                                   |
| 日志开关/保留条数                              | `.env` → `apps/server/src/config/deployment.ts` → `apps/server/src/index.ts`                                                                                                                                                                                                                                                                                      |
| 浏览器来源放行面（本机/私网/服务器自己的名字） | `apps/server/src/app.ts`（`isAllowedOrigin`）+ `apps/server/src/startup/local-hostnames.ts`（本机名枚举；见 ADR-0036 / ADR-0037）                                                                                                                                                                                                                                 |
| 画布渲染/增量绘制                              | `apps/client/src/canvas/replay-machine.ts`（重放状态机：决策/世代/簿记/原子提交）+ `components/game/GameCanvas.vue`（薄装配壳）+ `composables/useCanvas*.ts` / `useStrokeSession.ts`（直线段描边，勿引入轮廓填充平滑库）                                                                                                                                          |
| 填充重放/降级与填充门禁                        | `apps/client/src/canvas/flood-fill-worker.ts`（Worker 失败降级一次）+ `canvas/replay-machine.ts`（渲染态）+ `composables/useFillSession.ts`（提交态）+ `canvas/fill-diagnostics.ts`（见 `docs/adr/0009-fill-degradation-and-locks.md`、ADR-0018）                                                                                                                 |
| 音效资源/播放策略                              | `packages/config/src/audio.ts` → `apps/client/src/audio/` → `composables/useAudioFeedback.ts`（音效文件名清单与格式约定见 `apps/client/src/assets/audio/README.md`；BGM 系统已移除）                                                                                                                                                                              |
| Windows 分发包构建/发布                        | `apps/server/scripts/package-dist.ts`（esbuild 单文件 + 资源 + 内置 Node 校验下载 + zip）+ `apps/server/src/runtime-layout.ts`（源码/产物布局）+ `apps/server/src/build/node-dist.ts`（内置 Node 版本解析与 SHASUMS 校验）+ `apps/server/src/build/dist-templates.ts`（start.cmd/使用说明模板）+ `.github/workflows/windows-release.yml`（见 ADR-0034、ADR-0050） |
| 全局样式 / Tailwind 令牌                       | `apps/client/src/style/index.css`                                                                                                                                                                                                                                                                                                                                 |
| 类名合并 cn()                                  | `apps/client/src/utils/cn.ts`                                                                                                                                                                                                                                                                                                                                     |

---

以「服务端权威 + 角色裁剪快照 + 幂等 ack + 增量绘图 + 低频持久化」为核心原则开发。除非需求/清单明确要求且经得起「约束与禁止事项」核对，否则不要擅自扩大持久化边界、改变画布渲染模型、引入图片头像、公网暴露或客户端裁决。

---

## 架构决策与技能

所有架构、领域与工程决策统一记录在 `docs/adr/`（格式见 `docs/adr/README.md`），不使用临时 Markdown 议题目录。单上下文领域词表位于根 `CONTEXT.md`。分诊标签保留五个规范角色的默认字符串（needs-triage / needs-info / ready-for-agent / ready-for-human / wontfix）。
