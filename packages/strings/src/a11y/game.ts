/**
 * 无障碍文案（按用途分层）：供 aria-* 与悬浮 title 使用。
 *
 * 分类口径见 CONTEXT.md。
 */

export const game = {
  pauseAriaHost: '暂停游戏',
  pauseAriaGuest: '请求房主暂停',
  resumeAria: '继续游戏',
  settingsAria: '打开对局设置',
  enterFullscreenAria: '进入全屏',
  exitFullscreenAria: '退出全屏',
  quickPhrasePickerAria: '选择快捷短语',
  quickPhrasePanelAria: '快捷短语列表',
  sendGuessAria: '发送猜词',
  chatActionsAria: '快捷互动',
  reactionPickerAria: '选择表情反应',
  reactionPanelAria: '表情反应列表',
  sendReactionAria: (reaction: string) => `发送表情 ${reaction}`,
  sendQuickPhraseAria: (phrase: string) => `发送快捷短语：${phrase}`,
  penTool: '画笔',
  penAria: (key: string) => `画笔，快捷键 ${key}`,
  eraserTool: '橡皮擦',
  eraserAria: (key: string) => `橡皮擦，快捷键 ${key}`,
  fillTool: '填充',
  fillAria: (key: string) => `区域填充，快捷键 ${key}`,
  presetColorAria: (color: string) => `选择预设颜色 ${color}`,
  customColorTitle: '选择任意画笔或填充颜色',
  customColorAria: '选择任意绘图颜色',
  undoAria: '撤销 Ctrl+Z',
  undo: '撤销',
  redoAria: '重做 Ctrl+Shift+Z',
  redo: '重做',
  clearAria: '清空画板',
  clear: '清空',
  rerollWords: '换一组',
  rerollUsed: '每回合仅能更换一次候选词',
  customWordTitle: '画点别的',
  customWordHint: (max: number) => `输入你想画的词（最多 ${max} 个字），确认后立即开始作画`,
  customWordCancel: '取消',
  toggleAnswerVisibilityAria: '切换答案显示状态',
  toggleAnswerVisibilityHint: '点击切换答案明文与遮罩',
  topBarAria: '对局顶栏',
  toggleChat: '聊天面板',
  dragToolbarTitle: '拖动工具条',
  dragToolbarAria: '拖动移动工具条位置',
  // 接龙作答浮层（S41，工单 10）：拖动手柄与输入框的无障碍名。
  dragAnswerPanelTitle: '拖动作答框',
  dragAnswerPanelAria: '拖动移动作答框位置',
  answerInputAria: '接龙作答输入框',
  // 复盘双胶囊与投票卡（S75 / S78 / S82，工单 11）：未揭晓答案与匿名票行的无障碍名。
  relayHiddenAnswerAria: '答案尚未揭晓',
  relayVoteRowAria: '匿名票行',
  /**
   * 接龙聊天输入区（S79）：这条输入框只发社交消息、永不携带作答，
   * 故读屏文案用聊天语义，不复用猜词的「输入你的答案 / 发送猜词」。
   * 可见文案（占位）与无障碍名是**两个 key**：占位在 `strings.ui`，无障碍名只在本层。
   */
  relayChatInputAria: '接龙聊天输入框',
  relayChatSendAria: '发送聊天消息',
  playersPanelTitle: '玩家',
  closePanelAria: '关闭面板',
  toolbarAria: '绘图工具栏',
  brushSize: '画笔大小',
  brushUnit: 'px',
  brushWheelHint: '滚动调整画笔大小',
  canvasMenuAria: '画板操作菜单',
  accoladeBadgeAria: (nickname: string, accolade: string) =>
    `${nickname} 获得荣誉称号：${accolade}`,
} as const
export const canvas = {
  drawingAria: '作画画布，支持画笔、橡皮擦、封闭区域填充和滚轮调整画笔或橡皮擦粗细',
  watchingAria: '实时观看画布',
} as const
