/**
 * 领域配置：本地设置、界面与预设短语，由公开配置 workspace 包导出。
 */
export const localSettings = {
  masterVolume: 0.8,
  soundVolume: 0.8,
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
  /** 画家默认显示答案：开启后作画时默认显示答案与提示类别，关闭则与猜词玩家一致（下划线遮罩与未揭示提示）。 */
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
 * 首屏性能门禁与静态资源缓存策略（唯一来源）。
 *
 * 消费方：
 * - `apps/server/src/app.ts` 按本表设置静态资源缓存响应头；
 * - `test/e2e/specs/08-performance-budget.spec.ts` 按本表断言「主入口 gzip」与
 *   「首屏实际下载」两项预算，并校验缓存响应头。
 * 调整预算时必须先看 `BUNDLE_REPORT=1 pnpm --filter @draw-guess/client build`
 * 的模块占比报告，确认变化来自真实取舍而不是把 vendor 硬拆成多个 chunk 掩盖体积。
 */
export const performance = {
  /**
   * 带内容哈希的构建产物（`/assets/**`）缓存时长（秒）：一年 + immutable。
   * 文件名含内容哈希，内容变化必然改名，因此可安全长缓存。
   */
  immutableAssetMaxAgeSeconds: 31_536_000,
  /**
   * 首屏预算：入口 JS chunk 的 gzip 体积上限（KiB，按资源计时 encodedBodySize 计）。
   * 现状约 166 KiB（框架 + zod 校验 + socket.io + 共享原语 + 静态导入的设置页，
   * 设置页不再懒加载的取舍见 docs/adr/0014-settings-view-static-import.md），留约 6% 余量；
   * 触顶说明有新的重量级依赖进了主 chunk，应先看体积报告再决定是否懒加载，而不是调大本值。
   */
  mainEntryGzipKib: 176,
  /** 首屏预算：进入资料页为止实际下载的传输体积上限（KiB，按资源计时 transferSize 求和）。现状约 176 KiB。 */
  firstScreenTransferKib: 192,
} as const

export const ui = {
  toastDurationMs: 3_200, // Toast 展示时长
  // 聊天区允许回看最近 80 条消息；服务端按 2 倍裁剪内存队列，兼顾滚动回看与内存上限。
  recentMessageCount: 80,
  /** 难度星级最大值（词库 difficulty 上限，选词星级与难度列共用） */
  difficultyMax: 5,
  /** 可绘制性星级最大值（词库 drawability 上限，选词卡第二组星级与词库管理列共用） */
  drawabilityMax: 5,
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
