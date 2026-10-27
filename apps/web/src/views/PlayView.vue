<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type PlayMode, type SeatRole } from '../api';
import { avatarDataUrl, randomAvatarSeed } from '../avatar';
import { useAuthStore } from '../stores/auth';

/**
 * 本机快开：本地编辑座位（名/角色/头像），开房后写入服务端并立即开局。
 */
interface DraftSeat {
  key: string;
  displayName: string;
  role: SeatRole | '';
  avatarSeed: string;
}

let seatKeySeq = 0;
function newSeatKey(): string {
  seatKeySeq += 1;
  return `local-${seatKeySeq}`;
}

function makeSeat(displayName: string): DraftSeat {
  return {
    key: newSeatKey(),
    displayName,
    role: '',
    avatarSeed: randomAvatarSeed(),
  };
}

const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const boardId = computed(() => String(route.params.boardId));

const playMode = ref<PlayMode>('multi');
const seats = ref<DraftSeat[]>([makeSeat('玩家')]);
const error = ref('');
const loading = ref(false);

/** 虚空入座卡草稿 */
const draftName = ref('');
const draftRole = ref<SeatRole | ''>('');
const draftAvatarSeed = ref(randomAvatarSeed());
/** 正在加载头像的座位 key；ghost 表示虚空卡 */
const avatarLoading = ref<Record<string, boolean>>({});

const isSolo = computed(() => playMode.value === 'solo');
const maxPlayers = computed(() => (isSolo.value ? 1 : 6));
const showGhostSeat = computed(
  () => !isSolo.value && seats.value.length < maxPlayers.value,
);

function roleLabel(role: SeatRole | null | ''): string {
  if (role === 'dominant') return '支配者';
  if (role === 'submissive') return '顺从者';
  return '未指定';
}

function isAvatarLoading(key: string): boolean {
  return Boolean(avatarLoading.value[key]);
}

function setAvatarLoading(key: string, loading: boolean) {
  avatarLoading.value = { ...avatarLoading.value, [key]: loading };
}

function onAvatarImgLoad(key: string) {
  setAvatarLoading(key, false);
}

function onAvatarImgError(key: string) {
  setAvatarLoading(key, false);
}

function rerollSeatAvatar(key: string) {
  if (isAvatarLoading(key)) return;
  const seat = seats.value.find((s) => s.key === key);
  if (!seat) return;
  setAvatarLoading(key, true);
  seat.avatarSeed = randomAvatarSeed();
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

function addSeatFromGhost() {
  if (!showGhostSeat.value) return;
  const name =
    draftName.value.trim() || `玩家${seats.value.length + 1}`;
  seats.value.push({
    key: newSeatKey(),
    displayName: name,
    role: draftRole.value,
    avatarSeed: draftAvatarSeed.value,
  });
  resetGhostDraft();
}

function removeSeat(key: string) {
  if (seats.value.length <= 1) return;
  seats.value = seats.value.filter((s) => s.key !== key);
}

function toRole(raw: SeatRole | ''): SeatRole | null {
  return raw === 'dominant' || raw === 'submissive' ? raw : null;
}

async function begin() {
  error.value = '';
  loading.value = true;
  try {
    await api.playableBoard(boardId.value);
    const list = seats.value.map((s) => ({
      displayName: s.displayName.trim() || '玩家',
      role: toRole(s.role),
      avatarSeed: s.avatarSeed,
    }));
    if (!list.length) throw new Error('至少一名玩家');
    if (isSolo.value && list.length > 1) {
      throw new Error('单人棋盘只能有一名玩家');
    }
    const first = list[0]!;
    const room = await api.createRoom(boardId.value, {
      displayName: first.displayName,
      visibility: 'private',
      role: first.role,
      avatarSeed: first.avatarSeed,
    });
    for (let i = 1; i < list.length; i++) {
      const s = list[i]!;
      await api.addSeat(room.code, s.displayName, {
        role: s.role,
        avatarSeed: s.avatarSeed,
      });
    }
    await api.startRoom(room.code);
    await router.replace({ name: 'room', params: { code: room.code } });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '开局失败';
  } finally {
    loading.value = false;
  }
}

onMounted(async () => {
  try {
    const board = await api.getBoard(boardId.value);
    playMode.value = board.playMode === 'solo' ? 'solo' : 'multi';
    const name = auth.user?.username || '玩家';
    seats.value = [makeSeat(name)];
    await api.playableBoard(boardId.value);
  } catch (e) {
    error.value = e instanceof Error ? e.message : '棋盘不可玩';
  }
});
</script>

<template>
  <div class="stack">
    <div class="row" style="justify-content: space-between">
      <div>
        <h1>本机快开</h1>
        <p class="muted">
          {{ isSolo ? '单人模式' : '为自己占多个座位并开房' }}
          · 当前用户 {{ auth.user?.username }}
        </p>
      </div>
      <button type="button" @click="router.push(`/boards/${boardId}`)">回编辑</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <div class="card stack lobby-seats">
      <div class="lobby-header row" style="justify-content: space-between; flex-wrap: wrap">
        <h2>入座</h2>
        <button class="primary" type="button" :disabled="loading || !seats.length" @click="begin">
          {{ loading ? '开房中…' : '开房并开始' }}
        </button>
      </div>
      <p class="muted">
        悬停头像可重随机 · 角色用于指令占位符。
        <template v-if="isSolo">单人模式仅一个座位。</template>
      </p>
      <div class="seat-grid">
        <article v-for="s in seats" :key="s.key" class="seat-card">
          <button
            type="button"
            class="seat-corner danger"
            :disabled="seats.length <= 1"
            title="退座"
            @click="removeSeat(s.key)"
          >
            退座
          </button>
          <button
            type="button"
            class="avatar-wrap"
            :class="{ loading: isAvatarLoading(s.key) }"
            :disabled="isAvatarLoading(s.key)"
            :title="isAvatarLoading(s.key) ? '头像加载中…' : '点击重随机头像'"
            @click="rerollSeatAvatar(s.key)"
          >
            <img
              class="avatar-img"
              :src="avatarDataUrl(s.avatarSeed)"
              :alt="s.displayName"
              width="96"
              height="96"
              @load="onAvatarImgLoad(s.key)"
              @error="onAvatarImgError(s.key)"
            />
            <span
              v-if="isAvatarLoading(s.key)"
              class="avatar-loading"
              aria-live="polite"
            >
              加载中
            </span>
            <span v-else class="avatar-reroll" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                <path
                  d="M17.65 6.35A7.95 7.95 0 0 0 12 4V1L7 6l5 5V7c2.76 0 5 2.24 5 5a5 5 0 0 1-8.9 3.1L6.2 16.6A7.96 7.96 0 0 0 20 12c0-2.21-.9-4.21-2.35-5.65zM6 12c0-2.76 2.24-5 5-5v3l5-5-5-5v3a8 8 0 0 0-6.8 12.6l1.9-1.5A5 5 0 0 1 6 12z"
                />
              </svg>
            </span>
          </button>
          <div class="seat-meta">
            <input
              v-model="s.displayName"
              class="seat-name-input"
              placeholder="玩家名"
              maxlength="32"
            />
            <select
              v-model="s.role"
              class="seat-role"
              :title="roleLabel(s.role)"
            >
              <option value="">未指定</option>
              <option value="dominant">支配者</option>
              <option value="submissive">顺从者</option>
            </select>
          </div>
        </article>

        <article v-if="showGhostSeat" class="seat-card seat-card-ghost">
          <button
            type="button"
            class="seat-corner primary"
            title="入座"
            @click="addSeatFromGhost"
          >
            入座
          </button>
          <button
            type="button"
            class="avatar-wrap"
            :class="{ loading: isAvatarLoading('ghost') }"
            :disabled="isAvatarLoading('ghost')"
            :title="isAvatarLoading('ghost') ? '头像加载中…' : '点击重随机头像'"
            @click="rerollDraftAvatar"
          >
            <img
              class="avatar-img"
              :src="avatarDataUrl(draftAvatarSeed)"
              alt="新座位头像"
              width="96"
              height="96"
              @load="onAvatarImgLoad('ghost')"
              @error="onAvatarImgError('ghost')"
            />
            <span
              v-if="isAvatarLoading('ghost')"
              class="avatar-loading"
              aria-live="polite"
            >
              加载中
            </span>
            <span v-else class="avatar-reroll" aria-hidden="true">
              <svg viewBox="0 0 24 24" width="28" height="28" fill="currentColor">
                <path
                  d="M17.65 6.35A7.95 7.95 0 0 0 12 4V1L7 6l5 5V7c2.76 0 5 2.24 5 5a5 5 0 0 1-8.9 3.1L6.2 16.6A7.96 7.96 0 0 0 20 12c0-2.21-.9-4.21-2.35-5.65zM6 12c0-2.76 2.24-5 5-5v3l5-5-5-5v3a8 8 0 0 0-6.8 12.6l1.9-1.5A5 5 0 0 1 6 12z"
                />
              </svg>
            </span>
          </button>
          <div class="seat-meta">
            <input
              v-model="draftName"
              class="seat-name-input"
              placeholder="玩家名"
              maxlength="32"
              @keyup.enter="addSeatFromGhost"
            />
            <select
              v-model="draftRole"
              class="seat-role"
              :title="roleLabel(draftRole)"
            >
              <option value="">未指定</option>
              <option value="dominant">支配者</option>
              <option value="submissive">顺从者</option>
            </select>
          </div>
        </article>
      </div>
    </div>
  </div>
</template>

<style scoped>
.lobby-seats {
  max-width: 720px;
}
.lobby-header {
  align-items: center;
  gap: 0.75rem;
}
.lobby-header h2 {
  margin: 0;
}
.seat-grid {
  display: grid;
  grid-template-columns: repeat(auto-fill, minmax(160px, 1fr));
  gap: 1rem;
}
.seat-card {
  position: relative;
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.55rem;
  padding: 1rem 0.75rem 0.85rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--bg-muted, rgba(0, 0, 0, 0.02));
}
.seat-card-ghost {
  border-style: dashed;
  background: transparent;
}
.seat-corner {
  position: absolute;
  top: 0.4rem;
  right: 0.4rem;
  padding: 0.15rem 0.45rem;
  font-size: 0.75rem;
  height: auto;
  min-height: 0;
  z-index: 2;
}
.seat-name-input {
  width: 100%;
  max-width: 8.5rem;
  text-align: center;
  font-weight: 600;
  font-size: 0.9rem;
  height: 2rem;
  min-height: 2rem;
  padding: 0 0.4rem;
}
.avatar-wrap {
  position: relative;
  width: 96px;
  height: 96px;
  padding: 0;
  border: none;
  border-radius: 50%;
  background: transparent;
  cursor: pointer;
  overflow: hidden;
}
.avatar-wrap:disabled {
  cursor: default;
}
.avatar-wrap.loading {
  cursor: wait;
}
.avatar-img {
  display: block;
  width: 96px;
  height: 96px;
  border-radius: 50%;
  object-fit: cover;
}
.avatar-wrap.loading .avatar-img {
  opacity: 0.45;
}
.avatar-reroll,
.avatar-loading {
  position: absolute;
  inset: 0;
  display: flex;
  align-items: center;
  justify-content: center;
  background: rgba(20, 16, 24, 0.55);
  color: #fff;
  pointer-events: none;
}
.avatar-reroll {
  opacity: 0;
  transition: opacity 0.15s ease;
}
.avatar-wrap:not(:disabled):hover .avatar-reroll {
  opacity: 1;
}
.avatar-loading {
  font-size: 0.8rem;
  font-weight: 600;
  letter-spacing: 0.04em;
}
.seat-meta {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 0.35rem;
  font-size: 0.9rem;
  width: 100%;
}
.seat-role {
  max-width: 6.5rem;
  font-size: 0.85rem;
}
</style>
