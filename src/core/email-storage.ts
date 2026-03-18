import type { Attachment, AttachmentTextExtractionStatus, Email } from './types.js'

export function normalizeEmailForStorage(email: Email): Email {
  const createdAt = email.created_at || new Date().toISOString()
  const attachments = normalizeAttachments(email.id, email.attachments, createdAt)

  return {
    ...email,
    message_id: email.message_id ?? null,
    has_attachments: email.has_attachments ?? attachments.length > 0,
    attachment_count: email.attachment_count ?? attachments.length,
    attachment_names: email.attachment_names ?? attachments.map((attachment) => attachment.filename).join(' '),
    attachment_search_text: email.attachment_search_text ?? attachments
      .map((attachment) => attachment.text_content)
      .filter((value) => value.length > 0)
      .join('\n\n'),
    raw_storage_key: email.raw_storage_key ?? null,
    attachments,
    created_at: createdAt,
  }
}

export function normalizeAttachments(
  emailId: string,
  attachments: Attachment[] | undefined,
  createdAt: string
): Attachment[] {
  return (attachments ?? []).map((attachment, index) => normalizeAttachment(emailId, attachment, index, createdAt))
}

function normalizeAttachment(
  emailId: string,
  attachment: Attachment,
  index: number,
  createdAt: string
): Attachment {
  const contentBase64 = attachment.content_base64 ?? null
  const storageKey = attachment.storage_key ?? null

  return {
    ...attachment,
    id: attachment.id,
    email_id: attachment.email_id || emailId,
    filename: attachment.filename,
    content_type: attachment.content_type || 'application/octet-stream',
    size_bytes: attachment.size_bytes ?? sizeFromBase64(contentBase64),
    content_disposition: attachment.content_disposition ?? null,
    content_id: attachment.content_id ?? null,
    mime_part_index: Number.isFinite(attachment.mime_part_index) ? attachment.mime_part_index : index,
    text_content: attachment.text_content ?? '',
    text_extraction_status: attachment.text_extraction_status ?? defaultExtractionStatus(attachment),
    storage_key: storageKey,
    content_base64: contentBase64,
    downloadable: attachment.downloadable ?? Boolean(storageKey || contentBase64),
    created_at: attachment.created_at || createdAt,
  }
}

function defaultExtractionStatus(attachment: Attachment): AttachmentTextExtractionStatus {
  return attachment.text_content ? 'done' : 'pending'
}

function sizeFromBase64(contentBase64: string | null): number | null {
  if (!contentBase64) return null
  try {
    return Buffer.from(contentBase64, 'base64').byteLength
  } catch {
    return null
  }
}
