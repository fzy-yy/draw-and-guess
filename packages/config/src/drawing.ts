import { DRAWING_PROTOCOL_LIMITS } from '@draw-guess/shared/protocol/constants'

/**
 * 领域配置：浏览器画板与公开载荷预算；协议字段范围复用 shared 约束。
 */
export const drawing = {
  colors: ['#1F2937', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6', '#FFFFFF'],
  colorPattern: DRAWING_PROTOCOL_LIMITS.colorPattern,
  defaultColor: '#1F2937',
  /** 画笔与橡皮擦共用同一粗细值，画板滚轮按 wheelStep 连续调整。 */
  width: { ...DRAWING_PROTOCOL_LIMITS.width, default: 5, wheelStep: 1 },
  /** DOM 展示层设备像素比封顶；逻辑填充缓冲固定短边 720，不随 DPR 增长。 */
  devicePixelRatioCap: 2.0,
  /** 线宽相对画布缩放的基准分辨率（drawStroke 用 min(宽,高)/referenceResolution 算缩放）。 */
  referenceResolution: 720,
  /** 缩放到画布像素时线宽的最小倍率，避免超小画布上笔迹过细。 */
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
  //   调大将按比例放大内存与重连卡顿，调小会过早丢弃早期笔画。
  batchIntervalMs: 24,
  maxPointsPerBatch: DRAWING_PROTOCOL_LIMITS.maxPointsPerBatch,
  maxHistoryCommands: 1_500,
  // maxPointsPerStroke：单次按下可累计的点数上限。同一笔画多批次共用 ID，因此
  //   maxHistoryCommands（只数命令条数）对其完全不生效，需单独限额防止无限追加。
  // maxPointsPerRound：整回合的总点数预算，直接限定内存与“全量快照/断线重放”的序列化成本。
  maxPointsPerStroke: 1_200,
  maxPointsPerRound: 40_000,
  // maxFillsPerRound：单回合区域填充次数上限。每次填充在重连/撤销重绘时都必须完整重放
  //   （720p 单次约 10~30ms），该上限防止极端刷填充让重放成本与内存失控；正常回合远低于此值。
  maxFillsPerRound: 60,
} as const
