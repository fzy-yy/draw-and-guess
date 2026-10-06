/**
 * 可见文案（按用途分层）：界面直接可见。
 *
 * 分类口径见 CONTEXT.md。
 */

export const game = {
  roundLabel: 'ROUND',
  roundSeparator: ' / ',
  rankPrefix: (rank: number) => `#${rank}`,
  awaitingWord: '等待选词…',
  secondsSuffix: '秒',
  fullscreenFailed: '当前浏览器或页面环境无法进入全屏',
  choosingHint: '画家正在选择题目',
  liveChatLabel: 'LIVE CHAT',
  chatTitle: '猜词消息',
  noMessages: '回合消息会显示在这里',
  guessLabel: '输入你的答案',
  guessPlaceholder: '按 Enter 发送猜词',
  drawerChatPlaceholder: '按 Enter 发送消息',
  drawerCannotSendAnswer: '无法发送答案',
  yourTurn: '轮到你作画了',
  chooseWordTitle: '选择一个词',
  rerollWords: '换一组',
  customWord: '自定义',
  customWordHint: (max: number) => `输入你想画的词（最多 ${max} 个字），确认后立即开始作画`,
  customWordPlaceholder: '例如：一只在屋顶的猫',
  customWordTooLong: (max: number) => `最多 ${max} 个字`,
  customWordConfirm: '开始作画',
  customWordCancel: '取消',
  autoChoose: (seconds: number) => `${seconds} 秒后将自动选择`,
  endEarly: '提前结束',
  roundAnswerLabel: '本回合答案',
  scoreOrderLabel: (order: number) => `第 ${order} 个猜中`,
  scoreTotal: (total: number) => `+${total}`,
  noGuesses: '本回合无人猜中，再接再厉！',
  drawerScoreLabel: '作画得分',
  drawerNameTag: (name: string) => `${name} (画家)`,
  enterNextRound: (seconds: number) => `进入下一轮( ${seconds} )`,
  replayingDrawing: '作画精彩重播中...',
  gameResultLabel: 'GAME RESULT',
  finalRanking: '最终排行',
  playerStats: (correct: number, avgSeconds: number, drawing: number) =>
    `猜中 ${correct} 次 · 平均 ${avgSeconds} 秒 · 作画带猜中 ${drawing} 人次`,
  rematchReady: '已选择再来一局',
  rematchWithSeconds: (seconds: number) => `再来一局( ${seconds} )`,
  rematchReadyWithSeconds: (seconds: number) => `已选择再来一局( ${seconds} )`,
  hostReturnWaitingWithSeconds: (seconds: number) => `全员返回房间( ${seconds} )`,
  hostReturnQueuedWithSeconds: (seconds: number) => `展示结束后返回( ${seconds} )`,
  gameResultAutoReturn: (seconds: number) => `${seconds} 秒后自动返回房间`,
  leaveRoom: '退出房间',
  leaveGame: '退出游戏',
  leaveGameTitle: '退出本局游戏？',
  leaveGameBody: '退出后将返回大厅，你在本局的成绩卡会为其他玩家保留。',
  confirmLeaveGame: '确认退出',
  clearCanvasTitle: '清空整个画板？',
  clearCanvasBody: '这会清除本回合全部笔画；操作将由服务端广播给所有玩家。',
  confirmClear: '确认清空',
  endGameTitle: '提前结束本局？',
  endGameBody: '所有玩家将立即进入提前结算，当前分数会保留。',
  confirmEnd: '确认结束',
  // —— 接龙模式（S73 / S74 / S84）：顶栏阶段与棒次、玩家 chip 与提交状态、聊天语义、选词等待 ——
  /**
   * 接龙顶栏的阶段短名。阶段全名（`ui.status.phaseRelay*`）已带「接龙」前缀，
   * 与顶栏的模式标签并排会读成「接龙 接龙作画」，故顶栏单独用短名。
   */
  relayPhaseChoose: '选词阶段',
  relayPhaseDraw: '作画阶段',
  relayPhaseGuess: '猜词阶段',
  relayPhaseShowcase: '复盘展示',
  relayPhaseVote: '投票阶段',
  /** 棒次胶囊：与经典 ROUND 胶囊同构（前缀 / 大号数字 / 总数）。 */
  relayStepPrefix: '第',
  relayStepTotal: (total: number) => `/ ${total} 棒`,
  /** 猜词棒的答案 UI 文案：这一段我拿到的是上家的画，要猜的正是它的词。 */
  relayGuessPrompt: '看图猜词',
  /**
   * 接龙选词遮罩的标题（S83）：接龙选词只发生在第 1 棒、且人人各选自己那条链的词，
   * 一句「接龙 · 第 1 棒」就够；**不带**任何括号说明。经典侧仍是 `yourTurn`。
   */
  relayChooseTitle: '接龙 · 第 1 棒',
  /** 选词后等待他人：与本步的候选词卡片同卡呈现（S16 全员提交即秒切）。 */
  relayWaitingOthers: '已提交',
  relayChatTitle: '接龙聊天',
  relaySubmitted: '已提交',
  relayNotSubmitted: '未提交',
  relayVoted: '已投票',
  relayNotVoted: '未投票',
  /**
   * 接龙作答浮层（S41 / S72，工单 10）：猜词棒＝写答案，作画棒＝完成提交；
   * 提交后的等待态复用上面的 `relayWaitingOthers`（与选词卡同一句「已提交，等待其他玩家」）。
   */
  relayAnswerPlaceholder: '输入答案',
  relayAnswerSubmit: '提交',
  relayDrawingHint: '画完了就提交，交给下一位',
  relayDrawingSubmit: '完成提交',
  /** 接龙猜词超时或离线兜底文本（Image 4）：上家未作答时展示为灰色弱化并带前置图标。 */
  relayUnanswered: '上家未作答',
  /**
   * 本棒已在本地（校正后）时钟上过期：服务端在截止时刻即代交并换手，此刻提交必然被拒，
   * 因此直接锁住提交入口并显示这句状态（见 .scratch/relay-mode/bug-report.md B2）。
   */
  relayStepEnded: '本棒已结束，等待其他玩家',
  /**
   * 复盘展示与投票（S75 / S78 / S82，工单 11）：链条进度紧跟在顶栏最左标签之后，
   * 投票卡只留标题与两个动作（倒计时只看顶栏，卡内不重复）。
   */
  relayChainProgress: (index: number, total: number) => `第 ${index} / ${total} 条链`,
  relayVoteTitle: '这个匹配吗？',
  relayVoteAgree: '匹配',
  relayVoteDisagree: '不匹配',
  /**
   * 终局接龙口径统计（S77）：替代经典第二行的「猜中 N 次 · 平均 X 秒」——
   * 接龙猜词不判对错，用参与链数与累计赞同票数表达这一局的贡献。
   */
  relayPlayerStats: (chainCount: number, agreeVotes: number) =>
    `参与 ${chainCount} 条链 · 共获 ${agreeVotes} 张赞同票`,
  // —— 对局浮层布局：顶栏、可拖动浮层面板与底部横向工具条（见 docs/adr/0043-game-view-floating-layout.md）——
  chatPanelTitle: '聊天',
  brushUnit: 'px',
  // —— 画板右键菜单与画作导出 ——
  canvasMenuBrush: '画笔',
  canvasMenuEraser: '橡皮擦',
  canvasMenuFill: '油漆桶',
  canvasMenuEyedropper: '吸管取色',
  canvasMenuUndo: '撤销',
  canvasMenuRedo: '重做',
  canvasMenuHideToolbar: '隐藏工具栏',
  canvasMenuShowToolbar: '显示工具栏',
  canvasMenuSave: '保存图片',
  canvasMenuClear: '清空画板',
  canvasMenuQuickPhrases: '快捷发言短语',
  // 微表情互动菜单项文案
  canvasMenuReactionThumbsUp: '点赞 👍',
  canvasMenuReactionConfused: '满头问号 ❓',
  canvasMenuReactionFire: '神仙画画 🔥',
  canvasSavedAsImage: '已保存画作图片',
  // 终局战报荣誉称号文案
  accolades: {
    masterDrawer: '神笔马良',
    masterDrawerDesc: '画作秒懂，全场猜中速度最快',
    soulPainter: '灵魂画手',
    soulPainterDesc: '笔精墨妙，画风独树一帜',
    mindReader: '读心大师',
    mindReaderDesc: '心有灵犀，多次第一顺位秒猜中',
    activeGuesser: '积极分子',
    activeGuesserDesc: '猜词最积极，全场氛围担当',
  },
} as const
