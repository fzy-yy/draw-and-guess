/**
 * 终局战报趣味荣誉称号纯函数模块。
 *
 * 根据整局战报历史推导：
 * 1.「神笔马良」：单回合被猜出速度最快（或被猜出率最高）的画家；
 * 2.「灵魂画手」：全场无人猜出次数最多、但画作笔画丰富的画家；
 * 3.「读心大师」：全场最早猜中（获得 100 分第一顺位）次数最多的猜词王者；
 * 4.「积极分子」：全场发言猜测频次最高的气氛担当。
 *
 * 称号计算完全在前端完成，纯函数输入输出，无副作用，不依赖 SQLite 数据库迁移。
 */
import type { GameView, RoomMember } from '@draw-guess/shared'
import { strings } from '@draw-guess/strings'

/** 荣誉称号类型定义 */
export type AccoladeKey = 'masterDrawer' | 'soulPainter' | 'mindReader' | 'activeGuesser'

/** 单个荣誉称号元数据 */
export interface AccoladeInfo {
  key: AccoladeKey
  title: string
  description: string
  icon: string
  /** 颜色风格类名 */
  colorClass: string
}

/** 静态称号信息配置 */
export const ACCOLADE_CONFIG: Record<AccoladeKey, AccoladeInfo> = {
  masterDrawer: {
    key: 'masterDrawer',
    title: strings.ui.game.accolades.masterDrawer,
    description: strings.ui.game.accolades.masterDrawerDesc,
    icon: '🖌️',
    colorClass: 'bg-yellow/15 text-warning-fg',
  },
  soulPainter: {
    key: 'soulPainter',
    title: strings.ui.game.accolades.soulPainter,
    description: strings.ui.game.accolades.soulPainterDesc,
    icon: '🎨',
    colorClass: 'bg-purple/15 text-purple',
  },
  mindReader: {
    key: 'mindReader',
    title: strings.ui.game.accolades.mindReader,
    description: strings.ui.game.accolades.mindReaderDesc,
    icon: '⚡',
    colorClass: 'bg-sky text-blue',
  },
  activeGuesser: {
    key: 'activeGuesser',
    title: strings.ui.game.accolades.activeGuesser,
    description: strings.ui.game.accolades.activeGuesserDesc,
    icon: '🔥',
    colorClass: 'bg-red/15 text-red',
  },
}

/**
 * 纯函数：根据当前 GameView 与房间成员列表计算每位成员获得的荣誉称号。
 *
 * @param gameView 对局快照（含得分明细、消息列表、笔画等）
 * @param members 房间成员（含 MemberStats 统计）
 * @returns 成员 ID 到荣誉称号列表的映射 Record<string, AccoladeInfo[]>
 */
export function deriveAccolades(
  gameView?: GameView,
  members: RoomMember[] = [],
): Record<string, AccoladeInfo[]> {
  const result: Record<string, AccoladeInfo[]> = {}
  if (!members.length) return result

  // 初始化所有成员结果列表
  for (const m of members) {
    result[m.id] = []
  }

  // 若缺少对局快照或数据不足，直接返回空
  if (!gameView) return result

  // 1.「神笔马良」：作画带猜中次数最多，且平均被猜中时间较短的画家
  // 从 members 的 stats.drawingCorrectCount 寻找最高者
  let bestDrawerId: string | undefined
  let maxDrawingCorrect = 0
  for (const m of members) {
    const drawingCorrect = m.stats.drawingCorrectCount
    if (drawingCorrect > maxDrawingCorrect) {
      maxDrawingCorrect = drawingCorrect
      bestDrawerId = m.id
    }
  }
  // 达到至少带猜中 1 人次的门槛才授予
  if (bestDrawerId && maxDrawingCorrect > 0) {
    result[bestDrawerId]?.push(ACCOLADE_CONFIG.masterDrawer)
  }

  // 2.「灵魂画手」：全场画作笔画丰富但无人猜出（或作画猜出率极低）的画家
  // 当画家当前作画笔画数 >= 5，但本局带猜中为 0
  let soulPainterId: string | undefined
  const strokesCount = gameView.strokes.length
  if (strokesCount >= 5) {
    for (const m of members) {
      if (m.stats.drawingCorrectCount === 0) {
        soulPainterId = m.id
        break
      }
    }
  }
  if (soulPainterId) {
    result[soulPainterId]?.push(ACCOLADE_CONFIG.soulPainter)
  }

  // 3.「读心大师」：全场最快猜中（第一顺位得 100 分）次数最多或平均用时最短的猜词者
  // 从 stats.correctCount > 0 且平均猜词用时最低的玩家计算
  let mindReaderId: string | undefined
  let bestAvgMs = Infinity
  for (const m of members) {
    if (m.stats.correctCount > 0) {
      const avgMs = m.stats.totalGuessMs / m.stats.correctCount
      if (avgMs < bestAvgMs) {
        bestAvgMs = avgMs
        mindReaderId = m.id
      }
    }
  }
  if (mindReaderId && bestAvgMs < Infinity) {
    result[mindReaderId]?.push(ACCOLADE_CONFIG.mindReader)
  }

  // 4.「积极分子」：全场发言猜测频次最高的气氛担当
  // 统计 messages 中各 playerId 发送 guess / preset 消息最多的玩家
  const guessCounts: Record<string, number> = {}
  for (const msg of gameView.messages) {
    if (msg.playerId && (msg.type === 'guess' || msg.type === 'preset')) {
      guessCounts[msg.playerId] = (guessCounts[msg.playerId] ?? 0) + 1
    }
  }
  let activeGuesserId: string | undefined
  let maxGuesses = 0
  for (const [pId, count] of Object.entries(guessCounts)) {
    if (count > maxGuesses) {
      maxGuesses = count
      activeGuesserId = pId
    }
  }
  // 至少发言 2 次以上且不是唯一发言
  if (activeGuesserId && maxGuesses >= 2) {
    result[activeGuesserId]?.push(ACCOLADE_CONFIG.activeGuesser)
  }

  return result
}
