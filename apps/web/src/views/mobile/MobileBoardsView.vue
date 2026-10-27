<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, type BoardSummary, type Visibility } from '../../api';
import { useAuthStore } from '../../stores/auth';

const router = useRouter();
const auth = useAuthStore();
const boards = ref<BoardSummary[]>([]);
const error = ref('');
const roomVisibility = ref<Visibility>('public');
const opening = ref(false);

async function load() {
  error.value = '';
  try {
    boards.value = await api.listBoards();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  }
}

async function openRoom(boardId: string) {
  opening.value = true;
  error.value = '';
  try {
    const board = boards.value.find((b) => b.id === boardId);
    const visibility = board?.playMode === 'solo' ? 'private' : roomVisibility.value;
    const room = await api.createRoom(boardId, {
      displayName: auth.user?.username,
      visibility,
    });
    await router.push({ name: 'room', params: { code: room.code } });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '开房失败';
  } finally {
    opening.value = false;
  }
}

onMounted(load);
</script>

<template>
  <div class="stack mobile-boards">
    <h1>我的棋盘</h1>
    <p class="muted" style="margin: 0">手机可开房与快开；编辑请用电脑</p>

    <div class="card row" style="align-items: center">
      <span class="muted">开房默认</span>
      <select v-model="roomVisibility" class="touch-field">
        <option value="public">公开房</option>
        <option value="private">私有房</option>
      </select>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <div v-if="!boards.length" class="card muted">还没有棋盘。请用电脑新建，或登录示例账号。</div>

    <article v-for="b in boards" :key="b.id" class="card board-item stack">
      <div>
        <strong>{{ b.name }}</strong>
        <div class="muted small">
          {{ b.playMode === 'solo' ? '单人' : '多人' }} · {{ b.cols }}×{{ b.rows }} ·
          {{ b.visibility === 'public' ? '公开' : '私有' }}
        </div>
      </div>
      <div class="actions">
        <button
          type="button"
          class="primary touch-btn"
          :disabled="opening"
          @click="openRoom(b.id)"
        >
          开房
        </button>
        <button type="button" class="touch-btn" @click="router.push(`/play/${b.id}`)">
          快开
        </button>
        <button type="button" class="touch-btn" @click="router.push(`/boards/${b.id}`)">
          编辑说明
        </button>
      </div>
    </article>
  </div>
</template>

<style scoped>
.small {
  font-size: 0.82rem;
  margin-top: 0.25rem;
}

.actions {
  display: grid;
  grid-template-columns: 1fr 1fr;
  gap: 0.5rem;
}

.actions .touch-btn:last-child {
  grid-column: 1 / -1;
}

.touch-btn {
  min-height: 44px;
}

.touch-field {
  min-height: 44px;
  flex: 1;
}
</style>
