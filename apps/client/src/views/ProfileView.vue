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
  <main class="grid h-full grid-cols-[43%_57%]">
    <section
      class="relative flex flex-col items-start justify-center overflow-hidden bg-navy px-[7cqw] py-[8cqh] text-white before:absolute before:right-[-12cqh] before:top-[-10cqh] before:h-[34cqh] before:w-[34cqh] before:rounded-full before:border-[0.5cqh] before:border-[#ffffff18] before:content-[''] after:absolute after:bottom-[-7cqh] after:left-[-9cqh] after:h-[22cqh] after:w-[22cqh] after:rounded-full after:border-[0.5cqh] after:border-[#ffffff18] after:content-['']"
      :aria-label="strings.profile.brandAria"
    >
      <div
        class="relative h-[13cqh] w-[13cqh] rounded-[2.4cqh] border-[0.55cqh] border-white bg-yellow shadow-[0.8cqh_0.8cqh_0_#0f172a55] -rotate-3"
        aria-hidden="true"
      >
        <span
          class="absolute left-[3.1cqh] top-[1.6cqh] h-[9cqh] w-[2.3cqh] rounded-full border-[0.35cqh] border-navy bg-orange rotate-[38deg]"
        ></span
        ><span
          class="absolute right-[1.2cqh] top-[1.2cqh] grid h-[4.5cqh] w-[4.5cqh] place-items-center rounded-full bg-blue text-white text-[1.7em] font-[1000]"
          >?</span
        >
      </div>
      <p class="mt-[3cqh] font-black tracking-[0.16em] text-[0.72em] text-[#93c5fd]">
        {{ strings.profile.brandEyebrow }}
      </p>
      <h1 class="mt-[0.8cqh] text-[3.5em]">{{ store.config.app.name }}</h1>
      <p class="mx-0 mb-[3.2cqh] mt-[1.8cqh] max-w-[25em] leading-[1.8] text-[#dbeafe]">
        {{ strings.profile.brandCopy }}
      </p>
      <div
        class="inline-flex items-center gap-[0.55em] rounded-full px-[1.05em] py-[0.65cqh] text-[0.8em] font-extrabold"
        :class="store.connected ? 'text-[#14532d] bg-[#dcfce7]' : 'text-[#991b1b] bg-[#fee2e2]'"
      >
        <Wifi v-if="store.connected" /><WifiOff v-else />
        <span>{{ store.connectionLabel }}</span>
      </div>
    </section>

    <section
      class="flex flex-col justify-center bg-paper px-[7cqw] pt-[5cqh] pb-[4cqh]"
      aria-labelledby="profile-title"
    >
      <header class="mb-[2.7cqh] flex items-center justify-between">
        <div>
          <p class="text-blue font-black tracking-[0.16em] text-[0.72em]">
            {{ strings.profile.sectionLabel }}
          </p>
          <h2 id="profile-title" class="mt-[0.5cqh] text-[1.8em]">
            {{ strings.profile.sectionTitle }}
          </h2>
        </div>
        <button
          class="flex items-center gap-[0.5em] bg-transparent text-blue font-extrabold"
          type="button"
          :aria-label="strings.profile.randomizeAria"
          @click="randomize"
        >
          <RefreshCw /> {{ strings.profile.randomize }}
        </button>
      </header>

      <!-- 大头像位于资料区顶部；整个圆形按钮均可打开头像选择弹窗。 -->
      <div class="flex flex-col items-center mb-[2.2cqh]">
        <span class="mb-[0.65cqh] block text-slate-700 font-extrabold">{{
          strings.profile.avatarLabel
        }}</span>
        <button
          class="flex flex-col items-center gap-[0.8cqh] bg-transparent text-blue text-[0.76em] font-black"
          type="button"
          :aria-label="strings.profile.changeAvatarAria"
          @click="showAvatarPicker = true"
        >
          <AvatarImage
            :avatar-id="store.profile.avatarId"
            :label="strings.common.myAvatarAria"
            class="h-[15cqh] w-[15cqh]"
          />
          <span>{{ strings.profile.changeAvatar }}</span>
        </button>
      </div>

      <!-- 昵称位于头像下方，保留自定义输入和 Enter 提交。 -->
      <label class="mb-[0.65cqh] block text-slate-700 font-extrabold" for="nickname">{{
        strings.profile.nicknameLabel
      }}</label>
      <div class="relative flex">
        <input
          id="nickname"
          v-model="store.profile.nickname"
          class="w-full min-w-0 h-[5.2cqh] rounded-[0.7em] border-[0.2cqh] border-line bg-white px-[1em] font-bold text-ink pr-[3em] text-[1.05em]"
          :maxlength="store.config.player.nicknameMaxLength"
          autocomplete="nickname"
          @keydown.enter="nicknameValid && store.connected && store.register()"
        />
        <CheckCircle2
          v-if="nicknameValid"
          class="absolute right-[1em] top-1/2 -translate-y-1/2 text-green"
          :aria-label="strings.profile.nicknameValidAria"
        />
      </div>
      <p class="mt-[0.6cqh] text-muted text-[0.74em]">
        {{
          strings.profile.nicknameHelp(
            store.config.player.nicknameMinLength,
            store.config.player.nicknameMaxLength,
          )
        }}
      </p>

      <button
        class="mt-[2.5cqh] inline-flex min-h-[5.2cqh] w-full items-center justify-center gap-[0.65em] rounded-[0.7em] px-[1.35em] font-black text-white bg-blue"
        type="button"
        :disabled="!nicknameValid || !store.connected || store.busy"
        @click="store.register()"
      >
        {{ store.busy ? strings.profile.busy : strings.profile.enterLobby }}<ArrowRight />
      </button>
      <p v-if="!store.connected" class="mt-[0.75cqh] text-[#b91c1c] text-[0.72em] font-bold">
        {{ strings.profile.offlineWarning }}
      </p>
    </section>

    <AvatarPickerDialog
      v-model="store.profile.avatarId"
      :open="showAvatarPicker"
      @close="showAvatarPicker = false"
    />
  </main>
</template>
