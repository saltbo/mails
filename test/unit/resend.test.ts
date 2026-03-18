import { describe, expect, test, mock, beforeEach, afterEach } from 'bun:test'
import { createResendProvider } from '../../src/providers/send/resend'

describe('Resend provider', () => {
  const originalFetch = globalThis.fetch

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('sends email successfully', async () => {
    globalThis.fetch = mock(async (url: string, init: RequestInit) => {
      expect(url).toBe('https://api.resend.com/emails')
      expect(init.method).toBe('POST')
      expect(init.headers).toEqual({
        'Authorization': 'Bearer re_test_key',
        'Content-Type': 'application/json',
      })

      const body = JSON.parse(init.body as string)
      expect(body.from).toBe('Agent <agent@test.com>')
      expect(body.to).toEqual(['user@example.com'])
      expect(body.subject).toBe('Test')
      expect(body.text).toBe('Hello')

      return new Response(JSON.stringify({ id: 'msg_123' }), { status: 200 })
    }) as typeof fetch

    const provider = createResendProvider('re_test_key')
    const result = await provider.send({
      from: 'Agent <agent@test.com>',
      to: ['user@example.com'],
      subject: 'Test',
      text: 'Hello',
    })

    expect(result.id).toBe('msg_123')
    expect(result.provider).toBe('resend')
  })

  test('sends HTML email', async () => {
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body.html).toBe('<h1>Hi</h1>')
      expect(body.text).toBeUndefined()
      return new Response(JSON.stringify({ id: 'msg_456' }), { status: 200 })
    }) as typeof fetch

    const provider = createResendProvider('key')
    const result = await provider.send({
      from: 'a@b.com',
      to: ['c@d.com'],
      subject: 'HTML',
      html: '<h1>Hi</h1>',
    })
    expect(result.id).toBe('msg_456')
  })

  test('includes replyTo when provided', async () => {
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body.reply_to).toBe('reply@test.com')
      return new Response(JSON.stringify({ id: 'msg_789' }), { status: 200 })
    }) as typeof fetch

    const provider = createResendProvider('key')
    await provider.send({
      from: 'a@b.com',
      to: ['c@d.com'],
      subject: 'Reply',
      text: 'test',
      replyTo: 'reply@test.com',
    })
  })

  test('includes headers and attachments when provided', async () => {
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      expect(body.headers).toEqual({
        'In-Reply-To': '<msg-123@test.com>',
        'References': '<msg-123@test.com>',
      })
      expect(body.attachments).toEqual([
        {
          filename: 'invoice.txt',
          content: Buffer.from('invoice-42').toString('base64'),
          content_type: 'text/plain',
          content_id: 'cid-invoice',
        },
      ])
      return new Response(JSON.stringify({ id: 'msg_attachment' }), { status: 200 })
    }) as typeof fetch

    const provider = createResendProvider('key')
    await provider.send({
      from: 'a@b.com',
      to: ['c@d.com'],
      subject: 'Attachment',
      text: 'see attachment',
      headers: {
        'In-Reply-To': '<msg-123@test.com>',
        'References': '<msg-123@test.com>',
      },
      attachments: [
        {
          filename: 'invoice.txt',
          content: Buffer.from('invoice-42').toString('base64'),
          contentType: 'text/plain',
          contentId: 'cid-invoice',
        },
      ],
    })
  })

  test('throws on API error', async () => {
    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ message: 'Invalid API key' }), { status: 403 })
    }) as typeof fetch

    const provider = createResendProvider('bad_key')
    expect(
      provider.send({ from: 'a@b.com', to: ['c@d.com'], subject: 'Test', text: 'hi' })
    ).rejects.toThrow('Resend error: Invalid API key')
  })
})
