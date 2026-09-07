export interface VocabularyWord {
  id: string
  text: string
  aliases: string[]
  category: string
  difficulty: number
  timeLimit?: number
  scoreWeight?: number
}
export const MIN_SELECTED_VOCABULARY_WORDS = 60
export interface VocabularyPackageInfo {
  id: string
  name: string
  wordCount: number
  description: string
  version: string
  updatedAt: string
}
export interface VocabularySnapshot {
  packageId: string
  packages: VocabularyPackageInfo[]
  items: VocabularyWord[]
  selectedIds: string[]
  version: string
  categories: string[]
}
