import { loadConfig, setConfigValue } from '../../core/config.js'
import { getStorage } from '../../core/storage.js'
import type { Email } from '../../core/types.js'

export async function syncCommand(args: string[]) {
  const config = loadConfig()

  // Determine sync source
  const workerUrl = config.worker_url
  const apiKey = config.api_key
  const baseUrl = apiKey
    ? (process.env.MAILS_API_URL || 'https://mails-dev-worker.o-u-turing.workers.dev')
    : workerUrl

  if (!baseUrl) {
    console.error('No worker_url or api_key configured. Nothing to sync from.')
    process.exit(1)
  }

  const mailbox = config.mailbox
  if (!mailbox) {
    console.error('No mailbox configured. Run: mails config set mailbox <address>')
    process.exit(1)
  }

  // Storage must be local (sqlite or db9), not remote
  const storage = await getStorage()
  if (storage.name === 'remote') {
    console.error('Cannot sync to remote storage. Set storage_provider to sqlite or db9.')
    process.exit(1)
  }

  // Parse args
  const fromScratch = args.includes('--from-scratch')
  const sinceArg = args.includes('--since')
    ? args[args.indexOf('--since') + 1]
    : undefined

  const syncSince = fromScratch
    ? '1970-01-01T00:00:00Z'
    : (sinceArg || config.last_sync || '1970-01-01T00:00:00Z')

  // Build auth headers
  const headers: Record<string, string> = {}
  if (apiKey) {
    headers['Authorization'] = `Bearer ${apiKey}`
  } else if (config.worker_token) {
    headers['Authorization'] = `Bearer ${config.worker_token}`
  }

  // Determine endpoint path
  // For hosted (api_key): use /v1/sync (no ?to= needed)
  // For self-hosted (worker_url): use /api/sync?to=mailbox
  const isHosted = !!apiKey
  const syncPath = isHosted ? '/v1/sync' : '/api/sync'

  let offset = 0
  let synced = 0

  console.log(`Syncing from ${baseUrl} since ${syncSince}...`)

  while (true) {
    let url = `${baseUrl}${syncPath}?since=${encodeURIComponent(syncSince)}&limit=100&offset=${offset}`
    if (!isHosted) {
      url += `&to=${encodeURIComponent(mailbox)}`
    }

    const res = await fetch(url, { headers })

    if (!res.ok) {
      const data = await res.json() as { error?: string }
      console.error(`Sync error: ${data.error ?? res.statusText}`)
      process.exit(1)
    }

    const data = await res.json() as {
      emails: Email[]
      total: number
      has_more: boolean
    }

    for (const email of data.emails) {
      await storage.saveEmail(email)
      synced++
    }

    if (!data.has_more || data.emails.length === 0) break
    offset += data.emails.length

    process.stdout.write(`\r  ${synced}/${data.total} emails synced`)
  }

  // Update last_sync
  const now = new Date().toISOString()
  setConfigValue('last_sync', now)

  console.log(`\nSynced ${synced} email(s). Last sync: ${now}`)
}
