/**
 * 领域配置：画板与填充。
 * 归入根级 config/ 目录后由 config.ts 聚合，保持“唯一业务配置中心”不变。
 */
export const drawing = {
  colors: ['#1F2937', '#EF4444', '#F97316', '#EAB308', '#22C55E', '#3B82F6', '#8B5CF6', '#FFFFFF'],
  colorPattern: '^#[0-9A-Fa-f]{6}$',
  defaultColor: '#1F2937',
  /** 画笔与橡皮擦共用同一粗细值，画板滚轮按 wheelStep 连续调整。 */
  width: { min: 1, max: 30, default: 5, step: 1, wheelStep: 1 },
  /** 洪泛填充比较目标像素时允许的单通道误差，用于兼容 Canvas 抗锯齿边缘。 */
  fillTolerance: 8,
  // —— 性能预算（为什么是这些值）：
  // batchIntervalMs 24：~40 批/秒的自由笔画采样节奏，兼顾实时性与事件量；调小会显著增加每人心跳与 CPU。
  // maxPointsPerBatch 120：单包最大点数，配合 24ms 批次通常在包内；调大只影响极端一笔画，不改变稳态。
  // maxDrawEventsPerSecond 45：服务端每秒接受绘图事件上限（滑动窗口）；高于 ~40 批/秒的刷包会被拒绝（STALE/RATE_LIMITED），同时防止恶意客户端用海量小包消耗 CPU 与网络。
  // maxHistoryCommands 1500 ≈ 全回合绘制上限：90 秒 × 40 批/秒 ≈ 3600 个事件，但单笔画多批共用 ID，实际命令数通常远小于事件数；
  //   它直接决定服务端每个回合 strokes 数组的内存与“全量快照/断线重放”的序列化成本（约 1500 × 数百字节 = 数百 KB/人），
  //   调大将按比例放大内存与重连卡顿，调小会过早丢弃早期笔画。
  batchIntervalMs: 24,
  maxPointsPerBatch: 120,
  maxDrawEventsPerSecond: 45,
  maxHistoryCommands: 1_500,
  // maxPointsPerStroke：单次按下可累计的点数上限。同一笔画多批次共用 ID，因此
  //   maxHistoryCommands（只数命令条数）对其完全不生效，需单独限额防止无限追加。
  // maxPointsPerRound：整回合的总点数预算，直接限定内存与“全量快照/断线重放”的序列化成本。
  maxPointsPerStroke: 1_200,
  maxPointsPerRound: 40_000,
} as const
