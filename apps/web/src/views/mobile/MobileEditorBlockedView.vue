<script setup lang="ts">
import { useRouter } from 'vue-router';

const router = useRouter();
</script>

<template>
  <div class="stack blocked card">
    <h1>请用电脑编辑</h1>
    <p class="muted">
      棋盘编辑器依赖较大画布与精细操作，移动端暂不支持。请在电脑浏览器打开同一账号进行编辑。
    </p>
    <button type="button" class="primary touch-btn" @click="router.push('/boards')">
      返回棋盘列表
    </button>
    <button type="button" class="touch-btn" @click="router.push('/')">回大厅</button>
  </div>
</template>

<style scoped>
.blocked {
  margin-top: 1.5rem;
  gap: 1rem;
}

.touch-btn {
  min-height: 44px;
  width: 100%;
}
</style>
