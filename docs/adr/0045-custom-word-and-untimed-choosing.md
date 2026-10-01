# 0045 · 画家自定义题目与选词阶段不限时

**状态**：已采纳

- 来源：2026-10-01「选词界面可自定义题目」需求（规格见 `.scratch/custom-word-and-simplification/spec.md`）。

## 背景

选词阶段的候选词完全来自房间词库，画家只能从 `optionCount` 个随机候选里选一个或换一组；
词库没有覆盖到的主题就画不了。同时选词阶段有 10–30 秒硬性时限，超时由服务端随机代选，
对「还没想好画什么」的画家是打断而非保护。房主侧「作画时间」这个滑块的实际含义也被词条难度派生
时限掩盖（见 [ADR-0046](0046-vocabulary-slimming-and-unified-round-time.md)）。

## 决策

1. **新增画家自定义题目**：选词界面渲染「自定义」入口（与「换一组」并排、同款按钮样式），
   点击弹窗输入并确认后**立即开画**；确认前可取消。候选词与「换一组」照常保留，自定义是第三条出口。
2. **房主开关，默认关闭**：房间规则新增 `allowCustomWord`（默认 `false`）。关闭时入口**不渲染**，
   服务端同时拒收（`FORBIDDEN`）——与 `allowWordReroll` 同一「隐藏 + 服务端兜底」范式。
3. **服务端合成词条**：服务端把输入合成为一条**无元数据词条**（无难度、无提示、无别称、分类标记为
   `自定义`）放进 `candidates` 后走统一的 `beginDrawing`，使「答案必须取自候选池」的既有不变式继续成立，
   而不是为自定义词另开一条绕过不变式的路径。
4. **词面规则**：去空白并折叠连续空白后 1–12 个 grapheme（`CUSTOM_WORD_MAX_LENGTH`）；允许中英文、
   数字、空格与常用标点；拒绝控制字符、格式字符（含零宽连接符）与 emoji——逐字遮罩按字符逐格揭示，
   emoji 的 ZWJ 组合序列会被拆成无意义的半截序列。不做敏感词过滤（局域网可信场景）。
5. **撞词拒绝**：与**本局已展示过的词**或**当前候选词**规范化后相同即拒绝（`CUSTOM_WORD_DUPLICATE`），
   避免同一局出现两次同一个词、破坏「整局不重复」的既有不变量。
6. **选词阶段新增时限开关，默认关闭**：房间规则新增 `allowChooseTimeLimit`（默认 `false`）。关闭时
   选词阶段没有截止时间：服务端**不写 `phaseEndsAt`（保持 `0` 哨兵）、不排计时器、不自动代选**，
   画家想多久都可以；开启时才恢复 `chooseSeconds`（10–30，默认 15）与超时随机代选。
7. **无时限下的兜底沿用既有机制**：画家离开或掉线且宽限期结束仍在选词阶段时，本回合作废并顺延到
   下一回合（`abandonChoosing`）。刻意**不**做「离线画家代选后继续作画」——画家离线时开画只会白耗
   一整个作画时长。

## 后果

- 画家能画词库覆盖不到的主题；不想用这个能力的房间把开关关掉即可，默认行为不变。
- 选词阶段默认不再有自然终点。**代价是明确的**：房主不主动干预时，在线发呆的画家会让房间停在
  选词阶段；房主仍可用踢人、暂停、提前结束本局解套。这正是把「打断」换成「自由」所付的价。
- `phaseEndsAt === 0` 从「暂停期哨兵」扩展为「本阶段无截止时间」的统一语义：暂停/恢复、暂停快照与
  客户端 HUD 都按这一条分支（无倒计时、不播倒计时警示音、进度条归零）。
- 自定义词与词库词在计时、遮罩、词长展示、计分与战报上**完全同构**，不额外标注来源。

## 关联

- 代码：`apps/server/src/domain/vocabulary/custom-word.ts`、`apps/server/src/game-service.ts`
  （`chooseCustomWord` / `isCustomWordDuplicate`）、`apps/server/src/round-machine.ts`
  （`beginChoosing` 的时限分支与 `scheduleCurrentPhase` 的无截止早退）、
  `apps/client/src/components/game/{PhaseOverlay,CustomWordDialog}.vue`
- 协议：`CUSTOM_WORD_MAX_LENGTH`、`RoomSettings.allowCustomWord` / `allowChooseTimeLimit`、
  错误码 `INVALID_CUSTOM_WORD` / `CUSTOM_WORD_DUPLICATE`
- 规格：`.scratch/custom-word-and-simplification/spec.md`
- 同时采纳：[ADR-0046](0046-vocabulary-slimming-and-unified-round-time.md)、
  [ADR-0047](0047-fixed-100-point-scoring.md)
