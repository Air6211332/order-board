<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import type { PlayMode } from '@order-board/rules';
import { api, type TileCategoryDto, type TileDto } from '../../api';

const tiles = ref<TileDto[]>([]);
const categories = ref<TileCategoryDto[]>([]);
const error = ref('');
const filterMode = ref<'all' | PlayMode>('all');
const filterCategoryId = ref<string | null>(null);
const detail = ref<TileDto | null>(null);

const filteredTiles = computed(() =>
  tiles.value.filter((t) => {
    if (filterMode.value !== 'all' && t.play_mode !== filterMode.value) return false;
    if (filterCategoryId.value != null && t.category_id !== filterCategoryId.value) {
      return false;
    }
    return true;
  }),
);

watch([filterMode, filterCategoryId], () => {
  detail.value = null;
});

async function load() {
  error.value = '';
  try {
    const [t, c] = await Promise.all([api.listTiles(), api.listCategories()]);
    tiles.value = t;
    categories.value = c;
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  }
}

onMounted(load);
</script>

<template>
  <div class="stack mobile-tiles">
    <h1>指令库</h1>
    <p class="muted" style="margin: 0">只读浏览 · 新建/编辑请用电脑</p>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="card stack">
      <label>
        模式
        <select v-model="filterMode" class="touch-field">
          <option value="all">全部</option>
          <option value="multi">多人</option>
          <option value="solo">单人</option>
        </select>
      </label>
      <label>
        分类
        <select
          class="touch-field"
          :value="filterCategoryId ?? ''"
          @change="
            filterCategoryId =
              ($event.target as HTMLSelectElement).value || null
          "
        >
          <option value="">全部</option>
          <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
        </select>
      </label>
    </div>

    <p v-if="!filteredTiles.length" class="muted">暂无指令</p>
    <button
      v-for="t in filteredTiles"
      :key="t.id"
      type="button"
      class="tile-row card"
      @click="detail = t"
    >
      <div class="tile-meta">
        <span
          class="cat"
          :style="t.category_color ? { color: t.category_color } : undefined"
        >
          {{ t.category_name ?? '未分类' }}
        </span>
        <span class="dot">·</span>
        <span>{{ t.play_mode === 'solo' ? '单人' : '多人' }}</span>
        <template v-if="t.intensity_label">
          <span class="dot">·</span>
          <span>{{ t.intensity_label }}</span>
        </template>
      </div>
      <div class="tile-title">{{ t.title }}</div>
      <p class="tile-preview">{{ t.body }}</p>
    </button>

    <div v-if="detail" class="modal-backdrop" @click.self="detail = null">
      <div class="card modal stack">
        <p
          class="muted"
          :style="detail.category_color ? { color: detail.category_color } : undefined"
        >
          {{ detail.category_name ?? '未分类' }}
        </p>
        <h2>{{ detail.title }}</h2>
        <p class="body">{{ detail.body }}</p>
        <button type="button" class="touch-btn" @click="detail = null">关闭</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.touch-field {
  min-height: 44px;
}

.tile-row {
  /* 覆盖全局 button 的居中，改为信息卡片 */
  display: flex;
  flex-direction: column;
  align-items: stretch;
  justify-content: flex-start;
  text-align: left;
  width: 100%;
  min-height: unset;
  height: auto;
  padding: 0.85rem 1rem;
  gap: 0.35rem;
  cursor: pointer;
  line-height: 1.35;
}

.tile-meta {
  display: flex;
  flex-wrap: wrap;
  align-items: center;
  gap: 0.25rem;
  font-size: 0.78rem;
  color: var(--muted);
  font-weight: 400;
}

.tile-meta .cat {
  font-weight: 600;
}

.tile-meta .dot {
  opacity: 0.6;
}

.tile-title {
  font-weight: 700;
  font-size: 1.05rem;
  color: var(--text);
}

.tile-preview {
  margin: 0;
  font-size: 0.88rem;
  font-weight: 400;
  color: color-mix(in srgb, var(--text) 78%, var(--muted));
  white-space: pre-wrap;
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 3;
  line-clamp: 3;
  overflow: hidden;
  word-break: break-word;
}

.body {
  white-space: pre-wrap;
  margin: 0;
}

.touch-btn {
  min-height: 44px;
}

.modal {
  width: min(100%, 420px);
  max-height: 85dvh;
  overflow: auto;
}
</style>
