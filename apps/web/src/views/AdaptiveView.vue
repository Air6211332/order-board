<script setup lang="ts">
import { type Component, shallowRef, watch } from 'vue';
import { useRoute } from 'vue-router';
import { useDeviceMode } from '../composables/useDeviceMode';

type AsyncView = () => Promise<{ default: Component }>;

const route = useRoute();
const { isMobile } = useDeviceMode();
const view = shallowRef<Component | null>(null);
const loadError = shallowRef('');

async function resolveView() {
  loadError.value = '';
  const meta = route.meta as {
    desktop?: AsyncView;
    mobile?: AsyncView;
  };
  const loader = isMobile.value
    ? (meta.mobile ?? meta.desktop)
    : (meta.desktop ?? meta.mobile);
  if (!loader) {
    loadError.value = '未配置页面组件';
    view.value = null;
    return;
  }
  try {
    const mod = await loader();
    view.value = mod.default;
  } catch (e) {
    loadError.value = e instanceof Error ? e.message : '页面加载失败';
    view.value = null;
  }
}

watch([() => route.name, isMobile], () => void resolveView(), { immediate: true });
</script>

<template>
  <p v-if="loadError" class="error">{{ loadError }}</p>
  <component :is="view" v-else-if="view" />
</template>
