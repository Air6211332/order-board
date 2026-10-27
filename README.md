# 令棋 Order Board

私密向网页棋盘游戏：编辑棋盘与指令 → 开房入座 → 掷骰沿出口走步 → 落点执行指令。

支持游客试玩、单机/多人房间、棋盘公开分享与大屏观战。当前版本未稳定，数据随时可能重置。

## 功能概览

| 模块 | 说明 |
| --- | --- |
| 大厅 | 公开房间列表；快捷开房（我的棋盘 / 公开棋盘） |
| 棋盘 | 新建/编辑网格、出口、起点终点、突出格；从指令库拷贝文案 |
| 指令库 | 分类 / 强度 / 标签；正文支持角色占位符 |
| 开局 | 配置座位、角色、头像；公开或私有开房 |
| 对局 | Phaser 棋盘、WebSocket 同步；可开大屏页 |

## 技术栈

- **前端**：Vue 3、Vue Router、Pinia、Phaser 3、Vite
- **后端**：Fastify、WebSocket、Cookie 会话
- **数据**：Node 内置 SQLite（`node:sqlite`），文件默认在 `data/order-board.sqlite`
- **规则**：`packages/rules` 纯逻辑包（Vitest）

Monorepo（npm workspaces）：

```
packages/rules   # 回合引擎、占位符、校验
apps/server      # API / WS / SQLite
apps/web         # 全部页面
```

## 环境要求

- Node.js ≥ 20（推荐 22+）
- 本机开发：后端 `3789`，前端 `5173`（Vite 代理 `/api`、`/ws`）

## 快速开始

```bash
npm install
npm run build -w @order-board/rules
npm run seed -w @order-board/server   # 可选：demo 账号 + 示例棋盘
npm run dev:server                     # http://127.0.0.1:3789
npm run dev:web                        # http://127.0.0.1:5173
```

浏览器打开前端。若已 seed，可用 `demo` / `demo1234` 登录；也可直接游客进入。

常用脚本：

```bash
npm run build          # 依次构建 rules → server → web
npm run test:rules     # 规则引擎测试
npm run test -w @order-board/web   # 前端单测（含棋盘几何等）
```

## 对局规则摘要

- 掷 1–6，沿当前格出口一步一步前进；多出口按分叉模式处理（自选 / 前进骰点数 / 独立分叉骰等）
- **只在最终落点**触发格子指令；确认执行后换人
- 可设多个起点；结束格支持「直接结束」或「残值后退」
- 房间状态经 WebSocket 同步；刷新后仍可按房间码重进（以服务端房间快照为准）

## 棋盘编辑要点

- 点击空格添加、拖动换位、双击删除；右侧配置全局或单格属性
- **突出格**：长宽约 ×1.5（槽位按突出尺寸预留，缝隙加大）
- **出口箭头**：能直连则直线；会被其他卡片挡住时折线绕开
- 指令写入格子文案，**不绑定**指令库记录；可随时改库而不影响已保存棋盘

## 数据与账号

- SQLite：`data/order-board.sqlite`（可用环境变量 `ORDER_BOARD_DB` 覆盖路径）
- 游客会话可「登录/注册」升级；棋盘可见性支持私有 / 公开（单人棋盘不可公开）

## 许可证

Private — 仅供内部/授权使用。
