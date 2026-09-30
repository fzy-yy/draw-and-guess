# 0030 · CI 工件配额兜底与容量用例的回合窗口

**状态**：已采纳

## 背景

`main` 的 quality 工作流自 2026-09-09 起长期红，2026-09-26 排查确认是**两个互相独立**的原因：

1. **09 容量用例（`test/e2e/specs/09-drawing-history-limit.spec.ts`）在慢 runner 上间歇失败。**
   该用例要用**真实点击**把服务端历史推到 `maxHistoryCommands=1500`。e2e 词库 fixture 的词条时限
   沿用产品默认 90s，而 GitHub runner 上 Playwright 的单次点击吞吐只有个位数/秒——90s 窗口内在推满前
   就到期；回合离开 `drawing` 后点击不再产生命令（某次失败现场：4897 次点击仅 375 条命令）。
   用于「冻结计时」的 `pauseGame/resumeGame` 又是第二个失败点：回合一旦结束，暂停按钮被阶段遮罩
   （`OverlayCard` 的 `absolute inset-0 z-30`）拦截，`pauseGame` 超时。这是环境相关而非随机抖动
   （同一用例在本地稳定通过，在 CI 时过时不过）。

2. **artifact 存储配额耗尽。**
   `Failed to CreateArtifact: Artifact storage quota has been hit`，四个 `upload-artifact` 步骤失败；
   由于它们用 `if: always()` / `if: failure()` 且无 `continue-on-error`，把 `format/lint/typecheck/
coverage/build` 全绿的 `verify-node-22` job 判为失败，并连带传不上 Playwright 失败诊断
   （trace/截图），使原因 1 的现场难以取证。

## 决策

**一、工件上传不作为门禁。** 四个 `upload-artifact` 步骤统一加 `continue-on-error: true`
（配额/网络问题不得误伤质量门禁）；保留期由 14/7 天下调为 7/3 天；新增
`.github/workflows/cleanup-artifacts.yml`，每日 03:17 UTC 删除超过 7 天的旧工件（可用
`workflow_dispatch` 手动触发），从根上缓解配额累积。

**二、给容量用例足够的回合窗口，并去掉易碎的计时规避。**

- e2e 词库 fixture（`apps/server/src/vocabulary/test-fixture.ts`，**仅 e2e 使用**）的词条时限放宽到
  **600s**，使慢 runner 也能在同一回合内推满；生产词库不受影响。
- 移除 09 用例里的 `pause/resume` 循环（它既是第二个失败点，也因窗口充足而不再需要）。
- 保留并强化既有硬化：只读探针 `__authoritativeCommandCount`（随 `VITE_EXPOSE_LOGICAL_CANVAS`
  开关，生产构建不含）让用例按**权威命令计数**推进到上限，再额外提交若干次并断言「历史不再增长
  且出现上限提示」；失败信息输出点击次数/权威命令数/上限。
- 用例超时 300s → 720s，墙钟上限 540s；Playwright job 超时 20 → 35 分钟以容纳一次重试。

**三、容量用例仍走真实点击链路**，不引入「测试专用命令注入」来加速：该用例的价值之一是覆盖真实
指针→批次→权威裁决的完整链路，绕开点击会削弱其意义。

## 后果

- `verify-node-22` 不再因配额变红；上传失败仅是「没有工件」，不影响校验结论。
- 09 在慢 runner 上不再因 90s 窗口到期而失败；实测 CI 上 `Node 22 Playwright` 由失败转为通过
  （本地 25/25，CI 三个 job 全绿）。
- 代价：Playwright job 最长可能到 6–10 分钟（实测 6m24s）；e2e fixture 的回合时限放宽会让该环境
  所有对局回合更长，但其它 e2e 用例都不依赖「计时结束回合」（04 靠全员猜中、05 靠 `endEarly`），
  本地 25/25 回归通过。
- 残余风险：若未来 runner 慢到持续 <2.5 条命令/秒，540s 墙钟仍可能先到期；此时失败信息会直接给出
  「点击次数/权威命令数/上限」，且诊断工件现在能正常上传，可快速判断是吞吐问题还是真实回归。
- 配额是**账号级**的：清理本仓库工件不保证账号总额度恢复；`cleanup-artifacts.yml` 提供可持续的
  自动清理，人工也可用 `gh api` 删除旧工件（注意 Git Bash 下 `gh api` 的端点**不要带前导斜杠**，
  否则会被 MSYS 当作文件路径重写）。

## 关联

- 工作流：`.github/workflows/quality.yml`（上传步骤与超时）、`.github/workflows/cleanup-artifacts.yml`
- 测试：`test/e2e/specs/09-drawing-history-limit.spec.ts`、`test/e2e/fixtures/canvas-probe.ts`
- 代码：`apps/client/src/components/game/GameCanvas.vue`（只读探针）、
  `apps/server/src/vocabulary/test-fixture.ts`（e2e 词条时限）
- 来源：2026-09-26 CI 失败排查（run 36217065328 / 36226453402 / 36227136800 / 36228168901）
- 相关：ADR-0010（绘图历史上限只增不删）、ADR-0009（填充降级与锁）
