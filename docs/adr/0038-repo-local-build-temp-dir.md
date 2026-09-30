# 0038 构建临时目录固定到仓库内，规避系统 %TEMP% 上的删除拦截

**状态**：已采纳

## 背景

在部分 Windows 机器上，`pnpm build` **必然**失败：

```
[vite:esbuild-transpile] remove C:\Users\<用户>\AppData\Local\Temp\esbuild-<64位hex>: Access is denied.
```

**机制**（逐环节已验证）：

1. esbuild 的 JS API 只在**单次 `transform` 输入超过 1 MiB** 时才落临时文件
   （`node_modules/.pnpm/esbuild@0.28.2/.../lib/main.js` 的 `if (input.length > 1024 * 1024)` 分支），
   路径为 `os.tmpdir()/esbuild-<64位hex>`；随后由 **esbuild 的原生（Go）二进制**（请求带 `inputFS: true`）读取并删除它。
2. 这次删除在系统 `%TEMP%` 下被拒绝，esbuild 把该错误作为 transform 的响应错误上报，Vite 直接中止构建。
3. 本仓库必然命中：Vite 压缩主 chunk 时把**压缩前源码**整体交给 esbuild，主 chunk 压缩前约 1.26 MB，
   稳定越过 1 MiB 阈值（这也是每次失败都在 `%TEMP%` 留下同尺寸残留文件的原因）。

最小复现（直接调用 esbuild `transform`，与 Vite 无关）：

| `os.tmpdir()` | 输入 < 1 MiB | 输入 > 1 MiB                            |
| :------------ | :----------- | :-------------------------------------- |
| 系统 `%TEMP%` | 成功         | **失败：`remove …: Access is denied.`** |
| 仓库内目录    | 成功         | 成功                                    |

**影响面**（三个入口都汇入 `pnpm --filter @draw-guess/client build`）：
`pnpm build`、`pnpm test:e2e`（经 `test/e2e/launcher.mts` 现场构建前端）、
`pnpm package:dist`（经 `apps/server/scripts/package-dist.ts` 构建前端）。

**拦截的方向：按进程，不是按目录，也不是时序**（三组对照实验）：

| 实验                                                                   | 结果          |
| :--------------------------------------------------------------------- | :------------ |
| node.exe 在系统 `%TEMP%` 写 1.2 MB 后**立刻**删除                      | 失败 **0/60** |
| node.exe 同上，**等 100 ms** 再删（给扫描器留出窗口）                  | 失败 **0/20** |
| 同一份 esbuild、同一次 `transform(>1 MiB)`，仅把 `TEMP` 指到仓库内目录 | **成功**      |

即：同一个目录、同样的文件尺寸，**node.exe 从不失败、esbuild.exe 100% 失败**——被针对的是 esbuild 这个
未签名的热解压原生二进制本身。本机运行着采用主动防御（HIPS）的安全软件（`HipsDaemon.exe` / `HipsTray.exe`
一类），与「只针对第三方二进制」的观察一致。已排除的另两个误导方向：

- **不是 AI 代理工具沙箱**：关闭工具沙箱后重跑，报错逐字相同。
- **不是普通权限不足**：`icacls` 显示当前用户对该目录与残留文件都有继承的完全控制；同一 shell 在
  `%TEMP%` 内自建自删文件也正常。

## 决策

**一、构建期把临时目录固定到仓库内**，经 `scripts/with-local-temp.mjs` 给子进程注入
`TEMP` / `TMP` / `TMPDIR`（Windows 上 `TMPDIR` 同样优先，三个都设以免漏改），目录取
`node_modules/.cache/draw-guess-tmp`——已被 `.gitignore` 覆盖，不污染工作区。

**二、只包装唯一真正执行 `vite build` 的叶子命令**（`apps/client/package.json` 的 `build`）。
三条根入口都汇入该命令，因而一处包装即全覆盖；不改根 `package.json`，避免同一策略在多层重复。

**三、不引入新依赖**：不用 `cross-env` 一类工具，包装器是约 40 行的原生 Node 脚本，
调用点命令为不含空格的固定串，经 shell 解析以兼容 Windows 的 pnpm/vite `.cmd` 垫片。

**四、明确不采用的两条路**：

- **不靠拆 chunk 规避**：触发阈值是 esbuild 的内部常量，与体积赛跑既不可控，也违背
  AGENTS 中「不要为消除告警把 vendor 硬拆成多个 chunk」的约定。
- **不在每条命令上重复设置**：策略只表达一次，避免多层 `package.json` 各写一份而漂移。

本决策不改变构建产物、游戏规则、线上协议与任何安全姿态。

## 后果

- **收益**：这类机器上 `pnpm build` / `pnpm test:e2e` / `pnpm package:dist` 开箱可用，无需每位开发者
  自行改环境变量或向安全软件申请白名单；错误从「构建期随机失败」变为「不可能发生」。
- **CI 无变化**：Linux/Windows runner 上仅临时目录位置不同（仓库内），构建输出与产物完全一致。
- **代价**：构建链路多一层包装进程；若有人绕过 npm script 直接调用 `vite build`，不受本包装保护
  （正常入口不受影响）。真正的**治本**仍属机器侧：解除安全软件对该操作的拦截后，本包装即使移除也不会再失败。
- 本包装是**环境规避**而非缺陷修复：它不掩盖仓库自身的任何问题，因为失败点完全在 esbuild 与
  系统临时目录之间。

## 关联

- 实现：`scripts/with-local-temp.mjs`（包装器）、`apps/client/package.json`（唯一调用点）
- 测试：`test/unit/build-temp-dir.spec.ts`（契约与行为守卫：构建脚本经包装、注入的临时目录确在仓库内）
- 相关：[0034](0034-node-single-file-distribution.md)（Node 单文件分发——`package:dist` 亦经此前端构建）、
  [0035](0035-startup-config-fail-fast.md)（同为「把不可见的环境差异显性化」的取舍）
