# 覆盖率策略

覆盖率用于守住高风险分支，而不是追求虚假的 100%。E2E 只保留跨进程、跨浏览器和真实画布链路；状态机、失败回滚、角色裁剪及异常恢复优先使用快速单元/组件/集成测试。

## 统计范围

`vitest.config.ts` 的 `coverage.include` 覆盖全部运行时源码：

- `apps/client/src/**`（视图目录除外）
- `apps/server/src/**`
- `packages/shared/src/**`
- `packages/config/src/**`（公开默认值的单一来源）
- `packages/strings/src/**`（全部展示文案的单一来源）

`apps/client/src/views/**` 显式排除：视图以编排与模板为主，由 `test/e2e/specs/` 跨三种浏览器环境（Chromium DPR 1/1.5、Firefox DPR 2）验收真实链路；V8 也不统计 SFC `<template>`。视图内如出现值得单测的脚本逻辑，应先抽成 composable/组件再纳入统计，而不是把视图重新塞回 include 制造虚假分母。

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
| `canvas/replay-machine.ts`                |        90% |      85% |      100% |   95% |
| `canvas/geometry.ts`                      |       100% |     100% |      100% |  100% |
| `components/game/{GameHud,PhaseOverlay}`  |        60% |      55% |         — |     — |
| `server/game-service.ts`                  |        59% |      49% |       70% |   60% |
| `server/round-machine.ts`                 |        83% |      67% |       83% |   89% |
| `server/snapshot.ts`                      |        84% |      76% |      100% |   93% |
| `shared/pure.ts`                          |        86% |      70% |      100% |   86% |

## 最近一次全量结果（2026-09-27，`pnpm test:coverage`）

分区数字为对应目录/文件的整体聚合（含子目录），与 `coverage/coverage-summary.json` 口径一致：

| 分区                                | Statements | Branches | Functions |  Lines |
| ----------------------------------- | ---------: | -------: | --------: | -----: |
| 全局                                |     76.93% |   68.73% |    70.33% | 79.23% |
| `apps/server/src`（全）             |     77.74% |   71.03% |    77.39% | 79.95% |
| `packages/shared/src`               |     95.41% |   70.59% |    81.25% | 95.41% |
| `packages/config`                   |    100.00% |  100.00% |   100.00% |   100% |
| `packages/strings`                  |     69.61% |  100.00% |    63.10% | 69.31% |
| `domain/drawing/drawing-service.ts` |     85.56% |   76.00% |    91.67% | 87.80% |
| `domain/session/session-service.ts` |     78.72% |   72.90% |    80.00% | 82.94% |
| `GameCanvas.vue`                    |     83.87% |   75.00% |    74.19% | 83.33% |
| `useFillSession.ts`                 |    100.00% |  100.00% |   100.00% |   100% |
| `ContextMenu.vue`                   |     96.19% |   89.19% |   100.00% |   100% |

## 维护约定

- 提高阈值前先增加真实断言；新增测试应提高而非降低门禁，不通过排除文件美化数字。
- 配置包与文案包已纳入统计：新增配置项或文案时，如导入路径变化导致覆盖回落，门禁会直接报警。
- `GameCanvas.vue` 由 `test/component/GameCanvas.spec.ts` 守住重放、增量投影、批次序号、填充降级与填充解锁路径；新增画布分支时应同步补用例。
- 填充的渲染态/提交态两把锁由 `test/component/ClientComposables.spec.ts` 直接覆盖释放规则，Worker 失败降级与终止由 `test/unit/flood-fill-worker.spec.ts` 覆盖；改这两处语义时应同步补充或调整用例（见 `docs/adr/0009-fill-degradation-and-locks.md`）。
- 右键菜单由 `test/component/ContextMenu.spec.ts` 守住菜单语义、键盘导航、关闭时机与舞台内定位夹取，边界矩阵另由 `test/unit/context-menu-position.spec.ts` 覆盖；扩展菜单项能力（子菜单、长按等）时应同步补用例。
- 绘图历史容量（硬上限 + 拒绝新增，不丢弃最旧命令）由四层守住：`test/unit/drawing-history-limit.spec.ts`（服务端语义与拒绝顺序）、`test/integration/drawing-history-mirror.spec.ts`（镜像与权威历史逐条一致、晚加入者重放一致、拒绝可见）、`test/component/GameCanvas.spec.ts` 的「绘图历史容量」用例（画布必须逐条重放收到的历史，自身不设上限）、`test/e2e/specs/09-drawing-history-limit.spec.ts`（真实浏览器 1500 条命令压力后的跨端逻辑栅格指纹，见 `docs/adr/0010-drawing-history-cap.md`）；改容量语义、客户端增量合并或画布重放时四处同步。
- 会话注销的原子性（持久化优先：失败即整体不生效、抛 INTERNAL_ERROR、记白名单日志；连接归属守卫）由 `test/unit/session-service.contract.spec.ts` 守住，含重复注销、身份已不在内存、离房失败与被接管旧 socket 的迟到注销；改注销顺序或失败语义前先读 `docs/adr/0011-session-logout-atomicity.md`。
- 请求响应 ack 边界（ack 外壳、requestId、成功 data、登记错误码；malformed success、未知错误码、requestId 不匹配、undefined 合法响应、协议版本错配）由三层守住：`test/unit/client-boundaries.spec.ts`（注册表对称性、解码分类与有界脱敏诊断）、`test/unit/game-transport.contract.spec.ts`（请求层不重试、统一文案与 pending 恢复）、`test/unit/response-contract.spec.ts`（真实服务端输出必须通过响应 Schema）；改 ack Schema、解码器或错误码时三处同步。
- 服务端权威阶段、快照和共享纯函数继续使用贴近当前基线的关键文件门禁。
