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
       relative：为头像选择弹窗（AvatarPickerDialog，基于 BaseDialog）的 absolute 遮罩提供定位容器。 -->
  <main class="relative grid h-full grid-cols-[43%_57%]">
    <section
      class="relative flex flex-col items-start justify-center overflow-hidden bg-navy px-[7cqw] py-[8cqh] text-white before:absolute before:right-[-12cqh] before:top-[-10cqh] before:h-[34cqh] before:w-[34cqh] before:rounded-full before:border-[0.5cqh] before:border-white/10 before:content-[''] after:absolute after:bottom-[-7cqh] after:left-[-9cqh] after:h-[22cqh] after:w-[22cqh] after:rounded-full after:border-[0.5cqh] after:border-white/10 after:content-['']"
      :aria-label="strings.a11y.profile.brandAria"
    >
      <!-- 品牌标记：整枚内联 SVG（白描边黄方块 + 深蓝画笔斜条 + 蓝色圆形问号徽标）。
           问号必须画成矢量路径、不能再用文本字形：文本字号带像素下限（text-fs-* 的 max(...) 下限），
           而这里所有尺寸都是 cqh 等比缩放，小窗下两者不同步会让问号溢出/错位；
           几何全进 SVG 用户坐标后，整枚标记严格随舞台缩放。
           rounded-[2.4cqh] 供 shadow-block 贴合圆角（SVG 的盒阴影跟随元素盒而非绘图路径）。 -->
      <svg
        class="h-[13cqh] w-[13cqh] rounded-[2.4cqh] shadow-block -rotate-3"
        viewBox="0 0 100 100"
        aria-hidden="true"
      >
        <rect
          x="2.1"
          y="2.1"
          width="95.8"
          height="95.8"
          rx="16.5"
          class="fill-yellow stroke-white"
          stroke-width="4.2"
        />
        <rect
          x="25.2"
          y="13.7"
          width="15"
          height="66.5"
          rx="7.5"
          class="fill-yellow stroke-navy"
          stroke-width="2.7"
          transform="rotate(38 32.7 46.9)"
        />
        <circle cx="73.5" cy="26.5" r="17.3" class="fill-blue" />
        <!-- 问号几何取自 lucide `circle-help`（24 盒内设计好的字形），按徽标半径 17.3/10 等比放大 -->
        <g
          class="fill-none stroke-white"
          stroke-width="2.2"
          stroke-linecap="round"
          stroke-linejoin="round"
          transform="translate(73.5 26.5) scale(1.73) translate(-12 -12)"
        >
          <path d="M9.09 9a3 3 0 0 1 5.83 1c0 2-3 3-3 3" />
          <path d="M12 17h.01" />
        </g>
      </svg>
      <p class="mt-[3cqh] eyebrow-light">
        {{ strings.ui.profile.brandEyebrow }}
      </p>
      <h1 class="mt-[0.8cqh] text-fs-48">{{ store.config.app.name }}</h1>
      <p class="mx-0 mb-[3.2cqh] mt-[1.8cqh] max-w-[25em] leading-[1.8] text-sky">
        {{ strings.ui.profile.brandCopy }}
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
            {{ strings.ui.profile.sectionLabel }}
          </p>
          <h2 id="profile-title" class="mt-[0.5cqh] text-fs-28">
            {{ strings.ui.profile.sectionTitle }}
          </h2>
        </div>
        <!-- 换一组：复用统一按钮组件 AppButton（secondary 白底描边），保证与全站按钮风格一致 -->
        <AppButton
          variant="secondary"
          type="button"
          :aria-label="strings.a11y.profile.randomizeAria"
          @click="randomize"
        >
          <RefreshCw /> {{ strings.ui.profile.randomize }}
        </AppButton>
      </header>

      <!-- 大头像位于资料区顶部；整个圆形按钮均可打开头像选择弹窗。 -->
      <div class="flex flex-col items-center mb-[2.2cqh]">
        <span class="mb-[0.65cqh] block text-navy font-bold">{{
          strings.ui.profile.avatarLabel
        }}</span>
        <button
          class="flex flex-col items-center gap-[0.8cqh] bg-transparent text-blue text-fs-12 font-bold"
          type="button"
          :aria-label="strings.a11y.profile.changeAvatarAria"
          @click="showAvatarPicker = true"
        >
          <AvatarImage
            :avatar-id="store.profile.avatarId"
            :label="strings.a11y.common.myAvatarAria"
            class="h-[15cqh] w-[15cqh]"
          />
          <span>{{ strings.ui.profile.changeAvatar }}</span>
        </button>
      </div>

      <!-- 昵称位于头像下方，保留自定义输入和 Enter 提交。 -->
      <label class="mb-[0.65cqh] block text-navy font-bold" for="nickname">{{
        strings.ui.profile.nicknameLabel
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
              :aria-label="strings.a11y.profile.nicknameValidAria"
            />
          </template>
        </AppInput>
      </div>
      <!-- 昵称规则说明：常驻显示（紧凑模式折叠已随布局模式移除）。 -->
      <p class="mt-[0.6cqh] text-muted text-fs-12">
        {{
          strings.ui.profile.nicknameHelp(
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
        {{ store.busy ? strings.ui.profile.busy : strings.ui.profile.enterLobby }}<ArrowRight />
      </AppButton>
      <p v-if="!store.connected" class="mt-[0.75cqh] text-red text-fs-12 font-bold">
        {{ strings.ui.profile.offlineWarning }}
      </p>
    </section>

    <AvatarPickerDialog
      v-model="store.profile.avatarId"
      v-model:open="showAvatarPicker"
      :avatar-ids="store.config.player.avatarIds"
    />
  </main>
</template>
