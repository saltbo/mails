import { getAttachmentBlobStore } from './blob-store.js'
import type { Attachment, Email } from './types.js'
import { getStorage } from './storage.js'
import { buildFilesystemAttachmentKey } from '../providers/blob/filesystem.js'

export async function saveInboundEmail(payload: unknown): Promise<Email> {
  const email = await materializeInboundEmail(parseInboundEmail(payload))
  const storage = await getStorage()
  await storage.saveEmail(email)
  return email
}

export function parseInboundEmail(payload: unknown): Email {
  if (!isRecord(payload)) {
    throw new Error('Inbound payload must be a JSON object')
  }

  const now = new Date().toISOString()
  const toAddress = readString(payload.to_address) ?? readString(payload.mailbox)
  if (!toAddress) {
    throw new Error('Inbound payload is missing to_address')
  }

  const id = readString(payload.id) ?? crypto.randomUUID()
  const createdAt = readString(payload.created_at) ?? now
  const receivedAt = readString(payload.received_at) ?? createdAt

  return {
    id,
    mailbox: readString(payload.mailbox) ?? toAddress,
    from_address: readString(payload.from_address) ?? '',
    from_name: readString(payload.from_name) ?? '',
    to_address: toAddress,
    subject: readString(payload.subject) ?? '',
    body_text: readString(payload.body_text) ?? '',
    body_html: readString(payload.body_html) ?? '',
    code: readNullableString(payload.code) ?? null,
    headers: readStringRecord(payload.headers),
    metadata: readUnknownRecord(payload.metadata),
    direction: readDirection(payload.direction),
    status: readStatus(payload.status),
    message_id: readNullableString(payload.message_id) ?? null,
    has_attachments: readBoolean(payload.has_attachments),
    attachment_count: readNumber(payload.attachment_count),
    attachment_names: readString(payload.attachment_names),
    attachment_search_text: readString(payload.attachment_search_text),
    raw_storage_key: readNullableString(payload.raw_storage_key) ?? null,
    attachments: readAttachments(payload.attachments, id, createdAt),
    received_at: receivedAt,
    created_at: createdAt,
  }
}

function readAttachments(value: unknown, emailId: string, createdAt: string): Attachment[] {
  if (!Array.isArray(value)) return []

  return value
    .filter(isRecord)
    .map((attachment, index) => ({
      id: readString(attachment.id) ?? crypto.randomUUID(),
      email_id: readString(attachment.email_id) ?? emailId,
      filename: readString(attachment.filename) ?? `attachment-${index + 1}`,
      content_type: readString(attachment.content_type) ?? 'application/octet-stream',
      size_bytes: readNumber(attachment.size_bytes) ?? null,
      content_disposition: readNullableString(attachment.content_disposition) ?? null,
      content_id: readNullableString(attachment.content_id) ?? null,
      mime_part_index: readNumber(attachment.mime_part_index) ?? index,
      text_content: readString(attachment.text_content) ?? '',
      text_extraction_status: readAttachmentStatus(attachment.text_extraction_status),
      storage_key: readNullableString(attachment.storage_key) ?? null,
      content_base64: readNullableString(attachment.content_base64) ?? null,
      downloadable: readBoolean(attachment.downloadable),
      created_at: readString(attachment.created_at) ?? createdAt,
    }))
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value)
}

function readString(value: unknown): string | undefined {
  return typeof value === 'string' ? value : undefined
}

function readNullableString(value: unknown): string | null | undefined {
  if (value === null) return null
  return readString(value)
}

function readBoolean(value: unknown): boolean | undefined {
  return typeof value === 'boolean' ? value : undefined
}

function readNumber(value: unknown): number | undefined {
  return typeof value === 'number' && Number.isFinite(value) ? value : undefined
}

function readStringRecord(value: unknown): Record<string, string> {
  if (!isRecord(value)) return {}

  const record: Record<string, string> = {}
  for (const [key, entry] of Object.entries(value)) {
    if (typeof entry === 'string') {
      record[key] = entry
    }
  }
  return record
}

function readUnknownRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? value : {}
}

function readDirection(value: unknown): Email['direction'] {
  return value === 'outbound' ? 'outbound' : 'inbound'
}

function readStatus(value: unknown): Email['status'] {
  switch (value) {
    case 'sent':
    case 'failed':
    case 'queued':
    case 'received':
      return value
    default:
      return 'received'
  }
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

async function materializeInboundEmail(email: Email): Promise<Email> {
  if (!email.attachments?.length) {
    return email
  }

  const blobStore = getAttachmentBlobStore()
  const attachments = await Promise.all(email.attachments.map(async (attachment) => {
    if (!attachment.content_base64) {
      return attachment
    }

    const bytes = decodeBase64(attachment.content_base64)
    const storageKey = attachment.storage_key
      ?? buildFilesystemAttachmentKey(email.id, attachment.id, attachment.filename)

    await blobStore.put(storageKey, bytes, {
      contentType: attachment.content_type,
      metadata: {
        email_id: email.id,
        attachment_id: attachment.id,
        filename: attachment.filename,
      },
    })

    return {
      ...attachment,
      size_bytes: attachment.size_bytes ?? bytes.byteLength,
      storage_key: storageKey,
      content_base64: null,
      downloadable: true,
    }
  }))

  return {
    ...email,
    attachments,
  }
}

function decodeBase64(value: string): Uint8Array {
  return Uint8Array.from(Buffer.from(value, 'base64'))
}
