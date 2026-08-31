# agents.md —— 项目导读（面向开发者 / AI 助手）

> 本文件是所有后续开发（人工或 AI）的**第一入口**。下列内容以**当前代码为准**；`需求文档.md` 可能过时，若与本文件或代码冲突，一律以代码与本文件为准。

---

## 1. 项目是什么

「你画我猜 / Draw and Guess」——基于 **Vue 3 + TypeScript + Socket.IO + Express** 的 2～6 人**局域网**实时派对游戏。

- **服务端权威**：身份、房间、阶段、答案、计时、绘画资格与分数全部由服务端裁决；客户端只发操作请求，结果经“角色裁剪快照”回写。
- **公开 / 私密房间**：公开房进入大厅列表；私密房不公开，只能通过服务端生成的短码或定向邀请加入；不支持自定义密码或二维码。游戏进行中可配置为**观战可加入**（spectate）。
- **内存态**：不落数据库，服务重启即清空（含身份、房间、画布、分数）。

## 2. 目录树与文件作用（逐文件）

```text
draw_and_guess/
├── package.json                  # 根工程：scripts（dev/build/start/typecheck/lint/format）、workspace 依赖
├── pnpm-workspace.yaml           # pnpm workspace：apps/* 与 packages/* 工作区
├── pnpm-lock.yaml                # 依赖锁文件（勿手改）
├── tsconfig.json                 # 根 TS 基础配置 + 路径别名（@draw-guess/shared、@draw-guess/config、@/）
├── eslint.config.js              # ESLint 扁平配置（Vue/TS/Node，DOM globals 白名单）
├── .prettierrc.json / .prettierignore # Prettier 格式（无分号/单引号/行宽 100/尾逗号 all）与忽略
├── .env.example                  # 部署环境变量示例（HOST/PORT/LOG_LEVEL），仅覆盖部署参数
├── .gitignore                    # 忽略 node_modules/dist/本地环境文件
├── config.ts                     # ★唯一业务配置中心（聚合 export）：APP_CONFIG / PUBLIC_CONFIG / getDeploymentConfig
├── config/                        # 按领域拆分的配置（由 config.ts 聚合，保持单一入口；strings.ts 除外）
│   ├── app.ts                     # 应用标识、名称版本、协议版本、storageKey、网络/连接参数（含限频与宽限）
│   ├── player.ts                  # 玩家资料：昵称长度、随机默认昵称与 40 个内置 SVG 头像 ID 白名单
│   ├── room.ts                    # 房间默认名、公开性、私密短码、允许邀请/暂停、加入策略 joinPolicy
│   ├── game.ts                    # 对局规则：轮数/作画/选词/候选数、提示、分数（基础/速度/顺序/画家）
│   ├── drawing.ts                 # 画板：预设色、色正则、粗细区间、填充容差、批次/限频/历史命令预算注释
│   ├── vocabulary.ts              # 词库：路径、编码、最小/最大词条数、去重与重置策略
│   ├── audio.ts                   # 音效合成 cue（频率序列与时长）与增益
│   ├── settings.ts                # 本地设置（音量/动画/快捷键/发现偏好/自动聚焦）、UI 参数、预设安全短语
│   └── strings.ts                 # ★唯一 UI 文案表：展示在界面上的全部中英文字符（客户端 strings / 服务端 serverStrings）；因含模板函数不纳入 PUBLIC_CONFIG，客户端经 @draw-guess/strings 导入、服务端经相对路径导入
├── vocabulary.md                 # ★唯一权威词库：每行一个词，禁止标题/列表符号/注释
├── README.md                      # 项目总览、十分钟启动、命令与续开发入口
├── agents.md                      # 本文件：目录导读、硬性限制、启动方法
├── 需求文档.md                     # 原始需求（可能过时，冲突以代码为准）
├── 代码审查与问题清单.md           # 待处理问题（当前仅剩 B1/B3/F4 三项低优项）
├── 开发建议.md                     # 开发计划/新功能/优化/模块拆分（M0-M3 里程碑）
│
├── packages/shared/               # 前后端共享层（无环境依赖）
│   └── src/
│       ├── index.ts               # 聚合出口：re-export 下列四模块（引用路径保持 @draw-guess/shared）
│       ├── events.ts              # 全部 Socket.IO 事件名常量 EVENTS（前后端唯一事件名来源）
│       ├── types.ts               # 领域类型：房间阶段/成员/规则/快照/绘图命令/邀请等 DTO（含 spectating 观战位）
│       ├── schemas.ts             # Zod 运行时校验：注册/资料/建房/规则/绘图等请求载荷
│       └── pure.ts                # 纯函数：答案规范化、答屏蔽罩、计分、近似判断、状态机转换表
│
├── apps/server/                   # 服务端（Express 5 + Socket.IO + Zod）
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
│       ├── protocol/
│       │   └── binder.ts          # 统一请求绑定：schema 校验、会话限频、幂等缓存、统一 ack
│       └── handlers/              # 按领域分组的事件注册（全部走 binder）
│           ├── session.ts         # 注册/资料/偏好/大厅/状态重同步/ping/断线
│           ├── room.ts            # 公开/私密建房与加入、离房、准备、规则、词库、踢人/移交、邀请
│           ├── game.ts            # 开始/选词/暂停/恢复/提前结束/返回房间
│           ├── chat.ts            # 猜词、预设安全短语
│           └── draw.ts            # 笔画批次/填充/撤销/重做/清空（跳过通用限频）
│
├── apps/client/                   # 客户端（Vue 3 + Pinia + Vite + Tailwind4 + Socket.IO）
│   ├── package.json               # 依赖（vue/pinia/socket.io-client/lucide-vue-next/tailwindcss）
│   ├── tsconfig.json              # 继承根配置 + DOM/vite 类型
│   ├── vite.config.ts             # Vite 配置：@draw-guess/config 虚拟公开模块裁剪、/@ alias、开发代理
│   ├── index.html                 # 入口 HTML（#app 挂载点，移动端缩放/主题色）
│   └── src/
│       ├── main.ts                # 客户端入口：创建 App 并挂载 #app
│       ├── App.vue                # 根舞台：页面互斥渲染（对局>房间>设置>大厅>资料）、Toast、邀请横幅、竖屏提示
│       ├── style/                 # 拆分后的全局样式（保持书写顺序，index.css 汇总）
│       │   ├── index.css          # 样式入口（@import tailwindcss + 各分块）
│       │   ├── base.css           # 设计令牌、reset、舞台缩放、通用控件/按钮/输入
│       │   ├── profile.css        # 资料页（品牌区/昵称/头像编辑器）
│       │   ├── lobby.css          # 大厅（房间列表/在线玩家/创建弹窗）
│       │   ├── dialog.css         # 舞台内弹层（stage-overlay/game-dialog/confirm）
│       │   ├── room.css           # 房间等待（席位/规则/词库/邀请）
│       │   ├── game.css           # 对局（HUD/得分条/画布/聊天/工具栏/阶段遮罩）
│       │   ├── settings.css       # 设置页（标签/滑块/快捷键/诊断）
│       │   └── toast.css          # Toast/邀请横幅/竖屏警告样式
│       ├── stores/
│       │   ├── game.ts            # Pinia store：本地资料/设置、房间与对局状态、业务操作请求（发送方）
│       │   ├── socket.ts          # Socket 单例 + 推送事件桥接（HMR dispose）
│       │   └── request.ts         # 请求封装：timeout+ack+错误翻译+quiet 静默降级
│       ├── composables/
│       │   ├── useAudioFeedback.ts # Web Audio 合成提示音（自动播放入口解锁、音量实时读取）
│       │   ├── useGameHud.ts      # 对局 HUD 计算：剩余时间/进度/猜词权限/阶段标签/排行
│       │   └── useShortcuts.ts    # 画板快捷键：自定义单键切换工具、撤销/重做组合键
│       ├── components/
│       │   ├── AvatarImage.vue    # 内置 SVG 头像统一安全展示（只接收白名单编号）
│       │   ├── AvatarPickerDialog.vue # 40 个 SVG 头像选择模态框
│       │   ├── GameSettingsDialog.vue # 对局内不离场的快速设置模态框
│       │   └── GameCanvas.vue     # 高 DPI 实时画板：增量绘制、橡皮擦/destination-out、洪泛填充、滚轮线宽
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
└── docs/                          # ❌ 已删除（内容要点已并入 README/agents.md）
```

---

## 3. 本项目严格限制的内容（改动代码前必读）

> 这些是**明确不允许或强烈不建议**的改动；违背会导致安全问题、无法联机或验收失败。

1. **架构与权威性**
   - 服务端必须保持**权威裁决**：答案、计分、阶段、计时、绘画资格只能由服务端判定；客户端永远不能上传“裁决结果”。
   - 服务端**不使用数据库、不写运行日志文件**（仅结构化内存 + logger），重启即清空运行状态——不要擅自引入持久化。
   - 公开房必须进入大厅列表；私密房必须从大厅隐藏，短码只能由服务端安全随机生成并限频校验，禁止客户端自选弱码、自定义密码、邀请链接或二维码。
2. **隐私与安全边界**
   - 带 `Secret` 后缀的服务端数据（恢复令牌、候选词、内部计时器、请求缓存）**绝不**原样出现在任何快照/事件中；对外一律经 `snapshot.ts` 裁剪。私密房短码仅作为用户可见访问凭据裁剪给当前房主。
   - 客户端请求必须带 `requestId`（幂等）、统一 ack；非法阶段/角色/序号/频率由 `binder.ts` 与领域服务拒绝。
   - 头像只允许 `config/player.ts` 白名单中的内置 SVG 编号；**禁止上传图片、任意 URL、data URI、SVG 正文、粘贴或拖放头像**。
3. **词库与内容**
   - `vocabulary.md` 每行只能写一个词/短语：**禁止标题、列表符号、编号、注释**；修改后需重启服务。
   - 猜词判定固定为 `normalizeAnswer`（NFKC + 去空白 + 折叠空白 + 忽略拉丁大小写），不要在别处另写一套比较。
4. **配置治理**
   - 业务规则**只允许**写在 `config/` 目录 + `config.ts` 聚合；环境变量仅覆盖 `HOST / PORT / LOG_LEVEL`，禁止环境变量覆盖游戏规则。
   - UI 文案**只允许**写在 `config/strings.ts`（客户端 `strings` / 服务端 `serverStrings`），组件与业务代码严禁硬编码展示字符；该文件含模板函数，不进入 `PUBLIC_CONFIG`。
   - 不要把配置明文写死进业务代码（应用名、版本、协议版本等集中在 `config/app.ts`）。
5. **联机与部署**
   - 服务监听默认 `0.0.0.0`，前端构建产物托管与 Socket.IO 必须在**同一 Node 服务**（端口分离仅限开发代理）。
   - 服务**不要开放到公网**；若主机被其它设备访问，需保证防火墙放行专用网络，并提示同一网段。
   - `protocolVersion` 变更属不兼容变更，必须与客户端同步 +1。
6. **画布与体验**
   - 坐标一律**归一化 0～1**；绘图序号必须单调递增，服务端拒绝旧包。
   - 橡皮擦/填充仍需保持“只传点击位置与颜色，不传像素”的约束（客户端按同一历史重放）。
   - 动画化/教学页不在首版范围（新增需另行评审）。
7. **工程约束**
   - 提交前必须通过：`pnpm format` → `pnpm lint`（--max-warnings=0）→ `pnpm typecheck` → `pnpm build`。
   - 目录职责保持现状：shared（协议/纯函数）、server（权威领域）、client（视图）；不要在 client 中裁决游戏逻辑。

---

## 4. 启动方法

### 4.1 环境要求

- Node.js 当前维护中的 LTS（建议 22 或 24）
- pnpm 10+
- 现代 Chromium/Edge/Firefox（支持 container queries）

### 4.2 首次安装

```bash
pnpm install
```

### 4.3 开发模式（本机联调）

```bash
pnpm dev
```

- 客户端：`http://localhost:5173`（Vite 代理 `/api` 与 `/socket.io` 到 5174）
- 服务端：`http://localhost:5174`

### 4.4 生产局域网模式（正式游玩）

```bash
pnpm build      # 先执行类型检查并构建前端
pnpm start      # 单一 Express + Socket.IO 生产服务
```

- 终端会醒目输出：主机访问地址、一个或多个 `http://局域网IP:5174` 候选地址、端口与加入说明。
- 其他玩家连接**同一局域网**后在浏览器输入上述局域网地址即可。
- 常见问题：IP/端口与终端输出不一致、设备不在同一网段、防火墙未放行 Node.js 专用网络、版本不兼容（刷新/清缓存）。
- 端口/监听地址/日志级别可用环境变量覆盖：`PORT=5180 pnpm start`、`HOST=0.0.0.0`、`LOG_LEVEL=debug`（复制 `.env.example`）。

### 4.5 其它命令

```bash
pnpm typecheck   # 全 workspace 严格类型检查
pnpm lint        # ESLint（无警告达标）
pnpm format      # Prettier 写入
pnpm format:check# 仅检查格式
```

---

## 5. 快速定位速查

| 想改什么                    | 去哪个文件                                                                                                                                             |
| --------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------ |
| 应用名/版本/端口/限频参数   | `config/app.ts`（经 config.ts 聚合）                                                                                                                   |
| 对局轮数/时间/分数/提示     | `config/game.ts`                                                                                                                                       |
| 画板颜色/粗细/批次/历史上限 | `config/drawing.ts`                                                                                                                                    |
| 词库内容                    | `vocabulary.md`（改后重启服务）                                                                                                                        |
| 新增一个请求事件            | `packages/shared/src/events.ts`（事件名）→ `schemas.ts`（校验）→ `game-service.ts` 或对应 handler → `handlers/*.ts` 注册 → `stores/game.ts` 客户端方法 |
| 回合流转/阶段               | `apps/server/src/round-machine.ts`                                                                                                                     |
| 计分规则                    | `apps/server/src/scoring.ts`                                                                                                                           |
| 快照裁剪/隐私边界           | `apps/server/src/snapshot.ts`                                                                                                                          |
| 画布渲染/增量绘制           | `apps/client/src/components/GameCanvas.vue`                                                                                                            |
| 全局样式                    | `apps/client/src/style/*.css`                                                                                                                          |

---

## 6. 结语

以“服务端权威 + 角色裁剪快照 + 幂等 ack + 增量绘图”为核心原则开发。除非需求文档/清单明确要求且经得起上述“严格限制”核对，否则不要引入数据库、私密房、图片头像、公网暴露或客户端裁决。
