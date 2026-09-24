/**
 * 领域配置：短音效清单与播放器参数，由公开配置 workspace 包导出。
 * 集中声明全游戏自定义 MP3/WAV 短音效、默认音量倍率、防刷冷却、类型与资源必需性。
 *
 * - `required: true` 表示该键是游戏可正常体验的必需资源；开发/测试环境缺失时给出可定位失败信息。
 * - `required: false` 表示该键允许缺失，缺失时只降级（播放静默跳过）、不判失败。
 *   素材文件统一放在 apps/client/src/assets/audio/。
 * - 背景音乐（BGM）系统已整体移除：仅保留点击/阶段等短音效，不再播放长循环音乐。
 */
export const soundCatalog = {
  // 界面交互 (SFX) — 必需
  click: { volumeMultiplier: 1.0, cooldownMs: 50, required: true },
  switch: { volumeMultiplier: 0.9, cooldownMs: 50, required: true },
  popup: { volumeMultiplier: 0.9, cooldownMs: 80, required: true },
  close: { volumeMultiplier: 0.8, cooldownMs: 80, required: true },
  // 房间状态 (SFX) — 必需
  ready: { volumeMultiplier: 1.0, cooldownMs: 100, required: true },
  invite: { volumeMultiplier: 1.0, cooldownMs: 200, required: true },
  // 对局关键事件 (SFX) — 必需
  start: { volumeMultiplier: 1.1, cooldownMs: 200, required: true },
  drawing: { volumeMultiplier: 1.0, cooldownMs: 200, required: true },
  correct: { volumeMultiplier: 1.2, cooldownMs: 100, required: true },
  tick: { volumeMultiplier: 0.85, cooldownMs: 200, required: true },
  round_result: { volumeMultiplier: 1.0, cooldownMs: 300, required: true },
  game_result: { volumeMultiplier: 1.2, cooldownMs: 300, required: true },
} as const

export type SoundCatalog = typeof soundCatalog
export type SoundCatalogKey = keyof SoundCatalog

export const audio = {
  sounds: soundCatalog,
  /** 音量滑块（主音量/音效）共用的合法区间与步进。 */
  volumeRange: { min: 0, max: 1, step: 0.05 },
  /**
   * 短音效发音池参数：每个音效名最多并发的实例数，以及池满时的抢占策略。
   * - `round-robin`：按池内游标轮转复用，可预测且避免始终命中数组首个实例。
   *   数值应 >= 1；0 表示不做池化（每次新建，无叠音上限）。
   */
  sfxPool: {
    maxInstances: 3,
    preemptStrategy: 'round-robin',
  } as const,
} as const

export type SfxPoolPreemptStrategy = typeof audio.sfxPool.preemptStrategy
