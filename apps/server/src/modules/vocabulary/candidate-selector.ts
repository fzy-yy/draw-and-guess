/**
 * 候选词多样性抽样选择器（纯函数）。
 *
 * 遵循架构约定：
 * 1. 抽样过程不读取随机源，不修改输入词池；
 * 2. 优先挑选所属合集（collection）尚未出现的词条，保证同回合候选词之间具有足够区分度。
 */
import type { VocabularyWord } from '@draw-guess/shared'

/**
 * 候选词选择器输入上下文。
 */
export interface CandidateSelectorContext {
  /** 候选词词池（已洗牌或已按特定策略排序） */
  pool: readonly VocabularyWord[]
  /** 抽选词条数量 */
  count: number
}

/**
 * 抽取具有多样合集分布的候选词列表。
 *
 * @param context 输入词池与数量
 * @returns 选出的候选词列表
 */
export function selectDiverseCandidates({
  pool,
  count,
}: CandidateSelectorContext): VocabularyWord[] {
  if (pool.length <= count) {
    return [...pool]
  }

  const selected: VocabularyWord[] = []
  const usedIds = new Set<string>()
  const usedCollections = new Set<string>()

  // 第一轮：优先挑选合集尚未出现的词，保持输入给定的词池顺序
  for (const word of pool) {
    if (selected.length >= count) break
    if (usedCollections.has(word.collection)) continue
    selected.push(word)
    usedIds.add(word.id)
    usedCollections.add(word.collection)
  }

  // 第二轮：若合集种类耗尽而候选数仍不足，按原顺序补齐其余词条
  for (const word of pool) {
    if (selected.length >= count) break
    if (usedIds.has(word.id)) continue
    selected.push(word)
    usedIds.add(word.id)
  }

  return selected
}
