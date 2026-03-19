import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test'
import { parseIncomingEmail } from '../../worker/src/mime'
import type { Env } from '../../worker/src/index'
import worker from '../../worker/src/index'

describe('worker: MIME parsing', () => {
  test('extracts body and text attachment metadata from multipart email', async () => {
    const attachment = Buffer.from('invoice number 42').toString('base64')
    const raw = [
      'From: "Sender" <sender@test.com>',
      'Subject: Invoice',
      'Message-ID: <msg-42@test.com>',
      'Content-Type: multipart/mixed; boundary="boundary"',
      '',
      '--boundary',
      'Content-Type: text/plain; charset="utf-8"',
      '',
      'Email body',
      '--boundary',
      'Content-Type: text/plain; name="invoice.txt"',
      'Content-Disposition: attachment; filename="invoice.txt"',
      'Content-Transfer-Encoding: base64',
      '',
      attachment,
      '--boundary--',
      '',
    ].join('\r\n')

    const parsed = await parseIncomingEmail(
      new TextEncoder().encode(raw).buffer,
      'email-1',
      '2026-03-18T00:00:00.000Z'
    )

    expect(parsed.subject).toBe('Invoice')
    expect(parsed.bodyText.trim()).toBe('Email body')
    expect(parsed.messageId).toContain('msg-42')
    expect(parsed.attachmentCount).toBe(1)
    expect(parsed.attachmentNames).toBe('invoice.txt')
    expect(parsed.attachmentSearchText).toContain('invoice number 42')
    expect(parsed.attachments[0]).toMatchObject({
      email_id: 'email-1',
      filename: 'invoice.txt',
      content_type: 'text/plain',
      content_disposition: 'attachment',
      text_extraction_status: 'done',
      text_content: 'invoice number 42',
      downloadable: false,
    })
  })

  test('marks unsupported binary attachments without failing the email parse', async () => {
    const pdf = Buffer.from('%PDF-1.4 fake').toString('base64')
    const raw = [
      'Subject: PDF',
      'Content-Type: multipart/mixed; boundary="boundary"',
      '',
      '--boundary',
      'Content-Type: text/plain',
      '',
      'Body',
      '--boundary',
      'Content-Type: application/pdf; name="invoice.pdf"',
      'Content-Disposition: attachment; filename="invoice.pdf"',
      'Content-Transfer-Encoding: base64',
      '',
      pdf,
      '--boundary--',
      '',
    ].join('\r\n')

    const parsed = await parseIncomingEmail(
      new TextEncoder().encode(raw).buffer,
      'email-2',
      '2026-03-18T00:00:00.000Z'
    )

    expect(parsed.bodyText.trim()).toBe('Body')
    expect(parsed.attachments).toHaveLength(1)
    expect(parsed.attachments[0]!.filename).toBe('invoice.pdf')
    expect(parsed.attachments[0]!.text_extraction_status).toBe('unsupported')
    expect(parsed.attachments[0]!.text_content).toBe('')
  })
})

// --- POST /api/send tests ---

function createMockD1() {
  const boundValues: unknown[] = []
  const runMock = mock(() => Promise.resolve({ success: true }))
  const bindMock = mock((...args: unknown[]) => {
    boundValues.push(...args)
    return { run: runMock }
  })
  const prepareMock = mock((_sql: string) => ({
    bind: bindMock,
  }))
  return {
    db: { prepare: prepareMock } as unknown as D1Database,
    prepareMock,
    bindMock,
    runMock,
    boundValues,
  }
}

const SEND_BODY = {
  from: 'me@example.com',
  to: ['you@example.com'],
  subject: 'Hello',
  text: 'World',
}

describe('worker: POST /api/send', () => {
  const originalFetch = globalThis.fetch
  let fetchMock: ReturnType<typeof mock>

  beforeEach(() => {
    fetchMock = mock(() =>
      Promise.resolve(
        Response.json({ id: 'resend-id-123' }, { status: 200 })
      )
    )
    globalThis.fetch = fetchMock as typeof fetch
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('sends email via Resend and records outbound', async () => {
    const { db, prepareMock, bindMock } = createMockD1()
    const env: Env = { DB: db, RESEND_API_KEY: 're_test_key' }

    const request = new Request('http://localhost/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SEND_BODY),
    })

    const response = await worker.fetch(request, env)
    const json = await response.json() as { id: string; from: string }

    expect(response.status).toBe(200)
    expect(json.id).toBe('resend-id-123')
    expect(json.from).toBe('me@example.com')

    // Verify Resend API was called correctly
    expect(fetchMock).toHaveBeenCalledTimes(1)
    const [resendUrl, resendInit] = (fetchMock as any).mock.calls[0]
    expect(resendUrl).toBe('https://api.resend.com/emails')
    expect(resendInit.method).toBe('POST')
    expect(resendInit.headers['Authorization']).toBe('Bearer re_test_key')
    const resendBody = JSON.parse(resendInit.body)
    expect(resendBody.from).toBe('me@example.com')
    expect(resendBody.to).toEqual(['you@example.com'])
    expect(resendBody.subject).toBe('Hello')
    expect(resendBody.text).toBe('World')

    // Verify D1 insert was called
    expect(prepareMock).toHaveBeenCalledTimes(1)
    expect(bindMock).toHaveBeenCalledTimes(1)
    const boundArgs = (bindMock as any).mock.calls[0]
    // id, from (mailbox), from (from_address), to_address, subject, text, html, has_attachments, attachment_count, received_at, created_at
    expect(boundArgs[0]).toBe('resend-id-123') // id
    expect(boundArgs[1]).toBe('me@example.com') // mailbox
    expect(boundArgs[2]).toBe('me@example.com') // from_address
    expect(boundArgs[3]).toBe('you@example.com') // to_address
    expect(boundArgs[4]).toBe('Hello') // subject
    expect(boundArgs[5]).toBe('World') // body_text
    expect(boundArgs[6]).toBe('') // body_html
    expect(boundArgs[7]).toBe(0) // has_attachments
    expect(boundArgs[8]).toBe(0) // attachment_count
  })

  test('returns 400 for missing fields', async () => {
    const { db } = createMockD1()
    const env: Env = { DB: db, RESEND_API_KEY: 're_test_key' }

    // Missing subject
    const request = new Request('http://localhost/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'me@example.com', to: ['you@example.com'], text: 'hi' }),
    })

    const response = await worker.fetch(request, env)
    const json = await response.json() as { error: string }

    expect(response.status).toBe(400)
    expect(json.error).toContain('Missing required fields')

    // Missing text and html
    const request2 = new Request('http://localhost/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ from: 'me@example.com', to: ['you@example.com'], subject: 'Hi' }),
    })

    const response2 = await worker.fetch(request2, env)
    const json2 = await response2.json() as { error: string }

    expect(response2.status).toBe(400)
    expect(json2.error).toContain('text or html')

    // Resend should not have been called
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('returns 500 when RESEND_API_KEY not configured', async () => {
    const { db } = createMockD1()
    const env: Env = { DB: db } // no RESEND_API_KEY

    const request = new Request('http://localhost/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SEND_BODY),
    })

    const response = await worker.fetch(request, env)
    const json = await response.json() as { error: string }

    expect(response.status).toBe(500)
    expect(json.error).toContain('RESEND_API_KEY')
    expect(fetchMock).not.toHaveBeenCalled()
  })

  test('requires auth when AUTH_TOKEN set', async () => {
    const { db } = createMockD1()
    const env: Env = { DB: db, RESEND_API_KEY: 're_test_key', AUTH_TOKEN: 'secret123' }

    // No auth header
    const request = new Request('http://localhost/api/send', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify(SEND_BODY),
    })

    const response = await worker.fetch(request, env)
    const json = await response.json() as { error: string }

    expect(response.status).toBe(401)
    expect(json.error).toBe('Unauthorized')

    // With correct auth header
    const request2 = new Request('http://localhost/api/send', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': 'Bearer secret123',
      },
      body: JSON.stringify(SEND_BODY),
    })

    const response2 = await worker.fetch(request2, env)
    const json2 = await response2.json() as { id: string }

    expect(response2.status).toBe(200)
    expect(json2.id).toBe('resend-id-123')
  })

  test('returns 405 for non-POST methods', async () => {
    const { db } = createMockD1()
    const env: Env = { DB: db, RESEND_API_KEY: 're_test_key' }

    const request = new Request('http://localhost/api/send', { method: 'GET' })
    const response = await worker.fetch(request, env)
    const json = await response.json() as { error: string }

    expect(response.status).toBe(405)
    expect(json.error).toBe('Method not allowed')
  })
})
