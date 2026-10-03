# 规格：画板双角色右键菜单、对局趣味机制与黄金三栏布局重构

> **Status**: `ready-for-agent`
> **来源**：2026-10-03 综合体验升级讨论，涵盖画板右键快捷操作、猜词与对局细节体验、纸墨扁平美学深化以及对局界面三栏布局重构。
> **参考记录**：根目录 `一次性的讨论文档.md`（完整共识归档）。

---

## Problem Statement

在现有的实时对局与画板交互中，存在以下几项影响游戏心流与视觉体验的核心问题：

1. **画家作画心流被打断**：在紧张的 60~120 秒作画时间内，画家频繁需要将鼠标从画板中央移至底部工具条切换画笔、橡皮、油漆桶或撤销，造成视觉盲区和操作迟疑；纯鼠标玩家缺乏就地盲操的快捷通道。
2. **猜词者/观战者局内参与感单一**：非画家在等待与猜词期间，无法对精彩画作进行快速复制分享，也无法在画板上进行无声的轻量互动（如点赞、发出问号），对局氛围偏冷。
3. **猜词挫败感与反馈粗暴**：玩家猜词出现错别字（如将多字词打错一个字）时，系统仅冷冰冰地将其视为普通错误发言，缺乏私密正向引导，容易挫伤猜词积极性；而公屏提示又会造成剧透。
4. **全员猜中后的无效等待**：当房间内所有猜词者均已猜中时，对局依然必须等待倒计时硬性归零，产生无意义的垃圾时间。
5. **终局结算缺乏趣味与成就感**：单局结束后仅有冰冷的分数与排名展示，缺乏针对玩家局内高光行为（如单回合神速猜出、全场抽象灵魂画作）的荣誉定性与趣味社交标签。
6. **对局界面布局不合理、画板视觉焦点被争夺**：
   - 浮动聊天面板在展开时直接硬性遮挡了画板右侧约 25% 的黄金作画区域，画家在右侧画画时猜词者无法看全；
   - 猜词者若为了看画而关闭聊天面板，又无法得知其他人的猜测记录，打字猜词还需频繁开合或拖动浮窗，体验极其分裂；
   - 原有的玩家常驻左栏过窄（仅 10% 舞台宽），扣除内边距与头像后文字可用宽度不足 60px，导致 4 个字以上的昵称严重截断、分数与状态角标拥挤错位。

---

## Solution

本项目实施一套全方位的游戏体验与界面布局重构方案：

1. **画板双角色右键菜单体系**：
   - 基于现有全局单例菜单组件，在画板区域拦截右键事件，按当前角色动态提供创作工具（画笔/橡皮/油漆桶/吸管/撤销/重做/复制/保存/清空二次确认）与猜词互动（复制/保存/全员微表情广播/快捷短语）；
   - 具备手势防冲突守卫、点外关闭防墨迹污染、以及局域网 HTTP 下剪贴板自动降级为文件下载的自愈能力。
2. **猜词「差一个字」私密智能提示**：
   - 服务端在裁决猜词时，若答案长度 $\ge 2$ 且编辑距离严格等于 1，向猜词者单人定向推送私密提示（公屏不可见，防剧透），房间规则可配置且默认开启。
3. **全员猜中立即提前结算**：
   - 当本回合所有在线猜词者全部答对时，服务端计时器立即截断，零等待切入回合结算，消除垃圾时间。
4. **画家 +20 即时得分反馈**：
   - 猜词者答对时，画家视角浮现金色 `+20` 飘字并伴随清脆金币声，余光即刻获知进度。
5. **终局战报趣味荣誉称号体系**：
   - 客户端纯函数根据全局战报统计，自动评定并展示「神笔马良」、「灵魂画手」、「读心大师」、「积极分子」荣誉标签，不改动数据库表结构。
6. **纸墨扁平美学深化**：
   - 保持克制、工整的扁平纸墨风格；大厅房间卡片增加 6 席位可视化小圆点（实心代表入座、虚线代表空位）；聊天流系统消息增加三级分层着色（系统常规灰、猜对广播绿、差一字提示橙）。
7. **黄金平衡三栏对局布局（16% - 62% - 20%）**：
   - 顶部统领全局顶栏（保持统一基线与高度）；
   - **左栏（玩家榜 16%）**：独立黑框，文字净宽扩展至 120px，完整容纳 8~10 字昵称不截断，两行优雅排布；
   - **中栏（核心画板 62%）**：独立黑框，物理比例达到约 4:3 黄金绘画比例，居中绝对主角，彻底废除浮动遮挡面板，全屏零遮挡、永不拉伸伸缩；
   - **右栏（常驻聊天栏 20%）**：独立黑框，流内常驻，单行容纳 15~16 汉字，短句不换行，猜词者边看画边打字，无需开关窗口。

---

## User Stories

### 画板右键菜单（画家视角）

1. As a drawer, I want to right-click anywhere on the canvas to open a quick context menu, so that I can switch between pen, eraser, and paint bucket without moving my cursor to the bottom toolbar.
2. As a drawer, I want currently active tools in the right-click menu to be visually disabled or checked, so that I can immediately confirm which tool I am currently using.
3. As a drawer, I want to select the eyedropper tool from the right-click menu, so that I can click on any canvas pixel to sample its color and automatically switch back to the pen tool for drawing.
4. As a drawer, I want to undo and redo strokes directly from the right-click menu, so that I can fix mistakes quickly using mouse clicks alone.
5. As a drawer, I want undo and redo menu items to be disabled when there is no relevant command history, so that I do not trigger redundant actions.
6. As a drawer, I want to see shortcut hints (e.g. `B`, `E`, `F`, `Ctrl+Z`, `Ctrl+Y`) beside right-click menu items, so that I can learn and memorize keyboard shortcuts naturally.
7. As a drawer, I want to copy my current canvas artwork as an image to the system clipboard from the right-click menu, so that I can easily paste and share it in chat applications.
8. As a drawer, I want to download my current canvas artwork as a high-resolution PNG file from the right-click menu, so that I can archive memorable party drawings.
9. As a drawer, I want selecting "Clear Canvas" in the right-click menu to trigger a confirmation dialog, so that I never accidentally erase my entire drawing with an unintended click.
10. As a drawer, I want right-click attempts during an active drawing stroke to be ignored, so that fast line gestures are not interrupted by unexpected menu popups.
11. As a drawer, I want clicking on the canvas to dismiss an open right-click menu to leave zero ink on the board, so that closing the menu does not pollute my drawing.
12. As a drawer, I want the clipboard copy action to automatically fall back to direct file download if the browser restricts clipboard permissions in an insecure HTTP LAN environment, so that my export request never silently fails.

### 画板右键菜单（猜词者与观战者视角）

13. As a guesser, I want to right-click on the canvas to copy or download the current drawing, so that I can preserve brilliant or hilarious artwork created by my friends.
14. As a guesser, I want to send micro-reactions (👍, ❓, 🔥) from the canvas right-click menu, so that I can express appreciation or confusion directly on the drawing board.
15. As a player, I want micro-reactions sent by guessers to float upwards and fade out over 1.2 seconds on all connected players' screens, so that the entire room shares the live party excitement.
16. As a player, I want micro-reactions to be ephemeral without being saved into authoritative drawing history, so that canvas replay performance and history caps remain completely unaffected.
17. As a guesser, I want to send pre-defined safe compliment or difficulty phrases from the right-click menu, so that I can interact quickly without typing.
18. As a room host, I want to toggle canvas reaction pings on or off in room settings, so that I can disable floating bubbles if players prefer an ultra-clean canvas.
19. As a player, I want canvas reaction pings to enforce a 1.5-second cooldown per user and a maximum of 6 concurrent bubbles on screen, so that the canvas is never flooded or obscured.

### 猜词与游戏机制细节

20. As a guesser, I want to receive a private hint when my guess is exactly one character away from the correct answer (for answers of 2 or more characters), so that I am encouraged to adjust my guess and keep trying.
21. As a guesser, I want near-miss hints to appear exclusively in my own chat stream, so that other players are not spoiled by my near-correct attempt.
22. As a guesser, I want single-character answers to never trigger near-miss hints, so that trivial random guessing is prevented from receiving clues.
23. As a room host, I want to enable or disable the near-miss hint rule in room settings (enabled by default), so that I can customize the game difficulty for my party.
24. As a drawer, I want to see a floating `+20` score indicator and hear a cheerful coin sound whenever a player guesses correctly, so that I receive immediate positive reinforcement while focusing on drawing.
25. As a player, I want the round to immediately advance to the round result stage when all active guessers have guessed correctly, so that our group does not waste time waiting for an unnecessary countdown.
26. As a player, I want the final game result screen to display fun party accolades (such as "神笔马良", "灵魂画手", "读心大师", "积极分子"), so that every participant's unique play style is recognized beyond pure ranking.
27. As a player, I want accolades to be calculated reliably by the client without breaking backward compatibility of archived match records, so that historical game logs remain intact.

### UI 视觉与三栏布局重构

28. As a player browsing the lobby, I want to see a 6-dot seat occupancy matrix on each room card, so that I can immediately tell how many seats are filled without mental math.
29. As a player reading chat, I want system messages to have distinct visual styling (neutral gray for join/leave, light green for correct guesses, soft orange for private hints), so that critical game events stand out clearly from ordinary conversation.
30. As a player, I want the visual aesthetic to adhere to the existing clean flat Paper & Ink theme without unnecessary cartoon or skeuomorphic clutter, so that the game feels refined and distraction-free.
31. As a player, I want a global top bar that maintains a consistent height (~10cqh) across all main screens, displaying round info, fixed-width countdown, and word clues.
32. As a player, I want the left player panel to occupy 16% width with independent border styling, so that nicknames up to 8-10 characters are fully displayed without truncation or score misalignment.
33. As a player, I want the center canvas to occupy 62% width with an aspect ratio of approximately 4:3, so that the canvas is the undisputed, unobstructed visual centerpiece of the match.
34. As a player, I want the canvas to never stretch, squeeze, or shift during the match, so that drawing geometry remains completely stable.
35. As a player, I want the floating chat panel to be completely eliminated in favor of a permanent 20% right-side chat column, so that drawings are never blocked by floating overlays.
36. As a guesser, I want to view the canvas and read incoming guesses simultaneously in parallel without toggling or dragging windows, so that my guessing workflow is seamless.
37. As a guesser, I want the bottom toolbar to be completely hidden on my screen, so that I enjoy maximum canvas clarity while watching the drawer.
38. As a drawer, I want the bottom toolbar to remain docked at the bottom of the canvas with a handle for slight repositioning, so that my drawing tools are readily available.

---

## Implementation Decisions

### 1. Data Contracts and Protocol Extensions

- **Room Settings Schema**:
  Extend `RoomSettings` with two new boolean flags, both defaulting to `true`:
  - `allowNearMissHint`: controls whether server sends private near-miss clues for 1-character differences.
  - `allowCanvasReactions`: controls whether players can broadcast floating micro-reactions on the canvas.
- **Canvas Reaction Event (`game:canvas_ping`)**:
  - Client request payload: `{ x: number, y: number, type: 'thumbs_up' | 'confused' | 'fire' }`.
  - Normalized coordinates `(x, y)` clamped to `[0, 1]`.
  - Server validation: reject if `allowCanvasReactions === false`, or if requester sends faster than 1.5 seconds per user.
  - Broadcast: lightweight broadcast to all room sockets with sender's nickname or ID; does NOT persist to SQLite, does NOT append to authoritative `strokes` history.
- **Near-Miss Hint Event / Notification**:
  - Evaluated on authoritative server inside chat/guess processing.
  - Target word is extracted from server-side game secret.
  - Condition: `allowNearMissHint === true`, target word length $\ge 2$, and Levenshtein edit distance between normalized guess and normalized answer equals 1.
  - Delivery: emitted strictly to the guesser's individual socket as a private system chat notification (`isPrivate: true` or distinct system kind).

### 2. Client Architecture and Canvas Right-Click Menu

- **Component Reuse**:
  - Exclusively reuse existing `ContextMenu.vue` and `useContextMenu()` singleton.
  - Context menu items declared via `ContextMenuItem[]`.
- **Drawer Menu Items**:
  - Tools group: Pen (disabled if active), Eraser (disabled if active), Fill (disabled if active), Eyedropper.
  - History group: Undo (disabled if no history), Redo (disabled if no redo history).
  - Export group: Copy canvas to clipboard, Download canvas PNG.
  - Danger group: Clear canvas (`danger: true`, triggers existing `ConfirmDialog.vue` for confirmation).
- **Guesser Menu Items**:
  - Export group: Copy canvas to clipboard, Download canvas PNG.
  - Reaction group: Thumbs Up (👍), Confused (❓), Fire (🔥) — broadcasts `game:canvas_ping`.
  - Phrase group: Predefined compliment and difficulty quick chat shortcuts.
- **Safety and Conflict Guards**:
  - In `GameCanvas.vue`, `@contextmenu.prevent` handles menu opening.
  - In `useStrokeSession.ts`, if `contextMenu.state.open === true`, any incoming canvas `pointerDown` closes the menu and immediately aborts stroke initiation, leaving zero marks on the canvas.
  - If a stroke is actively in progress (`drawing.value === true`), incoming context menu events are dropped.
- **Canvas Image Export**:
  - Extracted directly from `DrawingReplayMachine`'s 720p logical canvas (`canvas.toBlob(...)`), guaranteeing a clean, high-resolution raster free of DPR scaling, UI shadows, or cursors.
  - `navigator.clipboard.write` attempts writing `image/png`. Upon failure (such as HTTP LAN security restrictions), automatically falls back to client-side file download via anchor blob link and informs user via toast.

### 3. Immediate All-Guessed Transition & Real-Time Scoring Feedback

- **Server-Side Round Machine**:
  - When guess evaluation records a hit, compare `guessedCount` against `totalGuessers` (`playableMembers - 1`).
  - If `guessedCount === totalGuessers`, the server scheduler immediately cancels the remaining round timer and invokes `finishRoundEarly()`, progressing the phase machine to `round_result`.
- **Drawer Floating Score Feedback**:
  - In `GameCanvas.vue` or `PlayerPanel.vue`, when a new guesser is marked as guessed during the drawing phase, render an animated `+20` indicator near the drawer's avatar/canvas header for 1.2s, accompanied by the existing `click`/`correct` interaction sound.

### 4. Client-Side Accolade Evaluation (Party Titles)

- **Pure Function Derivation**:
  - A client-side pure module derives honors from match result history:
    - **「神笔马良」**: Drawer with the shortest average time-to-full-guess or highest guess-completion rate across their rounds.
    - **「灵魂画手」**: Drawer with zero successful guesses across rounds whose drawings contained substantial stroke counts.
    - **「读心大师」**: Guesser who achieved the first-order guess (100 points) the most times.
    - **「积极分子」**: Guesser with the highest overall chat/guess submission count.
  - Accolades attach directly to `GameResult` player summary cards in the UI without altering server database schemas or migration files.

### 5. Layout Reconstruction: Golden Ratio Three-Column Layout

- **Overall Geometry (100cqw Budget)**:
  - Outer margins: `0.2cqw` on left and right.
  - Two column gaps: `0.8cqw` each.
  - Left column (Player Panel): `16cqw` width.
  - Center column (Canvas & HUD): `62cqw` width.
  - Right column (Chat Panel): `20cqw` width.
  - Total: `0.2 + 16 + 0.8 + 62 + 0.8 + 20 + 0.2 = 100cqw`.
- **Top Bar**:
  - Global `StageHeader` occupies ~10cqh height, remaining consistent with lobby and room views.
- **Left Column (`PlayerPanel.vue`)**:
  - Dedicated black container (`border-[0.35cqh] border-line rounded-[0.6em]`).
  - Text available width expanded to ~120px, accommodating 8-10 Chinese characters without truncation.
  - Two-line structured layout per card: Avatar (4.6cqh) + Nickname (line 1) + Score & Status badge (line 2).
- **Center Column (`GameCanvas.vue`)**:
  - Dedicated black container (`border-[0.35cqh] border-line rounded-[0.6em]`).
  - Height ~48cqh with 62cqw width yields ~1.28:1 (~4:3) optimal drawing aspect ratio.
  - Floating panel component (`FloatingPanel.vue`) and toggle hotkey (`C`) are completely removed from the game view.
  - Drawer toolbar is docked inside the bottom of the canvas container, automatically hidden for guessers.
- **Right Column (`ChatPanel.vue`)**:
  - Dedicated black container (`border-[0.35cqh] border-line rounded-[0.6em]`).
  - Permanent in-flow vertical layout: scrollable message list at top, input box pinned at bottom.
  - Line width supports 15-16 Chinese characters without awkward line wrapping.
- **Visual Polish**:
  - Lobby room cards render a 6-dot seat occupancy strip (filled colored circle for occupied seats, dashed gray circle for vacant seats).
  - Chat panel classifies message types into distinct, flat visual categories: neutral gray for room events, light green border/background for correct guess announcements, soft orange for private near-miss hints.

---

## Testing Decisions

### What Makes a Good Test

1. **Test Observable Behavior Over Implementation**:
   - Assert visible outcomes (e.g. correct DOM elements rendered, correct events emitted with expected payloads, correct ack responses received), never internal private variables or helper functions.
2. **Deterministic and Isolated**:
   - Tests run in clean, isolated environments using fake clocks, mock sockets, and temporary memory structures. Tests never depend on external network services or persistent shared databases.
3. **Robust Boundary Verification**:
   - Explicitly verify boundary rules: 1-character words do not trigger near-miss hints; 2-character words with distance 1 do; room setting toggles reject/allow reactions; canvas clicks while menu is open close the menu without drawing.

### Modules and Seams to Test

1. **Shared Pure Functions & Schemas (`packages/shared`)**:
   - `RoomSettings` schema validation accepts `allowNearMissHint` and `allowCanvasReactions` with default `true`.
   - Pure string distance calculation verifies Levenshtein distance 1 detection.
2. **Server Handlers & Round Machine (`apps/server`)**:
   - Chat handler emits private near-miss notification only to the guesser's socket when condition matches.
   - Guess handler immediately transitions the round to `round_result` when the last guesser guesses correctly.
   - Rate limiter blocks canvas ping floods exceeding 1 per 1.5 seconds per player.
3. **Client Pure Functions & Accolades (`apps/client`)**:
   - Accolade evaluator correctly assigns "神笔马良", "灵魂画手", "读心大师", and "积极分子" based on simulated round history.
4. **Component Tests (`test/component`)**:
   - `GameView.vue`: Renders the three-column layout (16cqw player list, 62cqw canvas, 20cqw permanent chat) without any floating panels.
   - `PlayerPanel.vue`: Renders player cards with avatar, full nickname, score, and status without text overflow.
   - `ChatPanel.vue`: Renders system, guess, and private near-miss messages with designated styling classes.
   - `GameCanvas.vue`: Right-click triggers `useContextMenu().open` with appropriate items based on player role; canvas `pointerDown` while menu is open closes the menu and prevents stroke registration.
5. **Prior Art in Codebase**:
   - Follows patterns in `test/unit/game-rematch.spec.ts` and `test/unit/scoring.spec.ts` for pure domain logic.
   - Follows patterns in `test/component/CanvasToolbar.spec.ts`, `test/component/FloatingPanel.spec.ts`, and `test/component/CommonControlledComponents.spec.ts` for Vue component testing.

---

## Out of Scope

1. **Red Wax Seals / Vermilion Stamps**:
   - Retaining existing flat Lucide icons for badges and host indicators; no skeuomorphic wax stamps.
2. **Rice Paper Grid for Word Clues**:
   - Retaining clean flat underline and monospace letter mask presentation; no decorative calligraphy grid boxes.
3. **Long-Poster Image Generation**:
   - Accolades are rendered on the post-match summary cards in-game; generating stitch-together shareable panoramic poster images is excluded.
4. **Freehand Outline Smoothing Libraries**:
   - Canvas continues strictly using incremental line strokes (`stroke()` with round line caps), adhering strictly to ADR-0017 and ADR-0018.
5. **Mobile-Specific Compact Breakpoints**:
   - Adhering strictly to AGENTS.md responsive standards: fixed 16:9 proportional scaling using `cqw`/`cqh`/`em`, no compact mobile switching.

---

## Further Notes

1. **ADR Evolution**:
   - Implementation will update `docs/adr/README.md` and add a new ADR superseding ADR-0043, formally recording the transition from "floating chat panel over canvas" to the "golden ratio three-column layout (16-62-20)".
2. **Protocol Compatibility**:
   - Any addition of required schema fields to `RoomSettings` or new push events must increment `protocolVersion` in `packages/shared/src/protocol/constants.ts` to ensure clean client/server version alignment.
