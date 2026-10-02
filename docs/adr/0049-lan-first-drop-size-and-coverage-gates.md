# 0049 · 局域网优先：取消首屏体积与覆盖率门禁、移除组件级懒加载

**状态**：已采纳

## 背景

本项目只面向可信局域网（同一网段、浏览器直连主机），不存在公网带宽、弱网或按流量计费的压力。
但仓库为「体积」维护了一整套基建：

- 首屏体积预算（`performance.mainEntryGzipKib` / `firstScreenTransferKib`）+ E2E 首屏门禁
  - 单元预算守卫 + `BUNDLE_REPORT` 体积报告；
- 组件级懒加载（自管理包装组件 + 占位/失败重试兜底 + 「懒加载模块禁止 barrel re-export」约定）
  - 配套守卫测试与文案；
- V8 覆盖率门禁（全局与逐文件的 statements/branches/functions/lines 阈值）与分层维护文档。

这些数字在局域网内不构成真实风险，却在每次改依赖、加组件、调视图时持续产生维护成本
（拆 chunk、守 barrel、维护阈值与分层文档），还让「一个组件为什么不能静态导入」这类反直觉约束
需要专门解释。2026-10-02 用户明确要求取消体积限制与懒加载相关代码。

## 决策

1. **取消首屏体积门禁**：删除两个预算常量、E2E 体积断言与单元预算守卫、`BUNDLE_REPORT` 体积报告插件。
   保留带内容哈希产物的 `immutable` 长缓存与入口 HTML `no-cache`——它是功能性缓存而非体积门禁，
   常量收敛为 `packages/config/src/settings.ts` 的 `staticAssets.immutableMaxAgeSeconds`，
   断言保留在 `test/e2e/specs/08-static-asset-cache.spec.ts` 与 `test/unit/bundle-boundary.spec.ts`。
2. **移除组件级懒加载**：删除 `utils/lazy-component.ts` 与 `AsyncModuleFallback.vue`；词库弹窗改为经
   `components/room` barrel 静态导入，礼花库 `canvas-confetti` 改为顶部静态导入；随之移除占位/失败
   重试文案、`LazyComponentRetry` 组件测试与「懒加载模块禁止 barrel re-export」约定。
3. **彻底移除覆盖率**：删除 `vitest.config.ts` 的 coverage 配置与阈值、`test/COVERAGE.md`、
   `@vitest/coverage-v8` 依赖与 CI 覆盖率上传；质量工作流改为 `pnpm test:ci`（三层测试 + JUnit 失败诊断）。
4. **保留与体积无关的边界**：客户端产物隐私边界扫描（`scripts/check-client-bundle-boundary.mjs`，
   防服务端私有配置泄漏进浏览器产物）与洪泛填充 Worker 的轻量导入守卫继续存在。
5. ADR-0014 的懒加载/重试桥决策被本决策取代；其「设置页静态导入避免白闪」的结论以更强形式保留——
   前端不再有任何懒加载视图或组件。

## 后果

- 正面：删除三类数字门禁及其文档与守卫；新增组件不必再考虑 chunk 切分与 barrel 泄漏；
  CI 少一步覆盖率上传与阈值判定。
- 代价：入口 chunk 变大（词库弹窗的虚拟表格依赖与 `canvas-confetti` 进入主包），局域网首屏下载量上升；
  代码质量不再由覆盖率门槛兜底，回归风险改由测试用例本身与代码评审承担。
- 残余风险：若未来重新引入体积或覆盖率要求，应新开 ADR 说明度量口径，不直接恢复本 ADR 删除的常量。

## 关联

- 配置：`packages/config/src/settings.ts`（`staticAssets`）、`apps/server/src/app.ts`
- 客户端：`apps/client/src/views/RoomView.vue`、`apps/client/src/components/room/index.ts`、`apps/client/src/utils/confetti.ts`
- 测试与 CI：`test/e2e/specs/08-static-asset-cache.spec.ts`、`test/unit/bundle-boundary.spec.ts`、`.github/workflows/quality.yml`
- 取代：[ADR-0014](0014-settings-view-static-import.md)（设置页静态导入与懒加载重试桥）
