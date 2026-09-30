# 0016 类型护栏分层：协议泛型接入、strictTemplates 与 type-checked lint 的范围取舍

**状态**：已采纳

- 来源：全库 TypeScript 类型严谨性整改（用户要求「补全所有 TS 类型，减少 bug」）

## 背景

整改前项目显式水位已高（生产 0 `any`/0 `@ts-ignore`/服务端导出全标注），但存在结构性缺口：

1. Socket.IO 两端未接入 shared 已备好的 `ClientToServerEvents`/`ServerToClientEvents`，
   `Server`/`Socket`/`socket.data`/`emit`/`emitWithAck` 全链路默认 any——`socket.data` 沦为
   无契约垃圾袋，读写两端共 30+ 处手写 `as` 还原；推送方向 `emitRoomEvent(event: string,
payload: unknown)` 与 `createServerPush<T>(data)` 让「事件名 ↔ 载荷」配对在编译期不存在。
2. 生产代码 23 处非空断言（隐私裁剪核心路径 snapshot.ts 6 处、DataTable 模板 9 处）。
3. 护栏缺失：ESLint 未启用任何需要类型信息的规则，vue-tsc `strictTemplates` 未开。

整改中实测得到两条硬约束：

- **typescript-eslint 的普通 TS program 无法解析跨文件 .vue 组件类型**（那是 vue-tsc 的
  编译管线职责）：对客户端启用 type-checked 规则会因 `import X from './X.vue'` 解析为
  error 类型而批量误报 `no-unsafe-*`（main.ts、组件 barrel、lazy-component、focus() 透传等）。
- strictTemplates 的 70 处报错中 68 处是**合法的 attrs 透传**（原语组件设计即透传包装），
  真缺陷只有 2 处（RulesDialog 把 `joinPolicy` 联合拓宽成 string 的选项数组——正是护栏价值）。

## 决策

1. **协议泛型全接入**：服务端 `Server<ClientToServerEvents, ServerToClientEvents,
InterServerEvents, AppSocketData>`（`socket-types.ts` 集中声明），客户端
   `GameSocket = Socket<ServerToClientEvents, ClientToServerEvents>`；`socket.data` 显式
   `AppSocketData` 袋。`createServerPush(event, data)` 事件名↔载荷编译期配对，
   `emitRoomEvent`/`emitToPlayer` 窄接口同步泛型化。客户端入站数据**仍按 unknown 走 Zod
   解码**（不信任线路数据的安全姿态不因类型接入而弱化，handler 的 `raw: unknown` 形参逆变兼容）。
2. **泛型边界适配收敛到 4 处具名断言**：binder 的 `on`、GameService 的 room/player 推送、
   request 的 `emitWithAck`——Socket.IO 的 `EventParams/Parameters<>` 对泛型事件名是延迟
   条件类型，函数体内 TS 无法自证匹配；断言签名仍受协议联合约束（不再是任意 string），
   事件↔载荷配对已在调用方由泛型强制。**（后续：ADR-0019 已把其中 request `emitWithAck`
   一项移出并把 `io()` 构造断言纳入，现行份数见 `AGENTS.md`。）**
3. **护栏分层**：客户端用 vue-tsc `strict + strictTemplates`（模板类型严格性精度高于 type-aware
   lint，透传放行清单见 `apps/client/src/vue-augmentations.d.ts`）；服务端 + packages 用 ESLint
   `recommendedTypeChecked`（`no-unsafe-*` 抓 any 扩散）+ `no-non-null-assertion`；
   test/** 不开 type-checked 层（测试替身的 `as unknown as` 属惯例），配置块级豁免。
   `no-misused-promises` 关闭——异步事件回调属设计内语义。逐项范围见 `AGENTS.md`「类型护栏分层」。
4. **断言治理**：生产非空断言 23 → 2 处定点豁免（flood-fill 热循环栈顶、sqlite-provider
   接口适配的 require-await），各带中文理由；DataTable 以 `visibleRows` computed 集中收窄
   替代模板 9 处 `!`；可消除的单层 `as` 全部改守卫/类型谓词/`isAvatarId` 共享守卫。
5. **契约锁定用键集快照而非手写 interface**（`test/integration/store-contracts.ts`）：
   Facade 56 成员若手写 interface 即双份维护（Q6 已否决该模式）；编译期 `keyof` 快照
   把「静默改名/误删成员」变成 typecheck 失败，签名仍由实现推断。
6. **tsconfig 补开** `noImplicitReturns`/`noFallthroughCasesInSwitch`/`noImplicitOverride`/
   `noUncheckedSideEffectImports`/`verbatimModuleSyntax`（全部实测零改动通过）。
7. 新增 devDependency `@vue/runtime-dom`（Vue 核心自带、lockfile 已存在的类型包）：
   pnpm 严格布局下 `declare module '@vue/runtime-dom'` 需可解析才能生效。

## 后果

- 正面：事件名拼错、载荷配错、成员契约漂移、any 扩散、模板未知 props 全部转为编译失败；
  试点即抓出 1 个真缺陷（RulesDialog 联合拓宽）。
- 代价与边界：4 处泛型边界断言保留（附注释说明不可证原因）；type-checked lint 不覆盖
  客户端（受 .vue 解析限制，由 vue-tsc 补位，护栏不留真空）；strictTemplates 的透传放行
  意味着「任意 aria-*/onXxx 落到组件」不再被 lint 拒绝——这是透传型原语的既定契约。
- 维护约定：增删 Facade/composable 成员时同步 store-contracts.ts 名单；新增 Vite 旗标
  先登记 `vite-env.d.ts`；客户端确需 type-aware lint 时再评估 vue-tsc 集成的成熟度。

## 关联

- 组件/模块：`apps/server/src/socket-types.ts`、`apps/client/src/stores/{socket,request}.ts`、
  `packages/shared/src/protocol/push.ts`、`apps/client/src/{vite-env,vue-augmentations}.d.ts`、
  `test/integration/store-contracts.ts`
- 前序：ADR-0008（不 Teleport 的容器单位约束）、ADR-0015（fixed 锚定）
- 测试：`test/type/schema-first.ts`（负向配对断言随 createServerPush 签名升级同步迁移）
