# 客群数据系统（分群系统）

面向连锁零食门店的客群经营分析平台：以「过店 → 进店 → 成交 → 客单价」漏斗为核心，提供三维度诊断、运营方案（四率决策）、策略推送闭环、AI 海报/爆品选品，以及「客群基本信息」看板（综合报告 / 客群矩阵 / 人群结构 / 时段高峰 / 客流趋势）。

## 技术栈

- 后端：Node.js + Express（ESM）
- 前端：原生 HTML/CSS/JS + ECharts
- 数据：CSV（分时客流/人群明细）+ JSON（门店漏斗数据）+ JSON 文件存储

## 目录结构

```
server/           Express 后端（路由 / 服务 / 数据存储）
public/           HTML 页面与前端资源
  ├── index.html      登录
  ├── ops.html        运营/品牌/门店管理员工作台
  ├── admin.html      超级管理员（系统管理 + 品牌门店总览）
  ├── executor.html   门店执行者
  ├── crowd-report/   综合客群报告（分时客流/人群 CSV 数据）
  └── assets/         前端 JS / CSS / logo
data/             门店漏斗数据 + 演示数据
scripts/          数据生成脚本
```

## 角色（4 类）

| 角色 | 账号（演示） | 密码 | 权限 |
|---|---|---|---|
| 超级管理员 | admin@fenqun.local | Admin@2026 | 全品牌全门店 + 系统管理 |
| 品牌管理员 | ops@fenqun.local | Ops@2026 | 多门店经营 + 本品牌系统管理 |
| 门店管理员 | store@fenqun.local | Store@2026 | 单店业绩/三阶段诊断/客群看板/任务 |
| 门店执行者 | exec@fenqun.local | Exec@2026 | 仅待执行任务 |

## 快速开始

```bash
cd server
npm install
PORT=3011 node index.mjs
# 访问 http://localhost:3011（或由 nginx 反代 /kequn/system/ 静态资源 + /kequn/system/api/ 后端）
```

生产部署通过 nginx 托管 `public/` 静态资源，并将 `/kequn/system/api/` 反向代理到后端端口。

## 环境变量（可选）

复制 `.env.example` 为 `.env`，可配置：
- `PORT`：后端端口（默认 3011）
- `JWT_SECRET`：JWT 密钥
- `ARK_API_KEY` / `ARK_TEXT_MODEL` / `ARK_IMAGE_MODEL`：火山方舟 AI（生图/海报）
- `SITE_URL`：站点地址（邮件链接用）

未配置 AI 密钥时，AI 相关功能走演示降级。
