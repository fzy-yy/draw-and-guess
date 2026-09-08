import { APP_CONFIG as publicAppConfig, PUBLIC_CONFIG } from '@draw-guess/config'
import { getDeploymentConfig, type DeploymentConfig } from './deployment.ts'
import { serverPrivateConfig } from './private.ts'

/** 服务端在公开配置之上装配私有运行策略；浏览器只能依赖 @draw-guess/config。 */
export const APP_CONFIG = {
  ...publicAppConfig,
  network: { ...publicAppConfig.network, ...serverPrivateConfig.network },
  room: { ...publicAppConfig.room, ...serverPrivateConfig.room },
  drawing: { ...publicAppConfig.drawing, ...serverPrivateConfig.drawing },
  vocabulary: { ...publicAppConfig.vocabulary, ...serverPrivateConfig.vocabulary },
} as const

export { PUBLIC_CONFIG, getDeploymentConfig, serverPrivateConfig, type DeploymentConfig }
