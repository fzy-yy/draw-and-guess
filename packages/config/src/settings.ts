/**
 * 领域配置：本地设置、界面与预设短语，由公开配置 workspace 包导出。
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
  /** 画家默认显示答案：开启后作画时默认显示答案与提示类别，关闭则与猜词玩家一致（下划线遮罩与未揭示提示）。 */
  drawerDefaultReveal: true,
} as const

/**
 * 响应式与触控验收标准（唯一来源）。
 *
 * 供三处消费：
 * - 客户端样式（style/tokens.css 字号像素下限、style/utilities.css 的 compact 断点）按本表实现；
 * - Playwright 验收用例（test/e2e/specs/07-responsive-touch.spec.ts）按本表断言；
 * - AGENTS.md「响应式与触控验收标准」章节按本表描述。
 * 改动任一处必须同步另两处（test/unit/responsive-standards.spec.ts 会校验三者一致）。
 */
export const responsive = {
  /** 三个验收基准视口（CSS px）：桌面 / 平板横屏 / 手机横屏。 */
  baselines: [
    { key: 'desktop', label: '桌面', width: 1280, height: 720 },
    { key: 'tablet-landscape', label: '平板横屏', width: 1024, height: 768 },
    { key: 'phone-landscape', label: '手机横屏', width: 844, height: 390 },
  ],
  /**
   * 关键交互控件（动作按钮 / 图标按钮 / 开关行 / 弹窗按钮）最小命中区边长（CSS px）。
   * 视觉尺寸可小于该值，但点击/触摸命中区必须达到（经共享类 .touch-target 扩展）。
   */
  minTouchTargetPx: 44,
  /** 正文（text-fs-16 及以上）最小可读字号（CSS px）。 */
  minBodyFontPx: 12,
  /** 次级与辅助文案（text-fs-12 / text-fs-14）最小可读字号（CSS px）。 */
  minSecondaryFontPx: 10,
  /** 微标签（text-fs-10：徽章、工具条小字）最小可读字号（CSS px）。 */
  minMicroFontPx: 9,
  /**
   * 密集控件（画板色板、表情、表格复选框）最小视觉边长（CSS px）。
   * 这类控件横向间距不足以容纳 44px 命中区，因此**不接入** `.touch-target`：
   * 命中区即视觉盒，天然不会与相邻控件重叠。
   */
  minDenseTargetPx: 20,
  /**
   * 紧凑布局（compact）触发的舞台高度阈值（CSS px）：舞台高度不高于该值时启用。
   * 取 600px：桌面基准（1280×720）舞台高 713px 走标准布局；平板横屏（1024×768）舞台高 570px
   * 与手机横屏（844×390）舞台高 386px 均进入紧凑布局——两者按 cqh 等比缩放时控件只有 17～25px，
   * 已低于触控下限，必须由紧凑布局接管而不是继续缩小。
   */
  compactStageHeightPx: 600,
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
   * 现状约 155 KiB（框架 + zod 校验 + socket.io + 共享原语），留约 6% 余量；
   * 触顶说明有新的重量级依赖进了主 chunk，应先看体积报告再决定是否懒加载，而不是调大本值。
   */
  mainEntryGzipKib: 165,
  /** 首屏预算：进入资料页为止实际下载的传输体积上限（KiB，按资源计时 transferSize 求和）。现状约 167 KiB。 */
  firstScreenTransferKib: 180,
} as const

export const ui = {
  toastDurationMs: 3_200, // Toast 展示时长
  // 聊天区允许回看最近 80 条消息；服务端按 2 倍裁剪内存队列，兼顾滚动回看与内存上限。
  recentMessageCount: 80,
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
