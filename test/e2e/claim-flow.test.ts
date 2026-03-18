/**
 * E2E test for the claim CLI → browser → callback flow.
 *
 * Tests the local callback server that `mails claim` starts,
 * simulating what the mails.dev/claim page does after Clerk login.
 *
 * Run: bun test test/e2e/claim-flow.test.ts
 */
import { describe, expect, test, afterEach } from 'bun:test'
import { spawn } from 'bun'
import { readFileSync, rmSync, existsSync } from 'fs'
import { join } from 'path'
import { homedir } from 'os'

const CONFIG_FILE = join(homedir(), '.mails', 'config.json')

describe('E2E: mails claim callback flow', () => {
  afterEach(() => {
    // Clean up config changes
    if (existsSync(CONFIG_FILE)) {
      try {
        const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
        delete config.mailbox
        delete config.api_key
        require('fs').writeFileSync(CONFIG_FILE, JSON.stringify(config, null, 2) + '\n')
      } catch {}
    }
  })

  test('claim starts callback server and receives result', async () => {
    // Start `mails claim testbot` in background
    const proc = spawn({
      cmd: ['bun', 'run', 'src/cli/index.ts', 'claim', 'e2etest'],
      cwd: join(import.meta.dir, '../..'),
      stdout: 'pipe',
      stderr: 'pipe',
      env: {
        ...process.env,
        // Override to prevent actually opening browser
        BROWSER: 'echo',
      },
    })

    // Read stdout to find the port
    const reader = proc.stdout.getReader()
    let output = ''
    const decoder = new TextDecoder()

    // Read output until we see the port
    const deadline = Date.now() + 10000
    let port: string | null = null

    while (Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      output += decoder.decode(value)

      // Look for the URL with port
      const match = output.match(/port=(\d+)/)
      if (match) {
        port = match[1]!
        break
      }
    }

    expect(port).not.toBeNull()
    console.log(`  CLI started callback server on port ${port}`)

    // Simulate what the browser ClaimPage does: POST result to callback
    const callbackRes = await fetch(`http://localhost:${port}/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        mailbox: 'e2etest@mails.dev',
        api_key: 'mk_test_e2e_key_12345',
      }),
    })

    expect(callbackRes.status).toBe(200)
    const callbackData = await callbackRes.json() as { ok: boolean }
    expect(callbackData.ok).toBe(true)
    console.log('  Callback POST accepted')

    // Wait for process to finish
    const exitCode = await proc.exited
    expect(exitCode).toBe(0)

    // Read remaining stdout
    try {
      while (true) {
        const { value, done } = await reader.read()
        if (done) break
        output += decoder.decode(value)
      }
    } catch {}

    console.log(`  CLI output:\n${output.split('\n').map(l => `    ${l}`).join('\n')}`)

    // Verify output contains success messages
    expect(output).toContain('e2etest@mails.dev')
    expect(output).toContain('mk_test_e2e_key_12345')
    expect(output).toContain('Saved to ~/.mails/config.json')

    // Verify config was written
    const config = JSON.parse(readFileSync(CONFIG_FILE, 'utf-8'))
    expect(config.mailbox).toBe('e2etest@mails.dev')
    expect(config.api_key).toBe('mk_test_e2e_key_12345')
    console.log('  Config written correctly')
  }, 15000)

  test('claim shows usage without args', async () => {
    const proc = spawn({
      cmd: ['bun', 'run', 'src/cli/index.ts', 'claim'],
      cwd: join(import.meta.dir, '../..'),
      stdout: 'pipe',
      stderr: 'pipe',
    })

    const exitCode = await proc.exited
    expect(exitCode).toBe(1)

    const stderr = await new Response(proc.stderr).text()
    expect(stderr).toContain('Usage: mails claim <name>')
  })

  test('callback server rejects non-POST requests', async () => {
    const proc = spawn({
      cmd: ['bun', 'run', 'src/cli/index.ts', 'claim', 'rejecttest'],
      cwd: join(import.meta.dir, '../..'),
      stdout: 'pipe',
      stderr: 'pipe',
      env: { ...process.env, BROWSER: 'echo' },
    })

    const reader = proc.stdout.getReader()
    let output = ''
    const decoder = new TextDecoder()
    const deadline = Date.now() + 10000
    let port: string | null = null

    while (Date.now() < deadline) {
      const { value, done } = await reader.read()
      if (done) break
      output += decoder.decode(value)
      const match = output.match(/port=(\d+)/)
      if (match) { port = match[1]!; break }
    }

    expect(port).not.toBeNull()

    // GET should return 404
    const getRes = await fetch(`http://localhost:${port}/callback`)
    expect(getRes.status).toBe(404)

    // CORS preflight should work
    const optionsRes = await fetch(`http://localhost:${port}/callback`, { method: 'OPTIONS' })
    expect(optionsRes.status).toBe(200)
    expect(optionsRes.headers.get('Access-Control-Allow-Origin')).toBe('*')

    // Now send real callback to clean up
    await fetch(`http://localhost:${port}/callback`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ mailbox: 'rejecttest@mails.dev', api_key: 'mk_reject' }),
    })

    await proc.exited
  }, 15000)
})
