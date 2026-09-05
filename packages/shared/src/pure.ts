/**
 * 共享领域纯函数：答案规范化、遮罩生成、计分与状态机转换表。
 * 无任何运行时依赖，可在 Node 与浏览器中直接单测。
 */
import { APP_CONFIG } from '../../../config.ts'
import type { RoomPhase, ScoreDetail } from './types.ts'

export function normalizeHexColor(value: string): string | undefined {
  return new RegExp(APP_CONFIG.drawing.colorPattern).test(value) ? value.toUpperCase() : undefined
}

/** 标准化猜词；Unicode NFKC 可合并全角拉丁字符，中文词面不会被破坏。 */
export function normalizeAnswer(value: string): string {
  return value.normalize('NFKC').trim().replace(/\s+/gu, ' ').toLocaleLowerCase()
}

/** 按 Unicode 码点生成遮罩，标点和空白保留，避免中文代理对被拆开。 */
export function createAnswerMask(
  answer: string,
  revealed: ReadonlySet<number> = new Set(),
): string {
  return Array.from(answer)
    .map((character, index) =>
      /^[\p{P}\p{Z}\s]$/u.test(character) || revealed.has(index) ? character : '＿',
    )
    .join('')
}

/**
 * 计算猜中者分数。速度奖励按剩余时间比例线性衰减，并通过取整保证各客户端展示一致。
 * 两人局不使用顺序奖，避免唯一猜词者天然获得第一名额外分。
 * scoreMode='flat'（固定分）时只给基础分，速度与顺序奖励归零。
 */
export function calculateGuessScore(input: {
  elapsedMs: number
  durationMs: number
  correctOrder: number
  playerCount: number
  base: number
  maxSpeedBonus: number
  orderBonuses: readonly number[]
  /** 计分方式：缺省 standard（基础+速度+顺序）；flat 为固定分 */
  mode?: 'standard' | 'flat'
}): Omit<ScoreDetail, 'playerId'> {
  if (input.mode === 'flat') {
    return { base: input.base, speed: 0, order: 0, total: input.base }
  }
  const duration = Math.max(1, input.durationMs)
  const remainingRatio = Math.max(0, Math.min(1, 1 - input.elapsedMs / duration))
  const speed = Math.round(input.maxSpeedBonus * remainingRatio)
  const order = input.playerCount === 2 ? 0 : (input.orderBonuses[input.correctOrder - 1] ?? 0)
  return { base: input.base, speed, order, total: input.base + speed + order }
}

/**
 * 房间阶段合法转换表：每个阶段列出的目标阶段都是显式允许的。
 * 任何未列出的转换都会被服务端拒绝并返回 INVALID_TRANSITION。
 */
const LEGAL_PHASES: Record<RoomPhase, readonly RoomPhase[]> = {
  waiting: ['starting', 'closed'],
  starting: ['waiting', 'choosing_word', 'closed'],
  // choosing_word → round_result 表示“画家弃权，本回合作废”后进入（由 abandonChoosing 使用）
  choosing_word: ['drawing', 'paused', 'closed', 'game_result', 'round_result'],
  drawing: ['round_result', 'paused', 'closed', 'game_result'],
  round_result: ['choosing_word', 'game_result', 'paused', 'closed'],
  paused: ['choosing_word', 'drawing', 'round_result', 'game_result', 'closed'],
  game_result: ['waiting', 'closed'],
  closed: [],
}

/** 状态转换显式白名单；非法转换必须由调用方拒绝并记录。 */
export function canTransition(from: RoomPhase, to: RoomPhase): boolean {
  return LEGAL_PHASES[from].includes(to)
}
