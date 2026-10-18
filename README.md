# 你画我猜

基于 Vue 3、TypeScript、Socket.IO 与 Express 的 2～6 人局域网实时派对游戏。支持大厅公开房间和短码私密房间；服务端权威维护身份、访问控制、答案、计时、绘图资格和分数。两种玩法在**建房时选定、房间内不可修改**：**经典模式**轮流当画家、一轮一题；**接龙模式**下每人发起一条传话链、全员并行开画，四步（画 → 猜 → 画 → 猜）走完后逐链复盘并投票。房间容量固定 6 人、开局后不可加入。除源码运行外，还可打成 **Windows 分发包**（服务端单 JS + 前端产物 + 内置 Node 运行时），解压双击 `start.cmd` 即可用，无需预装 Node。

## 运行环境

- Node.js 当前维护中的 LTS（建议 22 或 24）
- pnpm 11+（版本由 `packageManager` 钉定 11.25.0）
- Chromium、Edge、Chrome 或 Firefox 的现代版本

前端运行时依赖：`vue@3` + `pinia`（状态）、`socket.io-client`（实时通信）、`zod`（经共享包引入，协议校验）、`@tanstack/vue-virtual`（词库虚拟列表）、`@vueuse/core` + `@vueuse/integrations`（组合式工具，含 `useFocusTrap`）、`nanoid`（短 ID）、`clsx` + `tailwind-merge`（类名合并 `cn()`）、`canvas-confetti`（猜中礼花）、`focus-trap`（弹窗焦点陷阱 peer）。**Toast 为自建组件（`components/common/AppToaster.vue` + `composables/useToasts.ts`）**，未使用第三方通知库；UI 图标来自 `lucide-vue-next`，样式基于 Tailwind CSS v4（容器单位 `cqh/cqw` 整屏缩放）。画布渲染采用「归一化点列 + 直线段描边」的增量同步模型。服务端另含 `better-sqlite3`（本地持久化，WAL）、`compression`（静态 gzip）。

## 十分钟启动

```bash
pnpm install
pnpm dev
```

开发模式：客户端 `http://localhost:5173`，Vite 会代理 `/api` 与 `/socket.io` 到 `5174` 服务端。

生产局域网模式：

```bash
pnpm build
pnpm start
```

终端会醒目输出主机地址、端口和一个或多个局域网 IPv4 URL。其他玩家连接同一局域网后，在浏览器输入其中可用的 `http://局域网IP:5174`。若无法连接，请依次确认：IP/端口与终端输出一致、设备处于同一网段、防火墙放行 Node.js 专用网络通信，并避免将服务开放到公网。

## Windows 分发包

```bash
pnpm package:dist   # 构建前端 + 服务端单文件 + 内置 Node，产出一个可运行目录与 zip
```

产物为一个 zip：`draw-and-guess-<version>-win-x64.zip`（约 37MB，**无需安装 Node**，
自带 Node 24 LTS 运行时）。内容：`server.mjs`（依赖已内联）、`client/` 前端、`vocabulary/` 内置词库、
`node_modules/better-sqlite3/` Node-API 预编译模块、`runtime/node.exe`（内置 Node 运行时）、
`start.cmd`、`使用说明.txt`。解压后双击 `start.cmd` 即启动服务并自动打开浏览器，
其他玩家用浏览器访问窗口里列出的局域网地址即可。运行数据写在 `data/`（`game.db`、`logs/`、
`vocabulary/custom/`、可选 `.env`）；默认端口被占用会自动顺延。内置 Node 从镜像下载
（默认国内镜像，可用 `NODE_DIST_MIRROR` 覆盖、`NODE_VERSION` 钉死版本），下载经同源
SHASUMS256.txt 的 sha256 校验，缓存损坏会自动重下一次；产物启动后自动打开浏览器，
`DRAW_GUESS_OPEN_BROWSER=false` 可关闭。
分发包仅面向 Windows x64 与可信局域网，详见
[`docs/adr/0034-node-single-file-distribution.md`](docs/adr/0034-node-single-file-distribution.md)
与 [`docs/adr/0050-single-dist-package.md`](docs/adr/0050-single-dist-package.md)。

## 可用命令

```bash
pnpm dev           # 并行启动前后端
pnpm build         # 类型检查并构建前端
pnpm start         # 单一 Express + Socket.IO 生产服务
pnpm typecheck     # 全 workspace 严格类型检查
pnpm lint          # ESLint（--max-warnings=0）
pnpm format        # 写入 Prettier 格式
pnpm format:check  # 检查格式
pnpm test:unit        # Node 环境的领域/纯函数单元测试
pnpm test:component   # happy-dom 中的 Vue 组件测试
pnpm test:integration # Pinia + MSW 客户端集成测试
pnpm test:ci          # 三层 Vitest 全量（unit/component/integration，CI 用，含 JUnit 输出）
pnpm test:e2e         # Playwright 跨浏览器端到端测试
pnpm package:dist     # 构建 Windows 分发包（一个可运行目录 + zip）
```

> 测试分为 Vitest 单元、组件、集成三层及 Playwright E2E；CI 运行三层全量（`pnpm test:ci`）与 Playwright。
> 提交前最低验证：`pnpm format && pnpm lint && pnpm typecheck && pnpm build`；
> 涉及规则/状态机/绘图/持久化等关键逻辑时额外跑 `pnpm test:unit` 与 `pnpm test:e2e`（均为隔离环境，不碰真实数据）。

## 配置与词库

- **配置边界**：协议版本、头像白名单和载荷范围以 [`packages/shared/src/protocol/constants.ts`](packages/shared/src/protocol/constants.ts) 为唯一来源；浏览器安全默认值由 [`@draw-guess/config`](packages/config/src/index.ts) 导出；限频、数据库路径和清理策略位于 [`apps/server/src/config/`](apps/server/src/config/)；禁止跨边界复制协议常量。
- **玩法模式与接龙规则**：玩法模式（经典 / 接龙）只在**建房弹窗**选定，`gameMode` 位于房间顶层、创建后不可修改，房间头部用徽标显示当前模式。接龙房额外有**选词 / 作画 / 猜词**三档时长（各自白名单，默认 20 / 90 / 45 秒），复盘四时长（重播 3 / 停顿 1 / 揭晓 3 / 投票上限 10 秒）是固定常量、房主不可改，其中投票在链阵容全员投完后会把剩余时间压到 3 秒（每链 17–24 秒，见 [`docs/adr/0063`](docs/adr/0063-relay-vote-settle-acceleration.md)）；对当前模式不生效的规则字段由服务端在 `updateSettings` 严格拒绝。档位白名单在 [`packages/shared/src/protocol/constants.ts`](packages/shared/src/protocol/constants.ts)，默认值与复盘时长在 `packages/config/src/relay.ts`。
- **部署覆盖**：复制 [`.env.example`](.env.example) 为根目录 `.env`，可配置 `HOST`、`PORT`、`LOG_LEVEL`、`LOG_ENABLED`、`LOG_MAX_FILES`、`HEALTH_METRICS_ENABLED`、`DRAW_GUESS_OPEN_BROWSER`（浏览器开关仅分发产物模式生效）；服务启动时会自动加载 `.env`（进程已有环境变量优先级更高）。环境变量不会覆盖游戏规则。
  - `LOG_ENABLED=false` 时完全不创建日志记录器、不写日志文件（零内存开销）；
  - `LOG_MAX_FILES` 控制日志文件保留条数（默认 10，每次启动新建一个 `apps/server/log/app-<秒级时间戳>.log`，超出删除最老）；
  - 配置写法严格校验：`PORT` 只接受纯十进制正整数、`HOST` 只接受 IP 字面量或 RFC1123 主机名、布尔项只接受 `true`/`false`（大小写不敏感），写法或取值不对**启动即报错**；带 UTF-8 BOM 的 `.env`（记事本与 PowerShell 5.1 的默认写法）会被整份拒绝加载，均不会静默取默认值（见 [`docs/adr/0035`](docs/adr/0035-startup-config-fail-fast.md)）。
  - `/api/health` 默认只返回版本与协议安全摘要；仅当 `HEALTH_METRICS_ENABLED=true` 且请求来自本机回环地址时返回详细聚合指标。
- **词库来源**：[`vocabulary/`](vocabulary/) 目录下可包含多个 SQLite 词库包（metadata/words 表），由 Provider 注册并在房间内选择。词条只保留**词面/别称/合集（collection）**——分类枚举白名单与难度、可绘制性、提示、难度级配置与启用位已退出领域模型**并从库表删列**（见 [`docs/adr/0046`](docs/adr/0046-vocabulary-slimming-and-unified-round-time.md)、[`docs/adr/0048`](docs/adr/0048-vocabulary-schema-slimming.md)、[`docs/adr/0053`](docs/adr/0053-vocabulary-collection-and-toolbar-redesign.md)）。合集由词库自动检测聚合供前端筛选与一键全选启用。修改后重启服务生效，异常数据会以中文错误阻止启动。**空白词库样板**在 `vocabulary/templates/example.db`（字段与基础词库一致、0 词条，不参与启动扫描）：玩家复制到 `data/vocabulary/custom/` 填词即可，说明见 `vocabulary/templates/README.md`。
- 服务启动时会按规范化词面去重并生成稳定 ID（`sqlite:主键`）；词条过少或过长会阻止启动并显示中文错误。

## 工程结构

```text
apps/client/       Vue 3 游戏舞台、内置 SVG 头像、Pinia 状态与 Canvas 实时画板
  └─ src/components/  # 按领域分子目录，各自提供 index.ts barrel：
                      #   common/   共享原语（AppButton / BaseDialog / ConfirmDialog / 输入与开关等）
                      #   game/     对局（固定顶栏 / 铺满画布 / 常驻左栏玩家面板 / 浮层聊天面板 / 底部工具条 / 阶段遮罩）
                      #             其中 relay/ 为接龙专属内容（顶栏两形态 / 作答浮层 / 投票卡 / 玩家状态行）
                      #   lobby/    大厅弹窗（建房 / 私密房加入）
                      #   room/     房间（席位 / 规则 / 邀请 / 词库）
                      #   settings/ 设置页分类（声音 / 显示 / 快捷键 / 诊断）
  └─ src/views/       ProfileView / LobbyView / RoomView / GameView / SettingsView
apps/server/       Express、Socket.IO、权威领域状态与 SQLite 本地持久化
  └─ src/core/                  # 核心层：统一配置、AppError 错误模型与统一运行时
  └─ src/infra/                 # 基础设施：SQLite（PRAGMA 顺序与语句缓存）、迁移与文件日志
  └─ src/modules/               # 业务模块纵切：session / room / gameplay / relay / drawing / chat / vocabulary / archive
  └─ src/http/ 与 src/ws/        # 入口层：Express 5 适配（RFC 9457 统一错误）与 Socket.IO 网关
  └─ src/server.ts 与 index.ts   # 组合根（纯构造函数依赖装配）与生产进程入口
  └─ src/config/                # 服务端私有限频、清理、数据库路径与部署参数
  └─ src/domain/relay/          # 接龙状态机、复盘轮播、投票结算与按观看者裁剪的接龙视图
  └─ src/db/ 与 src/repositories/   # 数据库连接/迁移与仓储（player/archive）
  └─ src/runtime-layout.ts      # 源码 / 分发产物两种运行布局（data、client、vocabulary、.env）
  └─ src/build/node-dist.ts     # 分发内置 Node 版本解析与 SHASUMS 校验条目提取（纯函数，可单测）
  └─ src/build/dist-templates.ts # 分发文本模板：start.cmd / 使用说明（纯函数，两包启动差异有单测锁定）
  └─ scripts/package-dist.ts    # 构建 Windows 分发包（esbuild 单文件 + 资源 + 内置 Node + zip）
packages/shared/   DTO、Zod schema、协议常量、事件名和领域纯函数（完全自包含）
packages/config/   浏览器安全的公开应用配置 workspace 包（含接龙三时长默认值与复盘四时长 `relay.ts`）
packages/strings/  展示文案包（`strings.ui` 可见 / `strings.a11y` 无障碍 / `serverStrings` 服务端）
vocabulary/        唯一权威词库目录（SQLite 数据库，Provider 加载）
docs/adr/          架构决策记录（背景 / 决策 / 后果），源码注释引用此处
```

客户端样式采用**模块化分层**：`apps/client/src/style/index.css` 只做聚合导入，具体规则分散在同目录
`tokens.css`（`@theme` 设计令牌）、`base.css`（reset 与舞台容器上下文）、`components.css`（共享组件类）、
`utilities.css`（交互修饰类）、`animations.css`（过渡钩子与关键帧）、`other.css`（设备方向）。
组件/页面自身视觉一律写成 Vue 模板内的行内 Tailwind 类；不在共享层之外新增原生 CSS 类选择器，也不新建分片 CSS 文件。

## 版本与发布

- **应用版本的唯一权威源**是 [`packages/config/src/app.ts`](packages/config/src/app.ts) 的 `app.version`：启动横幅、`/api/health`、设置页诊断都取它，文档里出现的版本号也必须与之一致。
- 仓库内各 `package.json`（根与 `apps/*`、`packages/*`）都是 `private: true` 的 workspace 包，**不发布到 npm**；其中的 `version` 字段只是占位，与产品版本无关，不要作为版本依据。

> 完整文件职责逐行说明与项目约定，见根级 [AGENTS.md](AGENTS.md)（面向后续开发者/AI，最权威）。

## 安全与状态恢复

客户端请求统一带 `requestId`、超时和 ack，并在写入任何状态前用共享 ack Schema（`CLIENT_RESPONSE_SCHEMAS`）校验响应外壳、成功 data、登记错误码与回显 `requestId`：非法响应按协议损坏处理（不重试、不写入 Pinia、只记录脱敏诊断并显示统一安全文案）。服务端校验协议版本、恢复令牌、成员资格、房间码、角色、阶段、回合、版本、绘图序号与频率。私密房使用服务端安全随机生成的短码且不会进入大厅列表；候选词仅发送当前画家，猜中判断和计分只在服务端执行。

**身份恢复边界**：恢复令牌明文只返回并保存在当前客户端；服务端仅在签发或校验调用栈中短暂接触明文，常驻内存与 SQLite 都只保存 SHA-256 摘要。每次成功恢复都会签发新令牌并立即使旧令牌失效；并发恢复只有一个请求能接管原身份。

**浏览器边界**：HTTP API、Socket.IO polling 与 WebSocket 握手共用本机/私网 Origin 白名单（私网来源**只认 IP 字面量**，`10.attacker.com` 这类域名前缀不算，见 [`docs/adr/0036`](docs/adr/0036-origin-private-ip-literal.md)）；另外放行**服务器自己**的计算机名及其 `.local` 形态，用于局域网里 `http://<计算机名>:5174` 这类访问（见 [`docs/adr/0037`](docs/adr/0037-allow-local-hostname-origin.md)）。响应启用仅覆盖同源生产脚本、Socket.IO、音频、SVG/data/blob 资源与 Vue 行内 style 属性的 CSP；为保证纯 HTTP 局域网访问，不启用 `upgrade-insecure-requests` 或 HSTS。本项目仍仅面向可信局域网，不应通过端口转发、反向代理或公网 IP 暴露到互联网。

**状态持久化边界**：服务端为「内存权威 + 低频落盘」——房间、成员席位、画布笔画、聊天消息、计时器和对局实时状态均不落盘，重启即清空；仅玩家身份摘要/资料/偏好与完成局战报经 SQLite 落盘（`apps/server/data/game.db`）。重启后身份可凭客户端持有的令牌在宽限内恢复到大厅，历史战报可查。业务日志写入 `apps/server/log/` 文件（不输出到控制台，避免 Windows 控制台 GBK 解码 UTF-8 中文乱码）。分发包则把同样的数据写到 `server.mjs` 旁的 `data/`（`game.db`、`logs/`、用户自定义词库 `vocabulary/custom/`、可选 `.env`）。浏览器本地只保存三个键：`draw-and-guess-profile-v1`（昵称 / 内置头像编号 / 短期恢复令牌）、`draw-and-guess-settings-v1`（本地设置），以及 `sessionStorage` 的 `draw-and-guess-fullscreen-prompt-v1`（全屏提示已读标记）。

## 新版交互说明

- 玩家头像从 40 个内置 SVG 中选择，协议只传递白名单编号，不支持上传、任意 URL 或 SVG 正文。
- 公开房间实时进入大厅列表；私密房不公开，由房主分享服务端生成的房间码或发送定向邀请。
- 建房时选择**玩法模式**（经典 / 接龙），房间内不可修改；房间头部显示模式徽标。房间容量固定 6 人、开局后不可加入。
- **接龙模式**：每人发起一条传话链、全员并行开画——选词 → 作画 → 猜词 → 作画 → 猜词，每步全员对自己负责的那条链动手一次，画完即提交、全员提交即进入下一棒；猜词的作答浮层可拖动避让画布，作答与聊天互不串（聊天不会带出答案）。
- 四步走完后全员统一步调进入复盘：按链发起人席位顺序逐条轮播，每条链两个半场（先重播画作、再揭晓答案），随后对该链「初始词与最终答案是否匹配」投票；全部链走完后显示接龙口径的终局战报（排名、分数与「参与 N 条链 · 共获 M 张赞同票」）。
- 画板支持自由画笔、橡皮擦和封闭区域填充；画笔与橡皮擦共用连续粗细滑块，并都可在画板内用滚轮调整。
- 画笔与填充支持预设或任意 HEX 颜色；画笔、橡皮擦和填充均可使用设置页中的自定义快捷键切换。
- UI 静态文字默认不可拖选；按钮、弹窗和状态变化提供统一轻量动效，并可在设置中关闭。
- 新版不提供教学页面或首次教学引导，快捷键说明直接显示在工具提示和设置中。

## 继续开发

- 完整目录职责、编码/测试/提交流程与项目硬性限制：[AGENTS.md](AGENTS.md)

提交前应依次运行 `pnpm format`、`pnpm lint`、`pnpm typecheck` 和 `pnpm build`。
