import type {
  BoardDefinition,
  DiceSpec,
  EndMode,
  ForkMode,
  GameEvent,
  GameState,
  PlayMode,
} from '@order-board/rules';

export type { DiceSpec };

export type { PlayMode };

export interface User {
  id: string;
  username: string;
  isTemp?: boolean;
}

export interface IntensityLevelDto {
  level: number;
  label: string;
}

export interface TileCategoryDto {
  id: string;
  userId: string;
  name: string;
  color: string | null;
  sortOrder: number;
  createdAt: number;
  updatedAt: number;
  intensities: IntensityLevelDto[];
}

export interface TileDto {
  id: string;
  category_id: string | null;
  category_name: string | null;
  category_color: string | null;
  play_mode: PlayMode;
  intensity_level: number | null;
  intensity_label: string | null;
  tags: string[];
  title: string;
  body: string;
  created_at: number;
  updated_at: number;
}

export type Visibility = 'public' | 'private';

export interface BoardSummary {
  id: string;
  name: string;
  cols: number;
  rows: number;
  startCellId: string | null;
  visibility: Visibility;
  playMode: PlayMode;
  updatedAt: number;
}

export interface PublicBoardSummary {
  id: string;
  name: string;
  cols: number;
  rows: number;
  playMode: PlayMode;
  ownerUsername: string;
  updatedAt: number;
}

export interface BoardDocument {
  id: string;
  name: string;
  cols: number;
  rows: number;
  startCellId: string | null;
  visibility: Visibility;
  playMode: PlayMode;
  /** 全局前进骰 */
  dice: DiceSpec;
  cells: Array<{
    id: string;
    col: number;
    row: number;
    /** 已废弃：指令文案内嵌在 title/body */
    tileId: string | null;
    forkMode: ForkMode | null;
    seq: number;
    title: string;
    body: string;
    tileCategory: string | null;
    tileCategoryColor: string | null;
    isStart: boolean;
    endMode: EndMode | null;
    /** 突出显示（长宽 1.5 倍） */
    emphasized: boolean;
    /** 模式二独立分叉骰；null 表示用全局 */
    forkDice: DiceSpec | null;
  }>;
  exits: Array<{
    id: string;
    fromCellId: string;
    toCellId: string;
    label: string;
    faces: number[];
    isDefault: boolean;
  }>;
  updatedAt: number;
}

export interface BoardSaveInput {
  name: string;
  cols: number;
  rows: number;
  startCellId: string | null;
  visibility?: Visibility;
  playMode?: PlayMode;
  dice?: DiceSpec | null;
  cells: BoardDocument['cells'];
  exits: Array<{
    id?: string;
    fromCellId: string;
    toCellId: string;
    label: string;
    faces?: number[];
    isDefault?: boolean;
  }>;
}

export type RoomStatus = 'lobby' | 'playing' | 'ended';
export type SeatRole = 'dominant' | 'submissive';

export interface RoomSeatDto {
  id: string;
  userId: string;
  displayName: string;
  sortOrder: number;
  role: SeatRole | null;
  avatarSeed: string;
}

export interface RoomDto {
  code: string;
  hostUserId: string;
  boardId: string | null;
  boardName: string;
  playMode: PlayMode;
  status: RoomStatus;
  visibility: Visibility;
  seats: RoomSeatDto[];
  createdAt: number;
  updatedAt: number;
}

export interface PublicRoomSummary {
  code: string;
  boardName: string;
  status: RoomStatus;
  seatCount: number;
  hostUsername: string;
  updatedAt: number;
}

export interface TileWriteBody {
  categoryId: string;
  title: string;
  body: string;
  playMode?: PlayMode;
  intensityLevel?: number | null;
  tags?: string[];
}

async function request<T>(path: string, init?: RequestInit): Promise<T> {
  const headers = new Headers(init?.headers);
  // 无 body 时不要带 application/json，否则 Fastify 会拒绝空 JSON（如 DELETE）
  if (init?.body != null && !headers.has('Content-Type')) {
    headers.set('Content-Type', 'application/json');
  }
  const res = await fetch(path, {
    credentials: 'include',
    ...init,
    headers,
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) {
    throw new Error((data as { error?: string }).error ?? `请求失败 (${res.status})`);
  }
  return data as T;
}

export const api = {
  me: () => request<User>('/api/me'),
  guest: () =>
    request<User>('/api/auth/guest', { method: 'POST', body: '{}' }),
  register: (username: string, password: string) =>
    request<User>('/api/auth/register', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  login: (username: string, password: string) =>
    request<User>('/api/auth/login', {
      method: 'POST',
      body: JSON.stringify({ username, password }),
    }),
  logout: () =>
    request<{ ok: boolean }>('/api/auth/logout', { method: 'POST', body: '{}' }),

  listCategories: () => request<TileCategoryDto[]>('/api/tile-categories'),
  createCategory: (body: {
    name: string;
    color?: string | null;
    intensities?: string[];
  }) =>
    request<TileCategoryDto>('/api/tile-categories', {
      method: 'POST',
      body: JSON.stringify(body),
    }),
  updateCategory: (
    id: string,
    body: {
      name?: string;
      color?: string | null;
      sortOrder?: number;
      intensities?: string[];
    },
  ) =>
    request<TileCategoryDto>(`/api/tile-categories/${id}`, {
      method: 'PUT',
      body: JSON.stringify(body),
    }),
  deleteCategory: (id: string) =>
    request<{ ok: boolean }>(`/api/tile-categories/${id}`, { method: 'DELETE' }),

  listTiles: () => request<TileDto[]>('/api/tiles'),
  createTile: (body: TileWriteBody) =>
    request<TileDto>('/api/tiles', { method: 'POST', body: JSON.stringify(body) }),
  updateTile: (id: string, body: TileWriteBody) =>
    request<TileDto>(`/api/tiles/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  deleteTile: (id: string) =>
    request<{ ok: boolean }>(`/api/tiles/${id}`, { method: 'DELETE' }),

  listBoards: () => request<BoardSummary[]>('/api/boards'),
  listPublicBoards: () => request<PublicBoardSummary[]>('/api/boards/public'),
  getBoard: (id: string) => request<BoardDocument>(`/api/boards/${id}`),
  createBoard: (body: BoardSaveInput) =>
    request<BoardDocument>('/api/boards', { method: 'POST', body: JSON.stringify(body) }),
  updateBoard: (id: string, body: BoardSaveInput) =>
    request<BoardDocument>(`/api/boards/${id}`, { method: 'PUT', body: JSON.stringify(body) }),
  setBoardVisibility: (id: string, visibility: Visibility) =>
    request<BoardSummary>(`/api/boards/${id}/visibility`, {
      method: 'PATCH',
      body: JSON.stringify({ visibility }),
    }),
  deleteBoard: (id: string) =>
    request<{ ok: boolean }>(`/api/boards/${id}`, { method: 'DELETE' }),
  playableBoard: (id: string) => request<BoardDefinition>(`/api/boards/${id}/playable`),

  listPublicRooms: () => request<PublicRoomSummary[]>('/api/rooms/public'),
  createRoom: (
    boardId: string,
    opts?: {
      displayName?: string;
      visibility?: Visibility;
      role?: SeatRole | null;
      avatarSeed?: string;
    },
  ) =>
    request<RoomDto>('/api/rooms', {
      method: 'POST',
      body: JSON.stringify({
        boardId,
        displayName: opts?.displayName,
        visibility: opts?.visibility ?? 'public',
        role: opts?.role ?? null,
        avatarSeed: opts?.avatarSeed,
      }),
    }),
  getRoom: (code: string) =>
    request<{ room: RoomDto; state: GameState | null }>(`/api/rooms/${code}`),
  joinRoom: (code: string) =>
    request<{ room: RoomDto; state: GameState | null }>(`/api/rooms/${code}/join`, {
      method: 'POST',
      body: '{}',
    }),
  addSeat: (
    code: string,
    displayName?: string,
    opts?: { role?: SeatRole | null; avatarSeed?: string },
  ) =>
    request<RoomDto>(`/api/rooms/${code}/seats`, {
      method: 'POST',
      body: JSON.stringify({
        displayName,
        role: opts?.role ?? null,
        avatarSeed: opts?.avatarSeed,
      }),
    }),
  removeSeat: (code: string, seatId: string) =>
    request<RoomDto>(`/api/rooms/${code}/seats/${seatId}`, { method: 'DELETE' }),
  setSeatRole: (code: string, seatId: string, role: SeatRole | null) =>
    request<RoomDto>(`/api/rooms/${code}/seats/${seatId}`, {
      method: 'PATCH',
      body: JSON.stringify({ role }),
    }),
  setSeatAvatarSeed: (code: string, seatId: string, avatarSeed: string) =>
    request<RoomDto>(`/api/rooms/${code}/seats/${seatId}`, {
      method: 'PATCH',
      body: JSON.stringify({ avatarSeed }),
    }),
  startRoom: (code: string) =>
    request<{ room: RoomDto; state: GameState; events: GameEvent[] }>(
      `/api/rooms/${code}/start`,
      { method: 'POST', body: '{}' },
    ),
};
