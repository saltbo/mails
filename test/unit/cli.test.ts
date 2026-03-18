import { describe, expect, test, mock, afterEach } from 'bun:test'
import { existsSync, rmSync, writeFileSync } from 'fs'
import { join } from 'path'
import { setConfigValue, loadConfig, saveConfig } from '../../src/core/config'

describe('CLI: send command', () => {
  const originalFetch = globalThis.fetch
  const attachmentPath = join(import.meta.dir, '..', '.cli-attachment.txt')

  afterEach(() => {
    globalThis.fetch = originalFetch
    if (existsSync(attachmentPath)) rmSync(attachmentPath)
  })

  test('send command parses args correctly', async () => {
    // Setup config
    setConfigValue('resend_api_key', 're_test')
    setConfigValue('default_from', 'Bot <bot@test.com>')

    let sentBody: Record<string, unknown> = {}
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ id: 'msg_cli' }))
    }) as typeof fetch

    // Import and call directly
    const { send } = await import('../../src/core/send')
    const result = await send({
      to: 'user@example.com',
      subject: 'CLI Test',
      text: 'Hello from CLI',
      attachments: [
        {
          filename: 'notes.txt',
          content: new TextEncoder().encode('hello attachment'),
          contentType: 'text/plain',
        },
      ],
    })

    expect(sentBody.to).toEqual(['user@example.com'])
    expect(sentBody.subject).toBe('CLI Test')
    expect(sentBody.text).toBe('Hello from CLI')
    expect(sentBody.attachments).toEqual([
      {
        filename: 'notes.txt',
        content: Buffer.from('hello attachment').toString('base64'),
        content_type: 'text/plain',
      },
    ])
    expect(result.id).toBe('msg_cli')
  })

  test('send command supports repeated --attach flags', async () => {
    setConfigValue('resend_api_key', 're_test')
    setConfigValue('default_from', 'Bot <bot@test.com>')
    writeFileSync(attachmentPath, 'attachment from path')

    let sentBody: Record<string, unknown> = {}
    globalThis.fetch = mock(async (_url: string, init: RequestInit) => {
      sentBody = JSON.parse(init.body as string)
      return new Response(JSON.stringify({ id: 'msg_cli_attach' }))
    }) as typeof fetch

    const { sendCommand } = await import('../../src/cli/commands/send')
    const originalLog = console.log
    console.log = () => {}

    try {
      await sendCommand([
        '--to', 'user@example.com',
        '--subject', 'CLI Attach',
        '--body', 'See attached',
        '--attach', attachmentPath,
      ])
    } finally {
      console.log = originalLog
    }

    expect(sentBody.attachments).toEqual([
      {
        filename: '.cli-attachment.txt',
        content: Buffer.from('attachment from path').toString('base64'),
        content_type: 'text/plain',
      },
    ])
  })
})

describe('CLI: config command', () => {
  test('config set and get work', () => {
    setConfigValue('domain', 'cli-test.com')
    const { getConfigValue } = require('../../src/core/config')
    expect(getConfigValue('domain')).toBe('cli-test.com')
  })

  test('config loads defaults for missing file', () => {
    const config = loadConfig()
    expect(config.mode).toBe('hosted')
    expect(config.send_provider).toBe('resend')
  })
})

describe('CLI: help command', () => {
  test('helpCommand outputs text', () => {
    const { helpCommand } = require('../../src/cli/commands/help')
    // Just verify it doesn't throw
    const originalLog = console.log
    let output = ''
    console.log = (msg: string) => { output = msg }
    helpCommand()
    console.log = originalLog
    expect(output).toContain('mails')
    expect(output).toContain('send')
    expect(output).toContain('inbox')
    expect(output).toContain('code')
    expect(output).toContain('serve')
    expect(output).toContain('config')
    expect(output).toContain('mails.dev')
  })
})
