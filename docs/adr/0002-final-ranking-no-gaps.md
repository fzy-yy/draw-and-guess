# 0002 战报名次按实际产出条目递增，不留下排名空洞

**状态**：已采纳

## 背景

`finishGame` 组装最终排名时，`flatMap` 会丢弃 `profile` 为空的成员（`if (!profile) return []`）。
原实现用「过滤后数组的 `index + 1`」当名次，一旦有成员被丢弃，后面所有名次整体跳号，
并且并列判定用的 `previousScore` 只在返回分支更新，丢人后并列判定也不复位。
这份带空洞的排名会原样落盘到 `game_archive.final_ranking`，属于持久化的历史数据，
事后无法自愈。

## 决策

- 名次改为**按实际产出的条目数递增**：每产出一条 `emittedCount += 1`，分数变化时 `rank = emittedCount`；
- 并列判定只依赖相邻「已产出」条目的分数，丢弃成员不再影响并列关系；
- 保持「首次进入最终结算时一次性冻结排名」的既有语义（之后成员离房不改变历史成绩）。

## 后果

- 落盘排名连续、无跳号，历史战报可被前端直接按名次渲染；
- 代价：被丢弃成员的位次空缺由后续成员递补，因此名次不再等于「原始排序位置」——
  这是有意的，战报只关心可展示的参与者。

## 关联

- 代码：`apps/server/src/round-machine.ts`（`finishGame` 的 `finalRanking` 组装）
- 持久化：`game_archive.final_ranking`（`apps/server/src/repositories/archive-repository.ts`）
