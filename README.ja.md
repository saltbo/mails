# mails

AIエージェント向けのメールインフラ。プログラムでメールの送受信ができます。

[![npm](https://img.shields.io/npm/v/mails)](https://www.npmjs.com/package/mails)
[![license](https://img.shields.io/npm/l/mails)](LICENSE)

[English](README.md) | [中文](README.zh.md)

## テストカバレッジ

```
全ファイル: 100.00% Functions | 100.00% Lines
ユニットテスト 78件 + ライブ E2E テスト 8件（実際の Resend + Cloudflare Email Routing）
```

## 特徴

- **メール送信** — Resend経由（他のプロバイダーも追加予定）
- **メール受信** — Cloudflare Email Routing Worker経由
- **認証コード自動抽出** — メールから認証コードを自動検出（英語/中国語/日本語/韓国語対応）
- **ストレージプロバイダー** — ローカルSQLite（デフォルト）または [db9.ai](https://db9.ai) クラウドPostgreSQL
- **依存関係ゼロ** — Resendプロバイダーは `fetch()` を直接使用、SDKは不要
- **エージェントファースト** — `skill.md` 統合ガイド付きのAIエージェント向け設計
- **クラウドサービス** — `@mails.dev` アドレス、x402マイクロペイメント対応（近日公開）

## インストール

```bash
npm install -g mails
# または
bun install -g mails
# または直接実行
npx mails
```

## クイックスタート

```bash
# 設定
mails config set resend_api_key re_YOUR_KEY
mails config set default_from "Agent <agent@yourdomain.com>"

# メール送信
mails send --to user@example.com --subject "Hello" --body "World"
```

## CLIリファレンス

### 送信

```bash
mails send --to <email> --subject <subject> --body <text>
mails send --to <email> --subject <subject> --html "<h1>Hello</h1>"
mails send --from "Name <email>" --to <email> --subject <subject> --body <text>
```

### 受信箱

```bash
mails inbox                           # 最近のメール一覧
mails inbox --mailbox agent@test.com  # 特定メールボックス
mails inbox <id>                      # メール詳細表示
```

### 認証コード

```bash
mails code --to agent@test.com              # コード待機（デフォルト30秒）
mails code --to agent@test.com --timeout 60 # タイムアウト指定
```

コードは標準出力に出力されるため、パイプで利用可能: `CODE=$(mails code --to agent@test.com)`

### 設定

```bash
mails config                    # 全設定表示
mails config set <key> <value>  # 値を設定
mails config get <key>          # 値を取得
mails config path               # 設定ファイルのパス表示
```

## SDK

```typescript
import { send, getInbox, waitForCode } from 'mails'

// 送信
const result = await send({
  to: 'user@example.com',
  subject: 'Hello',
  text: 'World',
})

// 受信箱一覧
const emails = await getInbox('agent@yourdomain.com', { limit: 10 })

// 認証コード待機
const code = await waitForCode('agent@yourdomain.com', { timeout: 30 })
if (code) console.log(code.code) // "123456"
```

## メールワーカー

`worker/` ディレクトリにCloudflare Email Routing Workerが含まれています。

### セットアップ

```bash
cd worker
bun install
# wrangler.toml を編集 — D1データベースIDを設定
wrangler d1 create mails
wrangler d1 execute mails --file=schema.sql
wrangler deploy
```

その後、Cloudflare Email Routingでこのワーカーへの転送を設定します。

## ストレージプロバイダー

### SQLite（デフォルト）

`~/.mails/mails.db` のローカルデータベース。設定不要。

### db9.ai

AIエージェント向けクラウドPostgreSQL。

```bash
mails config set storage_provider db9
mails config set db9_token YOUR_TOKEN
mails config set db9_database_id YOUR_DB_ID
```

## テスト

```bash
bun test              # 全テスト実行
bun test --coverage   # カバレッジレポート付き
```

## ライセンス

MIT
