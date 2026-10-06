/**
 * 领域配置：短音效清单与播放器参数，由公开配置 workspace 包导出。
 * 集中声明全游戏自定义 MP3/WAV 短音效、默认音量倍率、防刷冷却、类型与资源必需性。
 *
 * - `required: true` 表示该键是游戏可正常体验的必需资源；开发/测试环境缺失时给出可定位失败信息。
 * - `required: false` 表示该键允许缺失，缺失时只降级（播放静默跳过）、不判失败。
 *   素材文件统一放在 apps/client/src/assets/audio/。
 * - 背景音乐（BGM）系统已整体移除：仅保留点击/阶段等短音效，不再播放长循环音乐。
 *
 * 每个音效的参数含义：`volumeMultiplier` 为相对音效音量的倍率，`cooldownMs` 为防刷冷却时长（毫秒）。
 */
export const soundCatalog = {
  // 界面交互 (SFX) — 必需
  /** 按钮/控件点击音。 */
  click: { volumeMultiplier: 1.0, cooldownMs: 50, required: true },
  /** 开关、页签等状态切换音。 */
  switch: { volumeMultiplier: 0.9, cooldownMs: 50, required: true },
  /** 弹窗/浮层打开音。 */
  popup: { volumeMultiplier: 0.9, cooldownMs: 80, required: true },
  /** 弹窗/浮层关闭音。 */
  close: { volumeMultiplier: 0.8, cooldownMs: 80, required: true },
  // 房间状态 (SFX) — 必需
  /** 玩家准备状态切换音。 */
  ready: { volumeMultiplier: 1.0, cooldownMs: 100, required: true },
  /** 收到邀请音。 */
  invite: { volumeMultiplier: 1.0, cooldownMs: 200, required: true },
  // 对局关键事件 (SFX) — 必需
  /** 对局开始（开局倒计时入场）音。 */
  start: { volumeMultiplier: 1.1, cooldownMs: 200, required: true },
  /** 自己落笔作画的笔触音。 */
  drawing: { volumeMultiplier: 1.0, cooldownMs: 200, required: true },
  /** 猜中答案音。 */
  correct: { volumeMultiplier: 1.2, cooldownMs: 100, required: true },
  /** 倒计时进入紧急区间的警示音。 */
  tick: { volumeMultiplier: 0.85, cooldownMs: 200, required: true },
  /** 回合结算界面出现音。 */
  round_result: { volumeMultiplier: 1.0, cooldownMs: 300, required: true },
  /** 终局战报出现音。 */
  game_result: { volumeMultiplier: 1.2, cooldownMs: 300, required: true },
} as const

export const audio = {
  /** 音效键到播放参数的映射；`SoundName` 由本对象推导，新增音效只需在这里加一条并放入素材文件。 */
  sounds: soundCatalog,
  /** 音量滑块（主音量/音效）共用的合法区间与步进。 */
  volumeRange: { min: 0, max: 1, step: 0.05 },
  /**
   * 短音效发音池参数：每个音效名最多并发的实例数，以及池满时的抢占策略。
   * - `round-robin`：按池内游标轮转复用，可预测且避免始终命中数组首个实例。
   *   数值应 >= 1；0 表示不做池化（每次新建，无叠音上限）。
   */
  sfxPool: {
    /** 每个音效名最多并发的实例数（叠音上限）。 */
    maxInstances: 3,
    /** 池满时的抢占策略。 */
    preemptStrategy: 'round-robin',
  } as const,
} as const
