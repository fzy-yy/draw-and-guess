# 0034 · Node 单文件分发与 Windows 双包交付

## 状态

已采纳

## 背景

项目原本只能「装 Node + `pnpm install` + `pnpm start`」运行，对非开发者门槛过高。
曾尝试用 Electron 打成便携 exe，但在原生模块 ABI、ESM 打包与体积上引入了一串问题，最终放弃。
随后改为「把服务端编译打包成一个 JS 文件，用 `node` 直接启动」；但仍有「用户电脑没装 Node」的场景，
于是进一步提供**自带 Node 运行时的 full 包**，让零依赖用户也能双击即用。

约束：

- `better-sqlite3` 是原生模块，无法内联进单个 JS 文本；
- 前端是静态资源，同样不应内联；
- 服务端源码用 `import.meta.url` 定位数据库、日志、词库与前端产物，打包后这些相对路径必须重新解析；
- 源码模式（`pnpm dev`）依赖 Vite 固定端口 5174 代理，产物模式又需要「端口被占用也能启动」；
- 内置 Node 运行时会显著增大分发包，因此需要兼顾「体积敏感」与「零依赖」两类用户。

## 决策

**一、交付形态 = 单 JS + 资源目录，产出 slim / full 两个 zip。** `pnpm package:dist` 一次产出：

```text
release/
├── slim/draw-and-guess/     → draw-and-guess-<version>-win-x64-slim.zip   (约 2MB，需系统 Node 22+)
└── full/draw-and-guess/     → draw-and-guess-<version>-win-x64-full.zip   (约 37MB，自带 Node)
```

两包共有：

```text
draw-and-guess/
├── server.mjs                         服务端 ESM 单文件（依赖内联）
├── start.cmd                          双击启动
├── 使用说明.txt
├── client/                            前端构建产物（由该服务静态托管）
├── vocabulary/                        内置词库（随包）
└── node_modules/better-sqlite3/       Node-API 预编译原生模块（仅 win32-x64）
```

**full** 额外携带：

```text
└── runtime/node.exe + runtime/LICENSE 官方 Node 运行时（Node 24 LTS，win-x64）
```

不做 exe / 安装器；仅支持 Windows x64。运行期数据（`data/`）在首次启动时于 `server.mjs` 旁创建：
`game.db`、`logs/`、`vocabulary/custom/`、可选 `.env`。

**二、`start.cmd` 按包区分。** full 直接用内置 `runtime\node.exe`（免版本检测、开箱即用）；
slim 保持「检测系统 Node 22+，缺失/过低给中文提示并暂停」。两份文本与《使用说明.txt》由
`apps/server/src/build/dist-templates.ts` 纯函数生成（最低 Node 主版本引用单一常量），
两包启动差异由单测锁定，构建脚本只负责落盘。

**三、运行时资源布局由构建期模式决定。** 新增 `apps/server/src/runtime-layout.ts` 纯函数：
构建脚本经 esbuild `define` 注入 `DRAW_GUESS_RUNTIME_MODE=dist`，源码运行时读不到该变量即为 source。

- source：沿用仓库相对路径（`apps/server/data`、`apps/server/log`、仓库 `vocabulary/`、`apps/client/dist`、
  根 `.env`），**端口固定、不自动开浏览器**——保住 Vite 的 5174 代理；
- dist：以 `server.mjs` 所在目录为根解析 `client/`、`vocabulary/`、`data/`，**端口被占用自动顺延、
  启动后自动打开浏览器**（开关 `DRAW_GUESS_OPEN_BROWSER` 经部署配置收口模块解析，默认开、
  `0`/`false` 关闭，登记于 `.env.example`——与 HOST/PORT/LOG_* 同一治理通道）。
  顺延的「探测空闲端口 → 正式监听」之间存在微秒级 TOCTOU 竞态：窗口极小、真发生时下次启动
  会自动再顺延，评审结论为**接受该风险**，不做重试封装。

**四、词库双目录。** 内置词库在产物 `vocabulary/`（随包、升级覆盖）；用户自定义词库放
`data/vocabulary/custom/`（升级不动）。词库加载器扩展为扫描多个目录并合并（同名包 ID 追加序号唯一化），
游戏内不区分来源。

**五、服务端打包用 esbuild，ESM 输出。** 保留 ESM 是因为服务端仍依赖 `import.meta.url` 定位资源根；
`better-sqlite3` 保持 external（Node-API 预编译，ABI 跨 Node/Electron 稳定，无需重建），
`bufferutil` / `utf-8-validate` 这两个 socket.io 的**可选**原生加速模块同样保持 external——
随包未提供它们，Node 在模块缺失时自动降级到纯 JS 实现，功能不受影响（若内联则会在缺失环境直接抛错）。
其余依赖全部内联，使用者无需 `pnpm install`。ESM 产物顶部用 `createRequire(import.meta.url)` 提供真实
`require`，避免内联的 CJS 依赖动态 `require('buffer')` 时触发 esbuild 兜底报错。

**六、内置 Node 的获取（下载即校验）。** 构建时解析官方分发索引里最新的**稳定 Node 24 LTS（v24.x）**，
从镜像下载 win-x64 zip 并缓存到 `release/.cache/`；默认镜像 `https://npmmirror.com/mirrors/node/`，
可用 `NODE_DIST_MIRROR` 覆盖、用 `NODE_VERSION` 钉死版本。full 包内只放 `node.exe` 与 Node 的 `LICENSE`
（不含 npm/npx），随包分发并提供许可证。下载完整性：取同一版本目录的 `SHASUMS256.txt`，
**写缓存与缓存命中都比对 zip 的 sha256**；不符删除缓存重下载一次，二次仍不符报错（只自愈一次防镜像
同步不完整导致的无限重下）；`SHASUMS256.txt` 拿不到或无目标条目按 fail-fast 中止构建。
CI（`windows-latest`，runner 在境外）显式设 `NODE_DIST_MIRROR=https://nodejs.org/dist/`。
信任边界：校验文件与 zip 同源，**防截断/缓存损坏，不防被攻陷的镜像**（防后者需 GPG 签名验证，
超出局域网工具的威胁模型，明确不做）。

**七、发布。** `.github/workflows/windows-release.yml`：打 `v*` tag 在 `windows-latest` 构建两个 zip 并作为
**两个 Release 资产**发布；手动触发只产出一个 artifact（内含两个 zip）。本功能随 `2.5.0` 发布，协议版本不变。

## 后果

- 零依赖用户装 full 包即可双击开服；体积敏感/自带 Node 的用户用 slim 包（约 2MB）。
- 体积远小于 Electron：full 包也仅约 37MB（主要是官方 Node 运行时），slim 包约 2MB。
- 服务端新增的能力是「可配置布局」：多目录词库、日志目录注入、`.env` 路径注入；源码模式默认行为不变。
- 代价与残余风险：
  - full 包内置的 Node 版本随构建时间变化；需要可复现时可设 `NODE_VERSION` 钉死；
  - 构建需要联网下载 Node 运行时（默认国内镜像；海外可设官网），并多一次 SHASUMS256.txt 小文件请求；
  - 端口顺延的探测/监听 TOCTOU 竞态与同源校验的信任边界（如上）均为**已接受的取舍**；
  - 仅 Windows x64；zip 无代码签名概念，建议从官方 Release 下载。

## 关联

- 新增：`apps/server/src/runtime-layout.ts`、`apps/server/src/build/node-dist.ts`、
  `apps/server/src/build/dist-templates.ts`、
  `apps/server/src/startup/port.ts`、`apps/server/src/startup/open-browser.ts`、
  `apps/server/scripts/package-dist.ts`
- 改动：`apps/server/src/index.ts`（布局接线）、`apps/server/src/vocabulary/index.ts`（多目录）、
  `apps/server/src/logging/file-logger.ts`（`logDir`）、`apps/server/src/startup/environment.ts`（`envPath`）、
  `apps/server/src/config/deployment.ts`（`DRAW_GUESS_OPEN_BROWSER` 收口与布尔解析单一口径）
- 命令与发布：根 `package.json`（`package:dist`）、`.github/workflows/windows-release.yml`
- 测试：`test/unit/runtime-layout.spec.ts`、`test/unit/vocabulary-multi-dir.spec.ts`、
  `test/unit/node-dist.spec.ts`、`test/unit/dist-templates.spec.ts`
- 相关：ADR-0004（词库默认包选择）、ADR-0005（日志保留顺序）
