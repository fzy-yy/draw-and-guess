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
import { useGameStore } from '@/stores/game'

const store = useGameStore()
// 当前激活的设置分类标签
const tab = ref<'audio' | 'accessibility' | 'shortcuts' | 'diagnostics'>('audio')
const shortcutError = ref('') // 快捷键错误提示文案
// 可自定义的快捷键设置键名类型
type ShortcutSettingKey = 'penShortcut' | 'eraserShortcut' | 'fillShortcut'

// 快捷键配置行：设置键、中文名、说明与图标
const shortcutRows: Array<{
  setting: ShortcutSettingKey
  name: string
  detail: string
  icon: typeof Brush
}> = [
  { setting: 'penShortcut', name: '画笔', detail: '切换到自由画笔', icon: Brush },
  { setting: 'eraserShortcut', name: '橡皮擦', detail: '切换到橡皮擦并沿用当前粗细', icon: Eraser },
  {
    setting: 'fillShortcut',
    name: '区域填充',
    detail: '填充点击位置的封闭区域',
    icon: PaintBucket,
  },
]

// 诊断信息：当前页面来源（host）作为服务地址展示
const serverAddress = location.origin
// 汇总连接与身份诊断文本，供一键复制排障
const diagnostic = computed(() =>
  [
    `${store.config.app.name} ${store.config.app.version}`,
    `协议版本：${store.config.app.protocolVersion}`,
    `服务地址：${serverAddress}`,
    `连接状态：${store.connectionLabel}`,
    `近似延迟：${store.latency || '未知'}ms`,
    `玩家 ID：${store.playerId ? `${store.playerId.slice(0, 8)}…` : '未登录'}`,
    `房间：${store.room?.name ?? '无'}`,
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
    copied ? '脱敏诊断信息已复制' : '当前环境不支持复制，请手动选择文本',
    copied ? 'success' : 'warning',
  )
}

/**
 * 捕获一个不带修饰键的可打印字符作为工具快捷键。
 * 重复键会被拒绝，避免一次按键对应多个工具；输入框本身只展示结果，不接收普通文本编辑。
 */
function captureShortcut(setting: ShortcutSettingKey, event: KeyboardEvent): void {
  if (event.ctrlKey || event.metaKey || event.altKey || event.key.trim().length !== 1) {
    shortcutError.value = '请直接按一个字母、数字或符号，不要组合 Ctrl、Alt 或 Command。'
    return
  }
  const next = event.key.toLocaleLowerCase()
  const conflict = shortcutRows.find(
    (row) => row.setting !== setting && store.settings[row.setting].toLocaleLowerCase() === next,
  )
  if (conflict) {
    shortcutError.value = `“${next}”已用于${conflict.name}，请换一个按键。`
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
      <button type="button" @click="store.page = 'lobby'"><ArrowLeft /> 返回大厅</button>
      <div>
        <p class="step-label">SETTINGS</p>
        <h1>游戏设置</h1>
      </div>
      <span><ShieldCheck /> 设置仅保存在本机</span>
    </header>
    <!-- 分类标签：声音 / 显示与操作 / 快捷键 / 资料与诊断 -->
    <nav class="tab-strip" aria-label="设置分类">
      <button :class="{ active: tab === 'audio' }" type="button" @click="tab = 'audio'">
        <Volume2 />声音</button
      ><button
        :class="{ active: tab === 'accessibility' }"
        type="button"
        @click="tab = 'accessibility'"
      >
        <Eye />显示与操作</button
      ><button :class="{ active: tab === 'shortcuts' }" type="button" @click="tab = 'shortcuts'">
        <Keyboard />快捷键</button
      ><button
        :class="{ active: tab === 'diagnostics' }"
        type="button"
        @click="tab = 'diagnostics'"
      >
        <SlidersHorizontal />资料与诊断
      </button>
    </nav>

    <!-- 声音设置：主音量 / 音效音量 / 背景音乐 / 全部静音 -->
    <section v-if="tab === 'audio'" class="settings-content">
      <div class="settings-intro">
        <Music2 />
        <div>
          <h2>声音反馈</h2>
          <p>所有音量会乘以主音量；浏览器首次交互前不会强制播放。</p>
        </div>
      </div>
      <div class="slider-settings">
        <label
          ><span><b>主音量</b><small>控制游戏全部声音</small></span
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
          ><span><b>音效音量</b><small>倒计时、猜中、邀请等反馈</small></span
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
          ><span><b>背景音乐</b><small>轻量大厅和结算音乐</small></span
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
          ><span><b>全部静音</b><small>视觉反馈仍会保留</small></span
          ><input v-model="store.settings.muted" type="checkbox" @change="store.saveSettings"
        /></label>
      </div>
    </section>

    <!-- 显示与操作设置：色觉友好 / 快捷键提示 / 自动聚焦 / 发现与邀请开关 -->
    <section v-else-if="tab === 'accessibility'" class="settings-content accessibility-settings">
      <div class="settings-intro">
        <Eye />
        <div>
          <h2>显示与便捷操作</h2>
          <p>关键状态始终同时使用文字或图标，不仅依赖颜色。</p>
        </div>
      </div>
      <div class="switch-grid">
        <label
          ><span><b>色觉友好调色板</b><small>调整准备与警告的辅助色</small></span
          ><input
            v-model="store.settings.colorFriendly"
            type="checkbox"
            @change="store.saveSettings"
        /></label>
        <label
          ><span><b>显示快捷键提示</b><small>在画板工具旁显示组合键</small></span
          ><input
            v-model="store.settings.showShortcuts"
            type="checkbox"
            @change="store.saveSettings"
        /></label>
        <label
          ><span><b>自动聚焦猜词框</b><small>新回合作画开始时方便直接输入</small></span
          ><input
            v-model="store.settings.autoFocusGuess"
            type="checkbox"
            @change="store.saveSettings"
        /></label>
        <label
          ><span><b>允许在线发现</b><small>关闭后不出现在当前服务的发现列表</small></span
          ><input
            v-model="store.settings.discoverable"
            type="checkbox"
            @change="store.saveSettings"
        /></label>
        <label
          ><span><b>接收房间邀请</b><small>关闭后其他玩家不能定向邀请你</small></span
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
          <h2>画板工具快捷键</h2>
          <p>点击输入框后直接按下新按键；猜词框或其他输入控件聚焦时不会切换工具。</p>
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
            :aria-label="`设置${row.name}快捷键`"
            @keydown.prevent="captureShortcut(row.setting, $event)"
          />
        </label>
      </div>
      <p v-if="shortcutError" class="shortcut-error" role="alert">{{ shortcutError }}</p>
      <p class="shortcut-note">
        撤销固定为 Ctrl/Command + Z，重做固定为 Ctrl/Command + Shift + Z 或 Ctrl/Command + Y。
      </p>
    </section>

    <!-- 资料与诊断：修改大厅资料 / 查看诊断 / 恢复默认与清除资料 -->
    <section v-else class="settings-content diagnostic-content">
      <div class="profile-edit">
        <span
          class="solid-avatar profile-solid-avatar"
          :style="{ backgroundColor: store.profile.avatarColor }"
          aria-label="我的纯色头像"
        ></span
        ><label
          >大厅昵称<input
            v-model="store.profile.nickname"
            :maxlength="store.config.player.nicknameMaxLength"
            class="game-input" /></label
        ><label class="profile-color-field"
          >头像颜色<input
            v-model="store.profile.avatarColor"
            type="color"
            aria-label="修改头像颜色" /></label
        ><button class="primary-action" type="button" @click="store.updateProfile">保存资料</button>
      </div>
      <div class="diagnostic-box">
        <h2>关于与连接诊断</h2>
        <pre>{{ diagnostic }}</pre>
        <button class="secondary-action" type="button" @click="copyDiagnostics">
          <Clipboard />复制诊断信息
        </button>
      </div>
      <div class="destructive-settings">
        <button type="button" @click="store.resetSettings"><RotateCcw />恢复本地默认设置</button
        ><button class="danger-action" type="button" @click="store.clearProfile">
          <Trash2 />清除本地资料
        </button>
      </div>
    </section>
  </main>
</template>
