import { defineStore } from 'pinia';
import { ref } from 'vue';
import { api, type User } from '../api';

export const useAuthStore = defineStore('auth', () => {
  const user = ref<User | null>(null);
  const ready = ref(false);

  /** 无会话则创建游客；已有会话则拉取 /me */
  async function bootstrap() {
    try {
      try {
        user.value = await api.me();
      } catch {
        user.value = await api.guest();
      }
    } catch {
      user.value = null;
    } finally {
      ready.value = true;
    }
  }

  async function login(username: string, password: string) {
    user.value = await api.login(username, password);
  }

  async function register(username: string, password: string) {
    user.value = await api.register(username, password);
  }

  async function logout() {
    await api.logout();
    user.value = await api.guest();
  }

  return { user, ready, bootstrap, login, register, logout };
});
