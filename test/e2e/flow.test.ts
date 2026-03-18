import { describe, expect, test, beforeAll, afterAll } from 'bun:test'
import { existsSync, rmSync } from 'fs'
import { join } from 'path'
import { createSqliteProvider } from '../../src/providers/storage/sqlite'
import { createResendProvider } from '../../src/providers/send/resend'
import type { Email } from '../../src/core/types'

const TEST_DB = join(import.meta.dir, '..', '.e2e-mails.db')

describe('E2E: full email flow', () => {
  let provider: ReturnType<typeof createSqliteProvider>
  const originalFetch = globalThis.fetch

  beforeAll(async () => {
    // Clean up
    for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
      if (existsSync(f)) rmSync(f)
    }

    // Init SQLite provider
    provider = createSqliteProvider(TEST_DB)
    await provider.init()

    // No config dependency — use providers directly
  })

  afterAll(() => {
    globalThis.fetch = originalFetch
    for (const f of [TEST_DB, TEST_DB + '-wal', TEST_DB + '-shm']) {
      if (existsSync(f)) rmSync(f)
    }
  })

  test('1. send email via resend', async () => {
    let capturedBody: Record<string, unknown> = {}

    globalThis.fetch = (async (_url: string, init: RequestInit) => {
      capturedBody = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ id: 'e2e-msg-1' }))
    }) as typeof fetch

    const resend = createResendProvider('re_e2e_test')
    const result = await resend.send({
      from: 'E2E Bot <bot@e2e.test>',
      to: ['user@example.com'],
      subject: 'E2E Test Email',
      text: 'This is an E2E test',
    })

    expect(result.id).toBe('e2e-msg-1')
    expect(result.provider).toBe('resend')
    expect(capturedBody.from).toBe('E2E Bot <bot@e2e.test>')
    expect(capturedBody.to).toEqual(['user@example.com'])

    // Record the sent email in storage
    await provider.saveEmail({
      id: result.id,
      mailbox: 'inbox@e2e.test',
      from_address: 'bot@e2e.test',
      from_name: 'E2E Bot',
      to_address: 'user@example.com',
      subject: 'E2E Test Email',
      body_text: 'This is an E2E test',
      body_html: '',
      code: null,
      headers: {},
      metadata: { provider: 'resend' },
      direction: 'outbound',
      status: 'sent',
      received_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    })
  })

  test('2. simulate receiving inbound email', async () => {
    await provider.saveEmail({
      id: 'inbound-1',
      mailbox: 'inbox@e2e.test',
      from_address: 'reply@example.com',
      from_name: 'User',
      to_address: 'inbox@e2e.test',
      subject: 'Re: E2E Test Email',
      body_text: 'Got your email!',
      body_html: '<p>Got your email!</p>',
      code: null,
      headers: { 'In-Reply-To': 'e2e-msg-1' },
      metadata: {},
      direction: 'inbound',
      status: 'received',
      received_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    })
  })

  test('3. simulate receiving verification code email', async () => {
    await provider.saveEmail({
      id: 'code-email-1',
      mailbox: 'inbox@e2e.test',
      from_address: 'noreply@auth.service.com',
      from_name: 'Auth Service',
      to_address: 'inbox@e2e.test',
      subject: 'Your verification code',
      body_text: 'Your verification code is 847291. It expires in 10 minutes.',
      body_html: '',
      code: '847291',
      headers: {},
      metadata: {},
      direction: 'inbound',
      status: 'received',
      received_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    })
  })

  test('4. query inbox - shows all emails', async () => {
    const emails = await provider.getEmails('inbox@e2e.test')
    expect(emails.length).toBeGreaterThanOrEqual(3)
  })

  test('5. query inbox - filter by direction', async () => {
    const outbound = await provider.getEmails('inbox@e2e.test', { direction: 'outbound' })
    expect(outbound).toHaveLength(1)
    expect(outbound[0]!.subject).toBe('E2E Test Email')

    const inbound = await provider.getEmails('inbox@e2e.test', { direction: 'inbound' })
    expect(inbound).toHaveLength(2)
  })

  test('6. get email by id', async () => {
    const email = await provider.getEmail('inbound-1')
    expect(email).not.toBeNull()
    expect(email!.subject).toBe('Re: E2E Test Email')
    expect(email!.headers['In-Reply-To']).toBe('e2e-msg-1')
  })

  test('7. query verification code', async () => {
    const result = await provider.getCode('inbox@e2e.test', { timeout: 1 })
    expect(result).not.toBeNull()
    expect(result!.code).toBe('847291')
    expect(result!.from).toBe('noreply@auth.service.com')
    expect(result!.subject).toBe('Your verification code')
  })

  test('8. code query with since filter excludes old emails', async () => {
    const futureDate = new Date(Date.now() + 86400000).toISOString()
    const result = await provider.getCode('inbox@e2e.test', { timeout: 1, since: futureDate })
    expect(result).toBeNull()
  })

  test('9. pagination works', async () => {
    const page1 = await provider.getEmails('inbox@e2e.test', { limit: 1 })
    expect(page1).toHaveLength(1)

    const page2 = await provider.getEmails('inbox@e2e.test', { limit: 1, offset: 1 })
    expect(page2).toHaveLength(1)
    expect(page2[0]!.id).not.toBe(page1[0]!.id)
  })

  test('10. different mailboxes are isolated', async () => {
    await provider.saveEmail({
      id: 'other-mailbox-1',
      mailbox: 'other@e2e.test',
      from_address: 'x@y.com',
      from_name: '',
      to_address: 'other@e2e.test',
      subject: 'Other mailbox',
      body_text: 'test',
      body_html: '',
      code: null,
      headers: {},
      metadata: {},
      direction: 'inbound',
      status: 'received',
      received_at: new Date().toISOString(),
      created_at: new Date().toISOString(),
    })

    const inbox = await provider.getEmails('inbox@e2e.test')
    const other = await provider.getEmails('other@e2e.test')

    expect(inbox.every(e => e.mailbox === 'inbox@e2e.test')).toBe(true)
    expect(other).toHaveLength(1)
    expect(other[0]!.mailbox).toBe('other@e2e.test')
  })
})
