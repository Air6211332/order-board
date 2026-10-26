# 令棋 Order Board

私密向网页棋盘：掷骰 → 沿格子出口走步 → 落点执行指令。第一版支持同一台设备轮流玩。

技术栈：Vue 3 + Phaser 3 + Fastify + Node 内置 SQLite（`node:sqlite`）。

## 启动

需要 Node.js ≥ 20（推荐 22+，本机已用 26 验证）。

```bash
npm install
npm run build -w @order-board/rules
npm run seed -w @order-board/server   # 可选：demo / demo1234 + 示例棋盘
npm run dev:server                     # http://127.0.0.1:3789
npm run dev:web                        # http://127.0.0.1:5173
```

浏览器打开前端地址，用 `demo` / `demo1234` 登录（若已 seed）。

## 目录

- `packages/rules` — 回合规则引擎（Vitest）
- `apps/server` — 鉴权、指令库、棋盘 API；SQLite 文件在 `data/order-board.sqlite`
- `apps/web` — 登录 / 指令库 / 棋盘编辑 / 对局

## 规则摘要

- 1–6 人共用一台设备轮流
- 掷 1–6，沿当前格出口一步一步走；多出口时当场选择
- 只在最终落点触发指令；确认「已执行」后换人
- 刷新页面会丢失本局（对局只在内存）

## 测试

```bash
npm run test:rules
```
