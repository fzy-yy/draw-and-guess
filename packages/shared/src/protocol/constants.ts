/**
 * 线上协议的公开约束。前后端配置与 Zod Schema 都必须引用这里，避免边界两侧各维护一份。
 * 这里只放会影响协议兼容性或客户端可提交载荷的值；限频、持久化与清理策略属于服务端私有配置。
 */
export const PROTOCOL_VERSION = '10' as const

export const AVATAR_IDS = [
  '01',
  '02',
  '03',
  '04',
  '05',
  '06',
  '07',
  '08',
  '09',
  '10',
  '11',
  '12',
  '13',
  '14',
  '15',
  '16',
  '17',
  '18',
  '19',
  '20',
  '21',
  '22',
  '23',
  '24',
  '25',
  '26',
  '27',
  '28',
  '29',
  '30',
  '31',
  '32',
  '33',
  '34',
  '35',
  '36',
  '37',
  '38',
  '39',
  '40',
] as const

export const PLAYER_PROTOCOL_LIMITS = {
  minPlayers: 2,
  maxPlayers: 6,
  nicknameMinLength: 1,
  nicknameMaxLength: 16,
  roomNameMaxLength: 24,
  chatMaxLength: 60,
} as const

export const ROOM_RULE_LIMITS = {
  roundsPerPlayer: { min: 1, max: 5 },
  drawSeconds: { min: 45, max: 180 },
  chooseSeconds: { min: 10, max: 30 },
  optionCount: { min: 2, max: 5 },
  hintStartRatio: { min: 0.1, max: 0.9 },
  guessBaseScore: { min: 50, max: 2_000 },
} as const

export const PRIVATE_ROOM_CODE = {
  alphabet: '23456789ABCDEFGHJKLMNPQRSTUVWXYZ',
  length: 6,
} as const

export const DRAWING_PROTOCOL_LIMITS = {
  colorPattern: '^#[0-9A-Fa-f]{6}$',
  width: { min: 1, max: 30, step: 1 },
  maxPointsPerBatch: 120,
} as const

export const MAX_VOCABULARY_SELECTION_IDS = 10_000
