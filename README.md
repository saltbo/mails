# mails

Email infrastructure for AI agents. Send and receive emails programmatically.

[![npm](https://img.shields.io/npm/v/mails)](https://www.npmjs.com/package/mails)
[![license](https://img.shields.io/npm/l/mails)](https://github.com/chekusu/mails/blob/main/LICENSE)

[日本語](https://github.com/chekusu/mails/blob/main/README.ja.md) | [中文](https://github.com/chekusu/mails/blob/main/README.zh.md)

## Features

- **Send emails** via Resend (more providers coming)
- **Receive emails** via Cloudflare Email Routing Worker
- **Verification code extraction** — auto-extracts codes from emails (EN/ZH/JA/KO)
- **Storage providers** — local SQLite (default) or [db9.ai](https://db9.ai) cloud PostgreSQL
- **Zero dependencies** — Resend provider uses raw `fetch()`, no SDK needed
- **Agent-first** — designed for AI agents with `skill.md` integration guide
- **Cloud service** — `@mails.dev` addresses with x402 micropayments (coming soon)

## Install

```bash
npm install -g mails
# or
bun install -g mails
# or use directly
npx mails
```

## Quick Start

```bash
# Configure
mails config set resend_api_key re_YOUR_KEY
mails config set default_from "Agent <agent@yourdomain.com>"

# Send an email
mails send --to user@example.com --subject "Hello" --body "World"
```

## CLI Reference

### Send

```bash
mails send --to <email> --subject <subject> --body <text>
mails send --to <email> --subject <subject> --html "<h1>Hello</h1>"
mails send --from "Name <email>" --to <email> --subject <subject> --body <text>
```

### Inbox

```bash
mails inbox                           # List recent emails
mails inbox --mailbox agent@test.com  # Specific mailbox
mails inbox <id>                      # View email details
```

### Verification Code

```bash
mails code --to agent@test.com              # Wait for code (default 30s)
mails code --to agent@test.com --timeout 60 # Custom timeout
```

The code is printed to stdout for easy piping: `CODE=$(mails code --to agent@test.com)`

### Config

```bash
mails config                    # Show all config
mails config set <key> <value>  # Set a value
mails config get <key>          # Get a value
mails config path               # Show config file path
```

## SDK Usage

```typescript
import { send, getInbox, waitForCode } from 'mails'

// Send
const result = await send({
  to: 'user@example.com',
  subject: 'Hello',
  text: 'World',
})

// List inbox
const emails = await getInbox('agent@yourdomain.com', { limit: 10 })

// Wait for verification code
const code = await waitForCode('agent@yourdomain.com', { timeout: 30 })
if (code) console.log(code.code) // "123456"
```

### Direct Provider Usage

```typescript
import { createResendProvider } from 'mails'

const resend = createResendProvider('re_YOUR_KEY')
await resend.send({
  from: 'Agent <agent@yourdomain.com>',
  to: ['user@example.com'],
  subject: 'Hello',
  text: 'Direct provider usage',
})
```

## Email Worker

The `worker/` directory contains a Cloudflare Email Routing Worker for receiving emails.

### Setup

```bash
cd worker
bun install
# Edit wrangler.toml — set your D1 database ID
wrangler d1 create mails
wrangler d1 execute mails --file=schema.sql
wrangler deploy
```

Then configure Cloudflare Email Routing to forward to this worker.

### Worker API

| Endpoint | Description |
|----------|-------------|
| `GET /api/inbox?to=<addr>&limit=20` | List emails |
| `GET /api/code?to=<addr>&timeout=30` | Long-poll for verification code |
| `GET /api/email?id=<id>` | Get email by ID |
| `GET /health` | Health check |

## Storage Providers

### SQLite (default)

Local database at `~/.mails/mails.db`. Zero config.

### db9.ai

Cloud PostgreSQL for AI agents.

```bash
mails config set storage_provider db9
mails config set db9_token YOUR_TOKEN
mails config set db9_database_id YOUR_DB_ID
```

## Config Keys

| Key | Default | Description |
|-----|---------|-------------|
| `mode` | `hosted` | `hosted` or `selfhosted` |
| `domain` | `mails.dev` | Email domain |
| `mailbox` | | Your receiving address |
| `send_provider` | `resend` | Send provider |
| `storage_provider` | `sqlite` | `sqlite` or `db9` |
| `resend_api_key` | | Resend API key |
| `default_from` | | Default sender address |
| `db9_token` | | db9.ai API token |
| `db9_database_id` | | db9.ai database ID |

## Testing

```bash
bun test              # Run all tests (78 unit + 1 E2E)
bun test:coverage     # With coverage report
bun test:live         # Live E2E with real Resend + Cloudflare (requires .env)
```

### Test Coverage

```
---------------------------------|---------|---------|
File                             | % Funcs | % Lines |
---------------------------------|---------|---------|
All files                        |  100.00 |  100.00 |
 src/cli/commands/help.ts        |  100.00 |  100.00 |
 src/core/config.ts              |  100.00 |  100.00 |
 src/core/send.ts                |  100.00 |  100.00 |
 src/core/types.ts               |  100.00 |  100.00 |
 src/providers/send/resend.ts    |  100.00 |  100.00 |
 src/providers/storage/db9.ts    |  100.00 |  100.00 |
 src/providers/storage/sqlite.ts |  100.00 |  100.00 |
 worker/src/extract-code.ts      |  100.00 |  100.00 |
---------------------------------|---------|---------|

78 unit tests + 8 live E2E tests (real Resend + Cloudflare Email Routing)
```

## License

MIT
