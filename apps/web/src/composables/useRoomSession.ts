import { computed, onBeforeUnmount, onMounted, ref, type Ref } from 'vue';
import { useRoute } from 'vue-router';
import type { GameState } from '@order-board/rules';
import { formatDiceSpec, resolveBoardDice } from '@order-board/rules';
import { api, type RoomDto, type SeatRole } from '../api';
import { randomAvatarSeed } from '../avatar';
import { resolveOrderBody } from '../resolveOrderBody';
import { RoomSocket, type ServerMessage } from '../roomWs';
import { useAuthStore } from '../stores/auth';

export const PHASE_LABEL: Record<string, string> = {
  pick_start: '选起点',
  roll: '掷骰',
  choose_exit: '选出口',
  order: '执行指令',
  ended: '已结束',
};

export interface UseRoomSessionOptions {
  /** 状态变更后回调（PC 用于同步 Phaser） */
  onStateChange?: (state: GameState | null) => void;
}

/**
 * 房间会话：HTTP 进房、WS 订阅、大厅座位与对局操作。
 * PC / 移动端共用，避免两套协议。
 */
export function useRoomSession(options: UseRoomSessionOptions = {}) {
  const route = useRoute();
  const auth = useAuthStore();
  const roomCode = computed(() => String(route.params.code).toUpperCase());

  const room: Ref<RoomDto | null> = ref(null);
  const state: Ref<GameState | null> = ref(null);
  const error = ref('');
  const wsStatus = ref<'connecting' | 'open' | 'closed'>('connecting');
  const draftName = ref('');
  const draftRole = ref<SeatRole | ''>('');
  const draftAvatarSeed = ref(randomAvatarSeed());
  const avatarLoading = ref<Record<string, boolean>>({});

  let socket: RoomSocket | null = null;

  const isHost = computed(
    () => room.value && auth.user && room.value.hostUserId === auth.user.id,
  );

  const mySeatIds = computed(() => {
    if (!room.value || !auth.user) return new Set<string>();
    return new Set(
      room.value.seats.filter((s) => s.userId === auth.user!.id).map((s) => s.id),
    );
  });

  const currentPlayer = computed(() => {
    if (!state.value) return null;
    return state.value.players[state.value.currentPlayerIndex] ?? null;
  });

  function isMyPlayer(playerId: string, playerIndex: number): boolean {
    if (!auth.user || !room.value) return false;
    if (mySeatIds.value.has(playerId)) return true;
    const seat = room.value.seats[playerIndex];
    return Boolean(seat && seat.userId === auth.user.id);
  }

  const canControl = computed(() => {
    if (!state.value || !currentPlayer.value) return false;
    return isMyPlayer(currentPlayer.value.id, state.value.currentPlayerIndex);
  });

  const startOptions = computed(() => {
    if (!state.value) return [];
    const board = state.value.board;
    const ids = board.startCellIds?.length ? board.startCellIds : [board.startCellId];
    return ids.map((id) => {
      const cell = board.cells.find((c) => c.id === id);
      const title = cell?.title?.trim() || '起点';
      return { id, label: `${cell?.seq ?? '?'} · ${title}` };
    });
  });

  const diceHint = computed(() => {
    if (!state.value) return '';
    const parts: string[] = [];
    const diceLabel = formatDiceSpec(resolveBoardDice(state.value.board));
    if (state.value.lastRoll != null) {
      parts.push(`前进骰 ${state.value.lastRoll}（${diceLabel}）`);
    }
    if (state.value.lastBranchRoll != null) {
      parts.push(`分叉骰 ${state.value.lastBranchRoll}`);
    }
    return parts.join(' · ');
  });

  const isSolo = computed(() => room.value?.playMode === 'solo');

  const showGhostSeat = computed(() => {
    if (!room.value || isSolo.value) return false;
    return room.value.seats.length < 6;
  });

  const resolvedOrderBody = computed(() => {
    const order = state.value?.pendingOrder;
    if (!order || !room.value) return '';
    return resolveOrderBody(
      order.tile.body,
      room.value.seats,
      currentPlayer.value?.name ?? '玩家',
      room.value.playMode ?? 'multi',
    );
  });

  function notifyState() {
    options.onStateChange?.(state.value);
  }

  function canEditSeat(seatUserId: string): boolean {
    return Boolean(isHost.value || (auth.user && seatUserId === auth.user.id));
  }

  function isAvatarLoading(seatId: string): boolean {
    return Boolean(avatarLoading.value[seatId]);
  }

  function setAvatarLoading(seatId: string, loading: boolean) {
    avatarLoading.value = { ...avatarLoading.value, [seatId]: loading };
  }

  function onAvatarImgLoad(seatId: string) {
    setAvatarLoading(seatId, false);
  }

  function onAvatarImgError(seatId: string) {
    setAvatarLoading(seatId, false);
  }

  async function changeSeatRole(seatId: string, raw: string) {
    error.value = '';
    try {
      const role: SeatRole | null =
        raw === 'dominant' || raw === 'submissive' ? raw : null;
      room.value = await api.setSeatRole(roomCode.value, seatId, role);
    } catch (e) {
      error.value = e instanceof Error ? e.message : '设置角色失败';
    }
  }

  async function rerollAvatar(seatId: string) {
    if (isAvatarLoading(seatId)) return;
    error.value = '';
    setAvatarLoading(seatId, true);
    try {
      room.value = await api.setSeatAvatarSeed(
        roomCode.value,
        seatId,
        randomAvatarSeed(),
      );
    } catch (e) {
      setAvatarLoading(seatId, false);
      error.value = e instanceof Error ? e.message : '更新头像失败';
    }
  }

  function roleLabel(role: SeatRole | null): string {
    if (role === 'dominant') return '支配者';
    if (role === 'submissive') return '顺从者';
    return '未指定';
  }

  function handleMessage(msg: ServerMessage) {
    if (msg.type === 'error') {
      error.value = String(msg.error ?? '错误');
      return;
    }
    if (msg.type === 'room_updated' && msg.room) {
      error.value = '';
      room.value = msg.room as RoomDto;
      if ('state' in msg) {
        state.value = (msg.state as GameState | null | undefined) ?? null;
        notifyState();
      }
      return;
    }
    if (msg.type === 'game_started') {
      error.value = '';
      room.value = msg.room as RoomDto;
      state.value = msg.state as GameState;
      notifyState();
      return;
    }
    if (msg.type === 'state') {
      error.value = '';
      state.value = msg.state as GameState;
      notifyState();
    }
  }

  function send(intent: Parameters<RoomSocket['send']>[0]) {
    error.value = '';
    socket?.send(intent);
  }

  function rerollDraftAvatar() {
    if (isAvatarLoading('ghost')) return;
    setAvatarLoading('ghost', true);
    draftAvatarSeed.value = randomAvatarSeed();
  }

  function resetGhostDraft() {
    draftName.value = '';
    draftRole.value = '';
    draftAvatarSeed.value = randomAvatarSeed();
  }

  async function addSeat() {
    if (!showGhostSeat.value) return;
    const name =
      draftName.value.trim() || `玩家${(room.value?.seats.length ?? 0) + 1}`;
    const role: SeatRole | null =
      draftRole.value === 'dominant' || draftRole.value === 'submissive'
        ? draftRole.value
        : null;
    send({
      type: 'add_seat',
      roomCode: roomCode.value,
      displayName: name,
      role,
      avatarSeed: draftAvatarSeed.value,
    });
    resetGhostDraft();
  }

  function removeSeat(seatId: string) {
    send({ type: 'remove_seat', roomCode: roomCode.value, seatId });
  }

  function startGame() {
    send({ type: 'start_game', roomCode: roomCode.value });
  }

  function onRoll() {
    if (!canControl.value) return;
    send({ type: 'roll', roomCode: roomCode.value });
  }

  function onPickStart(cellId: string) {
    if (!canControl.value) return;
    send({ type: 'pick_start', roomCode: roomCode.value, cellId });
  }

  function onChooseExit(exitId: string) {
    if (!canControl.value) return;
    send({ type: 'choose_exit', roomCode: roomCode.value, exitId });
  }

  function onConfirmOrder() {
    if (!canControl.value) return;
    send({ type: 'confirm_order', roomCode: roomCode.value });
  }

  onMounted(async () => {
    error.value = '';
    try {
      const data = await api.getRoom(roomCode.value);
      room.value = data.room;
      state.value = data.state;
      const joined = await api.joinRoom(roomCode.value);
      room.value = joined.room;
      if (joined.state) state.value = joined.state;
      notifyState();
      socket = new RoomSocket({
        onMessage: handleMessage,
        onStatus: (s) => {
          wsStatus.value = s;
        },
      });
      socket.connect();
      socket.send({ type: 'join_room', roomCode: roomCode.value });
    } catch (e) {
      error.value = e instanceof Error ? e.message : '进入房间失败';
    }
  });

  onBeforeUnmount(() => {
    socket?.send({ type: 'leave' });
    socket?.close();
    socket = null;
  });

  return {
    auth,
    roomCode,
    room,
    state,
    error,
    wsStatus,
    draftName,
    draftRole,
    draftAvatarSeed,
    isHost,
    currentPlayer,
    canControl,
    startOptions,
    diceHint,
    isSolo,
    showGhostSeat,
    resolvedOrderBody,
    isMyPlayer,
    canEditSeat,
    isAvatarLoading,
    onAvatarImgLoad,
    onAvatarImgError,
    changeSeatRole,
    rerollAvatar,
    roleLabel,
    rerollDraftAvatar,
    addSeat,
    removeSeat,
    startGame,
    onRoll,
    onPickStart,
    onChooseExit,
    onConfirmOrder,
  };
}
