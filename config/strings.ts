/**
 * 全局 UI 文案唯一定义文件（唯一的文案来源）。
 *
 * 所有展示在界面上的字符内容统一在此维护：按钮文字、标题、提示、Toast、
 * aria/无障碍标签、占位符、错误消息、系统通知、画布标签等；组件、store、
 * composable 与服务端消息生成处严禁再硬编码展示文案，一律从这里导入。
 *
 * 约定：
 * - `strings`            —— 客户端（浏览器）侧展示文案；
 * - `serverStrings`      —— 服务端产生的、会随事件/ack 展示到界面上的文案
 *   （错误提示、系统通知、房间关闭原因等）；服务端日志与终端输出不属于 UI，
 *   保留在服务端源码中。
 * - 所有值使用 `as const`，纯静态文案为字符串字面量；含动态插值的文案定义为
 *   模板函数 `(...args) => string`，占位内容由调用方传入（如昵称、时间、分数）。
 *
 * 客户端通过 `@draw-guess/strings` 别名导入（见 vite.config.ts 与根 tsconfig paths）；
 * 服务端通过相对路径 `../../../config/strings.ts` 导入。
 */
export const strings = {
  /* ============================= 页面元信息 ============================= */
  /** 浏览器标签页标题与 meta 描述；由 vite.config.ts 构建时注入 index.html。 */
  meta: {
    title: '你画我猜',
    description: '局域网实时多人你画我猜游戏',
  },

  /* ============================= 通用交互词 ============================= */
  /** 多个页面共用的短操作词（App / 大厅 / 房间 / 对局）。 */
  common: {
    cancel: '取消', // 弹窗取消按钮
    accept: '接受', // 邀请接受按钮
    decline: '拒绝', // 邀请拒绝按钮
    exit: '退出', // 房间顶栏退出按钮
    scoreUnit: (score: number) => `${score} 分`, // 玩家得分后缀
    playersUnit: (count: number) => `${count} 人`, // 人数单位
    roundsUnit: (count: number) => `${count} 轮`, // 轮数单位
    secondsUnit: (count: number) => `${count} 秒`, // 秒数单位
    roundsField: '每人作画次数', // 建房 / 规则表单的轮数字段名
    drawTimeField: '作画时间', // 建房 / 规则表单的作画时间字段名
    myAvatarAria: '我的 SVG 头像', // 自己的头像无障碍标签
    playerAvatarAria: (nickname: string) => `${nickname}的 SVG 头像`, // 他人头像无障碍标签
  },

  /* ============================= 连接状态 ============================= */
  /** 连接状态文案；随 socket 生命周期切换（stores/game.ts 的 ConnectionLabel 派生自本组）。 */
  connection: {
    connecting: '正在连接', // 初始状态
    connected: '已连接', // 连接成功
    unstable: '连接不稳定', // io error / 抖动
    reconnecting: '正在重连', // 断线重连中
    unavailable: '无法连接', // 服务端主动断开
  },

  /* ============================= 状态标签 ============================= */
  /** 玩家在线状态（大厅发现列表 / useGameHud / 席位标签等共用的枚举文案）。 */
  status: {
    playerIdle: '空闲', // 在线玩家：空闲
    playerInRoom: '房间中', // 在线玩家：在房间
    playerPlaying: '游戏中', // 在线玩家：对局中
    playerReconnecting: '离线宽限', // 在线玩家：断线宽限
    phaseStarting: '准备开始', // 阶段：开局倒计时
    phaseChoosing: '画家选词', // 阶段：画家选词
    phaseDrawing: '作画与猜词', // 阶段：作画
    phaseRoundResult: '回合结算', // 阶段：回合结算
    phasePaused: '游戏暂停', // 阶段：暂停
    phaseGameResult: '最终结算', // 阶段：最终结算
    phaseWaiting: '等待', // 阶段：等待
    phaseClosed: '关闭', // 阶段：已关闭
    roomWaiting: '等待中', // 房间列表相位：等待加入
    roomSpectatable: '可以观战', // 房间列表相位：可观战
    roomInProgress: '进行中', // 房间列表相位：对局中
    roleSpectating: '观战中', // 角色：观战
    roleGuessed: '已猜中', // 角色：已猜中
    roleDrawing: '作画中', // 角色：画家
    roleGuessing: '猜词中', // 角色：猜词者
    roleReady: '已准备', // 席位：已准备
    roleNotReady: '未准备', // 席位：未准备
    roleReconnecting: '重连中', // 席位：断线重连
  },

  /* ============================= 根舞台 App.vue ============================= */
  app: {
    stageAriaLabel: (appName: string) => `${appName} 游戏舞台`, // 舞台区无障碍标签
    toastStackAria: '操作通知', // Toast 堆栈无障碍标签
    toastDismissAria: '关闭通知', // Toast 关闭按钮标签
    inviteDialogAria: '房间邀请', // 邀请横幅弹层标签
    inviterAvatarAria: '邀请者 SVG 头像', // 邀请者头像标签
    inviteHeading: '收到房间邀请', // 邀请横幅标题
    inviteReceived: (nickname: string, roomName: string) => `${nickname} 邀请你加入“${roomName}”`, // 邀请横幅正文
    portraitTitle: '请横屏使用', // 竖屏警告标题
    portraitHint: '旋转设备后即可获得完整的游戏舞台。', // 竖屏警告说明
  },

  /* ============================= 资料页 ProfileView.vue ============================= */
  profile: {
    brandAria: '游戏介绍', // 品牌区无障碍标签
    brandEyebrow: '局域网派对游戏', // 品牌区眉题
    brandCopy: '一人作画，大家来猜。连接同一主机服务即可实时加入。', // 品牌宣传语
    sectionLabel: 'PLAYER PROFILE', // 分区眉题（英文装饰字）
    sectionTitle: '准备好你的角色', // 资料面板标题
    randomizeAria: '重新随机昵称与 SVG 头像', // 随机按钮无障碍标签
    randomize: '换一组', // 一键随机按钮
    nicknameLabel: '昵称', // 昵称字段
    nicknameValidAria: '昵称有效', // 有效性对勾图标标签
    nicknameHelp: (min: number, max: number) =>
      `${min}～${max} 个可见字符，在线重名会自动添加数字。`, // 昵称长度提示
    avatarLabel: '角色头像', // 头像区块标题
    changeAvatar: '点击更换头像', // 大头像按钮提示
    changeAvatarAria: '打开 SVG 头像选择', // 大头像按钮无障碍标签
    avatarPickerLabel: 'AVATARS', // 头像弹窗眉题
    avatarPickerTitle: '选择你的头像', // 头像弹窗标题
    avatarPickerCloseAria: '关闭头像选择', // 头像弹窗关闭按钮
    avatarPickerAria: '全部可用 SVG 头像', // 头像选择列表标签
    avatarOptionAria: (id: string) => `选择第 ${id} 号头像`, // 单个头像选项标签
    busy: '正在登记身份…', // 登记进行中的按钮文字
    enterLobby: '进入在线大厅', // 进入大厅按钮
    offlineWarning: '无法进入：请确认主机服务已启动，地址和端口正确，并检查防火墙。', // 未连接警告
  },

  /* ============================= 大厅 LobbyView.vue ============================= */
  lobby: {
    lobbyEnglishTitle: 'ONLINE LOBBY', // 标题英文装饰字
    navAria: '辅助页面', // 顶栏导航标签
    settingsEntry: '设置', // 设置入口按钮
    roomsLabel: 'ROOMS', // 房间区眉题
    roomsTitle: '全部公开画室', // 房间区标题
    roomCount: (count: number) => `${count} 个房间`, // 房间数量
    createRoomTitle: '创建公开房间', // 创建房间大按钮
    createRoomHint: '创建公开或私密画室', // 创建房间副说明
    joinPrivateTitle: '加入私密房间', // 私密房入口标题
    joinPrivateHint: '使用房主分享的房间码加入', // 私密房入口说明
    roomListAria: '全部公开房间列表', // 房间列表无障碍标签
    roomMeta: (host: string, rounds: number, seconds: number) =>
      `房主 ${host} · ${rounds} 轮 · ${seconds} 秒`, // 房间行副信息
    joinButton: '加入', // 加入按钮
    spectateButton: '观战', // 观战加入按钮
    emptyRoomsTitle: '还没有公开房间', // 空房间标题
    emptyRoomsHint: '成为第一个房主，新房间会实时广播给所有在线玩家。', // 空房间说明
    playersLabel: 'PLAYERS', // 在线玩家区眉题
    playersTitle: '在线玩家', // 在线玩家区标题
    playerFilterPlaceholder: '按昵称筛选', // 筛选输入占位符
    playerFilterAria: '筛选在线玩家', // 筛选输入标签
    discoveryEmpty: '其他玩家需先访问本主机地址并确认资料，之后会自动显示在这里。', // 无发现玩家提示
    lanTipTitle: '局域网发现说明', // 底部说明标题
    lanTipBody: '这里只展示已经连接到当前主机服务且允许被发现的玩家。', // 底部说明正文
    newRoomLabel: 'NEW ROOM', // 创建弹窗眉题
    createDialogTitle: '创建画室', // 创建弹窗标题
    createDialogCloseAria: '关闭创建房间弹窗', // 创建弹窗关闭按钮
    roomNameField: '房间名称', // 房间名字段
    maxPlayersField: '最大人数', // 最大人数字段
    visibilityField: '房间类型', // 房间可见性单选组
    visibilityPublic: '公开房间', // 公开选项
    visibilityPublicHint: '出现在大厅列表，所有玩家均可自由加入', // 公开选项说明
    visibilityPrivate: '私密房间', // 私密选项
    visibilityPrivateHint: '不进入大厅列表，仅可凭房间码或邀请加入', // 私密选项说明
    publicNote: '公开房间会实时显示在大厅，其他玩家可以直接加入。', // 公开说明
    privateNote: '私密房间不会出现在大厅；创建后房主可在房间顶部查看房间码。', // 私密说明
    createAndEnter: '创建并进入', // 创建提交按钮
    privateJoinLabel: 'PRIVATE ROOM', // 私密加入弹窗眉题
    privateJoinTitle: '输入房间码', // 私密加入标题
    privateJoinCloseAria: '关闭私密房加入弹窗', // 私密加入关闭按钮
    privateJoinBody: '请输入私密房房主分享的房间码。字母不区分大小写。', // 私密加入说明
    privateCodePlaceholder: '例如 A2B3C4', // 房间码输入占位符
    privateCodeAria: '私密房间码', // 房间码输入标签
    joinPrivateConfirm: '加入房间', // 私密加入提交
  },

  /* ============================= 房间等待 RoomView.vue ============================= */
  room: {
    publicRoomBadge: '公开房间 · 大厅自由加入', // 公开房标识
    privateRoomBadge: '私密房间', // 私密房标识
    copyPrivateCodeAria: '复制私密房间码', // 房间码按钮标签
    privateCodeCopied: '房间码已复制', // 复制成功
    privateCodeCopyFailed: '无法自动复制，请手动记录房间码', // 复制失败
    authoritativeConnected: '权威服务已连接', // 连接状态徽章
    playersTitle: '玩家席位', // 席位区标题
    roomEyebrow: 'ROOM', // 房间眉题装饰字
    playersEyebrow: 'PLAYERS', // 席位区眉题装饰字
    rulesEyebrow: 'RULES', // 规则区眉题装饰字
    seatCount: (count: number, max: number) => `${count}/${max}`, // 席位计数
    hostCrownAria: '房主', // 房主皇冠图标标签
    meTag: '我', // 自己的席位标记
    kickAria: '移除该玩家', // 房主踢人按钮
    emptySeatTitle: '等待玩家', // 空席位标题
    emptySeatHint: '可从在线列表邀请', // 空席位说明
    rulesTitle: '本局规则', // 规则区标题
    rulesEdit: '编辑', // 规则编辑入口
    ruleRoundsDt: '作画次数', // 规则项：轮数
    ruleRoundsDd: (rounds: number) => `每人 ${rounds} 轮`, // 规则项：轮数值
    ruleDrawDt: '作画时间', // 规则项：作画时间
    ruleDrawDd: (seconds: number) => `${seconds} 秒`, // 规则项：作画时间值
    ruleOptionsDt: '候选词', // 规则项：候选词
    ruleOptionsDd: (count: number) => `${count} 选 1`, // 规则项：候选词值
    ruleHintsDt: '提示', // 规则项：提示
    hintsOn: '逐步提示', // 提示开启
    hintsOff: '关闭', // 提示关闭
    vocabularyTitle: '本局词库', // 词库管理入口标题
    vocabularyCount: (selected: number, total: number) => `${selected} / ${total} 个词条`, // 词库数量
    vocabularyManage: '管理', // 房主的管理入口
    vocabularyHostOnly: '仅房主可编辑', // 非房主只读提示
    inviteDisabledFull: '房间已满员', // 邀请禁用提示：满员
    inviteDisabledHostOnly: '本房间仅房主可邀请', // 邀请禁用提示：仅房主
    inviteDisabledTip: '邀请当前服务中的空闲玩家', // 邀请可用提示
    invitePlayers: '邀请在线玩家', // 邀请按钮
    spectatorReadyHint: '你是观战成员，请退出房间后重新加入参与对局。', // 观战者提示
    needMorePlayers: '还需要至少 1 名玩家', // 人数不足提示
    waitForReady: '等待其他玩家准备', // 非房主等待提示
    waitForGuestsReady: '等待其他玩家全部准备', // 房主等待提示
    allReady: '全员准备就绪', // 全员就绪提示
    cancelReady: '取消准备', // 取消准备按钮
    readyGo: '我准备好了', // 准备按钮
    spectatorReadyButton: '观战中', // 观战者禁用按钮文字
    spectatorReadyTitle: '观战成员不能参与准备', // 观战者禁用按钮提示
    startGame: '开始游戏', // 开始游戏按钮
    vocabLabel: 'VOCABULARY', // 词库弹窗眉题
    vocabTitle: '选择本局词库', // 词库弹窗标题
    vocabCloseAria: '关闭词库', // 词库弹窗关闭按钮
    vocabAll: '全部', // 词库统计：全部
    vocabResults: '搜索结果', // 词库统计：搜索结果
    vocabSelected: '已选', // 词库统计：已选
    vocabSearchPlaceholder: '输入关键词搜索', // 词库搜索占位符
    vocabSearchAria: '搜索词条', // 词库搜索标签
    vocabClearSearchAria: '清空搜索', // 清空搜索按钮
    selectAll: '全选全部', // 批量选择：全部
    deselectAll: '取消全选', // 批量取消：全部
    selectResults: '全选结果', // 批量选择：搜索结果
    deselectResults: '取消结果', // 批量取消：搜索结果
    vocabMinHint: (min: number) => `至少选择 ${min} 个词条；搜索不会丢失其他选择。`, // 最小词条提示
    restoreDefault: '恢复默认全选', // 恢复默认按钮
    confirmSelection: '确认选择', // 保存词库按钮
    settingsLabel: 'ROOM SETTINGS', // 规则弹窗眉题
    settingsTitle: '房间规则', // 规则弹窗标题
    settingsCloseAria: '关闭规则', // 规则弹窗关闭按钮
    maxPlayersField: '最大玩家数', // 最大玩家数字段
    maxPlayersNote: '当前成员数以下的值不可保存', // 最大人数提示
    chooseTimeField: '选词时间', // 选词时间字段
    optionCountField: '候选词数量', // 候选词数量字段
    optionCountUnit: (count: number) => `${count} 个`, // 候选词数量单位
    toggleShowWordLength: '显示答案字数', // 规则开关：字数显示
    toggleProgressiveHints: '逐步提示字符', // 规则开关：逐步提示
    toggleCloseGuess: '近似答案提示', // 规则开关：近似提示
    togglePlayerInvite: '普通玩家可邀请', // 规则开关：成员邀请
    togglePause: '房主可暂停', // 规则开关：暂停权限
    joinPolicyField: '中途加入', // 加入策略字段
    joinPolicyForbid: '禁止', // 加入策略：禁止
    joinPolicySpectate: '仅观战', // 加入策略：仅观战
    joinPolicyNextGame: '下一局加入', // 加入策略：下一局
    rulesChangeNote: '修改公平性规则会自动取消全员准备。', // 规则保存提示
    saveRules: '保存规则', // 保存规则按钮
    inviteLabel: 'INVITE', // 邀请弹窗眉题
    inviteTitle: '邀请伙伴', // 邀请弹窗标题
    inviteCloseAria: '关闭邀请', // 邀请弹窗关闭按钮
    inviteEmpty: '暂无空闲且允许接收邀请的在线玩家。', // 无可邀请玩家
    leaveTitle: '退出当前房间？', // 退出确认标题
    leaveBody: '主动退出后当前座位会立即释放；房主退出时将迁移给最早加入的在线玩家。', // 退出确认说明
    stayInRoom: '继续留在房间', // 退出确认：留下
    confirmLeave: '确认退出', // 退出确认：确认
  },

  /* ============================= 对局 GameView.vue ============================= */
  game: {
    roundLabel: 'ROUND', // 回合指示英文
    drawerAvatarAria: '当前画家 SVG 头像', // 当前画家头像标签
    drawerLabel: '当前画家', // 画家指示标题
    drawerPending: '即将揭晓', // 画家未揭晓
    yourWord: '你的题目', // 画家视角答案标题
    guessPrompt: '猜猜这是什么', // 猜词者视角标题
    awaitingWord: '等待选词…', // 答案未揭晓占位
    secondsSuffix: '秒', // 计时器单位
    pauseAriaHost: '暂停游戏', // 房主暂停按钮标签
    pauseAriaGuest: '请求房主暂停', // 成员请求暂停按钮标签
    pauseReasonHost: '房主暂停了游戏', // 房主暂停的系统通知原因
    pauseReasonGuest: '希望短暂暂停', // 成员请求暂停的默认原因
    resumeAria: '继续游戏', // 恢复按钮标签
    settingsAria: '打开对局设置', // 顶栏设置按钮
    enterFullscreenAria: '进入全屏', // 顶栏全屏按钮
    exitFullscreenAria: '退出全屏', // 顶栏退出全屏按钮
    fullscreenFailed: '当前浏览器或页面环境无法进入全屏', // 全屏失败提示
    settingsTitle: '对局设置', // 对局内设置弹窗标题
    settingsCloseAria: '关闭对局设置', // 设置弹窗关闭按钮
    settingsQuickTitle: '快速调整', // 设置弹窗说明标题
    settingsQuickHint: '修改会立即保存在本机，不会中断当前游戏。', // 设置弹窗说明
    settingsDone: '完成', // 设置弹窗关闭提交
    scoreStripAria: '玩家得分', // 得分条无障碍标签
    hostMarkAria: '房主', // 得分条房主标记
    choosingHint: '画家正在选择题目', // 选词阶段非画家提示
    liveChatLabel: 'LIVE CHAT', // 聊天区英文眉题
    chatTitle: '猜词消息', // 聊天区标题
    noMessages: '回合消息会显示在这里', // 空消息占位
    guessLabel: '输入你的答案', // 猜词输入标签
    guessPlaceholder: '按 Enter 发送猜词', // 猜词输入占位符
    sendGuessAria: '发送猜词', // 发送按钮标签
    drawerChatHint: '画家不能发送文字，可使用安全互动短语', // 画家禁言提示
    spectatorChatHint: '观战成员只能观看，不能发言或猜词', // 观战禁言提示
    guessedChatHint: '你已猜中，只能发送安全互动短语', // 已猜中提示
    waitingChatHint: '等待作画阶段开始', // 开局前提示
    toolGroup: '工具', // 工具栏分组
    penTool: '画笔', // 画笔工具
    penAria: (key: string) => `画笔，快捷键 ${key}`, // 画笔按钮标签
    eraserTool: '橡皮擦', // 橡皮擦工具
    eraserAria: (key: string) => `橡皮擦，快捷键 ${key}`, // 橡皮擦按钮标签
    fillTool: '填充', // 填充工具
    fillAria: (key: string) => `区域填充，快捷键 ${key}`, // 填充按钮标签
    colorGroup: '颜色', // 颜色分组
    presetColorAria: (color: string) => `选择预设颜色 ${color}`, // 预设色按钮标签
    customColorTitle: '选择任意画笔或填充颜色', // 自定义颜色提示
    customColorAria: '选择任意绘图颜色', // 自定义颜色标签
    widthLabel: (width: number) => `线宽 ${width}`, // 线宽标注
    widthAria: '画笔与橡皮擦共用粗细', // 线宽滑块标签
    undoAria: '撤销 Ctrl+Z', // 撤销按钮标签
    undo: '撤销', // 撤销按钮
    redoAria: '重做 Ctrl+Shift+Z', // 重做按钮标签
    redo: '重做', // 重做按钮
    clearAria: '清空画板', // 清空按钮标签
    clear: '清空', // 清空按钮
    countdownTitle: '游戏即将开始', // 开局倒计时标题
    countdownHint: '画家顺序和首个回合由服务器统一确定', // 开局倒计时说明
    yourTurn: '轮到你作画了', // 选词面板提示
    chooseWordTitle: '选择一个词', // 选词面板标题
    autoChoose: (seconds: number) => `${seconds} 秒后将自动选择`, // 选词倒计时提示
    pausedTitle: '游戏已安全暂停', // 暂停面板标题
    pausedSubtitle: '所有计时已由服务器冻结', // 暂停面板副标题
    pausedHint: '等待房主继续；断线玩家可在宽限期内恢复座位。', // 暂停面板说明
    resumeGame: '继续游戏', // 恢复按钮
    endEarly: '提前结束', // 提前结束按钮
    roundAnswerLabel: '本回合答案', // 结算面板标题
    scoreBase: (base: number) => `基础 ${base}`, // 得分明细：基础分
    scoreSpeed: (speed: number) => `速度 +${speed}`, // 得分明细：速度分
    scoreOrder: (order: number) => `顺序 +${order}`, // 得分明细：顺序分
    scoreTotal: (total: number) => `+${total}`, // 得分明细：总分
    noGuesses: '本回合无人猜中，再接再厉！', // 无人猜中提示
    drawerScoreLine: (score: number, seconds: number) =>
      `画家本回合获得 ${score} 分 · ${seconds} 秒后继续`, // 结算画家得分行
    gameResultLabel: 'GAME RESULT', // 最终结算英文眉题
    finalRanking: '最终排行', // 最终排行标题
    playerStats: (correct: number, avgSeconds: number, drawing: number) =>
      `猜中 ${correct} 次 · 平均 ${avgSeconds} 秒 · 作画带猜中 ${drawing} 人次`, // 排行统计行
    backToRoom: '返回房间 · 再来一局', // 房主返回房间按钮
    leaveRoom: '退出房间', // 退出房间按钮
    clearCanvasTitle: '清空整个画板？', // 清空确认标题
    clearCanvasBody: '这会清除本回合全部笔画；操作将由服务端广播给所有玩家。', // 清空确认说明
    confirmClear: '确认清空', // 清空确认提交
    endGameTitle: '提前结束本局？', // 提前结束确认标题
    endGameBody: '所有玩家将立即进入提前结算，当前分数会保留。', // 提前结束确认说明
    confirmEnd: '确认结束', // 提前结束确认提交
  },

  /* ============================= 画布 GameCanvas.vue ============================= */
  canvas: {
    drawingAria: '作画画布，支持画笔、橡皮擦、封闭区域填充和滚轮调整画笔或橡皮擦粗细', // 可作画画布标签
    watchingAria: '实时观看画布', // 只读画布标签
  },

  /* ============================= 设置页 SettingsView.vue ============================= */
  settings: {
    backToLobby: '返回大厅', // 顶栏返回按钮
    label: 'SETTINGS', // 顶栏英文眉题
    title: '游戏设置', // 顶栏标题
    localOnly: '设置仅保存在本机', // 本地存储提示
    categoryAria: '设置分类', // 标签栏无障碍标签
    tabAudio: '声音', // 标签：声音
    tabAccessibility: '显示与操作', // 标签：显示与操作
    tabShortcuts: '快捷键', // 标签：快捷键
    tabDiagnostics: '资料与诊断', // 标签：资料与诊断
    audioTitle: '声音反馈', // 声音区标题
    audioIntro: '所有音量会乘以主音量；浏览器首次交互前不会强制播放。', // 声音区说明
    masterVolume: '主音量', // 主音量
    masterVolumeHint: '控制游戏全部声音', // 主音量说明
    soundVolume: '音效音量', // 音效音量
    soundVolumeHint: '倒计时、猜中、邀请等反馈', // 音效音量说明
    musicVolume: '背景音乐', // 背景音乐
    musicVolumeHint: '轻量大厅和结算音乐', // 背景音乐说明
    muted: '全部静音', // 静音开关
    mutedHint: '视觉反馈仍会保留', // 静音开关说明
    accessibilityTitle: '显示与便捷操作', // 显示区标题
    accessibilityIntro: '关键状态始终同时使用文字或图标，不仅依赖颜色。', // 显示区说明
    animations: '界面动画效果', // 动画总开关
    animationsHint: '按钮、弹窗与页面元素使用轻量反馈动画', // 动画开关说明
    showShortcuts: '显示快捷键提示', // 快捷键提示开关
    showShortcutsHint: '在画板工具旁显示组合键', // 快捷键提示说明
    autoFocus: '自动聚焦猜词框', // 自动聚焦开关
    autoFocusHint: '新回合作画开始时方便直接输入', // 自动聚焦说明
    discoverable: '允许在线发现', // 在线发现开关
    discoverableHint: '关闭后不出现在当前服务的发现列表', // 在线发现说明
    acceptsInvites: '接收房间邀请', // 接收邀请开关
    acceptsInvitesHint: '关闭后其他玩家不能定向邀请你', // 接收邀请说明
    shortcutsTitle: '画板工具快捷键', // 快捷键区标题
    shortcutsIntro: '点击输入框后直接按下新按键；猜词框或其他输入控件聚焦时不会切换工具。', // 快捷键区说明
    pen: '画笔', // 画笔工具名
    penDetail: '切换到自由画笔', // 画笔工具说明
    eraser: '橡皮擦', // 橡皮擦工具名
    eraserDetail: '切换到橡皮擦并沿用当前粗细', // 橡皮擦工具说明
    fill: '区域填充', // 填充工具名
    fillDetail: '填充点击位置的封闭区域', // 填充工具说明
    setShortcutAria: (name: string) => `设置${name}快捷键`, // 快捷键输入标签
    shortcutErrorSimple: '请直接按一个字母、数字或符号，不要组合 Ctrl、Alt 或 Command。', // 快捷键错误：组合键
    shortcutErrorConflict: (key: string, name: string) => `“${key}”已用于${name}，请换一个按键。`, // 快捷键错误：重复
    shortcutNote:
      '撤销固定为 Ctrl/Command + Z，重做固定为 Ctrl/Command + Shift + Z 或 Ctrl/Command + Y。', // 快捷键说明
    nicknameField: '大厅昵称', // 资料编辑：昵称
    avatarField: '更换头像', // 资料编辑：头像按钮
    saveProfile: '保存资料', // 保存资料按钮
    diagnosticsTitle: '关于与连接诊断', // 诊断区标题
    copyDiagnostics: '复制诊断信息', // 复制诊断按钮
    resetSettings: '恢复本地默认设置', // 恢复默认按钮
    clearProfile: '清除本地资料', // 清除资料按钮
    copied: '脱敏诊断信息已复制', // 复制成功提示
    copyFailed: '当前环境不支持复制，请手动选择文本', // 复制失败提示
    // 诊断文本模板（多行汇总）
    diagAppLine: (name: string, version: string) => `${name} ${version}`, // 应用名称与版本
    diagProtocol: (version: string) => `协议版本：${version}`, // 协议版本行
    diagAddress: (address: string) => `服务地址：${address}`, // 服务地址行
    diagConnection: (label: string) => `连接状态：${label}`, // 连接状态行
    diagLatency: (latency: string) => `近似延迟：${latency}ms`, // 延迟行
    diagPlayerId: (id: string) => `玩家 ID：${id}`, // 玩家 ID 行
    diagRoom: (name: string) => `房间：${name}`, // 房间行
    unknownLatency: '未知', // 延迟未知
    notLoggedIn: '未登录', // 玩家 ID 未登录
    noRoom: '无', // 无房间
  },

  /* ============================= 客户端 store / 请求层 ============================= */
  /** stores/game.ts：操作结果 Toast 与连接事件文案。 */
  store: {
    notConnected: '尚未连接到主机服务，请稍候再试', // 未连接时注册
    restored: '座位与对局状态已恢复', // 恢复令牌登录成功
    enteredLobby: '已进入在线大厅', // 登录成功
    settingsReset: '本地设置已恢复默认', // 恢复默认设置
    profileCleared: '本地资料已清除；刷新后将作为新玩家进入', // 清除资料
    profileUpdated: '玩家资料已更新', // 更新资料
    roomLeft: '已安全退出房间', // 退出房间
    vocabularyUpdated: '本局词库已更新，所有人需要重新准备', // 保存词库
    inviteSent: '邀请已发送', // 发送邀请
    pauseReasonHost: '房主暂停了游戏', // 房主暂停请求原因（与服务端通知共用）
  },
  /** stores/request.ts：请求失败的错误翻译。 */
  request: {
    genericFailure: '请求失败，请检查主机服务与局域网连接', // 未知错误兜底
    timeoutMessage: '服务器响应超时；当前操作未确认，请检查连接后重试', // 超时提示
  },
} as const

/**
 * 服务端产生的、展示在玩家界面上的文案（经 ack 错误、systemNotice、聊天消息、
 * roomClosed 原因等事件到达客户端）。仅在使用时注入动态占位（昵称、数值）。
 */
export const serverStrings = {
  /* ---- 请求错误提示（GameError message，经 ack 返回客户端 Toast）---- */
  errors: {
    PROTOCOL_MISMATCH: '客户端版本与服务器不兼容，请刷新或更新页面', // 协议版本不匹配
    INVALID_AVATAR_ID: '头像无效，请重新选择内置头像', // 注册或更新时头像编号非法
    PROFILE_LOCKED: '进入房间后不能修改昵称，请先退出房间', // 房间内锁定资料
    INVALID_NICKNAME: (min: number, max: number) => `昵称需为 ${min}～${max} 个可见字符`, // 昵称长度非法
    DUPLICATE_NICKNAME: '昵称已被占用，请换一个昵称', // 昵称重名且后缀耗尽
    INVALID_SETTINGS: '房间规则超出服务器允许范围', // 规则越界
    INVALID_SETTINGS_MAX_PLAYERS: '最大人数不能少于当前房间人数', // 最大人数过小
    UNAUTHORIZED_REGISTER: '请先确认玩家资料并登录', // 未登录发请求
    UNAUTHORIZED: '身份已失效，请重新进入游戏', // 身份失效
    ALREADY_IN_ROOM: '你已经在一个房间中，请先退出', // 已在房间又建房/加房
    NOT_IN_ROOM: '你当前不在房间中', // 无座位
    NOT_IN_ROOM_KICK: '目标玩家已不在房间', // 踢人目标不存在
    NOT_IN_ROOM_TRANSFER: '目标玩家不在房间', // 移交目标不存在
    FORBIDDEN: '只有房主可以执行此操作', // 房主权限
    FORBIDDEN_INVITE: '本房间仅房主可以邀请', // 邀请权限
    NO_GAME: '当前房间没有进行中的游戏', // 无对局
    NOT_DRAWER: '只有当前画家可以修改画板', // 非画家改画板
    NOT_DRAWER_ACTION: '只有当前画家能修改画板', // 非画家改画板（笔画/填充）
    NOT_DRAWER_CHOOSE: '只有当前画家能在选词阶段选择题目', // 非画家选词
    RATE_LIMITED: '操作过于频繁，请稍后再试', // 会话限频
    RATE_LIMITED_INVITE: '邀请发送过于频繁，请稍后再试', // 邀请冷却
    RATE_LIMITED_PRIVATE_JOIN: '房间码尝试过于频繁，请稍后再试', // 私密房短码限频
    INVALID_PAYLOAD: '请求格式无效或字段超出允许范围', // zod 校验失败
    INVALID_PHASE_READY: '当前阶段不能修改准备状态', // 非等待阶段准备
    INVALID_PHASE_SPECTATOR_READY: '观战成员不能准备，须退出后重新加入', // 观战者准备
    INVALID_PHASE_GAME_STARTED: '游戏已经开始或正在倒计时', // 重复开局
    INVALID_PHASE_GUESS: '当前不能猜词', // 非作画阶段猜词
    INVALID_PHASE_PRESET: '当前不能发送互动短语', // 非作画阶段发短语
    INVALID_PHASE_RESUME: '游戏当前没有暂停', // 未暂停时恢复
    INVALID_PHASE_END_EARLY: '当前没有可提前结束的比赛', // 无对局时提前结束
    INVALID_PHASE_TRANSFER_HOST: '仅等待阶段可以主动移交房主', // 非等待阶段移交
    INVALID_PHASE_RETURN_WAITING: '只有最终结算后才能返回房间', // 非结算阶段返回房间
    INVALID_TRANSITION: (from: string, to: string) => `非法状态转换：${from} → ${to}`, // 非法阶段转换
    SETTINGS_LOCKED_UPDATE: '比赛期间规则为只读，请返回房间后修改', // 对局中改规则
    SETTINGS_LOCKED_VOCABULARY: '游戏开始后不能修改本局词库', // 对局中改词库
    VERSION_CONFLICT_SETTINGS: '房间状态已更新，请查看最新规则后重试', // 规则版本冲突
    VERSION_CONFLICT_VOCABULARY: '房间状态已变化，请重新确认词库', // 词库版本冲突
    VERSION_CONFLICT_START: '房间状态已变化，请确认所有人准备后重试', // 开局版本冲突
    VOCABULARY_TOO_SMALL: (min: number) => `至少选择 ${min} 个词条`, // 词库数量不足
    VOCABULARY_TOO_SMALL_GAME: (required: number) => `本局至少需要选择 ${required} 个词条`, // 开局词库不足
    INVALID_WORD_ID: '选择中包含无效词条，请刷新词库', // 伪造词条
    INVALID_WORD_ID_CHOOSE: '候选词已失效，请等待服务端自动选择', // 候选词失效
    NOT_ENOUGH_PLAYERS: '至少需要 2 名玩家才能开始', // 可玩人数不足
    NOT_ALL_READY: '其他在线玩家全部准备后才能开始', // 未全员准备
    DRAWER_CANNOT_GUESS: '画家不能发送猜词消息', // 画家猜词
    SPECTATOR_CANNOT_GUESS: '观战成员不能参与猜词', // 观战者猜词
    SPECTATOR_CANNOT_CHAT: '观战成员不能发送互动短语', // 观战者发短语
    ALREADY_GUESSED: '你已经猜中了，只能发送预设短语', // 重复猜中
    INVALID_MESSAGE_EMPTY: '猜词内容为空或过长', // 猜词文本非法
    INVALID_MESSAGE_PRESET: '该互动短语不在安全列表中', // 预设短语不在白名单
    STALE_DRAW_EVENT_STROKE: '绘图包已过期或重复', // 笔画序号过期
    STALE_DRAW_EVENT_FILL: '填充命令已过期或重复', // 填充序号过期
    INVALID_DRAW_STYLE: '画笔颜色或线宽无效', // 笔画样式非法
    INVALID_FILL: '填充颜色无效', // 填充颜色非法
    PAUSE_DISABLED: '本房间未开启暂停权限', // 暂停权限关闭
    INVALID_TARGET_SELF: '房主不能移除自己，请使用退出房间', // 踢自己
    SPECTATOR_CANNOT_HOST: '观战成员不能成为房主', // 移交目标非法
    ROOM_NOT_JOINABLE_INVITE: '房间已开始或已满员，不能邀请', // 邀请前置失败
    TARGET_UNAVAILABLE: '该玩家当前无法接收邀请', // 目标不可邀
    INVITE_EXPIRED: '邀请已失效，请让对方重新邀请', // 邀请过期
    ROOM_NOT_FOUND_INVITE: '受邀房间已经关闭', // 受邀房间关闭
    INVITE_ROOM_CLOSED: '邀请房间已关闭', // 邀请视图生成时房间已关（snapshot）
    ROOM_NOT_FOUND: '房间不存在或已经关闭，请从大厅选择其他房间', // 加入失败
    PRIVATE_ROOM_NOT_FOUND: '房间码无效或私密房间已经关闭', // 私密房加入统一失败文案
    ROOM_FULL: '房间已经满员，请加入其他房间', // 房间满员
    GAME_IN_PROGRESS_FORBID: '本房间不允许中途加入，请等待下一局', // 禁止中途加入
    GAME_IN_PROGRESS_NEXT: '游戏进行中，请等待下一局开始后再加入', // 下一局加入
    UNKNOWN_FAILURE: '服务暂时不可用，请稍后重试', // 非预期错误兜底
  },

  /* ---- 系统通知 / 聊天消息 / 房间关闭原因（systemNotice / roomClosed / guessClose）---- */
  notices: {
    fallbackPlayerName: '玩家', // 昵称缺失兜底
    hostFallback: '新房主', // 房主名缺失兜底
    hostUnknown: '未知房主', // 大厅行房主名缺失兜底
    answerHidden: '答案长度已隐藏', // 关闭字数显示时的答案遮罩
    serverShutdown: '主机服务已关闭，请稍后重新连接', // 服务优雅关闭通告
    closeRoomEmpty: '最后一名玩家已离开，房间已关闭', // 空房间关闭
    closeRoomNoPlayableHost: '房间已无可接任房主的玩家，房间已关闭', // 仅剩观战者时关闭
    kickedReason: '你已被房主移出房间', // 被移出房间
    kickedLog: '玩家被房主移出', // 移出记录的离开原因
    joinedReadyReset: (nickname: string) => `${nickname} 加入了房间，所有人需重新准备`, // 新成员加入
    leaveReasonDefault: '主动离开房间', // 默认离开原因
    leaveReadyReset: (reason: string) => `${reason}，所有人需重新准备`, // 离开后取消准备
    countdownCanceled: '开始倒计时因成员变化而取消', // 成员变化取消倒计时
    drawerLeftChoosing: (nickname: string) => `${nickname} 在选词时离开，本回合作废`, // 画家选词时离开
    autoPaused: '在线玩家不足，比赛已自动暂停', // 人数不足自动暂停
    rulesUpdated: '房间规则已修改，所有人需重新准备', // 规则修改
    vocabularyUpdated: '本局词库已修改，所有人需重新准备', // 词库修改
    backToRoom: '已返回房间，请全员重新准备', // 返回房间
    hostTransferred: (nickname: string) => `房主已移交给 ${nickname}`, // 主动移交房主
    hostMigrated: (nickname: string) => `房主已迁移给 ${nickname}`, // 房主离开自动迁移
    hostMigratedTimeout: (nickname: string) => `原房主重连超时，控制权已迁移给 ${nickname}`, // 房主断线超时迁移
    pauseRequest: (nickname: string, reason: string) => `${nickname} 请求房主暂停：${reason}`, // 成员请求暂停
    pauseFallbackReason: '需要短暂暂停', // 暂停原因缺失兜底
    endEarlyByHost: '房主提前结束了本局游戏', // 房主提前结束
    drawingStarted: '作画开始，猜词玩家请在右侧输入答案', // 开画系统提示
    guessCorrect: (nickname: string) => `${nickname} 猜中了！`, // 猜中聊天消息
    guessClose: '很接近！再想一想', // 接近答案提示
    allRoundsDone: '全部回合完成', // 全部回合结束
    noDrawerAvailable: '没有可继续作画的在线玩家', // 无可用画家
    disconnectCountdownCanceled: '有玩家掉线，开始倒计时已取消', // 掉线取消倒计时
    drawerDisconnectChoosing: '画家在选词时掉线，本回合作废并重选', // 画家掉线重选
    playerReconnectedTimeout: '玩家重连超时离开', // 重连超时离开
  },

  /* ---- 词库加载错误（服务启动校验，展示给运维 / 终端）---- */
  vocabulary: {
    wordTooLong: (text: string, max: number) => `词条“${text}…”超过 ${max} 个字符`, // 单词超长
    tooFewWords: (size: number, min: number) => `有效词条仅 ${size} 个，至少需要 ${min} 个`, // 词条过少
    tooManyWords: (size: number, max: number) => `有效词条共 ${size} 个，最多支持 ${max} 个`, // 词条过多
  },
} as const
