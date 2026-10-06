import { DRAWING_PROTOCOL_LIMITS } from '@draw-guess/shared/protocol/constants'

/**
 * 领域配置：浏览器画板与公开载荷预算；协议字段范围复用 shared 约束。
 */
export const drawing = {
  /** 画板预设色板（工具色，不属品牌调色板）：工具栏色块按此顺序渲染。 */
  colors: ['#1F2937', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6', '#FFFFFF'],
  /** 颜色格式正则：服务端启动校验与画笔/填充请求校验共用（引用协议常量）。 */
  colorPattern: DRAWING_PROTOCOL_LIMITS.colorPattern,
  /** 进入对局时的初始画笔颜色。 */
  defaultColor: '#1F2937',
  /**
   * 画笔与橡皮擦共用同一粗细值；`min`/`max` 是滚轮可达区间，`default` 是进入对局初值，
   * `wheelStep` 是滚轮（画布内与粗细控件上）每格调整量。
   * 粗细的离散步长只在协议侧（`DRAWING_PROTOCOL_LIMITS.width.step = 1`，即必须为整数像素），
   * 此处不再重复一份：服务端对奇数/偶数粗细一视同仁，wheelStep 可独立调整。
   */
  width: {
    /** 最细线宽（参考像素值）。 */
    min: 1,
    /** 最粗线宽（参考像素值）。 */
    max: 30,
    /** 进入对局时的初始线宽。 */
    default: 6,
    /** 滚轮每格的线宽增量（画布内滚轮与粗细控件共用）。 */
    wheelStep: 2,
  },
  /** 展示层设备像素比上限：超过该值不再放大画布，避免 4K 屏上的绘制开销失控。 */
  devicePixelRatioCap: 2.0,
  /** 线宽基准分辨率（drawStroke 用 min(宽,高)/referenceResolution 算线宽缩放）。 */
  referenceResolution: 720,
  /** 线宽缩放到画布像素时的最小倍率，避免超小画布上笔迹过细。 */
  minLineScale: 0.6,
  /** 自由笔画采样的去抖距离（归一化坐标），避免一帧内产生大量重复点。 */
  dedupDistance: 0.0015,
  /** 洪泛填充比较目标像素时允许的单通道误差，用于兼容 Canvas 抗锯齿边缘。 */
  fillTolerance: 8,
  // —— 性能预算（为什么是这些值）：
  // batchIntervalMs 24：~40 批/秒的自由笔画采样节奏，兼顾实时性与事件量；调小会显著增加每人心跳与 CPU。
  // maxPointsPerBatch 120：单包最大点数，配合 24ms 批次通常在包内；调大只影响极端一笔画，不改变稳态。
  // 服务端另有私有的事件限频；公开配置只描述客户端批处理节奏和协议载荷范围。
  // maxHistoryCommands 1500 ≈ 全回合绘制上限：90 秒 × 40 批/秒 ≈ 3600 个事件，但单笔画多批共用 ID，实际命令数通常远小于事件数；
  //   它直接决定服务端每个回合 strokes 数组的内存与“全量快照/断线重放”的序列化成本（约 1500 × 数百字节 = 数百 KB/人），
  //   调大将按比例放大内存与重连卡顿。
  //   ★ 语义是**硬上限 + 拒绝新增**（DRAW_HISTORY_LIMIT_REACHED），不是静默丢弃最旧命令：
  //   丢弃会让早期封闭边界从权威历史里消失、后续填充重放时吞掉整张画布，并让客户端镜像与权威历史错位，
  //   撤销或清空后即可继续绘制（取舍见 docs/adr/0010-drawing-history-cap.md）。
  /** 自由笔画向上抛送的分批间隔（毫秒），即客户端采样节奏。 */
  batchIntervalMs: 24,
  /** 单个绘图请求最多携带的点数（协议载荷上限，由 shared 常量决定）。 */
  maxPointsPerBatch: DRAWING_PROTOCOL_LIMITS.maxPointsPerBatch,
  /** 单回合画布命令数上限，达到后服务端拒绝新命令（撤销或清空释放名额）。 */
  maxHistoryCommands: 1_500,
  /** 单笔可累计的点数上限，作为线上笔画 Schema 与服务端预算的共享边界。 */
  maxPointsPerStroke: DRAWING_PROTOCOL_LIMITS.maxPointsPerStroke,
  /** 单回合累计点数预算，防止极端刷笔画拖垮服务端。 */
  maxPointsPerRound: 40_000,
  // maxFillsPerRound：单回合区域填充次数上限。每次填充在重连/撤销重绘时都必须完整重放
  //   （720p 单次约 10~30ms），该上限防止极端刷填充让重放成本与内存失控；正常回合远低于此值。
  /** 单回合区域填充次数上限。 */
  maxFillsPerRound: 60,
} as const
