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
    provider: 'sqlite' as const,
    dbPath: 'vocabulary/draw_guess_words.db',
    maxWords: 10_000,
    maxAliasesPerWord: 8,
    maxAliasLength: 24,
    difficultyRange: { min: 1, max: 5 },
    deduplicate: true,
    resetWhenExhausted: true,
    useWordTimeLimit: true,
    useWordScoreWeight: false,
  },
} as const
