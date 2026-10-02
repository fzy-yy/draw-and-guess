/**
 * 可见文案（按用途分层）：界面直接可见。
 *
 * 分类口径见 .scratch/strings-layering-and-maintenance/spec.md。
 */

export const store = {
  notConnected: '尚未连接到主机服务，请稍候再试',
  restored: '身份已恢复',
  gameRestored: '座位与未完成对局状态已恢复',
  enteredLobby: '已进入在线大厅',
  memberDisconnected: (nickname: string) => `${nickname} 已断线，正在等待重连`,
  memberReconnected: (nickname: string) => `${nickname} 已重新连接`,
  memberLeftGame: (nickname: string) => `${nickname} 已退出本局游戏`,
  settingsReset: '本地设置已恢复默认',
  profileCleared: '本地资料与会话已清除，可直接输入新资料进入',
  profileUpdated: '玩家资料已更新',
  roomLeft: '已安全退出房间',
  sessionTakenOver: '会话已在新的窗口打开；如需在本窗口继续，请重新进入',
  vocabularyUpdated: '本局词库已更新，已准备状态保持不变',
  inviteSent: '邀请已发送',
  pauseReasonHost: '房主暂停了游戏',
} as const
export const request = {
  genericFailure: '请求失败，请检查主机服务与局域网连接',
  timeoutMessage: '服务器响应超时；当前操作未确认，请检查连接后重试',
  cancelled: '请求已取消',
  /** ack 无法通过运行时 Schema 时的统一安全文案：绝不回显原始响应内容。 */
  protocolFailure: '服务器响应与当前协议不匹配，请刷新页面后重试',
} as const
