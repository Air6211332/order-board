<script setup lang="ts">
import { computed, onMounted, ref } from 'vue';
import { useRoute, useRouter } from 'vue-router';
import { api, type PlayMode } from '../api';
import { useAuthStore } from '../stores/auth';

/**
 * 本机快开：开房后为自己加多个座位，再进入房间页（服务端权威 + WS）。
 */
const route = useRoute();
const router = useRouter();
const auth = useAuthStore();
const boardId = computed(() => String(route.params.boardId));

const playMode = ref<PlayMode>('multi');
const playerNames = ref(['玩家甲', '玩家乙']);
const error = ref('');
const loading = ref(false);

const isSolo = computed(() => playMode.value === 'solo');
const maxPlayers = computed(() => (isSolo.value ? 1 : 6));

function addPlayer() {
  if (playerNames.value.length >= maxPlayers.value) return;
  playerNames.value.push(`玩家${playerNames.value.length + 1}`);
}

function removePlayer(i: number) {
  if (playerNames.value.length <= 1) return;
  playerNames.value.splice(i, 1);
}

async function begin() {
  error.value = '';
  loading.value = true;
  try {
    await api.playableBoard(boardId.value);
    const names = playerNames.value.map((n) => n.trim()).filter(Boolean);
    if (!names.length) throw new Error('至少一名玩家');
    if (isSolo.value && names.length > 1) {
      throw new Error('单人棋盘只能有一名玩家');
    }
    const room = await api.createRoom(boardId.value, {
      displayName: names[0],
      visibility: 'private',
    });
    for (let i = 1; i < names.length; i++) {
      await api.addSeat(room.code, names[i]);
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
    if (playMode.value === 'solo') {
      playerNames.value = [auth.user?.username || '玩家'];
    }
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

    <div class="card stack" style="max-width: 480px">
      <h2>入座</h2>
      <div v-for="(_, i) in playerNames" :key="i" class="row">
        <input v-model="playerNames[i]" :placeholder="`玩家 ${i + 1}`" />
        <button
          type="button"
          class="danger"
          :disabled="playerNames.length <= 1"
          @click="removePlayer(i)"
        >
          移除
        </button>
      </div>
      <div class="row">
        <button
          v-if="!isSolo"
          type="button"
          :disabled="playerNames.length >= maxPlayers"
          @click="addPlayer"
        >
          加玩家
        </button>
        <button class="primary" type="button" :disabled="loading" @click="begin">
          {{ loading ? '开房中…' : '开房并开始' }}
        </button>
      </div>
      <p class="muted" style="font-size: 0.85rem">
        进入房间后由房主点「开始对局」。房间码可分享给他人加入。
      </p>
    </div>
  </div>
</template>
