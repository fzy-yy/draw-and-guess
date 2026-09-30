# 05 composables 杂项：死分支、bumpTick 删除、邀请修复①、比较器合并

Status: ready-for-agent

## 背景

composables 域审查：Toast 层存在「注释互指样式归属且引用不存在的 `.toast-bar`」的事实性错误与
被 onBump 机制取代的死字段 `bumpTick`；若干类型/框架语义下不可达的防御分支；接受邀请在途不
停倒计时可能重复发 reject（用户裁决：**修复①获批**）；两个词库排序器同形重复。

## 文件归属

- apps/client/src/composables/useToasts.ts
- apps/client/src/components/common/AppToaster.vue（本单唯一 components 触点：Toast 样式归属在
  组件内，与 useToasts 注释互指必须同改；**不动其它行**）
- apps/client/src/composables/useAppBootstrap.ts
- apps/client/src/composables/useAudioFeedback.ts
- apps/client/src/composables/useGameHud.ts
- apps/client/src/composables/useSelectAllState.ts
- apps/client/src/composables/useVirtualTableRows.ts
- apps/client/src/composables/useVocabularyPackages.ts
- apps/client/src/composables/useVocabularyQuery.ts
- apps/client/src/composables/useTableSort.ts
- apps/client/src/composables/useInviteQueue.ts
- apps/client/src/composables/useCanvasViewport.ts（仅补注释，不删导出）
- apps/client/src/composables/useCanvasCursor.ts（仅补注释）
- 测试联动：test/integration/toasts.spec.ts、test/component/ClientComposables.spec.ts
  （bumpTick / reset 相关断言同步；其余用例不动）

## 事项清单

1. **useToasts.ts 注释事实修正**：删除对不存在的 `.toast-bar` 类的引用；样式归属统一口径为
   「Toast 视觉（含小条橙色配色）全部内联于 AppToaster.vue，useToasts 只持有状态」；
   AppToaster.vue 头部注释反向宣称「配色在 useToasts」的行同步改准确。两文件注释互不矛盾。
2. **useToasts.ts 删除 `bumpTick`**：弹跳动画实际经 `onBump` 回调（AppToaster WAAPI）播放，
   bumpTick 只写不读（唯一读取点是 toasts.spec）——删字段与相关注释；toasts.spec.ts 的去重
   左弹跳断言改为观察 `onBump` 回调（如 `vi.fn` 注入），保持原验证强度。
3. **useAppBootstrap.ts:41**：`change.playerId === ''` 分支删除（协议 `MemberConnectionChange`
   schema 为 `z.string().uuid()`，payload 已整体解码，空串不可达）；保留本人过滤。
4. **useAppBootstrap.ts:199 附近**：`settingsStore.saveSettings(sessionStore.playerId)` 补一行
   「为什么」注释（连接建立即把本地设置推送到服务端会话，按代码事实写明动机）。
5. **useAudioFeedback.ts:33**：`phase === previous` 死分支删除（原始枚举 getter 下 Vue watch
   仅在值变化时回调）；保留 `if (!phase) return`。
6. **useGameHud.ts**：:91 与文件头重复的「useTimestamp 卸载自动停止」注释合并为一处。
7. **useSelectAllState.ts 头注释**：删「散列视图（统计栏）与表格视图共用」失实描述——现存唯一
   消费者是 VocabTableView；改为准确表述（可保留「历史曾含散列视图」一句注记）。
8. **useVirtualTableRows.ts**：`virtualizer.value as unknown as {...}` 双断言补中文理由注释
   （@tanstack 泛型在此处不可直证的边界适配）；默认行高 `ref(28)` 补来源注释（首帧实测前的
   兜底估算）。
9. **useVocabularyPackages.ts:18**：`sortKey as keyof VocabularyPackageInfo` 断言补理由注释。
10. **比较器合并**：useVocabularyQuery.ts:64-71 与 useVocabularyPackages.ts:19-26 的同构比较器
    （数值相减否则 `localeCompare('zh-Hans-CN')` + desc 反转）提取为 useTableSort.ts 导出的
    `compareValues(a, b)` 与 `applySortDir(cmp, desc)`（命名可斟酌，保持 kebab 文件名不变），
    两处消费。行为完全一致。
11. **useVocabularyQuery.ts**：删除 `reset()`（生产唯一入口 clearSearch 已覆盖，reset 仅测试
    调用——ClientComposables.spec.ts 对应断言改为经 `updateFilter`/`clearSearch` 达成同等覆盖）；
    `SEARCH_SEPARATOR = '\u0000'` 补「为什么」（NUL 不可能出现在用户输入/词面中，防连接串跨
    词条边界误匹配）。
12. **useInviteQueue.ts（修复①）**：`accept()` 起始处调用 `stop()`，与 `decline()` 对称——
    接受请求在途期间倒计时归零不得再自动发 reject。
13. **useCanvasViewport.ts / useCanvasCursor.ts**：`resizeCanvas` / `cursorVisible` **保留**，
    注释定性「测试观测出口」；useCanvasCursor.ts 补文件级职责头注释（对齐画布四件套其余成员）。

## 约束

- useToasts / useGameHud / useRoomSync 成员名单受 store-contracts.ts 锁定：本单删除的成员
  （bumpTick、reset 不在名单内则无需动；若在名单内，同步 test/integration/store-contracts.ts
  ——这是本单例外允许的第三个测试文件）。
- 中文注释；除 1、2 外不动 AppToaster.vue。

## 验收

`npx prettier --write <改动文件>` → `npx eslint <改动文件>` → `pnpm typecheck` 全绿 →
`pnpm vitest run test/integration/toasts.spec.ts test/component/ClientComposables.spec.ts` 通过。
