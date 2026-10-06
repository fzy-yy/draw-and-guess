/**
 * 房间成员服务（转发至 modules/room/room.service.ts）。
 */
export * from '../../modules/room/room.service.ts'
export {
  RoomService as RoomMembershipService,
  type RoomServiceContext as RoomMembershipServiceContext,
} from '../../modules/room/room.service.ts'
