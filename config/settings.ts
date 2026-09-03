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
  toastDurationMs: 3_200, // Toast 展示时长
  // 聊天区允许回看最近 80 条消息；服务端按 2 倍裁剪内存队列，兼顾滚动回看与内存上限。
  recentMessageCount: 80,
  /** 词库管理弹窗默认展示形式：'grid'=散列（仅词面） | 'table'=表格陈列（显式联合类型，避免被 as const 收窄成单值） */
  vocabDefaultView: 'grid' as 'grid' | 'table',
  /** 难度星级最大值（词库 difficulty 上限，选词星级与难度列共用） */
  difficultyMax: 5,
  /** 对局 HUD 时间刷新的毫秒间隔（useGameHud 的 useTimestamp interval）。 */
  tickIntervalMs: 200,
  /** 词库管理搜索框的防抖毫秒数，避免每次按键都触发过滤。 */
  searchDebounceMs: 150,
  /** 邀请横幅「拒绝」按钮的倒计时秒数：倒计时结束后自动拒绝（服务端邀请本身 30 秒过期）。 */
  inviteRejectCountdownSeconds: 15,
  /** 邀请按钮点击后的冷却秒数（防止对同一玩家反复发送邀请）；与服务端 network.inviteCooldownMs 保持一致。 */
  inviteCooldownSeconds: 5,
} as const

export const presets = {
  safeChat: ['画得真棒！', '我知道了！', '再来一点提示', '好难猜呀'],
  /** 表情反应同样经过服务端白名单校验，避免把任意聊天入口开放给画家或已猜中者。 */
  chatReactions: ['👏', '🎉', '😂', '🤔', '😮', '💡'],
} as const
