<script setup lang="ts">
import { computed, onMounted, ref, watch } from 'vue';
import { ROLE_PLACEHOLDER_CHIPS, type PlayMode } from '@order-board/rules';
import { api, type TileCategoryDto, type TileDto } from '../api';

const tiles = ref<TileDto[]>([]);
const categories = ref<TileCategoryDto[]>([]);
const error = ref('');
const editing = ref<TileDto | null>(null);
const form = ref({
  playMode: 'multi' as PlayMode,
  categoryId: '',
  intensityLevel: null as number | null,
  title: '',
  body: '',
  tags: [] as string[],
  tagDraft: '',
});
const showForm = ref(false);
const showPlaceholders = ref(false);
const filterMode = ref<'all' | PlayMode>('all');
/** null 表示「全部」 */
const filterCategoryId = ref<string | null>(null);
/** null 表示不按强度过滤 */
const filterIntensityLevel = ref<number | null>(null);
const pageSize = 10;
const currentPage = ref(1);
const bodyArea = ref<HTMLTextAreaElement | null>(null);

const showCatForm = ref(false);
const editingCat = ref<TileCategoryDto | null>(null);
const catForm = ref({ name: '', color: '', intensityLabels: [] as string[] });

const categoryOptions = computed(() => categories.value);

const selectedCategory = computed(() =>
  categories.value.find((c) => c.id === form.value.categoryId),
);

const intensityOptions = computed(() => selectedCategory.value?.intensities ?? []);

const filteredTiles = computed(() =>
  tiles.value.filter((t) => {
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

watch([filterMode, filterCategoryId, filterIntensityLevel], () => {
  currentPage.value = 1;
});

watch(filteredTiles, () => {
  if (currentPage.value > totalPages.value) {
    currentPage.value = totalPages.value;
  }
});

watch(
  () => form.value.categoryId,
  () => {
    const levels = intensityOptions.value.map((i) => i.level);
    if (form.value.intensityLevel != null && !levels.includes(form.value.intensityLevel)) {
      form.value.intensityLevel = null;
    }
  },
);

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
  return (
    filterCategoryId.value === id && filterIntensityLevel.value == null
  );
}

function isIntensitySelected(categoryId: string, level: number) {
  return (
    filterCategoryId.value === categoryId && filterIntensityLevel.value === level
  );
}

function goPrevPage() {
  if (currentPage.value > 1) currentPage.value -= 1;
}

function goNextPage() {
  if (currentPage.value < totalPages.value) currentPage.value += 1;
}

async function load() {
  const [t, c] = await Promise.all([api.listTiles(), api.listCategories()]);
  tiles.value = t;
  categories.value = c;
  if (!form.value.categoryId && c[0]) form.value.categoryId = c[0].id;
}

function openCreate() {
  editing.value = null;
  form.value = {
    playMode: 'multi',
    categoryId: categories.value[0]?.id ?? '',
    intensityLevel: null,
    title: '',
    body: '',
    tags: [],
    tagDraft: '',
  };
  showForm.value = true;
  showPlaceholders.value = false;
}

function openEdit(tile: TileDto) {
  editing.value = tile;
  form.value = {
    playMode: tile.play_mode ?? 'multi',
    categoryId: tile.category_id ?? categories.value[0]?.id ?? '',
    intensityLevel: tile.intensity_level,
    title: tile.title,
    body: tile.body,
    tags: [...(tile.tags ?? [])],
    tagDraft: '',
  };
  showForm.value = true;
  showPlaceholders.value = false;
}

function addTag() {
  const t = form.value.tagDraft.trim();
  if (!t) return;
  if (!form.value.tags.includes(t)) form.value.tags.push(t);
  form.value.tagDraft = '';
}

function removeTag(tag: string) {
  form.value.tags = form.value.tags.filter((x) => x !== tag);
}

function insertPlaceholder(token: string) {
  const el = bodyArea.value;
  const cur = form.value.body;
  if (!el) {
    form.value.body = cur + token;
    return;
  }
  const start = el.selectionStart ?? cur.length;
  const end = el.selectionEnd ?? cur.length;
  form.value.body = cur.slice(0, start) + token + cur.slice(end);
  requestAnimationFrame(() => {
    el.focus();
    const pos = start + token.length;
    el.setSelectionRange(pos, pos);
  });
}

async function save() {
  error.value = '';
  try {
    if (!form.value.categoryId) throw new Error('请选择分类');
    const payload = {
      categoryId: form.value.categoryId,
      title: form.value.title,
      body: form.value.body,
      playMode: form.value.playMode,
      intensityLevel: form.value.intensityLevel,
      tags: form.value.tags,
    };
    if (editing.value) {
      await api.updateTile(editing.value.id, payload);
    } else {
      await api.createTile(payload);
    }
    showForm.value = false;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '保存失败';
  }
}

async function remove(id: string) {
  if (!confirm('确定删除该指令？')) return;
  await api.deleteTile(id);
  await load();
}

function openCreateCat() {
  editingCat.value = null;
  catForm.value = { name: '', color: '', intensityLabels: [] };
  showCatForm.value = true;
}

function openEditCat(cat: TileCategoryDto) {
  editingCat.value = cat;
  catForm.value = {
    name: cat.name,
    color: cat.color ?? '',
    intensityLabels: (cat.intensities ?? []).map((i) => i.label),
  };
  showCatForm.value = true;
}

function addIntensityLabel() {
  if (catForm.value.intensityLabels.length >= 10) return;
  catForm.value.intensityLabels.push('');
}

function removeIntensityLabel(idx: number) {
  catForm.value.intensityLabels.splice(idx, 1);
}

async function saveCat() {
  error.value = '';
  try {
    const color = catForm.value.color.trim() || null;
    const intensities = catForm.value.intensityLabels.map((l) => l.trim()).filter(Boolean);
    if (editingCat.value) {
      await api.updateCategory(editingCat.value.id, {
        name: catForm.value.name,
        color,
        intensities,
      });
    } else {
      await api.createCategory({ name: catForm.value.name, color, intensities });
    }
    showCatForm.value = false;
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '分类保存失败';
  }
}

async function removeCat(id: string) {
  if (!confirm('删除分类后，相关指令将变为未分类。确定？')) return;
  if (filterCategoryId.value === id) {
    selectAll();
  }
  await api.deleteCategory(id);
  await load();
}

function modeLabel(m: PlayMode) {
  return m === 'solo' ? '单人' : '多人';
}

onMounted(async () => {
  try {
    await load();
  } catch (e) {
    error.value = e instanceof Error ? e.message : '加载失败';
  }
});
</script>

<template>
  <div class="stack">
    <div class="row" style="justify-content: space-between; flex-wrap: wrap">
      <div>
        <h1>指令库</h1>
        <p class="muted">
          模式 · 分类 · 强度 · 标签；正文可插入角色占位符（起点/终点请用棋盘属性）
        </p>
      </div>
      <div class="row">
        <button type="button" @click="openCreateCat">新建分类</button>
        <button class="primary" type="button" @click="openCreate">新建指令</button>
      </div>
    </div>
    <p v-if="error" class="error">{{ error }}</p>

    <div class="tiles-layout">
      <aside class="card stack tree-panel">
        <h2>分类</h2>
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
            <div
              class="tree-node cat-node"
              :class="{ active: isCategorySelected(c.id) }"
            >
              <button type="button" class="tree-label" @click="selectCategory(c.id)">
                <span
                  class="color-dot"
                  :style="{ background: c.color || 'var(--border)' }"
                />
                <span class="tree-name">{{ c.name }}</span>
              </button>
              <span class="tree-actions">
                <button
                  type="button"
                  class="icon-btn"
                  title="编辑分类"
                  aria-label="编辑分类"
                  @click.stop="openEditCat(c)"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                    <path
                      d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  class="icon-btn danger-icon"
                  title="删除分类"
                  aria-label="删除分类"
                  @click.stop="removeCat(c.id)"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                    <path
                      d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                    />
                  </svg>
                </button>
              </span>
            </div>
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
              <td class="row row-actions">
                <button
                  type="button"
                  class="icon-btn"
                  title="编辑指令"
                  aria-label="编辑指令"
                  @click="openEdit(t)"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                    <path
                      d="M3 17.25V21h3.75L17.81 9.94l-3.75-3.75L3 17.25zM20.71 7.04a1.003 1.003 0 0 0 0-1.42l-2.34-2.34a1.003 1.003 0 0 0-1.42 0l-1.83 1.83 3.75 3.75 1.84-1.82z"
                    />
                  </svg>
                </button>
                <button
                  type="button"
                  class="icon-btn danger-icon"
                  title="删除指令"
                  aria-label="删除指令"
                  @click="remove(t.id)"
                >
                  <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                    <path
                      d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                    />
                  </svg>
                </button>
              </td>
            </tr>
          </tbody>
        </table>
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

    <div v-if="showForm" class="modal-backdrop" @click.self="showForm = false">
      <form class="card modal stack wide" @submit.prevent="save">
        <h2>{{ editing ? '编辑指令' : '新建指令' }}</h2>
        <label>
          模式
          <select v-model="form.playMode">
            <option value="multi">多人模式</option>
            <option value="solo">单人模式</option>
          </select>
        </label>
        <label>
          分类
          <select v-model="form.categoryId" required>
            <option disabled value="">选择分类</option>
            <option v-for="c in categoryOptions" :key="c.id" :value="c.id">{{ c.name }}</option>
          </select>
        </label>
        <label>
          强度
          <select v-model="form.intensityLevel">
            <option :value="null">未指定</option>
            <option v-for="i in intensityOptions" :key="i.level" :value="i.level">
              {{ i.level }}. {{ i.label }}
            </option>
          </select>
        </label>
        <label>
          标题
          <input v-model="form.title" required />
        </label>
        <label>
          动作正文
          <textarea ref="bodyArea" v-model="form.body" rows="5" />
        </label>
        <div class="placeholders">
          <button type="button" class="linkish" @click="showPlaceholders = !showPlaceholders">
            可用的占位符 {{ showPlaceholders ? '▾' : '▸' }}
          </button>
          <div v-if="showPlaceholders" class="ph-panel">
            <p class="muted">点击插入到正文。本阶段仅角色占位符。</p>
            <div class="row" style="flex-wrap: wrap; gap: 0.4rem">
              <button
                v-for="p in ROLE_PLACEHOLDER_CHIPS"
                :key="p.token"
                type="button"
                class="ph-chip"
                @click="insertPlaceholder(p.token)"
              >
                {{ p.token }}
              </button>
            </div>
          </div>
        </div>
        <label>
          标签
          <div class="row" style="flex-wrap: wrap; gap: 0.4rem">
            <span v-for="tag in form.tags" :key="tag" class="tag-chip editable">
              {{ tag }}
              <button type="button" class="linkish" @click="removeTag(tag)">×</button>
            </span>
            <input
              v-model="form.tagDraft"
              placeholder="回车添加"
              style="max-width: 10rem"
              @keydown.enter.prevent="addTag"
            />
            <button type="button" @click="addTag">添加</button>
          </div>
        </label>
        <div class="row">
          <button class="primary" type="submit">保存</button>
          <button type="button" @click="showForm = false">取消</button>
        </div>
      </form>
    </div>

    <div v-if="showCatForm" class="modal-backdrop" @click.self="showCatForm = false">
      <form class="card modal stack wide" @submit.prevent="saveCat">
        <h2>{{ editingCat ? '编辑分类' : '新建分类' }}</h2>
        <label>
          名称
          <input v-model="catForm.name" required />
        </label>
        <label>
          颜色（可选，如 #e8a0b0）
          <input v-model="catForm.color" placeholder="#aabbcc" />
        </label>
        <div class="stack">
          <h3>
            强度标签（{{ catForm.intensityLabels.length }}/10）
          </h3>
          <p class="muted">自定义每级名称，数值自动为 1、2、3…</p>
          <div
            v-for="(_lab, idx) in catForm.intensityLabels"
            :key="idx"
            class="intensity-edit-row"
          >
            <span class="level-num">{{ idx + 1 }}</span>
            <input v-model="catForm.intensityLabels[idx]" :placeholder="`等级 ${idx + 1} 标签`" />
            <button
              type="button"
              class="icon-btn danger-icon"
              title="删除"
              aria-label="删除"
              @click="removeIntensityLabel(idx)"
            >
              <svg viewBox="0 0 24 24" width="16" height="16" fill="currentColor" aria-hidden="true">
                <path
                  d="M6 19c0 1.1.9 2 2 2h8c1.1 0 2-.9 2-2V7H6v12zM19 4h-3.5l-1-1h-5l-1 1H5v2h14V4z"
                />
              </svg>
            </button>
          </div>
          <button
            type="button"
            :disabled="catForm.intensityLabels.length >= 10"
            @click="addIntensityLabel"
          >
            + 新增强度等级
          </button>
        </div>
        <div class="row">
          <button class="primary" type="submit">保存</button>
          <button type="button" @click="showCatForm = false">取消</button>
        </div>
      </form>
    </div>
  </div>
</template>

<style scoped>
.tiles-layout {
  display: grid;
  grid-template-columns: 240px 1fr;
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
  justify-content: space-between;
  gap: 0.5rem;
  padding-right: 0.15rem;
  cursor: default;
  box-sizing: border-box;
}
.tree-label {
  display: flex;
  align-items: center;
  justify-content: flex-start;
  gap: 0.4rem;
  flex: 1 1 auto;
  min-width: 0;
  border: none;
  background: transparent;
  color: inherit;
  cursor: pointer;
  padding: 0;
  text-align: left;
  font: inherit;
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
.tree-actions {
  display: inline-flex;
  align-items: center;
  gap: 0.1rem;
  flex: 0 0 auto;
  margin-left: auto;
  opacity: 0.55;
}
.cat-node:hover .tree-actions,
.cat-node.active .tree-actions {
  opacity: 1;
}
.intensity-node {
  padding-left: 1.5rem;
  font-size: 0.85rem;
  color: var(--muted, #666);
}
.intensity-node.active {
  color: inherit;
}
.icon-btn {
  display: inline-flex;
  align-items: center;
  justify-content: center;
  width: 1.75rem;
  height: 1.75rem;
  padding: 0;
  border: none;
  border-radius: 6px;
  background: transparent;
  color: inherit;
  cursor: pointer;
}
.icon-btn:hover {
  background: var(--bg-muted, rgba(0, 0, 0, 0.08));
}
.danger-icon {
  color: var(--danger, #c44);
}
.row-actions {
  gap: 0.15rem;
  justify-content: flex-end;
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
.linkish {
  border: none;
  background: transparent;
  padding: 0;
  cursor: pointer;
  color: inherit;
  text-decoration: underline;
  font-size: 0.8rem;
}
.cat-name {
  font-weight: 600;
}
.body-cell {
  max-width: 14rem;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.modal.wide {
  max-width: 32rem;
  width: min(92vw, 32rem);
}
.filter {
  display: flex;
  flex-direction: column;
  gap: 0.25rem;
  font-size: 0.9rem;
}
.ph-panel {
  margin-top: 0.5rem;
  padding: 0.75rem;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--bg-muted, rgba(0, 0, 0, 0.03));
}
.ph-chip {
  font-family: ui-monospace, monospace;
  font-size: 0.85rem;
}
.intensity-edit-row {
  display: flex;
  flex-wrap: nowrap;
  align-items: center;
  gap: 0.5rem;
}
.intensity-edit-row input {
  flex: 1;
  min-width: 0;
  width: auto;
}
.intensity-edit-row .icon-btn {
  flex-shrink: 0;
}
.level-num {
  min-width: 1.5rem;
  flex-shrink: 0;
  font-weight: 700;
  color: var(--accent, #2a7);
}
</style>
