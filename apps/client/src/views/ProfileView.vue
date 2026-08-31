<!-- 玩家资料确认页：昵称与头像均来自公开配置，头像只允许选择内置 SVG 资源。 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, CheckCircle2, RefreshCw, Wifi, WifiOff } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import AvatarImage from '@/components/AvatarImage.vue'
import AvatarPickerDialog from '@/components/AvatarPickerDialog.vue'
import { useGameStore } from '@/stores/game'

const store = useGameStore()
const showAvatarPicker = ref(false)

/** 昵称按 Unicode 码点计数，避免中文或组合字符被 UTF-16 长度误判。 */
const nicknameValid = computed(() => {
  const length = Array.from(store.profile.nickname.trim()).length
  return (
    length >= store.config.player.nicknameMinLength &&
    length <= store.config.player.nicknameMaxLength
  )
})

/** 同时重抽昵称和内置 SVG 头像；随机结果始终来自前后端共享白名单。 */
function randomize(): void {
  const names = store.config.player.defaultNicknames
  const avatars = store.config.player.avatarIds
  store.profile.nickname = names[Math.floor(Math.random() * names.length)] ?? names[0]
  store.profile.avatarId =
    avatars[Math.floor(Math.random() * avatars.length)] ?? store.config.player.defaultAvatarId
}
</script>

<template>
  <!-- 玩家资料确认页：左侧品牌介绍，右侧头像在上、昵称在下的资料表单。 -->
  <main class="profile-layout">
    <section class="brand-zone" :aria-label="strings.profile.brandAria">
      <div class="brand-mark" aria-hidden="true">
        <span class="brand-pencil"></span><span class="brand-bubble">?</span>
      </div>
      <p class="eyebrow">{{ strings.profile.brandEyebrow }}</p>
      <h1>{{ store.config.app.name }}</h1>
      <p class="brand-copy">{{ strings.profile.brandCopy }}</p>
      <div class="connection-chip" :class="{ online: store.connected }">
        <Wifi v-if="store.connected" /><WifiOff v-else />
        <span>{{ store.connectionLabel }}</span>
      </div>
    </section>

    <section class="profile-panel" aria-labelledby="profile-title">
      <header class="section-heading compact">
        <div>
          <p class="step-label">{{ strings.profile.sectionLabel }}</p>
          <h2 id="profile-title">{{ strings.profile.sectionTitle }}</h2>
        </div>
        <button
          class="icon-text-button"
          type="button"
          :aria-label="strings.profile.randomizeAria"
          @click="randomize"
        >
          <RefreshCw /> {{ strings.profile.randomize }}
        </button>
      </header>

      <!-- 大头像位于资料区顶部；整个圆形按钮均可打开头像选择弹窗。 -->
      <div class="profile-avatar-section">
        <span class="field-label">{{ strings.profile.avatarLabel }}</span>
        <button
          class="profile-avatar-trigger"
          type="button"
          :aria-label="strings.profile.changeAvatarAria"
          @click="showAvatarPicker = true"
        >
          <AvatarImage :avatar-id="store.profile.avatarId" :label="strings.common.myAvatarAria" />
          <span>{{ strings.profile.changeAvatar }}</span>
        </button>
      </div>

      <!-- 昵称位于头像下方，保留自定义输入和 Enter 提交。 -->
      <label class="field-label" for="nickname">{{ strings.profile.nicknameLabel }}</label>
      <div class="nickname-row">
        <input
          id="nickname"
          v-model="store.profile.nickname"
          class="game-input"
          :maxlength="store.config.player.nicknameMaxLength"
          autocomplete="nickname"
          @keydown.enter="nicknameValid && store.connected && store.register()"
        />
        <CheckCircle2
          v-if="nicknameValid"
          class="valid-icon"
          :aria-label="strings.profile.nicknameValidAria"
        />
      </div>
      <p class="field-help">
        {{
          strings.profile.nicknameHelp(
            store.config.player.nicknameMinLength,
            store.config.player.nicknameMaxLength,
          )
        }}
      </p>

      <button
        class="primary-action enter-action"
        type="button"
        :disabled="!nicknameValid || !store.connected || store.busy"
        @click="store.register"
      >
        {{ store.busy ? strings.profile.busy : strings.profile.enterLobby }}<ArrowRight />
      </button>
      <p v-if="!store.connected" class="inline-warning">{{ strings.profile.offlineWarning }}</p>
    </section>

    <AvatarPickerDialog
      v-model="store.profile.avatarId"
      :open="showAvatarPicker"
      @close="showAvatarPicker = false"
    />
  </main>
</template>
