<script setup lang="ts">
import { useRouter } from 'vue-router';
import { avatarDataUrl } from '../../avatar';
import MobileBoardStrip from '../../components/mobile/MobileBoardStrip.vue';
import { PHASE_LABEL, useRoomSession } from '../../composables/useRoomSession';

const router = useRouter();
const session = useRoomSession();
const {
  auth,
  roomCode,
  room,
  state,
  error,
  wsStatus,
  draftName,
  draftRole,
  draftAvatarSeed,
  isHost,
  currentPlayer,
  canControl,
  startOptions,
  diceHint,
  isSolo,
  showGhostSeat,
  resolvedOrderBody,
  isMyPlayer,
  canEditSeat,
  isAvatarLoading,
  onAvatarImgLoad,
  onAvatarImgError,
  changeSeatRole,
  rerollAvatar,
  rerollDraftAvatar,
  addSeat,
  removeSeat,
  startGame,
  onRoll,
  onPickStart,
  onChooseExit,
  onConfirmOrder,
} = session;
</script>

<template>
  <div class="mobile-room stack">
    <div class="row room-head">
      <div>
        <h1>房间 {{ roomCode }}</h1>
        <p class="muted meta">
          {{ room?.boardName ?? '…' }}
          ·
          <template v-if="room?.playMode === 'solo'">单人</template>
          <template v-else>多人</template>
          ·
          <template v-if="room?.status === 'lobby'">大厅</template>
          <template v-else-if="room?.status === 'playing'">对局中</template>
          <template v-else>已结束</template>
          · WS {{ wsStatus === 'open' ? '已连' : wsStatus === 'connecting' ? '…' : '断' }}
        </p>
      </div>
      <button type="button" class="touch-btn" @click="router.push('/')">返回</button>
    </div>

    <p v-if="error" class="error">{{ error }}</p>

    <template v-if="room?.status === 'lobby'">
      <div class="card stack">
        <div class="row" style="justify-content: space-between">
          <h2>座位</h2>
          <button
            v-if="isHost"
            class="primary touch-btn"
            type="button"
            :disabled="!room.seats.length"
            @click="startGame"
          >
            开始
          </button>
        </div>
        <p class="muted" style="margin: 0; font-size: 0.85rem">
          点头像可换脸
          <template v-if="isSolo"> · 单人仅一座</template>
        </p>
        <div class="seat-list stack">
          <article v-for="s in room.seats" :key="s.id" class="seat-row card-inner">
            <button
              type="button"
              class="avatar-btn"
              :disabled="!canEditSeat(s.userId) || isAvatarLoading(s.id)"
              @click="rerollAvatar(s.id)"
            >
              <img
                :src="avatarDataUrl(s.avatarSeed)"
                :alt="s.displayName"
                width="56"
                height="56"
                @load="onAvatarImgLoad(s.id)"
                @error="onAvatarImgError(s.id)"
              />
            </button>
            <div class="seat-body">
              <div class="seat-name">
                {{ s.displayName }}
                <span v-if="s.userId === auth.user?.id" class="muted">（你）</span>
              </div>
              <select
                class="touch-select"
                :value="s.role ?? ''"
                :disabled="!canEditSeat(s.userId)"
                @change="changeSeatRole(s.id, ($event.target as HTMLSelectElement).value)"
              >
                <option value="">未指定</option>
                <option value="dominant">支配者</option>
                <option value="submissive">顺从者</option>
              </select>
            </div>
            <button
              type="button"
              class="danger touch-btn"
              :disabled="room.seats.length <= 1 || !canEditSeat(s.userId)"
              @click="removeSeat(s.id)"
            >
              退
            </button>
          </article>

          <article v-if="showGhostSeat" class="seat-row card-inner ghost">
            <button type="button" class="avatar-btn" @click="rerollDraftAvatar">
              <img
                :src="avatarDataUrl(draftAvatarSeed)"
                alt="新座位"
                width="56"
                height="56"
                @load="onAvatarImgLoad('ghost')"
                @error="onAvatarImgError('ghost')"
              />
            </button>
            <div class="seat-body">
              <input
                v-model="draftName"
                class="touch-input"
                placeholder="玩家名"
                maxlength="32"
                @keyup.enter="addSeat"
              />
              <select v-model="draftRole" class="touch-select">
                <option value="">未指定</option>
                <option value="dominant">支配者</option>
                <option value="submissive">顺从者</option>
              </select>
            </div>
            <button type="button" class="primary touch-btn" @click="addSeat">入座</button>
          </article>
        </div>
      </div>
    </template>

    <template v-else-if="state">
      <div class="card stack action-bar">
        <div>
          <template v-if="state.phase === 'ended'">
            <strong>全员已到达终点</strong>
          </template>
          <template v-else>
            当前：<strong>{{ currentPlayer?.name }}</strong>
            <span class="muted"> · {{ PHASE_LABEL[state.phase] ?? state.phase }}</span>
            <div v-if="diceHint" class="muted dice">{{ diceHint }}</div>
            <div v-if="!canControl" class="muted">等待对方操作</div>
          </template>
        </div>
        <button
          class="primary touch-btn roll-btn"
          type="button"
          :disabled="state.phase !== 'roll' || !canControl"
          @click="onRoll"
        >
          掷骰
        </button>
      </div>

      <ul class="player-chips">
        <li
          v-for="(p, i) in state.players"
          :key="p.id"
          :class="{ finished: p.finished, current: p.id === currentPlayer?.id }"
        >
          {{ p.name }}
          <span v-if="isMyPlayer(p.id, i)" class="muted">你</span>
        </li>
      </ul>

      <MobileBoardStrip :state="state" :focus-player-id="currentPlayer?.id" />

      <div v-if="state.phase === 'pick_start'" class="card stack">
        <p>
          <strong>{{ currentPlayer?.name }}</strong> 请选择起点
        </p>
        <button
          v-for="opt in startOptions"
          :key="opt.id"
          type="button"
          class="touch-btn"
          :disabled="!canControl"
          :class="currentPlayer?.cellId === opt.id ? 'primary' : ''"
          @click="onPickStart(opt.id)"
        >
          {{ opt.label }}
        </button>
      </div>

      <div v-if="state.phase === 'choose_exit'" class="card stack">
        <p>选择出口</p>
        <button
          v-for="e in state.pendingChoice?.exits ?? []"
          :key="e.id"
          type="button"
          class="primary touch-btn"
          :disabled="!canControl"
          @click="onChooseExit(e.id)"
        >
          {{ e.label }}
        </button>
      </div>
    </template>

    <div v-if="state?.phase === 'order' && state.pendingOrder" class="modal-backdrop">
      <div class="card modal stack">
        <p
          class="tile-category"
          :style="
            state.pendingOrder.tile.categoryColor
              ? { color: state.pendingOrder.tile.categoryColor }
              : undefined
          "
        >
          {{ state.pendingOrder.tile.category }}
        </p>
        <h2>{{ state.pendingOrder.tile.title }}</h2>
        <p style="white-space: pre-wrap">{{ resolvedOrderBody }}</p>
        <button
          class="primary touch-btn"
          type="button"
          :disabled="!canControl"
          @click="onConfirmOrder"
        >
          已执行
        </button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.mobile-room {
  padding-bottom: 1rem;
}

.room-head {
  justify-content: space-between;
  align-items: flex-start;
}

.meta {
  margin: 0.25rem 0 0;
  font-size: 0.82rem;
}

.touch-btn {
  min-height: 44px;
}

.roll-btn {
  width: 100%;
  font-size: 1.05rem;
}

.action-bar .dice {
  margin-top: 0.25rem;
  font-size: 0.85rem;
}

.seat-row {
  display: flex;
  gap: 0.65rem;
  align-items: center;
  padding: 0.65rem;
  border: 1px solid var(--border);
  border-radius: 12px;
  background: var(--panel-2);
}

.avatar-btn {
  padding: 0;
  border: none;
  background: transparent;
  min-height: 56px;
  min-width: 56px;
  border-radius: 50%;
  overflow: hidden;
}

.avatar-btn img {
  display: block;
  border-radius: 50%;
}

.seat-body {
  flex: 1;
  min-width: 0;
  display: grid;
  gap: 0.35rem;
}

.seat-name {
  font-weight: 600;
  font-size: 0.95rem;
}

.touch-input,
.touch-select {
  min-height: 40px;
}

.player-chips {
  list-style: none;
  margin: 0;
  padding: 0;
  display: flex;
  flex-wrap: wrap;
  gap: 0.45rem;
}

.player-chips li {
  padding: 0.35rem 0.7rem;
  border-radius: 999px;
  background: var(--panel);
  border: 1px solid var(--border);
  font-size: 0.85rem;
  min-height: 36px;
  display: inline-flex;
  align-items: center;
  gap: 0.35rem;
}

.player-chips li.current {
  border-color: var(--accent);
}

.player-chips li.finished {
  opacity: 0.45;
}

.tile-category {
  margin: 0;
  font-weight: 600;
}

.modal {
  width: min(100%, 420px);
  max-height: 85dvh;
  overflow: auto;
}
</style>
