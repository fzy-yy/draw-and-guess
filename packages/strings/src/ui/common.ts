/**
 * 可见文案（按用途分层）：界面直接可见。
 *
 * 分类口径见 CONTEXT.md。
 */
import { clampLatency } from '../internal/latency.ts'

export const meta = {
  title: '你画我猜',
  description: '实时多人你画我猜游戏',
} as const
export const common = {
  cancel: '取消',
  close: '关闭',
  accept: '接受',
  decline: '拒绝',
  listSeparator: '、',
  emptyDash: '—',
  /** 网络徽章上的延迟短文本（已封顶），与悬浮/无障碍文案共用同一口径。 */
  latencyShort: (latency: number) => `${clampLatency(latency)}ms`,
  scoreUnit: (score: number) => `${score} 分`,
  playersUnit: (count: number) => `${count} 人`,
  roundsUnit: (count: number) => `${count} 轮`,
  secondsUnit: (count: number) => `${count} 秒`,
  percentUnit: (value: number) => `${value}%`,
  countBadge: (label: string, count: number) => `${label} · ${count}`,
  roundsField: '每人作画次数',
} as const
export const connection = {
  connecting: '正在连接',
  connected: '已连接',
  disconnected: '未连接',
  unstable: '连接不稳定',
  reconnecting: '正在重连',
  unavailable: '无法连接',
} as const
export const status = {
  playerIdle: '空闲',
  playerInRoom: '房间中',
  playerPlaying: '游戏中',
  playerReconnecting: '离线宽限',
  phaseStarting: '准备开始',
  phaseChoosing: '画家选词',
  phaseDrawing: '作画与猜词',
  phaseRoundResult: '回合结算',
  phasePaused: '游戏暂停',
  phaseGameResult: '最终结算',
  phaseWaiting: '等待',
  phaseClosed: '关闭',
  roomWaiting: '等待中',
  roomSpectatable: '可以观战',
  roomJoinNextGame: '可候场加入',
  roomInProgress: '进行中',
  roleSpectating: '观战中',
  roleWaitingNextGame: '等待下一局',
  roleRematchReady: '再来一局已就绪',
  roleGuessed: '已猜中',
  roleDrawing: '作画中',
  roleGuessing: '猜词中',
  roleReady: '已准备',
  roleNotReady: '未准备',
  roleReconnecting: '重连中',
  roleLeftGame: '已退出',
} as const
