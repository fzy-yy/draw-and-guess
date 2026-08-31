<!-- 玩家资料确认页：随机昵称与纯色圆形头像均来自根级公开配置，不提供任何图片上传入口。 -->
<script setup lang="ts">
import { computed } from 'vue'
import { ArrowRight, CheckCircle2, RefreshCw, Wifi, WifiOff } from 'lucide-vue-next'
import { useGameStore } from '@/stores/game'

const store = useGameStore()

/** 昵称按 Unicode 码点计数，避免中文或组合字符被 UTF-16 长度误判。 */
const nicknameValid = computed(() => {
  const length = Array.from(store.profile.nickname.trim()).length
  return (
    length >= store.config.player.nicknameMinLength &&
    length <= store.config.player.nicknameMaxLength
  )
})

/** 同时重抽昵称和预设头像色；任意色仍可通过下方原生取色器修改。 */
function randomize(): void {
  const names = store.config.player.defaultNicknames
  const colors = store.config.player.avatarColors
  store.profile.nickname = names[Math.floor(Math.random() * names.length)] ?? names[0]
  store.profile.avatarColor =
    colors[Math.floor(Math.random() * colors.length)] ?? store.config.player.defaultAvatarColor
}
</script>

<template>
  <!-- 玩家资料确认页：左侧品牌介绍，右侧资料表单 -->
  <main class="profile-layout">
    <!-- 品牌区：游戏名、宣传语、连接状态 -->
    <section class="brand-zone" aria-label="游戏介绍">
      <div class="brand-mark" aria-hidden="true">
        <span class="brand-pencil"></span><span class="brand-bubble">?</span>
      </div>
      <p class="eyebrow">局域网派对游戏</p>
      <h1>{{ store.config.app.name }}</h1>
      <p class="brand-copy">一人作画，大家来猜。连接同一主机服务即可实时加入。</p>
      <!-- 连接状态徽章：在线/离线 -->
      <div class="connection-chip" :class="{ online: store.connected }">
        <Wifi v-if="store.connected" /><WifiOff v-else />
        <span>{{ store.connectionLabel }}</span>
      </div>
    </section>

    <!-- 资料面板：昵称与纯色头像编辑 -->
    <section class="profile-panel" aria-labelledby="profile-title">
      <header class="section-heading compact">
        <div>
          <p class="step-label">PLAYER PROFILE</p>
          <h2 id="profile-title">准备好你的角色</h2>
        </div>
        <!-- 一键随机昵称与头像色 -->
        <button
          class="icon-text-button"
          type="button"
          aria-label="重新随机昵称与头像颜色"
          @click="randomize"
        >
          <RefreshCw /> 换一组
        </button>
      </header>

      <!-- 昵称输入：右侧显示有效性对勾 -->
      <label class="field-label" for="nickname">昵称</label>
      <div class="nickname-row">
        <input
          id="nickname"
          v-model="store.profile.nickname"
          class="game-input"
          :maxlength="store.config.player.nicknameMaxLength"
          autocomplete="nickname"
          @keydown.enter="nicknameValid && store.connected && store.register()"
        />
        <CheckCircle2 v-if="nicknameValid" class="valid-icon" aria-label="昵称有效" />
      </div>
      <p class="field-help">
        {{ store.config.player.nicknameMinLength }}～{{ store.config.player.nicknameMaxLength }}
        个可见字符，在线重名会自动添加数字。
      </p>

      <!-- 头像编辑：预览 + 预设色 + 任意取色器 -->
      <div class="avatar-label-row">
        <span class="field-label">纯色圆形头像</span><span>{{ store.profile.avatarColor }}</span>
      </div>
      <div class="avatar-color-editor">
        <div
          class="avatar-preview"
          :style="{ backgroundColor: store.profile.avatarColor }"
          aria-label="当前头像颜色"
        ></div>
        <div class="avatar-color-grid" role="radiogroup" aria-label="头像预设颜色">
          <button
            v-for="paint in store.config.player.avatarColors"
            :key="paint"
            class="avatar-color-option"
            :class="{ selected: store.profile.avatarColor.toUpperCase() === paint }"
            :style="{ backgroundColor: paint }"
            type="button"
            role="radio"
            :aria-checked="store.profile.avatarColor.toUpperCase() === paint"
            :aria-label="`选择头像颜色 ${paint}`"
            @click="store.profile.avatarColor = paint"
          ></button>
        </div>
        <label class="avatar-color-picker">
          <span>任意颜色</span>
          <input v-model="store.profile.avatarColor" type="color" aria-label="选择任意头像颜色" />
        </label>
      </div>

      <!-- 进入大厅：昵称有效且已连接才可点击 -->
      <button
        class="primary-action enter-action"
        type="button"
        :disabled="!nicknameValid || !store.connected || store.busy"
        @click="store.register"
      >
        {{ store.busy ? '正在登记身份…' : '进入在线大厅' }}<ArrowRight />
      </button>
      <!-- 未连接时的内联警告 -->
      <p v-if="!store.connected" class="inline-warning">
        无法进入：请确认主机服务已启动，地址和端口正确，并检查防火墙。
      </p>
    </section>
  </main>
</template>
