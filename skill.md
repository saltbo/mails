# mails — Email for AI Agents

Send and receive emails programmatically. Supports custom domains (self-hosted) or zero-config `@mails.dev` addresses (hosted).

## Quick Start

```bash
# Install
npm install -g mails    # or: bunx mails

# Configure
mails config set resend_api_key re_YOUR_KEY
mails config set default_from "Agent <agent@yourdomain.com>"

# Send
mails send --to user@example.com --subject "Hello" --body "World"
```

## Configuration

Config lives at `~/.mails/config.json`. Set values via CLI:

```bash
mails config set <key> <value>
mails config get <key>
mails config          # show all
```

### Required Keys

| Key | Description |
|-----|-------------|
| `resend_api_key` | Your Resend API key (get one at resend.com) |
| `default_from` | Default sender, e.g. `"Agent <agent@yourdomain.com>"` |

### Optional Keys

| Key | Default | Description |
|-----|---------|-------------|
| `mode` | `hosted` | `hosted` (use @mails.dev) or `selfhosted` (custom domain) |
| `domain` | `mails.dev` | Your email domain |
| `mailbox` | | Your receiving address |
| `storage_provider` | `sqlite` | `sqlite` (local) or `db9` (db9.ai cloud) |
| `db9_token` | | db9.ai API token |
| `db9_database_id` | | db9.ai database ID |

## Sending Emails

### CLI

```bash
# Plain text
mails send --to user@example.com --subject "Report" --body "Here is your report."

# HTML
mails send --to user@example.com --subject "Report" --html "<h1>Report</h1><p>Details...</p>"

# Custom sender
mails send --from "Bot <bot@mydomain.com>" --to user@example.com --subject "Hi" --body "Hello"
```

### Programmatic (SDK)

```typescript
import { send } from 'mails'

const result = await send({
  to: 'user@example.com',
  subject: 'Hello from agent',
  text: 'This is a test email.',
})
console.log(result.id) // Resend message ID
```

### Programmatic (Direct Provider)

```typescript
import { createResendProvider } from 'mails'

const provider = createResendProvider('re_YOUR_KEY')
const result = await provider.send({
  from: 'Agent <agent@yourdomain.com>',
  to: ['user@example.com'],
  subject: 'Hello',
  text: 'Direct provider usage.',
})
```

## Receiving Emails

Requires a Cloudflare Email Routing Worker or the mails.dev hosted service. Once configured:

```bash
# List inbox
mails inbox
mails inbox --mailbox agent@yourdomain.com

# Wait for verification code (long-poll)
mails code --to agent@yourdomain.com --timeout 30
```

### SDK

```typescript
import { getInbox, waitForCode } from 'mails'

// List recent emails
const emails = await getInbox('agent@yourdomain.com', { limit: 10 })

// Wait for a verification code
const result = await waitForCode('agent@yourdomain.com', { timeout: 30 })
if (result) {
  console.log(result.code) // "123456"
}
```

## Cloud API (mails.dev)

For agents that need email without local CLI setup. Pay per use with USDC via x402.

```
Base URL: https://api.mails.dev

POST /v1/send          Send an email ($0.001/email)
GET  /v1/inbox?to=...  List received emails (free)
GET  /v1/code?to=...   Wait for verification code (free)
```

### Send via API

```bash
curl -X POST https://api.mails.dev/v1/send \
  -H "Content-Type: application/json" \
  -d '{
    "from": "agent@mails.dev",
    "to": ["user@example.com"],
    "subject": "Hello",
    "text": "Sent via mails.dev cloud API"
  }'
```

If no payment header is present, the API returns HTTP 402 with payment instructions.
Attach an `X-PAYMENT` header with a signed USDC payment to complete the request.

### Query Inbox

```bash
# List inbox (free)
curl "https://api.mails.dev/v1/inbox?to=myagent@mails.dev&limit=10"

# Wait for verification code (free, long-poll up to 55s)
curl "https://api.mails.dev/v1/code?to=myagent@mails.dev&timeout=30"
```

## Self-Hosted Setup

For custom domains, run the interactive setup:

```bash
mails setup
```

This opens a browser-based wizard at `mails.dev/setup` that guides you through:
1. Cloudflare API token configuration
2. DNS record setup (MX, SPF, DKIM, DMARC)
3. Email Worker deployment
4. Send provider (Resend) configuration
5. Storage provider selection

## Storage Providers

### SQLite (default)
Local database at `~/.mails/mails.db`. Zero config. Good for development and single-agent use.

### db9.ai
Cloud PostgreSQL for agents. Enables multi-agent access to shared mailboxes.

```bash
mails config set storage_provider db9
mails config set db9_token YOUR_TOKEN
mails config set db9_database_id YOUR_DB_ID
```

## Email Schema

All storage providers use this schema:

```sql
CREATE TABLE emails (
  id TEXT PRIMARY KEY,
  mailbox TEXT NOT NULL,
  from_address TEXT NOT NULL,
  from_name TEXT DEFAULT '',
  to_address TEXT NOT NULL,
  subject TEXT DEFAULT '',
  body_text TEXT DEFAULT '',
  body_html TEXT DEFAULT '',
  code TEXT,
  headers TEXT DEFAULT '{}',
  metadata TEXT DEFAULT '{}',
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status TEXT DEFAULT 'received' CHECK (status IN ('received', 'sent', 'failed', 'queued')),
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
CREATE INDEX idx_emails_mailbox ON emails(mailbox, received_at DESC);
```

## Links

- Website: https://mails.dev
- npm: https://www.npmjs.com/package/mails
- GitHub: https://github.com/chekusu/mails
