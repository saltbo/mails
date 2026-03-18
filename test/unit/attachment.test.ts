import { afterEach, beforeEach, describe, expect, mock, test } from 'bun:test'
import { existsSync, readFileSync, rmSync } from 'node:fs'
import { join } from 'node:path'
import { getAttachment, downloadAttachment } from '../../src/core/attachment'
import { saveConfig } from '../../src/core/config'

const DEFAULT_CONFIG = {
  mode: 'hosted' as const,
  domain: 'mails.dev',
  mailbox: '',
  send_provider: 'resend',
  storage_provider: 'sqlite',
  attachment_blob_store: 'filesystem',
}

describe('attachment', () => {
  const originalFetch = globalThis.fetch
  const outputPath = join(import.meta.dir, '..', '.downloaded-attachment.txt')

  beforeEach(() => {
    saveConfig({
      ...DEFAULT_CONFIG,
      worker_url: 'https://worker.test',
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (existsSync(outputPath)) rmSync(outputPath)
    saveConfig(DEFAULT_CONFIG)
  })

  test('getAttachment loads metadata from the worker attachment endpoint', async () => {
    let requestedUrl = ''
    globalThis.fetch = mock(async (input: string | URL | Request) => {
      requestedUrl = String(input)
      return Response.json({
        id: 'att-1',
        email_id: 'email-1',
        filename: 'invoice.txt',
        content_type: 'text/plain',
        size_bytes: 18,
        content_disposition: 'attachment',
        content_id: null,
        mime_part_index: 0,
        text_content: 'invoice number 42',
        text_extraction_status: 'done',
        storage_key: null,
        downloadable: true,
        created_at: '2026-03-18T00:00:00.000Z',
      })
    }) as typeof fetch

    const attachment = await getAttachment('att-1')

    expect(requestedUrl).toBe('https://worker.test/api/attachment?id=att-1&format=json')
    expect(attachment?.filename).toBe('invoice.txt')
  })

  test('downloadAttachment writes worker attachment bytes to disk', async () => {
    globalThis.fetch = mock(async () =>
      new Response('hello attachment', {
        headers: {
          'Content-Type': 'text/plain',
          'Content-Disposition': 'attachment; filename="hello.txt"',
        },
      })
    ) as typeof fetch

    const path = await downloadAttachment('att-2', outputPath)

    expect(path).toBe(outputPath)
    expect(readFileSync(outputPath, 'utf8')).toBe('hello attachment')
  })
})
