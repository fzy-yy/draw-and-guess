# T06 · 文档同步（AGENTS / README）

**Status**: ready-for-agent
**Blocked by**: 03, 04

> 依据：`.scratch/game-ui-redesign/spec.md`。

## 目标

让 `AGENTS.md` 与 `README.md` 的组件目录、职责说明、协议版本与提示描述与新代码一致，保证 `documentation.consistency.spec.ts` 通过。

## 范围

- `AGENTS.md`：组件清单/目录树中新增 `FloatingPanel` / `PlayerPanel` / `CanvasToolbar` / `BrushSizeField` 与公共原语，删除 `ScoreStrip` / `DrawingToolbar`；`protocolVersion` 14→15；删除结构化提示相关描述（含「提示揭示节奏」「词条 hint 揭示」等表述）；同步对局界面布局描述。
- `README.md`：同上对应条目。
- `CONTEXT.md`：本轮已由主导人更新，如需微调保持一致。

## 验收

- `AGENTS.md` / `README.md` 中不再出现已删除的组件名与结构化提示描述。
- `pnpm test:unit` 中 `documentation.consistency.spec.ts` 通过。

## 验证

- `pnpm test:unit -- documentation.consistency`
- `pnpm exec prettier --check AGENTS.md README.md CONTEXT.md`
