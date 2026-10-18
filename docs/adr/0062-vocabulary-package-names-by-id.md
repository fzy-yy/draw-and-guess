# 0062 · 多词库选择的包名按 ID 解析、行勾选只上抛一条事件

**状态**：已采纳

- 来源：2026-10-18 多词库选择功能审查（1 个真实缺陷 + 2 处隐患）

## 背景

房间可以同时绑定多个词库包（`room.vocabularyPackageIds`），相关元信息经两条路径下发：

1. **房间快照**：`RoomSnapshot.vocabularyPackageIds` 是 ID 列表；
2. **合并词库的展示名**：`VocabularyRegistry.getCombined()` 用
   `matchedPackages.map(p => p.name).join('、')` 生成 `meta.name`。

快照的包名列表原先**由展示名反推**：`vocabulary.meta.name.split('、')`。这条推导有三个前提，
在真实使用中都不成立：

- **顺序**：`packages` 的顺序来自目录扫描（`registry.packages`），与用户勾选顺序无关。
  用户先勾 `fzyyy_words` 再勾 `base_words` 时，快照得到
  `ids: ['fzyyy_words','base_words']`、`names: ['基础词库','fzyyy的词库']`——两个列表**逐位错位**；
- **可逆**：包名自身可以含「、」（例如「水果、蔬菜」），`split` 会多拆出一个元素，长度都对不上；
- **无歧义**：`split` 无法区分「包名里的、」与「包名之间的、」。

用户当前看到的只是 `RuleSummary` 把两个列表各自 join 起来的展示串，所以错位**没有暴露**；
但协议字段的隐含契约是「第 i 位对应」，任何按 ID 查包名、按包名找 ID 的消费方（高亮当前包、
按包过滤词条、未来「移除某个包」）都会拿错名字。

同一轮审查还发现两处隐患：

- **行勾选双发**：`VocabPackageTableView.handleToggle` 同时 `emit('select')` 与 `emit('toggle')`，
  而宿主两条都绑到同一个 `handleTogglePackage`。当时只靠「请求进行中禁止再次切换」的守卫
  把第二次调用挡下；守卫一旦改成排队/重试，就会退化成一次点击切换两次。
  （组件测试里的 stub 恰好按「单选 radio + `select` 事件」建模，把缺陷藏了两年年检也看不出来。）
- **通知文案拼接**：`词库已切换为「A、B」` 把合并展示名整体塞进一对引号，包名含「、」时
  `A、B、C` 无法分辨哪个是名、哪个是分隔。

## 决策

1. **包名按 ID 解析，不再拆展示名**：`SnapshotBuilder` 新增窄端口成员
   `vocabularyPackages(): readonly VocabularyPackageInfo[]`，快照用
   `packageIds.map(id => registry.packages.find(p => p.id === id)?.name ?? id)`——
   顺序与 ID 列表天然一致，包名里的「、」不再参与任何切分。
2. **包 ID 列表只算一次**：`snapshot()` 内提出 `packageIds` 局部量，ID 列表与包名列表共用同一份来源，
   不再各自推导（原先 `??` 链只覆盖了 ID 一半）。
3. **行勾选只上抛 `toggle`**：`VocabPackageTableView` 删除 `select` 事件，宿主只绑 `@toggle`。
   组件测试的 stub 同步改成「多选 checkbox + `toggle`」语义，与真实表格对齐。
4. **通知逐条包装包名**：`serverStrings.notices.vocabularyPackageSwitched(names: readonly string[])`
   改为 `词库已切换为「A」「B」`，由服务端按实际选中的包列表逐个传名。

### 协议兼容性

**不需要提升 `protocolVersion`**：字段名与类型不变，只是 `vocabularyPackageNames` 的取值从
「按不可靠推导得出的列表」改为「与 `vocabularyPackageIds` 逐位对应的列表」——这是对既有隐含契约的
落实，旧客户端照样只做展示。

## 后果

- 包 ID 与包名**逐位对应**在任何勾选顺序、任何包名内容下都成立
  （`test/unit/vocabulary-package-names.spec.ts` 用真实双库反序勾选、
  `vocabulary-package-names-edge.spec.ts` 用含「、」的包名守住）；
- 行勾选每次点击只产生一次切换，后续调整并发策略时不必再依赖「进行中守卫」兜住双发
  （`test/component/VocabPackageTableView.spec.ts` 直接断言不出现 `select` 事件）；
- 通知文案对含分隔符的包名保持可读；
- 代价：快照构建多一次 `packages` 线性查找（包数量是个位数，可忽略）。

## 关联

- 代码：`apps/server/src/snapshot.ts`（`vocabularyPackages` 窄端口与逐 ID 解析）、
  `apps/server/src/game-service.ts` 与 `apps/server/src/server.ts`（组合根接线）、
  `apps/server/src/modules/vocabulary/vocabulary.service.ts`（通知逐条传名）、
  `packages/strings/src/server.ts`（`vocabularyPackageSwitched` 签名）、
  `apps/client/src/components/room/VocabPackageTableView.vue` 与 `VocabularyDialog.vue`（单条 `toggle`）
- 测试：`test/unit/vocabulary-package-names.spec.ts`（真实双库反序勾选）、
  `test/unit/vocabulary-package-names-edge.spec.ts`（包名含「、」）、
  `test/component/VocabPackageTableView.spec.ts`（行勾选单条事件）、
  `test/component/RoomConfigurationDialogs.spec.ts`（替身改为真实表格语义）
- 相关：ADR-0021（快照裁剪窄端口）、ADR-0053（词库合集与工具栏改版）
