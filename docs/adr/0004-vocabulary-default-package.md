# 0004 词库默认包按「词数 + id」确定性选择

**状态**：已采纳

## 背景

服务启动时要在多个词库包之间选出默认包。原实现只按 `wordCount` 取最大（`>` 比较），
词数相同时保留「先遍历到的那一个」，而遍历顺序来自 `readdirSync`——
同一份数据在不同文件系统/不同机器上可能得到不同默认包，属于非确定性行为
（注释声称「同词数按 id 稳定选择」，代码并未实现）。

## 决策

- 排序键为「词数降序 → id 的 UTF-16 码元升序」，即 `right.wordCount - left.wordCount || byId(left, right)`；
- 排序结果对相同输入完全可复现，与目录遍历顺序无关；
- id 用码元比较而非 `localeCompare`，避免 locale 影响（与 #2 的「不用 locale 相关 API」同一原则）。

## 后果

- 默认包在任何机器上一致，房间规则与战报可复现；
- 代价：id 的码元序对人不直观（大小写/数字混排时），但它是**稳定**的，这比「看起来自然」更重要。

## 关联

- 代码：`apps/server/src/vocabulary/index.ts`（默认包选择）
- 相关：`apps/server/src/vocabulary/sqlite-provider.ts`（包 id 生成）
