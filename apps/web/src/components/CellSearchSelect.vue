<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from 'vue';

export interface CellOption {
  id: string;
  seq: number;
  title: string;
}

const props = defineProps<{
  modelValue: string;
  options: CellOption[];
  /** 排除的格子 id（如自身） */
  excludeId?: string;
}>();

const emit = defineEmits<{
  'update:modelValue': [id: string];
}>();

const open = ref(false);
const query = ref('');
const root = ref<HTMLElement | null>(null);

const selected = computed(() => props.options.find((o) => o.id === props.modelValue));

const displayLabel = computed(() => {
  if (!selected.value) return '选择格子…';
  const t = selected.value.title?.trim() || '未命名';
  return `${selected.value.seq} · ${t}`;
});

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase();
  return props.options
    .filter((o) => o.id !== props.excludeId)
    .filter((o) => {
      if (!q) return true;
      const label = `${o.seq} ${o.title}`.toLowerCase();
      return label.includes(q) || String(o.seq) === q;
    })
    .sort((a, b) => a.seq - b.seq);
});

function pick(id: string) {
  emit('update:modelValue', id);
  open.value = false;
  query.value = '';
}

function onDocClick(e: MouseEvent) {
  if (!root.value?.contains(e.target as Node)) {
    open.value = false;
    query.value = '';
  }
}

watch(open, (v) => {
  if (v) query.value = '';
});

onMounted(() => document.addEventListener('mousedown', onDocClick));
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocClick));
</script>

<template>
  <div ref="root" class="cell-select">
    <button type="button" class="trigger" @click="open = !open">
      {{ displayLabel }}
    </button>
    <div v-if="open" class="dropdown">
      <input
        v-model="query"
        type="search"
        placeholder="搜索序号或标题"
        autofocus
        @keydown.escape="open = false"
      />
      <ul>
        <li v-for="o in filtered" :key="o.id">
          <button
            type="button"
            :class="{ active: o.id === modelValue }"
            @click="pick(o.id)"
          >
            {{ o.seq }} · {{ o.title?.trim() || '未命名' }}
          </button>
        </li>
        <li v-if="!filtered.length" class="empty">无匹配</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.cell-select {
  position: relative;
  flex: 1;
  min-width: 140px;
}
.trigger {
  width: 100%;
  height: 2.25rem;
  min-height: 2.25rem;
  box-sizing: border-box;
  text-align: left;
  justify-content: flex-start;
  padding: 0 0.75rem;
  line-height: 1.2;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.dropdown {
  position: absolute;
  z-index: 20;
  left: 0;
  right: 0;
  top: calc(100% + 4px);
  background: #1a1220;
  border: 1px solid var(--border);
  border-radius: 10px;
  padding: 0.4rem;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.45);
}
.dropdown input {
  margin-bottom: 0.35rem;
}
.dropdown ul {
  list-style: none;
  margin: 0;
  padding: 0;
  max-height: 200px;
  overflow: auto;
}
.dropdown li button {
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  border-radius: 6px;
  padding: 0.4rem 0.5rem;
}
.dropdown li button:hover,
.dropdown li button.active {
  background: #3a2748;
}
.empty {
  color: var(--muted);
  padding: 0.5rem;
  font-size: 0.85rem;
}
</style>
