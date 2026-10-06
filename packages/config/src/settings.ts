/**
 * 领域配置：本地设置、界面时长与预设短语，由公开配置 workspace 包导出。
 */
export const localSettings = {
  /** 默认主音量（0~1），设置页音量滑块初值，与音效音量相乘得到实际音量。 */
  masterVolume: 0.8,
  /** 默认音效音量（0~1），无对应 UI 控件：与主音量相乘决定音效实际音量。 */
  soundVolume: 0.8,
  /** 是否默认静音（设置页「静音」开关初值）。 */
  muted: false,
  /** 默认是否启用界面动效；关闭后设置页会挂 `motion-disabled`、猜中礼花也不放（useGuessConfetti）。 */
  animationsEnabled: true,
  /**
   * 单键快捷键（画板工具 + 面板显隐）只保存单个可打印字符；
   * 客户端会阻止重复键互相覆盖（工具之间、面板之间、工具与面板之间都不得重键）。
   */
  /** 默认画笔工具快捷键。 */
  penShortcut: 'b',
  /** 默认橡皮擦工具快捷键。 */
  eraserShortcut: 'e',
  /** 默认填充工具快捷键。 */
  fillShortcut: 'f',
  /** 显示/隐藏聊天面板（回车键固定用于打开聊天，见 usePanelShortcuts）。 */
  chatPanelShortcut: 'c',
  /** 默认是否在进入猜词时自动聚焦输入框（设置页「自动聚焦」开关初值）。 */
  autoFocusGuess: true,
  /** 默认是否在大厅对其他人可见（设置页「可被发现」开关初值）。 */
  discoverable: true,
  /** 默认是否接收他人邀请（设置页「接收邀请」开关初值）。 */
  acceptsInvites: true,
  /** 画家默认显示答案：开启后作画时默认显示答案，关闭则与猜词玩家一致（只看到下划线遮罩）。 */
  drawerDefaultReveal: true,
} as const

/**
 * 响应式缩放与可读验收标准（唯一来源）。
 *
 * 核心口径：界面 UI 一律使用相对尺寸（cqh/cqw/em），随舞台视口等比缩放；
 * 主要适配电脑网页端，不对手机/平板横屏做特殊适配（无紧凑布局、无设备基准视口），
 * 竖屏仍由 style/other.css 的旋转提示接管；已废除旧的「44px 触控命中区契约」
 * （.touch-target 外扩与 .compact-control 视觉保底），命中区即视觉尺寸。
 *
 * 供三处消费：
 * - 客户端样式（style/tokens.css 字号像素下限）按本表实现；
 * - Playwright 验收用例（test/e2e/specs/07-responsive-touch.spec.ts）按本表断言；
 * - AGENTS.md「响应式与触控验收标准」章节按本表描述。
 * 改动任一处必须同步另两处（test/unit/responsive-standards.spec.ts 会校验三者一致）。
 */
export const responsive = {
  /** 验收基准视口（CSS px）：桌面网页端单一基准。 */
  baselines: [{ key: 'desktop', label: '桌面', width: 1280, height: 720 }],
  /** 正文（text-fs-16 及以上）最小可读字号（CSS px）。 */
  minBodyFontPx: 12,
  /** 次级与辅助文案（text-fs-12 / text-fs-14）最小可读字号（CSS px）。 */
  minSecondaryFontPx: 10,
  /** 微标签（text-fs-10：徽章、工具条小字）最小可读字号（CSS px）。 */
  minMicroFontPx: 9,
  /**
   * 密集控件（画板色板、表情、表格/表单复选框、筛选勾选）最小视觉边长（CSS px）。
   * 密集控件之间间距小，仅保留这一条像素下限防止「缩到看不见」；
   * 其余普通控件不设像素下限，完全随舞台等比缩放。
   */
  minDenseTargetPx: 16,
} as const

/**
 * 静态资源缓存策略（唯一来源）。
 *
 * 消费方：`apps/server/src/app.ts` 按本表设置静态资源缓存响应头，
 * 由 `test/e2e/specs/08-static-asset-cache.spec.ts` 与 `test/unit/bundle-boundary.spec.ts` 断言。
 *
 * 首屏体积预算与组件级懒加载已随「局域网优先」移除
 * （见 docs/adr/0049-lan-first-drop-size-and-coverage-gates.md），这里只保留功能性缓存时长。
 */
export const staticAssets = {
  /**
   * 带内容哈希的构建产物（`/assets/**`）缓存时长（秒）：一年 + immutable。
   * 文件名含内容哈希，内容变化必然改名，因此可安全长缓存。
   */
  immutableMaxAgeSeconds: 31_536_000,
} as const

export const ui = {
  /** Toast（自建 AppToaster）的展示时长（毫秒）。 */
  toastDurationMs: 3_200,
  /** 聊天区允许回看最近 80 条消息；服务端按 2 倍裁剪内存队列，兼顾滚动回看与内存上限。 */
  recentMessageCount: 80,
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
  /** 猜中后/已猜中者可发送的预设短语（服务端白名单校验）。 */
  safeChat: ['画得真棒！', '我知道了！', '再来一点提示', '好难猜呀'],
  /** 表情反应同样经过服务端白名单校验，避免把任意聊天入口开放给画家或已猜中者。 */
  chatReactions: ['👏', '🎉', '😂', '🤔', '😮', '💡'],
} as const
