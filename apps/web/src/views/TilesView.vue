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
const filterCategoryId = ref('all');
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
    if (filterCategoryId.value !== 'all' && t.category_id !== filterCategoryId.value) {
      return false;
    }
    return true;
  }),
);

watch(
  () => form.value.categoryId,
  () => {
    const levels = intensityOptions.value.map((i) => i.level);
    if (form.value.intensityLevel != null && !levels.includes(form.value.intensityLevel)) {
      form.value.intensityLevel = null;
    }
  },
);

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

    <div class="card stack">
      <h2>分类</h2>
      <div v-if="categories.length" class="cat-list row" style="flex-wrap: wrap; gap: 0.5rem">
        <span
          v-for="c in categories"
          :key="c.id"
          class="cat-chip"
          :style="c.color ? { borderColor: c.color, color: c.color } : undefined"
        >
          {{ c.name }}
          <span v-if="c.intensities?.length" class="muted" style="font-size: 0.8em">
            · {{ c.intensities.length }} 级
          </span>
          <button type="button" class="linkish" @click="openEditCat(c)">改</button>
          <button type="button" class="linkish danger-text" @click="removeCat(c.id)">删</button>
        </span>
      </div>
      <p v-else class="muted">暂无分类</p>
    </div>

    <div class="card stack">
      <div class="row" style="flex-wrap: wrap; gap: 0.75rem">
        <label class="filter">
          模式
          <select v-model="filterMode">
            <option value="all">全部</option>
            <option value="multi">多人</option>
            <option value="solo">单人</option>
          </select>
        </label>
        <label class="filter">
          分类
          <select v-model="filterCategoryId">
            <option value="all">全部</option>
            <option v-for="c in categories" :key="c.id" :value="c.id">{{ c.name }}</option>
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
          <tr v-for="t in filteredTiles" :key="t.id">
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
            <td class="row">
              <button type="button" @click="openEdit(t)">编辑</button>
              <button type="button" class="danger" @click="remove(t.id)">删除</button>
            </td>
          </tr>
        </tbody>
      </table>
      <p v-if="!filteredTiles.length" class="muted">暂无指令</p>
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
            class="row"
            style="align-items: center"
          >
            <span class="level-num">{{ idx + 1 }}</span>
            <input v-model="catForm.intensityLabels[idx]" :placeholder="`等级 ${idx + 1} 标签`" />
            <button type="button" class="danger" @click="removeIntensityLabel(idx)">删</button>
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
.cat-chip {
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
  padding: 0.25rem 0.55rem;
  border: 1px solid var(--border);
  border-radius: 999px;
  font-size: 0.9rem;
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
.danger-text {
  color: var(--danger, #c44);
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
.level-num {
  min-width: 1.5rem;
  font-weight: 700;
  color: var(--accent, #2a7);
}
</style>
