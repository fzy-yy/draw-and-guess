# T06 · 主导人收口：全量验证与评审修复

**Status**: ready-for-agent
**Blocked by**: 05

> 由主导人（根线程）执行，不分配给子代理。

## 目标

三批改动合并后做一次跨批次验收：全量质量命令、覆盖率、端到端用例、代码评审与修复，以及仓库状态收尾。

## 范围

- 全量质量门禁：格式、Lint、类型、构建、单元/组件/集成/覆盖率。
- 端到端：Chromium 与 Firefox 的对局用例（含自定义词路径）。
- 跨批次一致性检查：协议版本与文档一致、错误码与文案配对、禁止键清单完整、遗留引用（难度/可绘制性/提示/额外猜词时间/统一猜词基础分）全仓清零。
- 代码评审（`code-review` 技能）与评审发现的问题修复。
- 分支与提交收尾。

## 非目标

- 新增功能。
- 词库 `.db` 的删列。

## 验收

- [ ] `pnpm format && pnpm lint && pnpm typecheck && pnpm build` 全绿。
- [ ] `pnpm test:coverage` 通过且不低于既有阈值。
- [ ] `pnpm test:e2e` 通过（Chromium + Firefox）。
- [ ] 全仓 grep 不到已删除概念的残留引用（文档中作为历史说明的除外）。
- [ ] 评审发现的问题已修复或明确记录为后续任务。

## 验证

```bash
pnpm format && pnpm lint && pnpm typecheck && pnpm build
pnpm test:coverage
pnpm test:e2e
```
