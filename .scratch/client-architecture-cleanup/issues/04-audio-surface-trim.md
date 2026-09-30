# 04 audio 死表面删除（dispose 链等）+ 注释修正 + 不变量硬化

Status: ready-for-agent

## 背景

audio 域审查：`SoundManager.dispose` 注释宣称的「应用级注销」调用链不存在（纯死链）；
端口契约带「只写不读」成员；manifest 有无人消费的 `isValid` 与无断言支撑的键大小写隐式不变量；
若干静态不可达守卫与注释漂移。用户裁决：**分类处置**——纯残留删除并同步测试；
`required:false`/`optional-missing` 分支属刻意扩展位，**保留 + 定性注释**。

## 文件归属

- apps/client/src/audio/contracts.ts
- apps/client/src/audio/browser-adapter.ts
- apps/client/src/audio/manager.ts
- apps/client/src/audio/routing.ts
- apps/client/src/audio/manifest.ts
- apps/client/src/audio/runtime.ts
- apps/client/src/audio/index.ts
- packages/config/src/audio.ts（仅允许"导出类型"级零行为改动）
- test/unit/helpers/fake-audio.ts
- test/unit/sound-manager.spec.ts
- 测试联动：grep `dispose` / `port.url` / `isValid` / `AudioEvent` 命中的其它 spec，同步修改
  （含 test/component 音频相关 spec；发现范围外消费者则改为保留+注释并报告）

## 事项清单

1. **dispose 链删除**：`manager.ts` 的 `SoundManager.dispose()`、`contracts.ts` 的
   `AudioPort.dispose` 成员、`browser-adapter.ts` 的实现、`fake-audio.ts` 对应替身成员、
   `sound-manager.spec.ts` 相关用例；`manager.ts:164-166` 宣称「应用级注销」的注释随实现一并
   删除。useAudioFeedback 卸载路径维持 `stopAll()` 不变（先 grep 确认无人调 dispose）。
2. **`AudioPort.url` 删除**：全链只写不读（manager 从不取 `port.url`）；adapter 内部创建
   `new Audio(url)` 的局部变量不受影响；`fake-audio.ts` 同步去掉该字段。
3. **manager.ts:66,146 `if (!meta)` 守卫删除**：`APP_CONFIG.audio.sounds` 是 `as const`，
   `SoundName = keyof` 的已知键访问静态不可能 undefined；若 `noUncheckedIndexedAccess` 迫使
   保留，改为带中文理由的注释 + 最小非空处理，不得引入 console。
4. **browser-adapter.ts:106 `if (sound)`**：`interactionToAudio` 返回类型为 `SoundName`
   （非空联合）恒真——直调 `play(...)`。（先核实返回类型确无可空。）
5. **routing.ts**：:12「两个 switch 的 default 分支」改「各 switch」（实为三个穷尽 switch）；
   :17 `export type AudioEvent` 去掉 export（全仓无导入）。
6. **manifest.ts**：
   - `isValid` 字段删除（含 SoundManifest 类型成员；grep 确认 spec 是否断言，同步之；
     `hasFatalIssues` 为唯一消费口径）；
   - `entries` 键大小写不变量硬化：入表时 `key.toLowerCase()` 归一（当前 12 键全小写，
     行为零变化）并注释「资源 glob 与查询都以小写为键，防 catalog 引入大写键后静默失联」；
   - `SoundMeta` 改为从 config 派生：`packages/config/src/audio.ts` 导出
     `soundCatalog` 的类型别名（如 `export type SoundCatalog = typeof soundCatalog`），
     manifest 用 `SoundCatalog[keyof SoundCatalog]`，删手抄字段与「手抄一致性」注释
     （若字段有出入以 config 为准并检查消费点）。
   - `required:false` / `optional-missing` 分支：**保留**，补注释定性「刻意扩展位——
     内置目录当前全部 required，自定义词库音效可标可选」。
7. **runtime.ts**：音频资源目录字面量与 manifest.ts 的 `ASSET_DIR` 单源化（manifest 导出、
   runtime 导入）；双通道告警（initAudio 批量 error + getSoundUrl 逐键 warn）**保留机制**，
   各补一行「批量校验供启动期、逐键告警供运行期兜底」的定性注释。
8. **index.ts:4**：「测试按子路径直连」补上「useAudioFeedback 亦从 @/audio/routing 子路径直连」。
9. **manager.ts:109-114**：`sfxPoolCursor` 处补注释声明不变量「池实例只增不减，游标不会悬空；
   若未来加实例驱逐需先重置游标」。

## 约束

- 音效播放行为、清单校验语义、降级策略零变化；不动 assets/audio 资源与 README。
- 行号为审查快照，先验证再动手；不符者跳过并记录。

## 验收

`npx prettier --write <改动文件>` → `npx eslint <改动文件>` → `pnpm typecheck` 全绿 →
`pnpm vitest run` 音频相关 spec（sound-manager.spec / sound-manifest.spec / 组件音频 spec，
先 grep 定位）全部通过。
