import { soundCatalog } from '@draw-guess/config'

/** 全部合法音效键名（由 soundCatalog 配置直接推导，具备 IDE 严格自动补全）。 */
export type SoundName = keyof typeof soundCatalog
