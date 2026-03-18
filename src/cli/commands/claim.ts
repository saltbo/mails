import { getConfigValue, setConfigValue } from '../../core/config.js'

const API_BASE = 'https://mails-dev-worker.o-u-turing.workers.dev'

export async function claimCommand(args: string[]) {
  const name = args[0]

  if (!name) {
    console.error('Usage: mails claim <name>')
    console.error('Example: mails claim myagent  →  myagent@mails.dev')
    process.exit(1)
  }

  const token = getConfigValue('user_token')
  if (!token) {
    console.error('Not logged in. Run: mails login')
    process.exit(1)
  }

  const res = await fetch(`${API_BASE}/v1/claim`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${token}`,
    },
    body: JSON.stringify({ address: name }),
  })

  const data = await res.json() as { mailbox?: string; api_key?: string; error?: string }

  if (!res.ok) {
    console.error(`Error: ${data.error}`)
    process.exit(1)
  }

  // Save api_key and mailbox to config
  setConfigValue('mailbox', data.mailbox!)
  setConfigValue('api_key', data.api_key!)

  console.log(`Claimed: ${data.mailbox}`)
  console.log(`API Key: ${data.api_key}`)
  console.log('')
  console.log('Saved to ~/.mails/config.json')
  console.log('')
  console.log('Your agent can now:')
  console.log(`  • Receive emails at ${data.mailbox}`)
  console.log(`  • Query inbox:  curl -H "Authorization: Bearer ${data.api_key}" ${API_BASE}/v1/inbox`)
  console.log(`  • Wait for code: curl -H "Authorization: Bearer ${data.api_key}" "${API_BASE}/v1/code?timeout=30"`)
}
