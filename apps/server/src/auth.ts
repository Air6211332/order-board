import { createHash, randomBytes, scryptSync, timingSafeEqual } from 'node:crypto';
import { nanoid } from 'nanoid';
import type { FastifyReply, FastifyRequest } from 'fastify';
import { db, withTransaction } from './db.js';

const SESSION_COOKIE = 'ob_session';
const SESSION_DAYS = 14;
const TEMP_IDLE_MS = 30 * 24 * 60 * 60 * 1000;

export function hashPassword(password: string): string {
  const salt = randomBytes(16).toString('hex');
  const hash = scryptSync(password, salt, 64).toString('hex');
  return `${salt}:${hash}`;
}

export function verifyPassword(password: string, stored: string): boolean {
  if (!stored || !stored.includes(':')) return false;
  const [salt, hash] = stored.split(':');
  if (!salt || !hash) return false;
  const actual = scryptSync(password, salt, 64);
  const expected = Buffer.from(hash, 'hex');
  if (actual.length !== expected.length) return false;
  return timingSafeEqual(actual, expected);
}

export function createSession(userId: string): string {
  const id = nanoid(32);
  const expiresAt = Date.now() + SESSION_DAYS * 24 * 60 * 60 * 1000;
  db.prepare('INSERT INTO sessions (id, user_id, expires_at) VALUES (?, ?, ?)').run(
    id,
    userId,
    expiresAt,
  );
  return id;
}

export function destroySession(sessionId: string): void {
  db.prepare('DELETE FROM sessions WHERE id = ?').run(sessionId);
}

export function setSessionCookie(reply: FastifyReply, sessionId: string): void {
  reply.setCookie(SESSION_COOKIE, sessionId, {
    path: '/',
    httpOnly: true,
    sameSite: 'lax',
    maxAge: SESSION_DAYS * 24 * 60 * 60,
  });
}

export function clearSessionCookie(reply: FastifyReply): void {
  reply.clearCookie(SESSION_COOKIE, { path: '/' });
}

export interface AuthUser {
  id: string;
  username: string;
  isTemp: boolean;
}

function mapUser(row: { id: string; username: string; is_temp?: number | boolean }): AuthUser {
  return {
    id: row.id,
    username: row.username,
    isTemp: Boolean(row.is_temp),
  };
}

export function touchUserActive(userId: string): void {
  db.prepare('UPDATE users SET last_active_at = ? WHERE id = ?').run(Date.now(), userId);
}

export function getUserFromSessionId(sessionId: string): AuthUser | null {
  const row = db
    .prepare(
      `SELECT u.id, u.username, u.is_temp, s.expires_at
       FROM sessions s
       JOIN users u ON u.id = s.user_id
       WHERE s.id = ?`,
    )
    .get(sessionId) as
    | { id: string; username: string; is_temp: number; expires_at: number }
    | undefined;
  if (!row) return null;
  if (row.expires_at < Date.now()) {
    destroySession(sessionId);
    return null;
  }
  touchUserActive(row.id);
  return mapUser(row);
}

export function getUserFromRequest(request: FastifyRequest): AuthUser | null {
  const sessionId = request.cookies?.[SESSION_COOKIE];
  if (!sessionId) return null;
  return getUserFromSessionId(sessionId);
}

export function requireUser(request: FastifyRequest, reply: FastifyReply): AuthUser | null {
  const user = getUserFromRequest(request);
  if (!user) {
    reply.code(401).send({ error: '未登录' });
    return null;
  }
  return user;
}

/** 无会话时创建临时用户并写 Cookie；已有会话则刷新活跃并返回 */
export function ensureGuestUser(request: FastifyRequest, reply: FastifyReply): AuthUser {
  const existing = getUserFromRequest(request);
  if (existing) return existing;

  const id = newUserId();
  const username = `游客_${nanoid(6)}`;
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at, is_temp, last_active_at)
     VALUES (?, ?, '', ?, 1, ?)`,
  ).run(id, username, now, now);
  const sessionId = createSession(id);
  setSessionCookie(reply, sessionId);
  return { id, username, isTemp: true };
}

/**
 * 注册：若当前为临时用户则升级同一 id；否则新建正式用户。
 */
export function registerOrUpgrade(
  request: FastifyRequest,
  reply: FastifyReply,
  username: string,
  password: string,
): { ok: true; user: AuthUser } | { ok: false; status: number; error: string } {
  if (username.length < 2 || username.length > 32) {
    return { ok: false, status: 400, error: '用户名长度须为 2–32' };
  }
  if (password.length < 4) {
    return { ok: false, status: 400, error: '密码至少 4 位' };
  }

  const current = getUserFromRequest(request);
  const taken = db
    .prepare('SELECT id FROM users WHERE username = ? COLLATE NOCASE')
    .get(username) as { id: string } | undefined;

  if (current?.isTemp) {
    if (taken && taken.id !== current.id) {
      return { ok: false, status: 409, error: '用户名已存在' };
    }
    // 临时用户名可能与目标同名（仅大小写），允许占用自己
    withTransaction(() => {
      db.prepare(
        `UPDATE users SET username = ?, password_hash = ?, is_temp = 0, last_active_at = ?
         WHERE id = ?`,
      ).run(username, hashPassword(password), Date.now(), current.id);
    });
    return {
      ok: true,
      user: { id: current.id, username, isTemp: false },
    };
  }

  if (taken) {
    return { ok: false, status: 409, error: '用户名已存在' };
  }

  const id = newUserId();
  const now = Date.now();
  db.prepare(
    `INSERT INTO users (id, username, password_hash, created_at, is_temp, last_active_at)
     VALUES (?, ?, ?, ?, 0, ?)`,
  ).run(id, username, hashPassword(password), now, now);
  const sessionId = createSession(id);
  setSessionCookie(reply, sessionId);
  return { ok: true, user: { id, username, isTemp: false } };
}

/** 删除超过 idleMs 未活跃的临时用户（连带棋盘/指令/会话） */
export function purgeInactiveTempUsers(idleMs: number = TEMP_IDLE_MS): number {
  const cutoff = Date.now() - idleMs;
  const result = db
    .prepare(
      `DELETE FROM users
       WHERE is_temp = 1
         AND COALESCE(last_active_at, created_at) < ?`,
    )
    .run(cutoff);
  return Number(result.changes ?? 0);
}

/** 生成用户 id */
export function newUserId(): string {
  return nanoid(16);
}

export function newId(prefix = ''): string {
  return prefix ? `${prefix}_${nanoid(12)}` : nanoid(12);
}

/** 简易指纹，仅用于日志，非安全用途 */
export function fingerprint(s: string): string {
  return createHash('sha256').update(s).digest('hex').slice(0, 8);
}

export { SESSION_COOKIE, TEMP_IDLE_MS };
