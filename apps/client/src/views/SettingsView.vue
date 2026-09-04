<!-- 游戏内设置页：使用分页布局避免舞台内长列表和可见滚动条。 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowLeft,
  Brush,
  Eraser,
  Eye,
  Keyboard,
  PaintBucket,
  SlidersHorizontal,
  Volume2,
} from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { useGameStore } from '@/stores/game'
import { useCopyWithFeedback } from '@/composables/useCopyWithFeedback'
import {
  isUnmodifiedPrintableKey,
  normalizedShortcut,
  type ShortcutSettingKey,
} from '@/utils/keyboard'
import AudioTab from '@/components/settings/AudioTab.vue'
import AccessibilityTab from '@/components/settings/AccessibilityTab.vue'
import ShortcutsTab from '@/components/settings/ShortcutsTab.vue'
import DiagnosticsTab from '@/components/settings/DiagnosticsTab.vue'

const store = useGameStore()
const props = withDefaults(
  defineProps<{
    /** 返回按钮可由使用场景替换为“返回大厅”“返回游戏”等文案。 */
    backLabel?: string
    /** 对局内禁止修改昵称、头像或清除资料，其它本地设置仍可使用。 */
    profileEditingDisabled?: boolean
  }>(),
  {
    backLabel: strings.settings.backToLobby,
    profileEditingDisabled: false,
  },
)
const emit = defineEmits<{
  back: []
}>()
// 当前激活的设置分类标签
const tab = ref<'audio' | 'accessibility' | 'shortcuts' | 'diagnostics'>('audio')
// 分类标签数据驱动渲染：收敛四个重复的长类名按钮，图标/文案/键值集中一处维护
const tabs: Array<{ key: typeof tab.value; label: string; icon: typeof Volume2 }> = [
  { key: 'audio', label: strings.settings.tabAudio, icon: Volume2 },
  { key: 'accessibility', label: strings.settings.tabAccessibility, icon: Eye },
  { key: 'shortcuts', label: strings.settings.tabShortcuts, icon: Keyboard },
  { key: 'diagnostics', label: strings.settings.tabDiagnostics, icon: SlidersHorizontal },
]
const shortcutError = ref('') // 快捷键错误提示文案
const showAvatarPicker = ref(false) // 资料页复用的内置 SVG 头像选择弹窗

// 快捷键配置行：设置键、中文名（来自 strings）、说明与图标
const shortcutRows: Array<{
  setting: ShortcutSettingKey
  name: string
  detail: string
  icon: typeof Brush
}> = [
  {
    setting: 'penShortcut',
    name: strings.settings.pen,
    detail: strings.settings.penDetail,
    icon: Brush,
  },
  {
    setting: 'eraserShortcut',
    name: strings.settings.eraser,
    detail: strings.settings.eraserDetail,
    icon: Eraser,
  },
  {
    setting: 'fillShortcut',
    name: strings.settings.fill,
    detail: strings.settings.fillDetail,
    icon: PaintBucket,
  },
]

// 诊断信息：当前页面来源（host）作为服务地址展示
const serverAddress = location.origin
// 汇总连接与身份诊断文本，供一键复制排障（统一文案来自 strings.settings.diag*）
const diagnostic = computed(() =>
  [
    strings.settings.diagAppLine(store.config.app.name, store.config.app.version),
    strings.settings.diagProtocol(store.config.app.protocolVersion),
    strings.settings.diagAddress(serverAddress),
    strings.settings.diagConnection(store.connectionLabel),
    strings.settings.diagLatency(
      store.latency ? String(store.latency) : strings.settings.unknownLatency,
    ),
    strings.settings.diagPlayerId(
      store.playerId ? `${store.playerId.slice(0, 8)}…` : strings.settings.notLoggedIn,
    ),
    strings.settings.diagRoom(store.room?.name ?? strings.settings.noRoom),
  ].join('\n'),
)

// 复制脱敏诊断信息：useCopyWithFeedback 统一处理剪贴板（原生 API + execCommand 降级）与结果提示。
const copyDiagnostics = useCopyWithFeedback({
  text: () => diagnostic.value,
  success: strings.settings.copied,
  failure: strings.settings.copyFailed,
  notify: (text, type) => store.notify(text, type),
})

/**
 * 捕获一个可用的工具快捷键。
 * 统一走 utils/keyboard.ts 的「无修饰键单字符」判定，与对局内触发匹配（useShortcuts）严格一致；
 * 重复键会被拒绝，避免一次按键对应多个工具；输入框本身只展示结果，不接收普通文本编辑。
 */
function captureShortcut(setting: ShortcutSettingKey, event: KeyboardEvent): void {
  if (!isUnmodifiedPrintableKey(event)) {
    shortcutError.value = strings.settings.shortcutErrorSimple
    return
  }
  const next = normalizedShortcut(event.key)
  const conflict = shortcutRows.find(
    (row) => row.setting !== setting && store.settings[row.setting].toLocaleLowerCase() === next,
  )
  if (conflict) {
    shortcutError.value = strings.settings.shortcutErrorConflict(next, conflict.name)
    return
  }
  store.settings[setting] = next
  store.saveSettings()
  shortcutError.value = ''
}
</script>

<template>
  <!-- 设置子页骨架：顶栏 + 标签栏 + 正文四段（声音/显示/快捷键/资料诊断） -->
  <main class="grid h-full grid-rows-[11%_9%_minmax(0,1fr)] bg-sky">
    <!-- 顶栏：返回动作可配置，header-actions 插槽可按使用场景追加按钮。 -->
    <header
      class="grid grid-cols-[1fr_auto_1fr] items-center border-b-[0.45cqh] border-yellow bg-navy px-[2cqw] text-white"
    >
      <div class="justify-self-start flex items-center gap-[0.6em]">
        <button
          type="button"
          class="flex items-center gap-[0.45em] rounded-[0.55em] bg-white/10 px-[0.8em] py-[0.8cqh] text-white"
          @click="emit('back')"
        >
          <ArrowLeft /> {{ props.backLabel }}
        </button>
        <slot name="header-actions" />
      </div>
      <div class="text-center">
        <p class="eyebrow-light">
          {{ strings.settings.label }}
        </p>
        <h1 class="text-[1.25em]">{{ strings.settings.title }}</h1>
      </div>
      <div class="justify-self-end">
        <!-- 右上角插槽：由使用场景自行决定内容（如对局内设置页放「退出游戏」按钮） -->
        <slot name="header-status" />
      </div>
    </header>
    <!-- 分类标签：声音 / 显示与操作 / 快捷键 / 资料与诊断（数据驱动，统一样式） -->
    <nav
      class="flex justify-center gap-[0.5em] border-b-[0.18cqh] border-line bg-white p-[1cqh]"
      :aria-label="strings.settings.categoryAria"
    >
      <button
        v-for="item in tabs"
        :key="item.key"
        type="button"
        class="bg-transparent flex min-w-[13cqw] items-center justify-center gap-[0.45em] border-b-[0.35cqh] border-transparent font-extrabold text-muted"
        :class="{ 'border-b-blue! text-blue!': tab === item.key }"
        @click="tab = item.key"
      >
        <component :is="item.icon" />{{ item.label }}
      </button>
    </nav>

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
      :server-address="serverAddress"
      :show-avatar-picker="showAvatarPicker"
      :profile-editing-disabled="props.profileEditingDisabled"
      @update:show-avatar-picker="showAvatarPicker = $event"
      @copy="copyDiagnostics"
    />
  </main>
</template>
