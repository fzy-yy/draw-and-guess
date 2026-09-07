import type { InviteSecret, PlayerSecret, RoomSecret } from '../models.ts'

/** 服务端内存聚合的唯一所有者；领域协作者只接收所需 Map 或窄查询端口。 */
export class DomainContext {
  readonly players = new Map<string, PlayerSecret>()
  readonly playersByToken = new Map<string, PlayerSecret>()
  readonly rooms = new Map<string, RoomSecret>()
  readonly roomsByPrivateCode = new Map<string, string>()
  readonly invites = new Map<string, InviteSecret>()
}
