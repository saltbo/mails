import { setConfigValue } from '../../core/config.js'

const CLAIM_URL = 'https://mails.dev/claim'

export async function claimCommand(args: string[]) {
  const name = args[0]

  if (!name) {
    console.error('Usage: mails claim <name>')
    console.error('Example: mails claim myagent  →  myagent@mails.dev')
    process.exit(1)
  }

  // Start local callback server
  const { resolve, promise } = Promise.withResolvers<{ mailbox: string; api_key: string }>()
  let timeout: ReturnType<typeof setTimeout>

  const server = Bun.serve({
    port: 0, // random port
    fetch(req) {
      const url = new URL(req.url)

      if (req.method === 'OPTIONS') {
        return new Response(null, {
          headers: {
            'Access-Control-Allow-Origin': '*',
            'Access-Control-Allow-Methods': 'POST, OPTIONS',
            'Access-Control-Allow-Headers': 'Content-Type',
          },
        })
      }

      if (url.pathname === '/callback' && req.method === 'POST') {
        return req.json().then((data: any) => {
          resolve(data)
          return new Response(JSON.stringify({ ok: true }), {
            headers: {
              'Content-Type': 'application/json',
              'Access-Control-Allow-Origin': '*',
            },
          })
        })
      }

      return new Response('Not found', { status: 404 })
    },
  })

  const port = server.port
  const claimUrl = `${CLAIM_URL}?name=${encodeURIComponent(name)}&port=${port}`

  console.log(`Opening browser to claim ${name}@mails.dev ...`)
  console.log('')
  console.log(`If the browser doesn't open, visit:`)
  console.log(`  ${claimUrl}`)
  console.log('')
  console.log('Waiting for confirmation...')

  // Open browser
  const { exec } = await import('child_process')
  const platform = process.platform
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open'
  exec(`${cmd} "${claimUrl}"`)

  // Timeout after 5 minutes
  timeout = setTimeout(() => {
    console.error('\nTimeout: no response received. Try again.')
    server.stop()
    process.exit(1)
  }, 5 * 60 * 1000)

  // Wait for callback
  const result = await promise
  clearTimeout(timeout)
  server.stop()

  // Save to config
  setConfigValue('mailbox', result.mailbox)
  setConfigValue('api_key', result.api_key)

  console.log('')
  console.log(`Claimed: ${result.mailbox}`)
  console.log(`API Key: ${result.api_key}`)
  console.log('')
  console.log('Saved to ~/.mails/config.json')
}
