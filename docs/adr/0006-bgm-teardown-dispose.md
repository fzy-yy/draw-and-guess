# 0006 BGM 切歌时释放旧实例（dispose 清空 src）

**状态**：已废弃（BGM 子系统已整体移除，无取代 ADR）

## 背景

`SoundManager` 切换或停止 BGM 时原先只对旧端口做 `pause()` + `currentTime = 0`，
**不调用 `dispose()`**。而只有 `dispose()` 会清空 `src`；保留 `src` 的 `Audio` 元素
会一直持有已解码/待下载的资源，反复切歌（大厅 ↔ 对局）会累积到 GC 才释放。

## 决策

- `teardownBgm()` 在暂停、归零之后调用 `port.dispose()`，显式清空 `src`；
- `dispose()` 同时递增 `bgmGeneration`，让仍在进行中的播放异步结果作废，
  避免「已释放的实例」把过期结果写回解锁状态；
- 短音效池保持复用语义（不 dispose），只有 BGM 实例按切歌销毁。

## 后果

- 切歌后旧实例立即释放资源，长时间对局不再累积内存；
- 代价：同一首 BGM 反复切换会重新创建 `Audio` 实例（不复用），换来的是确定性的释放——
  BGM 切换频率极低，这点开销可忽略。

## 关联

- 代码：`apps/client/src/audio/manager.ts`（`teardownBgm` / `installBgmPort` / `dispose`）
- 相关：`apps/client/src/audio/browser-adapter.ts`（`dispose` 的实现）
