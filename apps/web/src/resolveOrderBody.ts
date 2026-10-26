import { resolveRolePlaceholders, type PlayMode } from '@order-board/rules';
import type { RoomSeatDto } from './api';

/**
 * 按座位角色解析指令正文中的角色占位符。
 * 单人且未指定角色时，三个占位符都替换为该玩家名。
 */
export function resolveOrderBody(
  body: string,
  seats: RoomSeatDto[],
  playerName: string,
  playMode: PlayMode = 'multi',
): string {
  if (playMode === 'solo' && seats.length === 1) {
    const seat = seats[0]!;
    const name = seat.displayName;
    if (!seat.role) {
      return resolveRolePlaceholders(body, {
        player: name,
        dominant: name,
        submissive: name,
      });
    }
    return resolveRolePlaceholders(body, {
      player: name,
      dominant: seat.role === 'dominant' ? name : undefined,
      submissive: seat.role === 'submissive' ? name : undefined,
    });
  }

  const dominant = seats.find((s) => s.role === 'dominant')?.displayName;
  const submissive = seats.find((s) => s.role === 'submissive')?.displayName;
  return resolveRolePlaceholders(body, {
    player: playerName,
    dominant,
    submissive,
  });
}
