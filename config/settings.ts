/**
 * 领域配置：本地设置、界面与预设短语。
 * 归入根级 config/ 目录后由 config.ts 聚合，保持“唯一业务配置中心”不变。
 */
export const localSettings = {
  masterVolume: 0.8,
  soundVolume: 0.8,
  musicVolume: 0.35,
  muted: false,
  /** 统一控制非必要的界面过渡与反馈动画；关闭后不影响倒计时和画布逻辑。 */
  animationsEnabled: true,
  showShortcuts: true,
  /** 工具快捷键只保存单个可打印字符；客户端会阻止重复键覆盖其他工具。 */
  penShortcut: 'b',
  eraserShortcut: 'e',
  fillShortcut: 'f',
  autoFocusGuess: true,
  discoverable: true,
  acceptsInvites: true,
} as const

export const ui = {
  stageAspectRatio: '16 / 9', // 舞台宽高比
  toastDurationMs: 3_200, // Toast 展示时长
  // 聊天区允许回看最近 80 条消息；服务端按 2 倍裁剪内存队列，兼顾滚动回看与内存上限。
  recentMessageCount: 80,
} as const

export const presets = {
  safeChat: ['画得真棒！', '我知道了！', '再来一点提示', '好难猜呀'],
  /** 表情反应同样经过服务端白名单校验，避免把任意聊天入口开放给画家或已猜中者。 */
  chatReactions: ['👏', '🎉', '😂', '🤔', '😮', '💡'],
} as const
