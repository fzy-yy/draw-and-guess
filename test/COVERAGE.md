# 覆盖率策略

覆盖率用于守住高风险分支，而不是追求虚假的 100%。E2E 只保留跨进程、跨浏览器和真实画布链路；状态机、失败回滚、角色裁剪及异常恢复优先使用快速单元/组件/集成测试。

## 统计范围

`vitest.config.ts` 的 `coverage.include` 覆盖全部运行时源码：

- `apps/client/src/**`（视图目录除外）
- `apps/server/src/**`
- `packages/shared/src/**`
- `packages/config/src/**`（公开默认值的单一来源）
- `packages/strings/src/**`（全部展示文案的单一来源）

`apps/client/src/views/**` 显式排除：视图以编排与模板为主，由 `test/e2e/specs/` 跨四种浏览器环境验收真实链路；V8 也不统计 SFC `<template>`。视图内如出现值得单测的脚本逻辑，应先抽成 composable/组件再纳入统计，而不是把视图重新塞回 include 制造虚假分母。

## 门禁分层（与 vitest.config.ts 保持一致）

| 作用域                                    | Statements | Branches | Functions | Lines |
| ----------------------------------------- | ---------: | -------: | --------: | ----: |
| 全局                                      |        60% |      52% |       54% |   62% |
| `packages/config/src/**`                  |        80% |      70% |         — |     — |
| `packages/strings/src/**`                 |        55% |      60% |         — |     — |
| `apps/client/src/composables/**`          |        60% |      50% |         — |     — |
| `apps/client/src/stores/**`               |        60% |      50% |         — |     — |
| `composables/{useGameHud,useRoomSync}.ts` |        75% |      60% |         — |     — |
| `composables/useStrokeSession.ts`         |        65% |      50% |         — |     — |
| `components/game/GameCanvas.vue`          |        60% |      50% |       55% |   62% |
| `components/game/{GameHud,PhaseOverlay}`  |        60% |      55% |         — |     — |
| `server/game-service.ts`                  |        59% |      49% |       70% |   60% |
| `server/round-machine.ts`                 |        83% |      67% |       83% |   89% |
| `server/snapshot.ts`                      |        84% |      76% |      100% |   93% |
| `shared/pure.ts`                          |        86% |      70% |      100% |   86% |

## 最近一次全量结果（2026-09-14，`pnpm test:coverage`）

分区数字为对应目录/文件的整体聚合（含子目录），与 `coverage/coverage-summary.json` 口径一致：

| 分区                    | Statements | Branches | Functions |  Lines |
| ----------------------- | ---------: | -------: | --------: | -----: |
| 全局                    |     69.08% |   60.83% |    63.09% | 71.27% |
| `apps/server/src`（全） |     67.45% |   62.86% |    67.84% | 69.19% |
| `packages/shared/src`   |     93.48% |   63.16% |    78.57% | 93.48% |
| `packages/config`       |    100.00% |  100.00% |   100.00% |   100% |
| `packages/strings`      |     63.00% |  100.00% |    55.95% | 63.00% |
| `GameCanvas.vue`        |     70.34% |   54.80% |    72.22% | 74.80% |

## 维护约定

- 提高阈值前先增加真实断言；新增测试应提高而非降低门禁，不通过排除文件美化数字。
- 配置包与文案包已纳入统计：新增配置项或文案时，如导入路径变化导致覆盖回落，门禁会直接报警。
- `GameCanvas.vue` 由 `test/component/GameCanvas.spec.ts` 守住重放、增量投影、批次序号、填充降级与填充解锁路径；新增画布分支时应同步补用例。
- 服务端权威阶段、快照和共享纯函数继续使用贴近当前基线的关键文件门禁。
