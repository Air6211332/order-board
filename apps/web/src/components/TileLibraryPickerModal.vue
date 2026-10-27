<script setup lang="ts">
import { computed, ref, watch } from 'vue';
import type { PlayMode } from '@order-board/rules';
import type { TileCategoryDto, TileDto } from '../api';

const props = defineProps<{
  open: boolean;
  tiles: TileDto[];
  categories: TileCategoryDto[];
  defaultPlayMode: PlayMode;
}>();

const emit = defineEmits<{
  close: [];
  select: [tileId: string];
}>();

const filterMode = ref<'all' | PlayMode>('all');
/** null 表示「全部」 */
const filterCategoryId = ref<string | null>(null);
/** null 表示不按强度过滤 */
const filterIntensityLevel = ref<number | null>(null);
const pageSize = 10;
const currentPage = ref(1);

const filteredTiles = computed(() =>
  props.tiles.filter((t) => {
    if (filterMode.value !== 'all' && t.play_mode !== filterMode.value) return false;
    if (filterCategoryId.value != null && t.category_id !== filterCategoryId.value) {
      return false;
    }
    if (
      filterIntensityLevel.value != null &&
      t.intensity_level !== filterIntensityLevel.value
    ) {
      return false;
    }
    return true;
  }),
);

const totalPages = computed(() =>
  Math.max(1, Math.ceil(filteredTiles.value.length / pageSize)),
);

const pagedTiles = computed(() => {
  const start = (currentPage.value - 1) * pageSize;
  return filteredTiles.value.slice(start, start + pageSize);
});

watch(
  () => props.open,
  (open) => {
    if (!open) return;
    filterMode.value = props.defaultPlayMode;
    filterCategoryId.value = null;
    filterIntensityLevel.value = null;
    currentPage.value = 1;
  },
);

watch([filterMode, filterCategoryId, filterIntensityLevel], () => {
  currentPage.value = 1;
});

watch(filteredTiles, () => {
  if (currentPage.value > totalPages.value) {
    currentPage.value = totalPages.value;
  }
});

function modeLabel(m: PlayMode) {
  return m === 'solo' ? '单人' : '多人';
}

function selectAll() {
  filterCategoryId.value = null;
  filterIntensityLevel.value = null;
}

function selectCategory(id: string) {
  filterCategoryId.value = id;
  filterIntensityLevel.value = null;
}

function selectIntensity(categoryId: string, level: number) {
  filterCategoryId.value = categoryId;
  filterIntensityLevel.value = level;
}

function isAllSelected() {
  return filterCategoryId.value == null && filterIntensityLevel.value == null;
}

function isCategorySelected(id: string) {
  return filterCategoryId.value === id && filterIntensityLevel.value == null;
}

function isIntensitySelected(categoryId: string, level: number) {
  return filterCategoryId.value === categoryId && filterIntensityLevel.value === level;
}

function goPrevPage() {
  if (currentPage.value > 1) currentPage.value -= 1;
}

function goNextPage() {
  if (currentPage.value < totalPages.value) currentPage.value += 1;
}

function onPick(id: string) {
  emit('select', id);
}
</script>

<template>
  <div v-if="open" class="modal-backdrop" @click.self="emit('close')">
    <div class="card modal picker-modal stack" role="dialog" aria-modal="true" aria-label="从指令库选用">
      <div class="row picker-head" style="justify-content: space-between; align-items: center">
        <div>
          <h2>从指令库选用</h2>
          <p class="muted">选定后拷贝标题与正文到本格（不绑定）</p>
        </div>
        <button type="button" @click="emit('close')">关闭</button>
      </div>

      <div class="tiles-layout">
        <aside class="card stack tree-panel">
          <h3>分类</h3>
          <nav class="cat-tree" aria-label="分类树">
            <button
              type="button"
              class="tree-node"
              :class="{ active: isAllSelected() }"
              @click="selectAll"
            >
              全部
            </button>
            <div v-for="c in categories" :key="c.id" class="tree-branch">
              <button
                type="button"
                class="tree-node cat-node"
                :class="{ active: isCategorySelected(c.id) }"
                @click="selectCategory(c.id)"
              >
                <span
                  class="color-dot"
                  :style="{ background: c.color || 'var(--border)' }"
                />
                <span class="tree-name">{{ c.name }}</span>
              </button>
              <button
                v-for="i in c.intensities"
                :key="`${c.id}-${i.level}`"
                type="button"
                class="tree-node intensity-node"
                :class="{ active: isIntensitySelected(c.id, i.level) }"
                @click="selectIntensity(c.id, i.level)"
              >
                {{ i.level }} · {{ i.label }}
              </button>
            </div>
            <p v-if="!categories.length" class="muted">暂无分类</p>
          </nav>
        </aside>

        <section class="card stack list-panel">
          <div class="row" style="flex-wrap: wrap; gap: 0.75rem">
            <label class="filter">
              模式
              <select v-model="filterMode">
                <option value="all">全部</option>
                <option value="multi">多人</option>
                <option value="solo">单人</option>
              </select>
            </label>
          </div>

          <div class="table-scroll">
            <table>
              <thead>
                <tr>
                  <th>模式</th>
                  <th>分类</th>
                  <th>强度</th>
                  <th>标题</th>
                  <th>标签</th>
                  <th>正文</th>
                  <th></th>
                </tr>
              </thead>
              <tbody>
                <tr v-for="t in pagedTiles" :key="t.id">
                  <td>{{ modeLabel(t.play_mode) }}</td>
                  <td>
                    <span
                      class="cat-name"
                      :style="t.category_color ? { color: t.category_color } : undefined"
                    >
                      {{ t.category_name ?? '未分类' }}
                    </span>
                  </td>
                  <td class="muted">{{ t.intensity_label ?? '—' }}</td>
                  <td>{{ t.title }}</td>
                  <td>
                    <span v-for="tag in t.tags" :key="tag" class="tag-chip">{{ tag }}</span>
                    <span v-if="!t.tags?.length" class="muted">—</span>
                  </td>
                  <td class="muted body-cell">{{ t.body }}</td>
                  <td>
                    <button type="button" class="primary" @click="onPick(t.id)">选定</button>
                  </td>
                </tr>
              </tbody>
            </table>
          </div>
          <p v-if="!filteredTiles.length" class="muted">暂无指令</p>
          <div v-else class="pager row">
            <button type="button" :disabled="currentPage <= 1" @click="goPrevPage">
              上一页
            </button>
            <span class="muted">
              第 {{ currentPage }}/{{ totalPages }} 页 · 共 {{ filteredTiles.length }} 条
            </span>
            <button
              type="button"
              :disabled="currentPage >= totalPages"
              @click="goNextPage"
            >
              下一页
            </button>
          </div>
        </section>
      </div>
    </div>
  </div>
</template>

<style scoped>
.picker-modal {
  width: min(1100px, 92vw);
  max-height: min(88vh, 900px);
  overflow: auto;
}
.picker-head h2 {
  margin: 0;
}
.picker-head .muted {
  margin: 0.25rem 0 0;
}
.tiles-layout {
  display: grid;
  grid-template-columns: 220px 1fr;
  gap: 1rem;
  align-items: start;
}
@media (max-width: 720px) {
  .tiles-layout {
    grid-template-columns: 1fr;
  }
}
.tree-panel {
  min-width: 0;
}
.list-panel {
  min-width: 0;
}
.tree-panel h3 {
  margin: 0;
  font-size: 0.95rem;
}
.cat-tree {
  display: flex;
  flex-direction: column;
  gap: 0.15rem;
}
.tree-branch {
  display: flex;
  flex-direction: column;
  gap: 0.1rem;
}
.tree-node {
  display: flex;
  align-items: center;
  gap: 0.35rem;
  width: 100%;
  padding: 0.35rem 0.45rem;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  text-align: left;
  cursor: pointer;
  font-size: 0.9rem;
}
.tree-node:hover {
  background: var(--bg-muted, rgba(0, 0, 0, 0.04));
}
.tree-node.active {
  background: var(--bg-muted, rgba(0, 0, 0, 0.08));
  font-weight: 600;
}
.cat-node {
  width: 100%;
  box-sizing: border-box;
}
.tree-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.color-dot {
  width: 0.55rem;
  height: 0.55rem;
  border-radius: 50%;
  flex-shrink: 0;
}
.intensity-node {
  padding-left: 1.5rem;
  font-size: 0.85rem;
  color: var(--muted, #666);
}
.intensity-node.active {
  color: inherit;
}
.table-scroll {
  overflow: auto;
  max-width: 100%;
}
.pager {
  justify-content: space-between;
  align-items: center;
  flex-wrap: wrap;
  gap: 0.5rem;
  margin-top: 0.5rem;
}
.tag-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.2rem;
  padding: 0.1rem 0.45rem;
  margin-right: 0.25rem;
  border: 1px solid var(--border);
  border-radius: 6px;
  font-size: 0.8rem;
}
.cat-name {
  font-weight: 600;
}
.body-cell {
  max-width: 12rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.filter {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.9rem;
}
</style>
