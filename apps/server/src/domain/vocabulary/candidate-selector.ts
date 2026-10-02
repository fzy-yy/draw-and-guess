import type { VocabularyWord } from '@draw-guess/shared'

/** 输入顺序由调用方提供；选择过程不读取随机源，也不修改词池。 */
interface CandidateSelectorContext {
  pool: readonly VocabularyWord[]
  count: number
}

/**
 * 候选词抽样：只保留唯一一条与难度无关的偏好——同一回合的候选尽量来自不同分类，
 * 让候选之间存在玩家可感知的区分度（同回合抽到两个「动物」是明显的体验退化）。
 *
 * 按难度的目标分布分层已随词库瘦身移除（见
 * docs/adr/0046-vocabulary-slimming-and-unified-round-time.md）：时限与权重不再有难度维度。
 */
export function selectDiverseCandidates({
  pool,
  count,
}: CandidateSelectorContext): VocabularyWord[] {
  if (pool.length <= count) return [...pool]

  const selected: VocabularyWord[] = []
  const usedIds = new Set<string>()
  const usedCollections = new Set<string>()

  // 第一轮：优先挑选合集尚未出现的词，保持调用方给定的词池顺序
  for (const word of pool) {
    if (selected.length >= count) break
    if (usedCollections.has(word.collection)) continue
    selected.push(word)
    usedIds.add(word.id)
    usedCollections.add(word.collection)
  }
  // 第二轮：分类已穷尽（候选数多于分类数）时按原顺序补齐
  for (const word of pool) {
    if (selected.length >= count) break
    if (usedIds.has(word.id)) continue
    selected.push(word)
    usedIds.add(word.id)
  }
  return selected
}
