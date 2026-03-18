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
  headers JSONB DEFAULT '{}',
  metadata JSONB DEFAULT '{}',
  message_id TEXT,
  has_attachments BOOLEAN NOT NULL DEFAULT FALSE,
  attachment_count INTEGER NOT NULL DEFAULT 0,
  attachment_names TEXT DEFAULT '',
  attachment_search_text TEXT DEFAULT '',
  raw_storage_key TEXT,
  direction TEXT NOT NULL CHECK (direction IN ('inbound', 'outbound')),
  status TEXT DEFAULT 'received' CHECK (status IN ('received', 'sent', 'failed', 'queued')),
  received_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
ALTER TABLE emails ADD COLUMN IF NOT EXISTS message_id TEXT;
ALTER TABLE emails ADD COLUMN IF NOT EXISTS has_attachments BOOLEAN NOT NULL DEFAULT FALSE;
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
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS idx_emails_mailbox ON emails(mailbox, received_at DESC);
CREATE INDEX IF NOT EXISTS idx_emails_code ON emails(mailbox) WHERE code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_attachments_email_id ON attachments(email_id);
CREATE INDEX IF NOT EXISTS idx_attachments_filename ON attachments(filename);
`

interface Db9SqlResult {
  columns: string[]
  rows: unknown[][]
  row_count: number
}

export function createDb9Provider(token: string, databaseId: string): StorageProvider {
  const baseUrl = 'https://api.db9.ai'

  async function sql(query: string): Promise<Db9SqlResult> {
    const res = await fetch(`${baseUrl}/customer/databases/${databaseId}/sql`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${token}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ query }),
    })
    if (!res.ok) {
      const text = await res.text()
      throw new Error(`db9 error (${res.status}): ${text}`)
    }
    return await res.json() as Db9SqlResult
  }

  function rowsToEmails(result: Db9SqlResult): Email[] {
    return result.rows.map((row) => {
      const obj: Record<string, unknown> = {}
      result.columns.forEach((col, i) => { obj[col] = row[i] })
      return rowToEmail(obj)
    })
  }

  return {
    name: 'db9',

    async init() {
      await sql(SCHEMA)
    },

    async saveEmail(emailInput: Email) {
      const email = normalizeEmailForStorage(emailInput)
      const statements = [
        `
        INSERT INTO emails (
          id, mailbox, from_address, from_name, to_address, subject,
          body_text, body_html, code, headers, metadata, message_id,
          has_attachments, attachment_count, attachment_names, attachment_search_text,
          raw_storage_key, direction, status, received_at, created_at
        )
        VALUES (
          ${text(email.id)}, ${text(email.mailbox)}, ${text(email.from_address)}, ${text(email.from_name)},
          ${text(email.to_address)}, ${text(email.subject)}, ${text(email.body_text)}, ${text(email.body_html)},
          ${nullableText(email.code)}, ${jsonb(email.headers)}, ${jsonb(email.metadata)}, ${nullableText(email.message_id)},
          ${bool(email.has_attachments ?? false)}, ${integer(email.attachment_count ?? 0)}, ${text(email.attachment_names ?? '')},
          ${text(email.attachment_search_text ?? '')}, ${nullableText(email.raw_storage_key)}, ${text(email.direction)},
          ${text(email.status)}, ${text(email.received_at)}, ${text(email.created_at)}
        )
        ON CONFLICT (id) DO UPDATE SET
          mailbox = EXCLUDED.mailbox,
          from_address = EXCLUDED.from_address,
          from_name = EXCLUDED.from_name,
          to_address = EXCLUDED.to_address,
          subject = EXCLUDED.subject,
          body_text = EXCLUDED.body_text,
          body_html = EXCLUDED.body_html,
          code = EXCLUDED.code,
          headers = EXCLUDED.headers,
          metadata = EXCLUDED.metadata,
          message_id = EXCLUDED.message_id,
          has_attachments = EXCLUDED.has_attachments,
          attachment_count = EXCLUDED.attachment_count,
          attachment_names = EXCLUDED.attachment_names,
          attachment_search_text = EXCLUDED.attachment_search_text,
          raw_storage_key = EXCLUDED.raw_storage_key,
          direction = EXCLUDED.direction,
          status = EXCLUDED.status,
          received_at = EXCLUDED.received_at,
          created_at = EXCLUDED.created_at
        `,
        `DELETE FROM attachments WHERE email_id = ${text(email.id)}`,
        ...buildAttachmentInserts(email.attachments ?? []),
      ]

      await sql(statements.join(';\n'))
    },

    async getEmails(mailbox, options) {
      const limit = options?.limit ?? 20
      const offset = options?.offset ?? 0
      let query = `SELECT * FROM emails WHERE mailbox = ${text(mailbox)}`

      if (options?.direction) {
        query += ` AND direction = ${text(options.direction)}`
      }

      query += ` ORDER BY received_at DESC LIMIT ${limit} OFFSET ${offset}`

      const result = await sql(query)
      return rowsToEmails(result)
    },

    async getEmail(id) {
      const emailResult = await sql(`SELECT * FROM emails WHERE id = ${text(id)} LIMIT 1`)
      const emails = rowsToEmails(emailResult)
      const email = emails[0] ?? null
      if (!email) return null

      const attachmentResult = await sql(
        `SELECT * FROM attachments WHERE email_id = ${text(id)} ORDER BY mime_part_index ASC`
      )

      email.attachments = rowsToAttachments(attachmentResult)
      return email
    },

    async getAttachment(id) {
      const result = await sql(`SELECT * FROM attachments WHERE id = ${text(id)} LIMIT 1`)
      const attachments = rowsToAttachments(result)
      return attachments[0] ?? null
    },

    async getCode(mailbox, options) {
      const timeout = (options?.timeout ?? 30) * 1000
      const since = options?.since
      const deadline = Date.now() + timeout

      while (Date.now() < deadline) {
        let query = `SELECT code, from_address, subject FROM emails WHERE mailbox = ${text(mailbox)} AND code IS NOT NULL`

        if (since) {
          query += ` AND received_at > ${text(since)}`
        }

        query += ' ORDER BY received_at DESC LIMIT 1'

        const result = await sql(query)
        if (result.row_count > 0) {
          const row = result.rows[0]!
          const codeIdx = result.columns.indexOf('code')
          const fromIdx = result.columns.indexOf('from_address')
          const subIdx = result.columns.indexOf('subject')
          return {
            code: row[codeIdx] as string,
            from: row[fromIdx] as string,
            subject: row[subIdx] as string,
          }
        }

        await new Promise(r => setTimeout(r, 2000))
      }

      return null
    },
  }
}

function buildAttachmentInserts(attachments: Attachment[]): string[] {
  return attachments.map((attachment) => `
    INSERT INTO attachments (
      id, email_id, filename, content_type, size_bytes,
      content_disposition, content_id, mime_part_index,
      text_content, text_extraction_status, storage_key, content_base64, created_at
    )
    VALUES (
      ${text(attachment.id)}, ${text(attachment.email_id)}, ${text(attachment.filename)},
      ${text(attachment.content_type)}, ${nullableInteger(attachment.size_bytes)},
      ${nullableText(attachment.content_disposition)}, ${nullableText(attachment.content_id)},
      ${integer(attachment.mime_part_index)}, ${text(attachment.text_content)},
      ${text(attachment.text_extraction_status)}, ${nullableText(attachment.storage_key)},
      ${nullableText(attachment.content_base64)}, ${text(attachment.created_at)}
    )
    ON CONFLICT (id) DO UPDATE SET
      email_id = EXCLUDED.email_id,
      filename = EXCLUDED.filename,
      content_type = EXCLUDED.content_type,
      size_bytes = EXCLUDED.size_bytes,
      content_disposition = EXCLUDED.content_disposition,
      content_id = EXCLUDED.content_id,
      mime_part_index = EXCLUDED.mime_part_index,
      text_content = EXCLUDED.text_content,
      text_extraction_status = EXCLUDED.text_extraction_status,
      storage_key = EXCLUDED.storage_key,
      content_base64 = EXCLUDED.content_base64,
      created_at = EXCLUDED.created_at
  `)
}

function rowsToAttachments(result: Db9SqlResult): Attachment[] {
  return result.rows.map((row) => {
    const obj: Record<string, unknown> = {}
    result.columns.forEach((col, i) => { obj[col] = row[i] })
    return {
      id: String(obj.id ?? ''),
      email_id: String(obj.email_id ?? ''),
      filename: String(obj.filename ?? ''),
      content_type: String(obj.content_type ?? 'application/octet-stream'),
      size_bytes: toNumber(obj.size_bytes),
      content_disposition: obj.content_disposition == null ? null : String(obj.content_disposition),
      content_id: obj.content_id == null ? null : String(obj.content_id),
      mime_part_index: toNumber(obj.mime_part_index) ?? 0,
      text_content: String(obj.text_content ?? ''),
      text_extraction_status: readAttachmentStatus(obj.text_extraction_status),
      storage_key: obj.storage_key == null ? null : String(obj.storage_key),
      content_base64: obj.content_base64 == null ? null : String(obj.content_base64),
      downloadable: Boolean(obj.storage_key || obj.content_base64),
      created_at: String(obj.created_at ?? ''),
    }
  })
}

function rowToEmail(obj: Record<string, unknown>): Email {
  return {
    id: obj.id as string,
    mailbox: obj.mailbox as string,
    from_address: obj.from_address as string,
    from_name: (obj.from_name as string) ?? '',
    to_address: obj.to_address as string,
    subject: (obj.subject as string) ?? '',
    body_text: (obj.body_text as string) ?? '',
    body_html: (obj.body_html as string) ?? '',
    code: (obj.code as string) ?? null,
    headers: typeof obj.headers === 'string' ? JSON.parse(obj.headers) : (obj.headers as Record<string, string>) ?? {},
    metadata: typeof obj.metadata === 'string' ? JSON.parse(obj.metadata) : (obj.metadata as Record<string, unknown>) ?? {},
    direction: obj.direction === 'outbound' ? 'outbound' : 'inbound',
    status: obj.status === 'sent' || obj.status === 'failed' || obj.status === 'queued' ? obj.status : 'received',
    message_id: obj.message_id == null ? null : String(obj.message_id),
    has_attachments: toBoolean(obj.has_attachments),
    attachment_count: toNumber(obj.attachment_count) ?? 0,
    attachment_names: (obj.attachment_names as string) ?? '',
    attachment_search_text: (obj.attachment_search_text as string) ?? '',
    raw_storage_key: obj.raw_storage_key == null ? null : String(obj.raw_storage_key),
    received_at: obj.received_at as string,
    created_at: obj.created_at as string,
  }
}

function text(value: string): string {
  return `'${escapeSql(value)}'`
}

function nullableText(value: string | null | undefined): string {
  return value == null ? 'NULL' : text(value)
}

function integer(value: number): string {
  return String(value)
}

function nullableInteger(value: number | null | undefined): string {
  return value == null ? 'NULL' : integer(value)
}

function bool(value: boolean): string {
  return value ? 'TRUE' : 'FALSE'
}

function jsonb(value: Record<string, unknown>): string {
  return `'${escapeSql(JSON.stringify(value))}'::jsonb`
}

function escapeSql(value: string): string {
  return value.replace(/'/g, "''")
}

function toBoolean(value: unknown): boolean {
  if (typeof value === 'boolean') return value
  if (typeof value === 'string') return value === 't' || value.toLowerCase() === 'true'
  if (typeof value === 'number') return value !== 0
  return false
}

function toNumber(value: unknown): number | null {
  if (typeof value === 'number' && Number.isFinite(value)) return value
  if (typeof value === 'string' && value.length > 0) {
    const parsed = Number(value)
    return Number.isFinite(parsed) ? parsed : null
  }
  return null
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
