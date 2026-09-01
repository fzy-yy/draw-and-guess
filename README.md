# 你画我猜（局域网联机版）

基于 Vue 3、TypeScript、Socket.IO 与 Express 的 2～6 人局域网实时派对游戏。支持大厅公开房间和短码私密房间；服务端权威维护身份、访问控制、答案、计时、绘图资格和分数。

## 运行环境

- Node.js 当前维护中的 LTS（建议 22 或 24）
- pnpm 10+
- Chromium、Edge、Chrome 或 Firefox 的现代版本

前端已引入并可直接使用：`@tanstack/vue-virtual`（虚拟列表）、`@vueuse/core`（组合式工具）、`nanoid`（短 ID）、`clsx`（类名合并）；UI 图标来自 `lucide-vue-next`，样式基于 Tailwind CSS v4（容器单位 `cqh/cqw` 整屏缩放）。

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
pnpm lint          # ESLint
pnpm format        # 写入 Prettier 格式
pnpm format:check  # 检查格式
```

## 配置与词库

- **唯一业务配置**：根级 [`config.ts`](config.ts)，按网络、玩家、房间、游戏、画板、音频、词库和 UI 分类。新增可调参数应先加入这里。
- **部署覆盖**：复制 [`.env.example`](.env.example) 的 `HOST`、`PORT`、`LOG_LEVEL`；环境变量不会覆盖游戏规则。
- **唯一词库**：根级 [`vocabulary.md`](vocabulary.md)。每个非空行只能写一个词或短语，不要加标题、列表符号、编号或注释。修改后重启服务生效。
- 服务启动时会清理换行和首尾空白、过滤空行、按规范化词面去重并生成稳定 ID；词条过少或过长会阻止启动并显示中文错误。

## 工程结构

```text
apps/client/       Vue 3 游戏舞台、内置 SVG 头像、Pinia 状态与 Canvas 实时画板
  └─ src/components/  # 按领域拆分：game/ 对局、room/ 房间、settings/ 设置；
                      # 共享组件 AppButton / BaseDialog / ConfirmDialog 放在 components/ 根目录
apps/server/       Express、Socket.IO 与权威内存领域状态
packages/shared/   DTO、Zod schema、事件名和领域纯函数
config.ts          唯一业务配置中心（按领域聚合 config/ 目录）
vocabulary.md      唯一权威词库正文
```

客户端样式采用「单一 `apps/client/src/style/index.css`（Tailwind `@theme` 令牌 + `@layer base` 全局层与 `@layer components` 共享组件类）+ 组件内行内 Tailwind 类」的约定，不新建分片 CSS 文件。

> 完整文件职责逐行说明与项目约定，见根级 [AGENTS.md](AGENTS.md)（面向后续开发者/AI）。

## 安全与状态恢复

客户端请求统一带 `requestId`、超时和 ack。服务端校验协议版本、恢复令牌、成员资格、房间码、角色、阶段、回合、版本、绘图序号与频率。私密房使用服务端安全随机生成的短码且不会进入大厅列表；候选词仅发送当前画家，猜中判断和计分只在服务端执行。临时身份令牌只用于当前服务进程内的短暂断线/刷新恢复。

服务端不使用数据库，也不写入运行日志、战绩、聊天、会话或遥测文件；重启服务后全部运行状态清空。浏览器仅在本机保存昵称、内置头像编号、本地设置和短期恢复令牌。

## 新版交互说明

- 玩家头像从 40 个内置 SVG 中选择，协议只传递白名单编号，不支持上传、任意 URL 或 SVG 正文。
- 公开房间实时进入大厅列表；私密房不公开，由房主分享服务端生成的房间码或发送定向邀请。
- 画板支持自由画笔、橡皮擦和封闭区域填充；画笔与橡皮擦共用连续粗细滑块，并都可在画板内用滚轮调整。
- 画笔与填充支持预设或任意 HEX 颜色；画笔、橡皮擦和填充均可使用设置页中的自定义快捷键切换。
- UI 静态文字默认不可拖选；按钮、弹窗和状态变化提供统一轻量动效，并可在设置中关闭。
- 新版不提供教学页面或首次教学引导，快捷键说明直接显示在工具提示和设置中。

## 继续开发

- 完整目录职责与项目硬性限制：[AGENTS.md](AGENTS.md)
- 开发计划与模块建议：[开发建议.md](开发建议.md)
- 样式重构与代码审查结论：[样式重构与代码审查报告.md](样式重构与代码审查报告.md)

提交前应依次运行 `pnpm format`、`pnpm lint`、`pnpm typecheck` 和 `pnpm build`。
