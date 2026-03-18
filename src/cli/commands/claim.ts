import { setConfigValue } from '../../core/config.js'

const API_BASE = process.env.MAILS_API_URL || 'https://mails-dev-worker.o-u-turing.workers.dev'
const CLAIM_PAGE = process.env.MAILS_CLAIM_URL || 'https://mails.dev/claim'
const POLL_INTERVAL = 2000

export async function claimCommand(args: string[]) {
  const name = args[0]

  if (!name) {
    console.error('Usage: mails claim <name>')
    console.error('Example: mails claim myagent  →  myagent@mails.dev')
    process.exit(1)
  }

  // 1. Create claim session
  const startRes = await fetch(`${API_BASE}/v1/claim/start`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ name }),
  })

  const startData = await startRes.json() as {
    session_id?: string
    device_code?: string
    url?: string
    error?: string
  }

  if (!startRes.ok) {
    console.error(`Error: ${startData.error}`)
    process.exit(1)
  }

  const { session_id, device_code } = startData
  const claimUrl = `${CLAIM_PAGE}?session=${session_id}&name=${encodeURIComponent(name)}`

  // 2. Show info and open browser
  console.log('')
  console.log(`  Claim: ${name}@mails.dev`)
  console.log(`  Code:  ${device_code}`)
  console.log('')
  console.log(`  ${claimUrl}`)
  console.log('')
  console.log(`  Or visit ${CLAIM_PAGE} and enter the code above.`)
  console.log('')

  // Try to open browser
  try {
    const { exec } = await import('child_process')
    const platform = process.platform
    const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open'
    exec(`${cmd} "${claimUrl}"`)
  } catch {}

  // 3. Poll for result
  process.stdout.write('  Waiting...')

  const deadline = Date.now() + 10 * 60 * 1000 // 10 min timeout

  while (Date.now() < deadline) {
    await new Promise(r => setTimeout(r, POLL_INTERVAL))

    const pollRes = await fetch(`${API_BASE}/v1/claim/poll?session=${session_id}`)
    const pollData = await pollRes.json() as {
      status: string
      mailbox?: string
      api_key?: string
    }

    if (pollData.status === 'complete') {
      process.stdout.write('\n')
      console.log('')

      setConfigValue('mailbox', pollData.mailbox!)
      setConfigValue('api_key', pollData.api_key!)

      console.log(`  Claimed: ${pollData.mailbox}`)
      console.log(`  API Key: ${pollData.api_key}`)
      console.log('')
      console.log('  Saved to ~/.mails/config.json')
      return
    }

    if (pollData.status === 'expired') {
      process.stdout.write('\n')
      console.error('  Session expired. Try again.')
      process.exit(1)
    }

    // Still pending
    process.stdout.write('.')
  }

  process.stdout.write('\n')
  console.error('  Timeout. Try again.')
  process.exit(1)
}
