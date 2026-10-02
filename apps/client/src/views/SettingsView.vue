<!-- 游戏内设置页：使用分页布局避免舞台内长列表和可见滚动条。 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowLeft,
  Brush,
  Eraser,
  Eye,
  Keyboard,
  MessageSquare,
  PaintBucket,
  Palette,
  SlidersHorizontal,
  Volume2,
} from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { playInteractionSound } from '@/audio'
import { useGameStore } from '@/stores/game'
import { useCopyWithFeedback } from '@/composables/useCopyWithFeedback'
import {
  isUnmodifiedPrintableKey,
  normalizedShortcut,
  type ShortcutSettingKey,
} from '@/utils/keyboard'
import { StageHeader, StageHeaderButton, SideNav, type SideNavItem } from '@/components/common'
// 诊断页同样静态导入（前端已无懒加载，随设置页一并进主入口，见 ADR-0049）
import { AccessibilityTab, AudioTab, DiagnosticsTab, ShortcutsTab } from '@/components/settings'

const store = useGameStore()
const props = withDefaults(
  defineProps<{
    /** 返回按钮可由使用场景替换为“返回大厅”“返回游戏”等文案。 */
    backLabel?: string
    /** 对局内禁止修改昵称、头像或清除资料，其它本地设置仍可使用。 */
    profileEditingDisabled?: boolean
  }>(),
  {
    backLabel: strings.ui.settings.backToLobby,
    profileEditingDisabled: false,
  },
)
const emit = defineEmits<{
  back: []
}>()
// 当前激活的设置分类
const tab = ref<'audio' | 'accessibility' | 'shortcuts' | 'diagnostics'>('audio')
// 侧边导航条目数据驱动渲染：图标/文案/键值集中一处维护
const navItems: SideNavItem<typeof tab.value>[] = [
  { key: 'audio', label: strings.ui.settings.tabAudio, icon: Volume2 },
  { key: 'accessibility', label: strings.ui.settings.tabAccessibility, icon: Eye },
  { key: 'shortcuts', label: strings.ui.settings.tabShortcuts, icon: Keyboard },
  { key: 'diagnostics', label: strings.ui.settings.tabDiagnostics, icon: SlidersHorizontal },
]
const shortcutError = ref('') // 快捷键错误提示文案

// 快捷键配置行：设置键、中文名（来自 strings）、说明与图标
const shortcutRows: Array<{
  setting: ShortcutSettingKey
  name: string
  detail: string
  icon: typeof Brush
}> = [
  {
    setting: 'penShortcut',
    name: strings.ui.settings.pen,
    detail: strings.ui.settings.penDetail,
    icon: Brush,
  },
  {
    setting: 'eraserShortcut',
    name: strings.ui.settings.eraser,
    detail: strings.ui.settings.eraserDetail,
    icon: Eraser,
  },
  {
    setting: 'fillShortcut',
    name: strings.ui.settings.fill,
    detail: strings.ui.settings.fillDetail,
    icon: PaintBucket,
  },
  {
    setting: 'chatPanelShortcut',
    name: strings.ui.settings.panelChat,
    detail: strings.ui.settings.panelChatDetail,
    icon: MessageSquare,
  },
  {
    setting: 'toolsPanelShortcut',
    name: strings.ui.settings.panelTools,
    detail: strings.ui.settings.panelToolsDetail,
    icon: Palette,
  },
]

// 诊断信息：当前页面来源（host）作为服务地址展示
const serverAddress = location.origin
// 汇总连接与身份诊断文本，供一键复制排障（统一文案来自 strings.ui.settings.diag*）
const diagnostic = computed(() =>
  [
    strings.ui.settings.diagAppLine(store.config.app.name, store.config.app.version),
    strings.ui.settings.diagProtocol(store.config.app.protocolVersion),
    strings.ui.settings.diagAddress(serverAddress),
    strings.ui.settings.diagConnection(store.connectionLabel),
    strings.ui.settings.diagLatency(
      store.latency
        ? strings.ui.common.latencyShort(store.latency)
        : strings.ui.settings.unknownLatency,
    ),
    strings.ui.settings.diagPlayerId(
      store.playerId ? `${store.playerId.slice(0, 8)}…` : strings.ui.settings.notLoggedIn,
    ),
    strings.ui.settings.diagRoom(store.room?.name ?? strings.ui.settings.noRoom),
  ].join('\n'),
)

// 复制脱敏诊断信息：useCopyWithFeedback 统一处理剪贴板（原生 API + execCommand 降级）与结果提示。
const copyDiagnostics = useCopyWithFeedback({
  text: () => diagnostic.value,
  success: strings.ui.settings.copied,
  failure: strings.ui.settings.copyFailed,
  notify: (text, type) => store.notify(text, type),
})

/**
 * 捕获一个可用的工具快捷键。
 * 统一走 utils/keyboard.ts 的「无修饰键单字符」判定，与对局内触发匹配（useShortcuts）严格一致；
 * 重复键会被拒绝，避免一次按键对应多个工具；输入框本身只展示结果，不接收普通文本编辑。
 */
function captureShortcut(setting: ShortcutSettingKey, event: KeyboardEvent): void {
  if (!isUnmodifiedPrintableKey(event)) {
    shortcutError.value = strings.ui.settings.shortcutErrorSimple
    return
  }
  const next = normalizedShortcut(event.key)
  const conflict = shortcutRows.find(
    (row) => row.setting !== setting && store.settings[row.setting].toLocaleLowerCase() === next,
  )
  if (conflict) {
    shortcutError.value = strings.ui.settings.shortcutErrorConflict(next, conflict.name)
    return
  }
  store.settings[setting] = next
  store.saveSettings()
  playInteractionSound('select')
  shortcutError.value = ''
}

function goBack(): void {
  playInteractionSound('activate')
  emit('back')
}
</script>

<template>
  <!-- 设置子页骨架：顶栏 + 下方左右两栏（左侧导航 / 右侧正文：声音/显示/快捷键/资料诊断） -->
  <main class="grid h-full grid-rows-[11%_minmax(0,1fr)] bg-sky">
    <!-- 顶栏：复用 StageHeader 统一步调骨架，返回动作可配置。 -->
    <StageHeader>
      <template #leading>
        <StageHeaderButton @click="goBack">
          <ArrowLeft />
          <span>{{ props.backLabel }}</span>
        </StageHeaderButton>
      </template>
      <template #center>
        <div class="text-center">
          <p class="eyebrow-light">
            {{ strings.ui.settings.label }}
          </p>
          <h1 class="text-fs-20">{{ strings.ui.settings.title }}</h1>
        </div>
      </template>
      <template #trailing>
        <!-- 右上角插槽：由使用场景自行决定内容（如对局内设置页放「退出游戏」按钮） -->
        <slot name="header-status" />
      </template>
    </StageHeader>

    <!-- 下方两栏：左侧分类导航（声音 / 显示与操作 / 快捷键 / 资料与诊断），右侧对应正文。
         导航列取「15% 与 11em 的较大值」：低高度舞台下 15% 会窄到把条目文字截断，需保底宽度。 -->
    <div class="grid min-h-0 grid-cols-[minmax(11em,15%)_minmax(0,1fr)]">
      <SideNav v-model="tab" :items="navItems" :label="strings.a11y.settings.categoryAria" />
      <!-- 正文区：内容高度由设置项自然撑开；relative 保留为一般定位锚点 -->
      <div class="relative min-h-0 min-w-0">
        <!-- 声音设置 -->
        <AudioTab v-if="tab === 'audio'" />
        <!-- 显示与操作设置 -->
        <AccessibilityTab v-else-if="tab === 'accessibility'" />
        <!-- 快捷键设置 -->
        <ShortcutsTab
          v-else-if="tab === 'shortcuts'"
          :rows="shortcutRows"
          :error="shortcutError"
          @capture="captureShortcut"
        />
        <!-- 资料与诊断 -->
        <DiagnosticsTab
          v-else
          :diagnostic="diagnostic"
          :profile-editing-disabled="props.profileEditingDisabled"
          @copy="copyDiagnostics"
        />
      </div>
    </div>
  </main>
</template>
