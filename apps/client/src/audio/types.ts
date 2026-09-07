import { soundCatalog } from '@draw-guess/config'

/** 全部合法音效键名（由 soundCatalog 配置直接推导，具备 IDE 严格自动补全）。 */
export type SoundName = keyof typeof soundCatalog

/** 单个音效播放的可选参数。 */
export interface PlaySoundOptions {
  /** 覆盖当前音效的基础音量倍率（0~1，默认采用配置中的 volumeMultiplier）。 */
  volumeScale?: number
}
