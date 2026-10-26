<script setup lang="ts">
import { onMounted, ref } from 'vue';
import { useRouter } from 'vue-router';
import { api, type BoardSummary, type Visibility } from '../api';
import { useAuthStore } from '../stores/auth';

const router = useRouter();
const auth = useAuthStore();
const boards = ref<BoardSummary[]>([]);
const error = ref('');
const creating = ref(false);
const roomVisibility = ref<Visibility>('public');

async function load() {
  error.value = '';
  try {
    boards.value = await api.listBoards();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  }
}

async function createBoard() {
  creating.value = true;
  error.value = '';
  try {
    const board = await api.createBoard({
      name: '新棋盘',
      cols: 6,
      rows: 4,
      startCellId: null,
      visibility: 'private',
      cells: [],
      exits: [],
    });
    await router.push({ name: 'board-edit', params: { id: board.id } });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '创建失败';
  } finally {
    creating.value = false;
  }
}

async function removeBoard(id: string) {
  if (!confirm('确定删除该棋盘？')) return;
  await api.deleteBoard(id);
  await load();
}

async function toggleVisibility(b: BoardSummary) {
  error.value = '';
  try {
    const next: Visibility = b.visibility === 'public' ? 'private' : 'public';
    const updated = await api.setBoardVisibility(b.id, next);
    const idx = boards.value.findIndex((x) => x.id === b.id);
    if (idx >= 0) boards.value[idx] = { ...boards.value[idx]!, ...updated };
  } catch (e) {
    error.value = e instanceof Error ? e.message : '更新可见性失败';
  }
}

async function openRoom(boardId: string) {
  error.value = '';
  try {
    const board = boards.value.find((b) => b.id === boardId);
    const visibility =
      board?.playMode === 'solo' ? 'private' : roomVisibility.value;
    const room = await api.createRoom(boardId, {
      displayName: auth.user?.username,
      visibility,
    });
    await router.push({ name: 'room', params: { code: room.code } });
  } catch (e) {
    error.value = e instanceof Error ? e.message : '开房失败';
  }
}

onMounted(load);
</script>

<template>
  <div class="stack">
    <div class="row" style="justify-content: space-between; flex-wrap: wrap">
      <div>
        <h1>我的棋盘</h1>
        <p class="muted">默认私有 · 设为公开后会出现在大厅供他人开房</p>
      </div>
      <div class="row">
        <RouterLink to="/">回大厅</RouterLink>
        <button class="primary" type="button" :disabled="creating" @click="createBoard">
          新建棋盘
        </button>
      </div>
    </div>

    <div class="card row" style="flex-wrap: wrap; align-items: center; gap: 0.75rem">
      <span class="muted">开房默认</span>
      <select v-model="roomVisibility">
        <option value="public">公开房</option>
        <option value="private">私有房</option>
      </select>
    </div>

    <p v-if="error" class="error">{{ error }}</p>
    <div v-if="!boards.length" class="card muted">还没有棋盘。可以新建，或用 seed 示例账号登录。</div>
    <div v-else class="card">
      <table>
        <thead>
          <tr>
            <th>名称</th>
            <th>模式</th>
            <th>尺寸</th>
            <th>可见性</th>
            <th>操作</th>
          </tr>
        </thead>
        <tbody>
          <tr v-for="b in boards" :key="b.id">
            <td>{{ b.name }}</td>
            <td class="muted">{{ b.playMode === 'solo' ? '单人' : '多人' }}</td>
            <td class="muted">{{ b.cols }}×{{ b.rows }}</td>
            <td>
              <button
                type="button"
                :disabled="b.playMode === 'solo'"
                :title="b.playMode === 'solo' ? '单人棋盘不能公开' : undefined"
                @click="toggleVisibility(b)"
              >
                {{ b.visibility === 'public' ? '公开' : '私有' }}
              </button>
            </td>
            <td class="row">
              <RouterLink :to="`/boards/${b.id}`">编辑</RouterLink>
              <button type="button" @click="openRoom(b.id)">开房</button>
              <RouterLink :to="`/play/${b.id}`">本机快开</RouterLink>
              <button type="button" class="danger" @click="removeBoard(b.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
    </div>
  </div>
</template>
