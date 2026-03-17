# mails

面向 AI Agent 的邮件基础设施。通过编程方式收发邮件。

[![npm](https://img.shields.io/npm/v/mails)](https://www.npmjs.com/package/mails)
[![license](https://img.shields.io/npm/l/mails)](https://github.com/chekusu/mails/blob/main/LICENSE)

[English](https://github.com/chekusu/mails/blob/main/README.md) | [日本語](https://github.com/chekusu/mails/blob/main/README.ja.md)

## 特性

- **发送邮件** — 通过 Resend（更多 Provider 即将支持）
- **接收邮件** — 通过 Cloudflare Email Routing Worker
- **验证码自动提取** — 自动从邮件中提取验证码（支持中/英/日/韩）
- **存储 Provider** — 本地 SQLite（默认）或 [db9.ai](https://db9.ai) 云端 PostgreSQL
- **零依赖** — Resend Provider 直接使用 `fetch()`，无需 SDK
- **Agent 优先** — 为 AI Agent 设计，附带 `skill.md` 接入指南
- **云服务** — `@mails.dev` 邮箱地址，x402 微支付（即将上线）

## 安装

```bash
npm install -g mails
# 或
bun install -g mails
# 或直接使用
npx mails
```

## 快速开始

```bash
# 配置
mails config set resend_api_key re_YOUR_KEY
mails config set default_from "Agent <agent@yourdomain.com>"

# 发送邮件
mails send --to user@example.com --subject "Hello" --body "World"
```

## CLI 参考

### 发送

```bash
mails send --to <email> --subject <subject> --body <text>
mails send --to <email> --subject <subject> --html "<h1>Hello</h1>"
mails send --from "Name <email>" --to <email> --subject <subject> --body <text>
```

### 收件箱

```bash
mails inbox                           # 最近邮件列表
mails inbox --mailbox agent@test.com  # 指定邮箱
mails inbox <id>                      # 查看邮件详情
```

### 验证码

```bash
mails code --to agent@test.com              # 等待验证码（默认 30 秒）
mails code --to agent@test.com --timeout 60 # 自定义超时
```

验证码输出到 stdout，方便管道使用：`CODE=$(mails code --to agent@test.com)`

### 配置

```bash
mails config                    # 显示所有配置
mails config set <key> <value>  # 设置值
mails config get <key>          # 获取值
mails config path               # 显示配置文件路径
```

## SDK 用法

```typescript
import { send, getInbox, waitForCode } from 'mails'

// 发送
const result = await send({
  to: 'user@example.com',
  subject: 'Hello',
  text: 'World',
})

// 收件箱列表
const emails = await getInbox('agent@yourdomain.com', { limit: 10 })

// 等待验证码
const code = await waitForCode('agent@yourdomain.com', { timeout: 30 })
if (code) console.log(code.code) // "123456"
```

## 邮件 Worker

`worker/` 目录包含 Cloudflare Email Routing Worker，用于接收邮件。

### 部署

```bash
cd worker
bun install
# 编辑 wrangler.toml — 设置你的 D1 数据库 ID
wrangler d1 create mails
wrangler d1 execute mails --file=schema.sql
wrangler deploy
```

然后在 Cloudflare Email Routing 中配置转发到此 Worker。

## 存储 Provider

### SQLite（默认）

本地数据库 `~/.mails/mails.db`，无需配置。

### db9.ai

面向 AI Agent 的云端 PostgreSQL。

```bash
mails config set storage_provider db9
mails config set db9_token YOUR_TOKEN
mails config set db9_database_id YOUR_DB_ID
```

## 配置项

| 键 | 默认值 | 说明 |
|---|--------|------|
| `mode` | `hosted` | `hosted` 或 `selfhosted` |
| `domain` | `mails.dev` | 邮件域名 |
| `mailbox` | | 接收邮箱地址 |
| `send_provider` | `resend` | 发送 Provider |
| `storage_provider` | `sqlite` | `sqlite` 或 `db9` |
| `resend_api_key` | | Resend API 密钥 |
| `default_from` | | 默认发件人地址 |
| `db9_token` | | db9.ai API Token |
| `db9_database_id` | | db9.ai 数据库 ID |

## 测试

```bash
bun test              # 运行所有测试（单元 78 + E2E 1）
bun test:coverage     # 带覆盖率报告
bun test:live         # Live E2E（真实 Resend + Cloudflare，需要 .env）
```

全部文件: 100.00% Functions | 100.00% Lines — 78 个单元测试 + 8 个 Live E2E 测试

## 许可证

MIT
