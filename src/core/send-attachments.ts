import { readFile } from 'node:fs/promises'
import { extname, basename } from 'node:path'
import type { PreparedAttachment, SendAttachment } from './types.js'

const MIME_TYPES: Record<string, string> = {
  '.csv': 'text/csv',
  '.gif': 'image/gif',
  '.htm': 'text/html',
  '.html': 'text/html',
  '.jpeg': 'image/jpeg',
  '.jpg': 'image/jpeg',
  '.json': 'application/json',
  '.md': 'text/markdown',
  '.markdown': 'text/markdown',
  '.pdf': 'application/pdf',
  '.png': 'image/png',
  '.svg': 'image/svg+xml',
  '.txt': 'text/plain',
  '.webp': 'image/webp',
}

export async function prepareSendAttachments(
  attachments?: SendAttachment[]
): Promise<PreparedAttachment[] | undefined> {
  if (!attachments?.length) return undefined
  return await Promise.all(attachments.map(prepareSendAttachment))
}

async function prepareSendAttachment(attachment: SendAttachment): Promise<PreparedAttachment> {
  const filename = attachment.filename ?? (attachment.path ? basename(attachment.path) : undefined)
  if (!filename) {
    throw new Error('Attachment filename is required when path is not provided')
  }

  if (attachment.path && attachment.content !== undefined) {
    throw new Error(`Attachment "${filename}" cannot include both path and content`)
  }

  if (!attachment.path && attachment.content === undefined) {
    throw new Error(`Attachment "${filename}" is missing content or path`)
  }

  let content: string
  if (attachment.path) {
    const file = await readFile(attachment.path)
    content = file.toString('base64')
  } else {
    content = encodeAttachmentContent(attachment.content!)
  }

  return {
    filename,
    content,
    contentId: attachment.contentId,
    contentType: attachment.contentType ?? guessContentType(filename),
  }
}

function encodeAttachmentContent(content: string | ArrayBuffer | Uint8Array): string {
  if (typeof content === 'string') {
    return content
  }

  if (content instanceof Uint8Array) {
    return Buffer.from(content).toString('base64')
  }

  return Buffer.from(new Uint8Array(content)).toString('base64')
}

function guessContentType(filename: string): string | undefined {
  return MIME_TYPES[extname(filename).toLowerCase()]
}
