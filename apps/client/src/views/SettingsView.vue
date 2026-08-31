<!-- 游戏内设置页：使用分页布局避免舞台内长列表和可见滚动条。 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import {
  ArrowLeft,
  Clipboard,
  Brush,
  Eraser,
  Eye,
  Keyboard,
  Music2,
  PaintBucket,
  RotateCcw,
  ShieldCheck,
  SlidersHorizontal,
  Trash2,
  Volume2,
} from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import AvatarImage from '@/components/AvatarImage.vue'
import AvatarPickerDialog from '@/components/AvatarPickerDialog.vue'
import { useGameStore } from '@/stores/game'

const store = useGameStore()
// 当前激活的设置分类标签
const tab = ref<'audio' | 'accessibility' | 'shortcuts' | 'diagnostics'>('audio')
const shortcutError = ref('') // 快捷键错误提示文案
const showAvatarPicker = ref(false) // 资料页复用的内置 SVG 头像选择弹窗
// 可自定义的快捷键设置键名类型
type ShortcutSettingKey = 'penShortcut' | 'eraserShortcut' | 'fillShortcut'

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

/**
 * 复制脱敏后的诊断信息到剪贴板。
 * 局域网 HTTP 属非安全上下文，navigator.clipboard 可能不存在，需降级到 execCommand。
 */
async function copyDiagnostics(): Promise<void> {
  const text = diagnostic.value
  let copied = false
  if (typeof navigator.clipboard?.writeText === 'function') {
    try {
      await navigator.clipboard.writeText(text)
      copied = true
    } catch {
      // 安全上下文内也可能因权限被拒，继续走降级方案
    }
  }
  if (!copied) {
    // 非安全上下文降级：隐藏 textarea + execCommand('copy')
    const textarea = document.createElement('textarea')
    textarea.value = text
    textarea.setAttribute('readonly', '')
    textarea.style.position = 'fixed'
    textarea.style.opacity = '0'
    document.body.appendChild(textarea)
    textarea.select()
    try {
      copied = document.execCommand('copy')
    } catch {
      copied = false
    }
    document.body.removeChild(textarea)
  }
  store.notify(
    copied ? strings.settings.copied : strings.settings.copyFailed,
    copied ? 'success' : 'warning',
  )
}

/**
 * 捕获一个不带修饰键的可打印字符作为工具快捷键。
 * 重复键会被拒绝，避免一次按键对应多个工具；输入框本身只展示结果，不接收普通文本编辑。
 */
function captureShortcut(setting: ShortcutSettingKey, event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey || event.key.trim().length !== 1) {
    shortcutError.value = strings.settings.shortcutErrorSimple
    return
  }
  const next = event.key.toLocaleLowerCase()
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
  <main class="subpage-layout settings-page">
    <!-- 顶栏：返回大厅 / 标题 / 只保存在本机的提示 -->
    <header class="subpage-header">
      <button type="button" @click="store.page = 'lobby'">
        <ArrowLeft /> {{ strings.settings.backToLobby }}
      </button>
      <div>
        <p class="step-label">{{ strings.settings.label }}</p>
        <h1>{{ strings.settings.title }}</h1>
      </div>
      <span><ShieldCheck /> {{ strings.settings.localOnly }}</span>
    </header>
    <!-- 分类标签：声音 / 显示与操作 / 快捷键 / 资料与诊断 -->
    <nav class="tab-strip" :aria-label="strings.settings.categoryAria">
      <button :class="{ active: tab === 'audio' }" type="button" @click="tab = 'audio'">
        <Volume2 />{{ strings.settings.tabAudio }}</button
      ><button
        :class="{ active: tab === 'accessibility' }"
        type="button"
        @click="tab = 'accessibility'"
      >
        <Eye />{{ strings.settings.tabAccessibility }}</button
      ><button :class="{ active: tab === 'shortcuts' }" type="button" @click="tab = 'shortcuts'">
        <Keyboard />{{ strings.settings.tabShortcuts }}</button
      ><button
        :class="{ active: tab === 'diagnostics' }"
        type="button"
        @click="tab = 'diagnostics'"
      >
        <SlidersHorizontal />{{ strings.settings.tabDiagnostics }}
      </button>
    </nav>

    <!-- 声音设置：主音量 / 音效音量 / 背景音乐 / 全部静音 -->
    <section v-if="tab === 'audio'" class="settings-content">
      <div class="settings-intro">
        <Music2 />
        <div>
          <h2>{{ strings.settings.audioTitle }}</h2>
          <p>{{ strings.settings.audioIntro }}</p>
        </div>
      </div>
      <div class="slider-settings">
        <label
          ><span
            ><b>{{ strings.settings.masterVolume }}</b
            ><small>{{ strings.settings.masterVolumeHint }}</small></span
          ><input
            v-model.number="store.settings.masterVolume"
            type="range"
            min="0"
            max="1"
            step="0.05"
            @change="store.saveSettings"
          /><strong>{{ Math.round(store.settings.masterVolume * 100) }}%</strong></label
        >
        <label
          ><span
            ><b>{{ strings.settings.soundVolume }}</b
            ><small>{{ strings.settings.soundVolumeHint }}</small></span
          ><input
            v-model.number="store.settings.soundVolume"
            type="range"
            min="0"
            max="1"
            step="0.05"
            @change="store.saveSettings"
          /><strong>{{ Math.round(store.settings.soundVolume * 100) }}%</strong></label
        >
        <label
          ><span
            ><b>{{ strings.settings.musicVolume }}</b
            ><small>{{ strings.settings.musicVolumeHint }}</small></span
          ><input
            v-model.number="store.settings.musicVolume"
            type="range"
            min="0"
            max="1"
            step="0.05"
            @change="store.saveSettings"
          /><strong>{{ Math.round(store.settings.musicVolume * 100) }}%</strong></label
        >
        <label class="setting-switch"
          ><span
            ><b>{{ strings.settings.muted }}</b
            ><small>{{ strings.settings.mutedHint }}</small></span
          ><input v-model="store.settings.muted" type="checkbox" @change="store.saveSettings"
        /></label>
      </div>
    </section>

    <!-- 显示与操作设置：动画 / 快捷键提示 / 自动聚焦 / 发现与邀请开关 -->
    <section v-else-if="tab === 'accessibility'" class="settings-content accessibility-settings">
      <div class="settings-intro">
        <Eye />
        <div>
          <h2>{{ strings.settings.accessibilityTitle }}</h2>
          <p>{{ strings.settings.accessibilityIntro }}</p>
        </div>
      </div>
      <div class="switch-grid">
        <label
          ><span
            ><b>{{ strings.settings.animations }}</b
            ><small>{{ strings.settings.animationsHint }}</small></span
          ><input
            v-model="store.settings.animationsEnabled"
            type="checkbox"
            @change="store.saveSettings"
        /></label>
        <label
          ><span
            ><b>{{ strings.settings.showShortcuts }}</b
            ><small>{{ strings.settings.showShortcutsHint }}</small></span
          ><input
            v-model="store.settings.showShortcuts"
            type="checkbox"
            @change="store.saveSettings"
        /></label>
        <label
          ><span
            ><b>{{ strings.settings.autoFocus }}</b
            ><small>{{ strings.settings.autoFocusHint }}</small></span
          ><input
            v-model="store.settings.autoFocusGuess"
            type="checkbox"
            @change="store.saveSettings"
        /></label>
        <label
          ><span
            ><b>{{ strings.settings.discoverable }}</b
            ><small>{{ strings.settings.discoverableHint }}</small></span
          ><input
            v-model="store.settings.discoverable"
            type="checkbox"
            @change="store.saveSettings"
        /></label>
        <label
          ><span
            ><b>{{ strings.settings.acceptsInvites }}</b
            ><small>{{ strings.settings.acceptsInvitesHint }}</small></span
          ><input
            v-model="store.settings.acceptsInvites"
            type="checkbox"
            @change="store.saveSettings"
        /></label>
      </div>
    </section>

    <!-- 快捷键设置：三个工具各自捕获一个单键，重复键会报错 -->
    <section v-else-if="tab === 'shortcuts'" class="settings-content shortcut-settings">
      <div class="settings-intro">
        <Keyboard />
        <div>
          <h2>{{ strings.settings.shortcutsTitle }}</h2>
          <p>{{ strings.settings.shortcutsIntro }}</p>
        </div>
      </div>
      <div class="shortcut-grid">
        <label v-for="row in shortcutRows" :key="row.setting">
          <component :is="row.icon" />
          <span
            ><b>{{ row.name }}</b
            ><small>{{ row.detail }}</small></span
          >
          <input
            :value="store.settings[row.setting]"
            type="text"
            readonly
            :aria-label="strings.settings.setShortcutAria(row.name)"
            @keydown.prevent="captureShortcut(row.setting, $event)"
          />
        </label>
      </div>
      <p v-if="shortcutError" class="shortcut-error" role="alert">{{ shortcutError }}</p>
      <p class="shortcut-note">{{ strings.settings.shortcutNote }}</p>
    </section>

    <!-- 资料与诊断：修改大厅资料 / 查看诊断 / 恢复默认与清除资料 -->
    <section v-else class="settings-content diagnostic-content">
      <div class="profile-edit">
        <button
          class="profile-avatar-edit"
          type="button"
          :aria-label="strings.profile.changeAvatarAria"
          @click="showAvatarPicker = true"
        >
          <AvatarImage :avatar-id="store.profile.avatarId" :label="strings.common.myAvatarAria" />
          <span>{{ strings.settings.avatarField }}</span>
        </button>
        <label
          >{{ strings.settings.nicknameField
          }}<input
            v-model="store.profile.nickname"
            :maxlength="store.config.player.nicknameMaxLength"
            class="game-input" /></label
        ><button class="primary-action" type="button" @click="store.updateProfile">
          {{ strings.settings.saveProfile }}
        </button>
      </div>
      <div class="diagnostic-box">
        <h2>{{ strings.settings.diagnosticsTitle }}</h2>
        <pre>{{ diagnostic }}</pre>
        <button class="secondary-action" type="button" @click="copyDiagnostics">
          <Clipboard />{{ strings.settings.copyDiagnostics }}
        </button>
      </div>
      <div class="destructive-settings">
        <button type="button" @click="store.resetSettings">
          <RotateCcw />{{ strings.settings.resetSettings }}</button
        ><button class="danger-action" type="button" @click="store.clearProfile">
          <Trash2 />{{ strings.settings.clearProfile }}
        </button>
      </div>
    </section>

    <AvatarPickerDialog
      v-model="store.profile.avatarId"
      :open="showAvatarPicker"
      @close="showAvatarPicker = false"
    />
  </main>
</template>
