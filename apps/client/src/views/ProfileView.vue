<!-- 玩家资料确认页：昵称与头像均来自公开配置，头像只允许选择内置 SVG 资源。 -->
<script setup lang="ts">
import { computed, ref } from 'vue'
import { ArrowRight, CheckCircle2, RefreshCw, Wifi, WifiOff } from 'lucide-vue-next'
import { strings } from '@draw-guess/strings'
import { countGraphemes } from '@draw-guess/shared'
import { AppButton, AppInput, AvatarImage, AvatarPickerDialog } from '@/components/common'
import { useGameStore } from '@/stores/game'

const store = useGameStore()
const showAvatarPicker = ref(false)

/** 昵称按 Unicode 码点计数，避免中文或组合字符被 UTF-16 长度误判。 */
const nicknameValid = computed(() => {
  const length = countGraphemes(store.profile.nickname.trim())
  return (
    length >= store.config.player.nicknameMinLength &&
    length <= store.config.player.nicknameMaxLength
  )
})

/** 同时重抽昵称和内置 SVG 头像；随机收敛到 store.randomizeProfile，保证与初始随机同一白名单来源。 */
function randomize(): void {
  store.randomizeProfile()
}
</script>

<template>
  <!-- 玩家资料确认页：左侧品牌介绍，右侧头像在上、昵称在下的资料表单。
       relative：为懒加载弹窗的 loading/error 占位提供定位容器（见 utils/lazy-component.ts）。 -->
  <main class="relative grid h-full grid-cols-[43%_57%]">
    <section
      class="relative flex flex-col items-start justify-center overflow-hidden bg-navy px-[7cqw] py-[8cqh] text-white before:absolute before:right-[-12cqh] before:top-[-10cqh] before:h-[34cqh] before:w-[34cqh] before:rounded-full before:border-[0.5cqh] before:border-white/10 before:content-[''] after:absolute after:bottom-[-7cqh] after:left-[-9cqh] after:h-[22cqh] after:w-[22cqh] after:rounded-full after:border-[0.5cqh] after:border-white/10 after:content-['']"
      :aria-label="strings.profile.brandAria"
    >
      <div
        class="relative h-[13cqh] w-[13cqh] rounded-[2.4cqh] border-[0.55cqh] border-white bg-yellow shadow-block -rotate-3"
        aria-hidden="true"
      >
        <span
          class="absolute left-[3.1cqh] top-[1.6cqh] h-[9cqh] w-[2.3cqh] rounded-full border-[0.35cqh] border-navy bg-yellow rotate-38"
        ></span
        ><span
          class="absolute right-[1.2cqh] top-[1.2cqh] grid h-[4.5cqh] w-[4.5cqh] place-items-center rounded-full bg-blue text-white text-fs-28 font-bold"
          >?</span
        >
      </div>
      <p class="mt-[3cqh] eyebrow-light">
        {{ strings.profile.brandEyebrow }}
      </p>
      <h1 class="mt-[0.8cqh] text-fs-48">{{ store.config.app.name }}</h1>
      <p class="mx-0 mb-[3.2cqh] mt-[1.8cqh] max-w-[25em] leading-[1.8] text-sky">
        {{ strings.profile.brandCopy }}
      </p>
      <div
        class="inline-flex items-center gap-[0.55em] rounded-full px-[1.05em] py-[0.65cqh] text-fs-14 font-bold"
        :class="
          store.connected ? 'text-success-on-dark bg-green/10' : 'text-danger-on-dark bg-red/10'
        "
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
          <p class="eyebrow">
            {{ strings.profile.sectionLabel }}
          </p>
          <h2 id="profile-title" class="mt-[0.5cqh] text-fs-28">
            {{ strings.profile.sectionTitle }}
          </h2>
        </div>
        <!-- 换一组：复用统一按钮组件 AppButton（secondary 白底描边），保证与全站按钮风格一致 -->
        <AppButton
          variant="secondary"
          type="button"
          :aria-label="strings.profile.randomizeAria"
          @click="randomize"
        >
          <RefreshCw /> {{ strings.profile.randomize }}
        </AppButton>
      </header>

      <!-- 大头像位于资料区顶部；整个圆形按钮均可打开头像选择弹窗。 -->
      <div class="flex flex-col items-center mb-[2.2cqh]">
        <span class="mb-[0.65cqh] block text-navy font-bold">{{
          strings.profile.avatarLabel
        }}</span>
        <button
          class="flex flex-col items-center gap-[0.8cqh] bg-transparent text-blue text-fs-12 font-bold"
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
      <label class="mb-[0.65cqh] block text-navy font-bold" for="nickname">{{
        strings.profile.nicknameLabel
      }}</label>
      <div>
        <AppInput
          id="nickname"
          v-model="store.profile.nickname"
          align="center"
          input-class="font-bold text-fs-18 text-navy"
          :maxlength="store.config.player.nicknameMaxLength"
          autocomplete="nickname"
          @enter="nicknameValid && store.connected && store.register()"
        >
          <template #suffix>
            <CheckCircle2
              v-if="nicknameValid"
              class="text-success-fg"
              :aria-label="strings.profile.nicknameValidAria"
            />
          </template>
        </AppInput>
      </div>
      <!-- 昵称规则说明：常驻显示（紧凑模式折叠已随布局模式移除）。 -->
      <p class="mt-[0.6cqh] text-muted text-fs-12">
        {{
          strings.profile.nicknameHelp(
            store.config.player.nicknameMinLength,
            store.config.player.nicknameMaxLength,
          )
        }}
      </p>

      <!-- 进入大厅：复用统一按钮组件 AppButton（primary 蓝底），保证与全站按钮风格一致。 -->
      <AppButton
        type="button"
        class="mt-[2.5cqh] w-full"
        :disabled="!nicknameValid || !store.connected || store.busy"
        @click="store.register()"
      >
        {{ store.busy ? strings.profile.busy : strings.profile.enterLobby }}<ArrowRight />
      </AppButton>
      <p v-if="!store.connected" class="mt-[0.75cqh] text-red text-fs-12 font-bold">
        {{ strings.profile.offlineWarning }}
      </p>
    </section>

    <AvatarPickerDialog
      v-model="store.profile.avatarId"
      v-model:open="showAvatarPicker"
      :avatar-ids="store.config.player.avatarIds"
    />
  </main>
</template>
