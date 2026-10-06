/**
 * 复盘轮播的游标与页序（纯函数，S11 / S43）。
 *
 * 服务端权威游标是三维的：**链序号**（1 起，按链发起人席位顺序升序，S11）
 * → **半场**（1/2，一条链的两幅画）→ **页**（半场内的三段：重播 → 停顿 → 揭晓，S43）。
 * 每页时长一律取自公开配置包（`relay.replaySeconds` / `relay.replayPauseSeconds` / `relay.revealSeconds`，
 * 禁止魔法数字），页序推进与「本链复盘是否结束」的判定都收在本模块；
 * 轮播状态机（`RelayMachine`）只负责按页排计时器、写阶段时间与换阶段，不自己算时序。
 *
 * 「页」不单独上线：快照用 `answer.text === null`（未揭晓）配合 `phaseStartedAt` / `phaseEndsAt`
 * （本页的权威窗口）表达它——服务端既是唯一计时者，客户端就不需要一个会与计时漂移的页枚举。
 */
import type { RelayHalf } from '@draw-guess/shared'
import { APP_CONFIG } from '../../config/index.ts'

/** 半场内的三页（S43）：重播画作 → 静止停顿 → 揭晓答案。 */
export type RelayShowcasePage = 'replay' | 'pause' | 'reveal'

/** 每半场的页序；数组顺序即推进顺序（唯一的顺序定义处）。 */
export const RELAY_SHOWCASE_PAGES = [
  'replay',
  'pause',
  'reveal',
] as const satisfies readonly RelayShowcasePage[]

/** 复盘游标：第几条链 / 第几个半场 / 哪一页（服务端权威，随快照表达为链序号 + 半场 + 揭晓态）。 */
export interface RelayShowcaseCursor {
  /** 当前链序号（1 起，与快照 `showcase.chainIndex` 同口径）。 */
  chainIndex: number
  /** 当前半场（1＝第一幅画与第二棒答案，2＝第二幅画与第四棒答案）。 */
  half: RelayHalf
  /** 当前页。 */
  page: RelayShowcasePage
}

/** 轮播从第 1 条链（席位最靠前的发起人）开始（S11）。 */
export const FIRST_SHOWCASE_CHAIN_INDEX = 1

/** 一页的时长（毫秒）：三档都取自配置包，改配置即两端同步（S17 / S43）。 */
export function showcasePageMs(page: RelayShowcasePage): number {
  if (page === 'replay') return APP_CONFIG.relay.replaySeconds * 1_000
  if (page === 'pause') return APP_CONFIG.relay.replayPauseSeconds * 1_000
  return APP_CONFIG.relay.revealSeconds * 1_000
}

/**
 * 下一页：同一半场内沿 `RELAY_SHOWCASE_PAGES` 前进；半场 1 的揭晓之后进入半场 2 的重播；
 * 半场 2 的揭晓之后返回 undefined——本链展示结束，调用方据此切入该链投票（S43）。
 */
export function nextShowcasePage(
  page: RelayShowcasePage,
  half: RelayHalf,
): { half: RelayHalf; page: RelayShowcasePage } | undefined {
  const next = RELAY_SHOWCASE_PAGES[RELAY_SHOWCASE_PAGES.indexOf(page) + 1]
  if (next) return { half, page: next }
  return half === 1 ? { half: 2, page: RELAY_SHOWCASE_PAGES[0] } : undefined
}
