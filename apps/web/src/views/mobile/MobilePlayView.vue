<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type PlayMode, type SeatRole } from '../../api';
import { avatarDataUrl, randomAvatarSeed } from '../../avatar';
import { useAuthStore } from '../../stores/auth';

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
const draftName = ref('');
const draftRole = ref<SeatRole | ''>('');
const draftAvatarSeed = ref(randomAvatarSeed());

const isSolo = computed(() => playMode.value === 'solo');
const showGhostSeat = computed(() => !isSolo.value && seats.value.length < 6);

function toRole(raw: SeatRole | ''): SeatRole | null {
  return raw === 'dominant' || raw === 'submissive' ? raw : null;
}

function removeSeat(key: string) {
  if (seats.value.length <= 1) return;
  seats.value = seats.value.filter((s) => s.key !== key);
}

function addSeatFromGhost() {
  if (!showGhostSeat.value) return;
  const name = draftName.value.trim() || `玩家${seats.value.length + 1}`;
  seats.value.push({
    key: newSeatKey(),
    displayName: name,
    role: draftRole.value,
    avatarSeed: draftAvatarSeed.value,
  });
  draftName.value = '';
  draftRole.value = '';
  draftAvatarSeed.value = randomAvatarSeed();
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
  <div class="stack mobile-play">
    <h1>本机快开</h1>
    <p class="muted" style="margin: 0">
      {{ isSolo ? '单人模式' : '可占多座并立即开局' }}
    </p>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="card stack">
      <div class="row" style="justify-content: space-between">
        <h2>入座</h2>
        <button
          class="primary touch-btn"
          type="button"
          :disabled="loading || !seats.length"
          @click="begin"
        >
          {{ loading ? '开房中…' : '开房并开始' }}
        </button>
      </div>

      <article v-for="s in seats" :key="s.key" class="seat-row">
        <button
          type="button"
          class="avatar-btn"
          @click="s.avatarSeed = randomAvatarSeed()"
        >
          <img :src="avatarDataUrl(s.avatarSeed)" :alt="s.displayName" width="48" height="48" />
        </button>
        <div class="seat-body">
          <input v-model="s.displayName" class="touch-field" placeholder="玩家名" maxlength="32" />
          <select v-model="s.role" class="touch-field">
            <option value="">未指定</option>
            <option value="dominant">支配者</option>
            <option value="submissive">顺从者</option>
          </select>
        </div>
        <button
          type="button"
          class="danger touch-btn"
          :disabled="seats.length <= 1"
          @click="removeSeat(s.key)"
        >
          退
        </button>
      </article>

      <article v-if="showGhostSeat" class="seat-row ghost">
        <button
          type="button"
          class="avatar-btn"
          @click="draftAvatarSeed = randomAvatarSeed()"
        >
          <img :src="avatarDataUrl(draftAvatarSeed)" alt="新座位" width="48" height="48" />
        </button>
        <div class="seat-body">
          <input
            v-model="draftName"
            class="touch-field"
            placeholder="玩家名"
            maxlength="32"
            @keyup.enter="addSeatFromGhost"
          />
          <select v-model="draftRole" class="touch-field">
            <option value="">未指定</option>
            <option value="dominant">支配者</option>
            <option value="submissive">顺从者</option>
          </select>
        </div>
        <button type="button" class="primary touch-btn" @click="addSeatFromGhost">入座</button>
      </article>
    </div>

    <button type="button" class="touch-btn" @click="router.push('/boards')">返回棋盘</button>
  </div>
</template>

<style scoped>
.touch-btn {
  min-height: 44px;
}

.touch-field {
  min-height: 40px;
}

.seat-row {
  display: flex;
  gap: 0.55rem;
  align-items: center;
  padding: 0.55rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel-2);
}

.avatar-btn {
  padding: 0;
  border: none;
  background: transparent;
  border-radius: 50%;
  overflow: hidden;
  min-width: 48px;
  min-height: 48px;
}

.avatar-btn img {
  display: block;
  border-radius: 50%;
}

.seat-body {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 0.3rem;
}
</style>
