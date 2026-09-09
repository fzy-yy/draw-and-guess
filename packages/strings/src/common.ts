/**
 * 通用元信息、交互词、网络连接状态与玩家/阶段状态标签。
 */
export const meta = {
  title: '你画我猜',
  description: '局域网实时多人你画我猜游戏',
} as const

export const common = {
  cancel: '取消',
  accept: '接受',
  decline: '拒绝',
  declineCountdown: (seconds: number) => `拒绝(${seconds})`,
  dismissToastAria: (text: string) => `关闭提示：${text}`,
  clearSearchAria: '清除搜索内容',
  listSeparator: '、',
  sortByAria: (name: string) => `按${name}排序`,
  emptyDash: '—',
  networkStatusAria: (label: string, latency: number) =>
    `${label} · 延迟 ${latency || common.emptyDash} 毫秒`,
  connectionDetail: (label: string, latency: number) =>
    `${label} · ${latency || common.emptyDash} ms`,
  latencyShort: (latency: number) => `${latency}ms`,
  exit: '退出',
  scoreUnit: (score: number) => `${score} 分`,
  playersUnit: (count: number) => `${count} 人`,
  roundsUnit: (count: number) => `${count} 轮`,
  secondsUnit: (count: number) => `${count} 秒`,
  percentUnit: (value: number) => `${value}%`,
  countBadge: (label: string, count: number) => `${label} · ${count}`,
  roundsField: '每人作画次数',
  drawTimeField: '作画时间',
  myAvatarAria: '我的 SVG 头像',
  playerAvatarAria: (nickname: string) => `${nickname}的 SVG 头像`,
  // 低频模块懒加载的占位与失败兜底（见 utils/lazy-component.ts）
  moduleLoading: '模块加载中…',
  moduleLoadFailed: '模块加载失败，请检查网络后重试',
  retry: '重试',
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
