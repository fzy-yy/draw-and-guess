/**
 * 服务端私有配置。这里的值不会成为协议或浏览器配置的一部分。
 * 限频、断线清理、数据库位置和服务端资源预算均在此维护。
 */
export const serverPrivateConfig = {
  game: {
    gameResultMinSeconds: 5,
    gameResultAutoReturnSeconds: 20,
  },
  network: {
    host: '0.0.0.0',
    port: 5174,
    reconnectGraceMs: 120_000,
    drawerReconnectGraceMs: 20_000,
    inviteExpiryMs: 30_000,
    inviteCooldownMs: 5_000,
    guessEventsPerSecond: 5,
    requestEventsPerSecond: 25,
    requestRateWindowMs: 1_000,
    /** 猜词/绘图等事件级滑动窗口的宽度（原硬编码 1 秒，与请求级窗口分列可调）。 */
    eventRateWindowMs: 1_000,
    idempotencyCacheMax: 100,
  },
  room: {
    privateJoinWindowMs: 10_000,
    privateJoinMaxAttempts: 5,
  },
  drawing: {
    maxDrawEventsPerSecond: 45,
  },
  vocabulary: {
    // 目录扫描不到任何 .db 时的兜底词库文件名（与 vocabulary/ 目录现库对齐）
    dbPath: 'vocabulary/base_words.db',
    maxWords: 10_000,
    maxAliasesPerWord: 8,
    maxAliasLength: 24,
    /** 词条 hint 提示文案的字符数上限（词库重建后约定 ≤10 字，空串合法） */
    maxHintLength: 10,
    difficultyRange: { min: 1, max: 5 },
    deduplicate: true,
    resetWhenExhausted: true,
    useWordTimeLimit: true,
  },
} as const
