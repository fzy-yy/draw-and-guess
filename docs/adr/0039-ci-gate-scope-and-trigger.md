# 0039 CI 触发面收敛、Windows 构建冒烟与审计不作门禁

**状态**：已采纳

## 背景

`quality` 工作流的三个 job 全在 ubuntu 上，触发方式为 `on: push`（**所有分支**）+ `pull_request`，
`pnpm audit` 与 format/lint/typecheck 串在同一个 job 里作为门禁。三个摩擦点：

1. **同一提交可能跑两遍**：向本仓库分支推送并开 PR 时，`push` 与 `pull_request` 各触发一次完整流程。
   仓库是**私有**的，Actions 额度按各 job 时长**累加**计费，一次运行约 12 分钟额度。
2. **发行平台零覆盖**：分发包只出 Windows（ADR-0034），而质量门禁全在 ubuntu——ADR-0038 的
   `scripts/with-local-temp.mjs` 正是为 Windows 环境打的补丁，却在 CI 里从未被执行过。
3. **审计会误伤门禁**：`pnpm audit` 的结论取决于外部 registry（本仓库还需用仓库变量切镜像），
   一次网络抖动或一个新披露的漏洞，会让**与本次改动无关**的提交集体变红。

## 决策

**一、`push` 只在 `main` 上跟进，其余分支经 PR 校验。** 本仓库没有分支保护（Free 计划私有库不提供
该功能，API 返回 403），门禁本就是劝告性的，收敛触发面不改变任何强制力，只省掉重复计费。
代价是直接把改动推到 feature 分支不再有 CI 反馈——这与「改动经 PR」的协作约定一致。

**二、审计不作为门禁**：`pnpm audit` 步骤加 `continue-on-error: true`。与工件上传同理——外部环境
问题不应误伤代码质量门禁（同一取舍见 [0030](0030-ci-artifact-quota-and-capacity-test-window.md)）。
审计输出仍保留在步骤日志中可查。

**三、新增 Windows 构建冒烟 job**（`windows-latest`，只跑 `pnpm build`）：覆盖构建临时目录包装器在
Windows 上的路径与 shell 行为，以及前端产物的边界扫描。**明确它复现不了** ADR-0038 要规避的拦截
（runner 上没有那类安全软件），因此不构成对包装器的替代，只保证「换了平台不会先死在路径/shell 上」。

**四、e2e 缓存 Playwright 浏览器**：缓存键取 Playwright 版本号而非锁文件哈希——依赖变动而 Playwright
未升级时缓存仍可命中；`playwright install` 保持原样（命中缓存时只补 apt 系统依赖，那部分不可缓存）。

**五、不按路径跳过文档改动**：`AGENTS.md` / `README.md` 正被
`test/unit/documentation.consistency.spec.ts` 校验，忽略 `**/*.md` 会漏掉真门禁；只忽略 `docs/**`
又会在删除 `docs/adr/README.md`（被 AGENTS 反引号引用、必须存在）时漏检。省几分钟不值得开一个静默漏检的口子。

## 后果

- feature 分支的推送不再触发完整流程；PR 仍全量校验。
- 供应链审计信号变弱：它不再能让运行变红。需要强信号时应改回门禁，或另加定时审计（本次未做）。
- Windows job 与其它 job 并行，不拉长墙钟（总墙钟仍由 e2e 决定）；代价是多占一份 Windows runner。
- 缓存首次命中前需要一次完整下载；之后每次 e2e 少一次约 300MB 的浏览器下载。

## 关联

- 实现：`.github/workflows/quality.yml`
- 相关：[0030](0030-ci-artifact-quota-and-capacity-test-window.md)（外部环境问题不作门禁的同一取舍）、
  [0038](0038-repo-local-build-temp-dir.md)（Windows 构建临时目录；本决策为该修复补上发行平台的冒烟覆盖）
