# 你画我猜（局域网联机版）

基于 Vue 3、TypeScript、Socket.IO 与 Express 的 2～6 人局域网实时派对游戏。支持大厅公开房间和短码私密房间；服务端权威维护身份、访问控制、答案、计时、绘图资格和分数。

## 运行环境

- Node.js 当前维护中的 LTS（建议 22 或 24）
- pnpm 10+
- Chromium、Edge、Chrome 或 Firefox 的现代版本

前端运行时依赖：`vue@3` + `pinia`（状态）、`socket.io-client`（实时通信）、`zod`（经共享包引入，协议校验）、`@tanstack/vue-virtual`（词库虚拟列表，随词库弹窗按需加载）、`@vueuse/core` + `@vueuse/integrations`（组合式工具，含 `useFocusTrap`）、`nanoid`（短 ID）、`clsx` + `tailwind-merge`（类名合并 `cn()`）、`canvas-confetti`（猜中礼花，按需加载）、`focus-trap`（弹窗焦点陷阱 peer）。**Toast 为自建组件（`components/common/AppToaster.vue` + `composables/useToasts.ts`）**，未使用第三方通知库；UI 图标来自 `lucide-vue-next`，样式基于 Tailwind CSS v4（容器单位 `cqh/cqw` 整屏缩放）。画布渲染采用「归一化点列 + 直线段描边」的增量同步模型。服务端另含 `better-sqlite3`（本地持久化，WAL）、`compression`（静态 gzip）。

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
pnpm test:coverage    # 全部 Vitest 项目 + V8 覆盖率阈值
pnpm test:e2e         # Playwright 跨浏览器端到端测试
```

> 测试分为 Vitest 单元、组件、集成三层及 Playwright E2E；CI 会执行 V8 覆盖率门禁并上传 HTML/LCOV 报告。
> 提交前最低验证：`pnpm format && pnpm lint && pnpm typecheck && pnpm build`；
> 涉及规则/状态机/绘图/持久化等关键逻辑时额外跑 `pnpm test:unit` 与 `pnpm test:e2e`（均为隔离环境，不碰真实数据）。

## 配置与词库

- **配置边界**：协议版本、头像白名单和载荷范围以 [`packages/shared/src/protocol/constants.ts`](packages/shared/src/protocol/constants.ts) 为唯一来源；浏览器安全默认值由 [`@draw-guess/config`](packages/config/src/index.ts) 导出；限频、数据库路径和清理策略位于 [`apps/server/src/config/`](apps/server/src/config/)；禁止跨边界复制协议常量。
- **部署覆盖**：复制 [`.env.example`](.env.example) 为根目录 `.env`，可配置 `HOST`、`PORT`、`LOG_LEVEL`、`LOG_ENABLED`、`LOG_MAX_FILES`、`HEALTH_METRICS_ENABLED`；服务启动时会自动加载 `.env`（进程已有环境变量优先级更高）。环境变量不会覆盖游戏规则。
  - `LOG_ENABLED=false` 时完全不创建日志记录器、不写日志文件（零内存开销）；
  - `LOG_MAX_FILES` 控制日志文件保留条数（默认 10，每次启动新建一个 `apps/server/log/app-<秒级时间戳>.log`，超出删除最老）。
  - `/api/health` 默认只返回版本与协议安全摘要；仅当 `HEALTH_METRICS_ENABLED=true` 且请求来自本机回环地址时返回详细聚合指标。
- **词库来源**：[`vocabulary/`](vocabulary/) 目录下可包含多个 SQLite 词库包（metadata/words 表），由 Provider 注册并在房间内选择。词条为富字段（词面/别称/唯一分类/难度/词条级时限与权重等），**词条分类同时作为作画阶段的猜词提示**；分类必须落在 `metadata.category_enum` 白名单内，`enabled=false` 的词条不参与抽选。修改后重启服务生效，异常数据会以中文错误阻止启动。
- 服务启动时会按规范化词面去重并生成稳定 ID（`sqlite:主键`）；词条过少或过长会阻止启动并显示中文错误。

## 工程结构

```text
apps/client/       Vue 3 游戏舞台、内置 SVG 头像、Pinia 状态与 Canvas 实时画板
  └─ src/components/  # 按领域分子目录，各自提供 index.ts barrel：
                      #   common/   共享原语（AppButton / BaseDialog / ConfirmDialog / 输入与开关等）
                      #   game/     对局（HUD / 画布 / 工具栏 / 聊天 / 阶段遮罩）
                      #   lobby/    大厅弹窗（建房 / 私密房加入）
                      #   room/     房间（席位 / 规则 / 邀请 / 词库）
                      #   settings/ 设置页分类（声音 / 显示 / 快捷键 / 诊断）
  └─ src/views/       ProfileView / LobbyView / RoomView / GameView / SettingsView
apps/server/       Express、Socket.IO、权威领域状态与 SQLite 本地持久化
  └─ src/config/                # 服务端私有限频、清理、数据库路径与部署参数
  └─ src/db/ 与 src/repositories/   # 数据库连接/迁移与仓储（player/archive）
packages/shared/   DTO、Zod schema、协议常量、事件名和领域纯函数（完全自包含）
packages/config/   浏览器安全的公开应用配置 workspace 包
packages/strings/  客户端与服务端展示文案 workspace 包
vocabulary/        唯一权威词库目录（SQLite 数据库，Provider 加载）
docs/adr/          架构决策记录（背景 / 决策 / 后果），源码注释引用此处
```

客户端样式采用**模块化分层**：`apps/client/src/style/index.css` 只做聚合导入，具体规则分散在同目录
`tokens.css`（`@theme` 设计令牌）、`base.css`（reset 与舞台容器上下文）、`components.css`（共享组件类）、
`utilities.css`（交互修饰类与紧凑布局契约类）、`animations.css`（过渡钩子与关键帧）、`other.css`（设备方向）。
组件/页面自身视觉一律写成 Vue 模板内的行内 Tailwind 类；不在共享层之外新增原生 CSS 类选择器，也不新建分片 CSS 文件。

## 版本与发布

- **应用版本的唯一权威源**是 [`packages/config/src/app.ts`](packages/config/src/app.ts) 的 `app.version`：启动横幅、`/api/health`、设置页诊断都取它，文档里出现的版本号也必须与之一致。
- 仓库内各 `package.json`（根与 `apps/*`、`packages/*`）都是 `private: true` 的 workspace 包，**不发布到 npm**；其中的 `version` 字段只是占位，与产品版本无关，不要作为版本依据。

> 完整文件职责逐行说明与项目约定，见根级 [AGENTS.md](AGENTS.md)（面向后续开发者/AI，最权威）。

## 安全与状态恢复

客户端请求统一带 `requestId`、超时和 ack，并在写入任何状态前用共享 ack Schema（`CLIENT_RESPONSE_SCHEMAS`）校验响应外壳、成功 data、登记错误码与回显 `requestId`：非法响应按协议损坏处理（不重试、不写入 Pinia、只记录脱敏诊断并显示统一安全文案）。服务端校验协议版本、恢复令牌、成员资格、房间码、角色、阶段、回合、版本、绘图序号与频率。私密房使用服务端安全随机生成的短码且不会进入大厅列表；候选词仅发送当前画家，猜中判断和计分只在服务端执行。

**身份恢复边界**：恢复令牌明文只返回并保存在当前客户端；服务端仅在签发或校验调用栈中短暂接触明文，常驻内存与 SQLite 都只保存 SHA-256 摘要。每次成功恢复都会签发新令牌并立即使旧令牌失效；并发恢复只有一个请求能接管原身份。

**浏览器边界**：HTTP API、Socket.IO polling 与 WebSocket 握手共用本机/私网 Origin 白名单。响应启用仅覆盖同源生产脚本、Socket.IO、音频、SVG/data/blob 资源与 Vue 行内 style 属性的 CSP；为保证纯 HTTP 局域网访问，不启用 `upgrade-insecure-requests` 或 HSTS。本项目仍仅面向可信局域网，不应通过端口转发、反向代理或公网 IP 暴露到互联网。

**状态持久化边界**：服务端为「内存权威 + 低频落盘」——房间、成员席位、画布笔画、聊天消息、计时器和对局实时状态均不落盘，重启即清空；仅玩家身份摘要/资料/偏好与完成局战报经 SQLite 落盘（`apps/server/data/game.db`）。重启后身份可凭客户端持有的令牌在宽限内恢复到大厅，历史战报可查。业务日志写入 `apps/server/log/` 文件（不输出到控制台，避免 Windows 控制台 GBK 解码 UTF-8 中文乱码）。浏览器本地只保存三个键：`draw-and-guess-profile-v1`（昵称 / 内置头像编号 / 短期恢复令牌）、`draw-and-guess-settings-v1`（本地设置），以及 `sessionStorage` 的 `draw-and-guess-fullscreen-prompt-v1`（全屏提示已读标记）。

## 新版交互说明

- 玩家头像从 40 个内置 SVG 中选择，协议只传递白名单编号，不支持上传、任意 URL 或 SVG 正文。
- 公开房间实时进入大厅列表；私密房不公开，由房主分享服务端生成的房间码或发送定向邀请。
- 画板支持自由画笔、橡皮擦和封闭区域填充；画笔与橡皮擦共用连续粗细滑块，并都可在画板内用滚轮调整。
- 画笔与填充支持预设或任意 HEX 颜色；画笔、橡皮擦和填充均可使用设置页中的自定义快捷键切换。
- UI 静态文字默认不可拖选；按钮、弹窗和状态变化提供统一轻量动效，并可在设置中关闭。
- 新版不提供教学页面或首次教学引导，快捷键说明直接显示在工具提示和设置中。

## 继续开发

- 完整目录职责、编码/测试/提交流程与项目硬性限制：[AGENTS.md](AGENTS.md)

提交前应依次运行 `pnpm format`、`pnpm lint`、`pnpm typecheck` 和 `pnpm build`。
