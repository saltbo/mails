import { describe, expect, test, beforeEach, afterEach, mock } from 'bun:test'
import { send } from '../../src/core/send'
import { setConfigValue, saveConfig, loadConfig } from '../../src/core/config'

describe('send', () => {
  const originalFetch = globalThis.fetch

  beforeEach(() => {
    saveConfig({
      mode: 'hosted',
      domain: 'mails.dev',
      mailbox: '',
      send_provider: 'resend',
      storage_provider: 'sqlite',
    })
  })

  afterEach(() => {
    globalThis.fetch = originalFetch
  })

  test('sends email using config', async () => {
    setConfigValue('resend_api_key', 're_test')
    setConfigValue('default_from', 'Bot <bot@test.com>')

    globalThis.fetch = mock(async () => {
      return new Response(JSON.stringify({ id: 'msg_1' }))
    }) as typeof fetch

    const result = await send({
      to: 'user@example.com',
      subject: 'Hello',
      text: 'World',
    })

    expect(result.id).toBe('msg_1')
    expect(result.provider).toBe('resend')
  })

  test('uses explicit from over default_from', async () => {
    setConfigValue('resend_api_key', 're_test')
    setConfigValue('default_from', 'Default <default@test.com>')

    let sentFrom = ''
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      sentFrom = body.from
      return new Response(JSON.stringify({ id: 'msg_2' }))
    }) as typeof fetch

    await send({
      from: 'Custom <custom@test.com>',
      to: 'user@example.com',
      subject: 'Test',
      text: 'body',
    })

    expect(sentFrom).toBe('Custom <custom@test.com>')
  })

  test('throws when no resend_api_key', async () => {
    const config = loadConfig()
    delete (config as Record<string, unknown>).resend_api_key
    saveConfig(config)

    expect(
      send({ to: 'a@b.com', subject: 'Test', text: 'hi' })
    ).rejects.toThrow('resend_api_key not configured')
  })

  test('throws when no from address', async () => {
    setConfigValue('resend_api_key', 're_test')
    const config = loadConfig()
    delete (config as Record<string, unknown>).default_from
    saveConfig(config)

    expect(
      send({ to: 'a@b.com', subject: 'Test', text: 'hi' })
    ).rejects.toThrow('No "from" address')
  })

  test('throws when no body', async () => {
    setConfigValue('resend_api_key', 're_test')
    setConfigValue('default_from', 'Bot <bot@test.com>')

    expect(
      send({ to: 'a@b.com', subject: 'Test' })
    ).rejects.toThrow('Either text or html body is required')
  })

  test('accepts string or array for to', async () => {
    setConfigValue('resend_api_key', 're_test')
    setConfigValue('default_from', 'Bot <bot@test.com>')

    let sentTo: string[] = []
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      const body = JSON.parse(init.body as string)
      sentTo = body.to
      return new Response(JSON.stringify({ id: 'msg_3' }))
    }) as typeof fetch

    await send({ to: 'single@test.com', subject: 'Test', text: 'hi' })
    expect(sentTo).toEqual(['single@test.com'])

    await send({ to: ['a@test.com', 'b@test.com'], subject: 'Test', text: 'hi' })
    expect(sentTo).toEqual(['a@test.com', 'b@test.com'])
  })

  test('throws for unknown provider', async () => {
    setConfigValue('send_provider', 'unknown')
    expect(
      send({ to: 'a@b.com', subject: 'Test', text: 'hi' })
    ).rejects.toThrow('Unknown send provider: unknown')

    // Reset
    setConfigValue('send_provider', 'resend')
  })
})
