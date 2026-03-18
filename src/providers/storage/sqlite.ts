import { Database } from 'bun:sqlite'
import { existsSync, mkdirSync } from 'fs'
import { homedir } from 'os'
import { join } from 'path'
import { normalizeEmailForStorage } from '../../core/email-storage.js'
import type { Attachment, Email, StorageProvider } from '../../core/types.js'

const SCHEMA = `
CREATE TABLE IF NOT EXISTS emails (
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
  message_id TEXT,
  has_attachments INTEGER NOT NULL DEFAULT 0,
  attachment_count INTEGER NOT NULL DEFAULT 0,
  attachment_names TEXT DEFAULT '',
  attachment_search_text TEXT DEFAULT '',
  raw_storage_key TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status TEXT DEFAULT 'received' CHECK (status IN ('received', 'sent', 'failed', 'queued')),
  received_at TEXT NOT NULL,
  created_at TEXT NOT NULL
);
ALTER TABLE emails ADD COLUMN IF NOT EXISTS message_id TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS has_attachments INTEGER NOT NULL DEFAULT 0;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS attachment_count INTEGER NOT NULL DEFAULT 0;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS attachment_names TEXT DEFAULT '';
ALTER TABLE emails ADD COLUMN IF NOT EXISTS attachment_search_text TEXT DEFAULT '';
ALTER TABLE emails ADD COLUMN IF NOT EXISTS raw_storage_key TEXT;

CREATE TABLE IF NOT EXISTS attachments (
  id TEXT PRIMARY KEY,
  email_id TEXT NOT NULL,
  filename TEXT NOT NULL,
  content_type TEXT NOT NULL,
  size_bytes INTEGER,
  content_disposition TEXT,
  content_id TEXT,
  mime_part_index INTEGER NOT NULL,
  text_content TEXT DEFAULT '',
  text_extraction_status TEXT NOT NULL DEFAULT 'pending',
  storage_key TEXT,
  content_base64 TEXT,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_emails_mailbox ON emails(mailbox, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_code ON emails(mailbox) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_email_id ON attachments(email_id);
CREATE INDEX IF NOT EXISTS idx_attachments_filename ON attachments(filename);
`

export function createSqliteProvider(dbPath?: string): StorageProvider {
  const dir = join(homedir(), '.mails')
  if (!existsSync(dir)) mkdirSync(dir, { recursive: true })

  const path = dbPath ?? join(dir, 'mails.db')
  let db: Database

  return {
    name: 'sqlite',

    async init() {
      db = new Database(path)
      db.exec('PRAGMA journal_mode=WAL;')
      db.exec(SCHEMA)
    },

    async saveEmail(emailInput: Email) {
      const email = normalizeEmailForStorage(emailInput)
      const insertEmail = db.prepare(`
        INSERT OR REPLACE INTO emails (
          id, mailbox, from_address, from_name, to_address, subject,
          body_text, body_html, code, headers, metadata, message_id,
          has_attachments, attachment_count, attachment_names, attachment_search_text,
          raw_storage_key, direction, status, received_at, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)
      const deleteAttachments = db.prepare('DELETE FROM attachments WHERE email_id = ?')
      const insertAttachment = db.prepare(`
        INSERT OR REPLACE INTO attachments (
          id, email_id, filename, content_type, size_bytes,
          content_disposition, content_id, mime_part_index,
          text_content, text_extraction_status, storage_key, content_base64, created_at
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `)

      const transaction = db.transaction((record: Email) => {
        insertEmail.run(
          record.id,
          record.mailbox,
          record.from_address,
          record.from_name,
          record.to_address,
          record.subject,
          record.body_text,
          record.body_html,
          record.code,
          JSON.stringify(record.headers),
          JSON.stringify(record.metadata),
          record.message_id ?? null,
          record.has_attachments ? 1 : 0,
          record.attachment_count ?? 0,
          record.attachment_names ?? '',
          record.attachment_search_text ?? '',
          record.raw_storage_key ?? null,
          record.direction,
          record.status,
          record.received_at,
          record.created_at,
        )

        deleteAttachments.run(record.id)
        for (const attachment of record.attachments ?? []) {
          insertAttachment.run(
            attachment.id,
            attachment.email_id,
            attachment.filename,
            attachment.content_type,
            attachment.size_bytes,
            attachment.content_disposition,
            attachment.content_id,
            attachment.mime_part_index,
            attachment.text_content,
            attachment.text_extraction_status,
            attachment.storage_key,
            attachment.content_base64 ?? null,
            attachment.created_at,
          )
        }
      })

      transaction(email)
    },

    async getEmails(mailbox, options) {
      const limit = options?.limit ?? 20
      const offset = options?.offset ?? 0
      let query = 'SELECT * FROM emails WHERE mailbox = ?'
      const params: (string | number)[] = [mailbox]

      if (options?.direction) {
        query += ' AND direction = ?'
        params.push(options.direction)
      }

      query += ' ORDER BY received_at DESC LIMIT ? OFFSET ?'
      params.push(limit, offset)

      const rows = db.prepare(query).all(...params) as Record<string, unknown>[]
      return rows.map((row) => rowToEmail(row))
    },

    async getEmail(id) {
      const row = db.prepare('SELECT * FROM emails WHERE id = ?').get(id) as Record<string, unknown> | null
      if (!row) return null

      const attachmentRows = db.prepare(
        'SELECT * FROM attachments WHERE email_id = ? ORDER BY mime_part_index ASC'
      ).all(id) as Record<string, unknown>[]

      return rowToEmail(row, attachmentRows.map(rowToAttachment))
    },

    async getAttachment(id) {
      const row = db.prepare('SELECT * FROM attachments WHERE id = ?').get(id) as Record<string, unknown> | null
      return row ? rowToAttachment(row) : null
    },

    async getCode(mailbox, options) {
      const timeout = (options?.timeout ?? 30) * 1000
      const since = options?.since
      const deadline = Date.now() + timeout

      while (Date.now() < deadline) {
        let query = 'SELECT code, from_address, subject FROM emails WHERE mailbox = ? AND code IS NOT NULL'
        const params: string[] = [mailbox]

        if (since) {
          query += ' AND received_at > ?'
          params.push(since)
        }

        query += ' ORDER BY received_at DESC LIMIT 1'

        const row = db.prepare(query).get(...params) as { code: string; from_address: string; subject: string } | null
        if (row) {
          return { code: row.code, from: row.from_address, subject: row.subject }
        }

        await new Promise(r => setTimeout(r, 1000))
      }

      return null
    },
  }
}

function rowToEmail(row: Record<string, unknown>, attachments?: Attachment[]): Email {
  return {
    id: String(row.id ?? ''),
    mailbox: String(row.mailbox ?? ''),
    from_address: String(row.from_address ?? ''),
    from_name: String(row.from_name ?? ''),
    to_address: String(row.to_address ?? ''),
    subject: String(row.subject ?? ''),
    body_text: String(row.body_text ?? ''),
    body_html: String(row.body_html ?? ''),
    code: row.code == null ? null : String(row.code),
    headers: safeJsonParse(row.headers, {}),
    metadata: safeJsonParse(row.metadata, {}),
    direction: row.direction === 'outbound' ? 'outbound' : 'inbound',
    status: row.status === 'sent' || row.status === 'failed' || row.status === 'queued' ? row.status : 'received',
    message_id: row.message_id == null ? null : String(row.message_id),
    has_attachments: Boolean(row.has_attachments),
    attachment_count: toNumber(row.attachment_count) ?? 0,
    attachment_names: String(row.attachment_names ?? ''),
    attachment_search_text: String(row.attachment_search_text ?? ''),
    raw_storage_key: row.raw_storage_key == null ? null : String(row.raw_storage_key),
    attachments,
    received_at: String(row.received_at ?? ''),
    created_at: String(row.created_at ?? ''),
  }
}

function rowToAttachment(row: Record<string, unknown>): Attachment {
  return {
    id: String(row.id ?? ''),
    email_id: String(row.email_id ?? ''),
    filename: String(row.filename ?? ''),
    content_type: String(row.content_type ?? 'application/octet-stream'),
    size_bytes: toNumber(row.size_bytes),
    content_disposition: row.content_disposition == null ? null : String(row.content_disposition),
    content_id: row.content_id == null ? null : String(row.content_id),
    mime_part_index: toNumber(row.mime_part_index) ?? 0,
    text_content: String(row.text_content ?? ''),
    text_extraction_status: readAttachmentStatus(row.text_extraction_status),
    storage_key: row.storage_key == null ? null : String(row.storage_key),
    content_base64: row.content_base64 == null ? null : String(row.content_base64),
    downloadable: Boolean(row.storage_key || row.content_base64),
    created_at: String(row.created_at ?? ''),
  }
}

function safeJsonParse<T>(value: unknown, fallback: T): T {
  if (typeof value !== 'string') return fallback
  try {
    return JSON.parse(value) as T
  } catch {
    return fallback
  }
}

function toNumber(value: unknown): number | null {
  return typeof value === 'number' && Number.isFinite(value) ? value : null
}

function readAttachmentStatus(value: unknown): Attachment['text_extraction_status'] {
  switch (value) {
    case 'done':
    case 'unsupported':
    case 'failed':
    case 'too_large':
    case 'pending':
      return value
    default:
      return 'pending'
  }
}
