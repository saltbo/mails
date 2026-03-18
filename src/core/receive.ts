import type { Email } from './types.js'
import { loadConfig } from './config.js'
import { getStorage } from './storage.js'

export async function getInbox(mailbox: string, options?: {
  limit?: number
  offset?: number
  direction?: 'inbound' | 'outbound'
}): Promise<Email[]> {
  const workerUrl = loadConfig().worker_url
  if (workerUrl) {
    const params = new URLSearchParams({
      to: mailbox,
      limit: String(options?.limit ?? 20),
      offset: String(options?.offset ?? 0),
    })
    const response = await fetch(`${workerUrl}/api/inbox?${params.toString()}`)
    if (!response.ok) {
      throw new Error(`Worker inbox request failed: ${response.status} ${response.statusText}`)
    }
    const data = await response.json() as { emails: Email[] }
    return data.emails
  }

  const storage = await getStorage()
  return storage.getEmails(mailbox, options)
}

export async function getEmail(id: string): Promise<Email | null> {
  const workerUrl = loadConfig().worker_url
  if (workerUrl) {
    const response = await fetch(`${workerUrl}/api/email?id=${encodeURIComponent(id)}`)
    if (response.status === 404) return null
    if (!response.ok) {
      throw new Error(`Worker email request failed: ${response.status} ${response.statusText}`)
    }
    return await response.json() as Email
  }

  const storage = await getStorage()
  return storage.getEmail(id)
}

export async function waitForCode(mailbox: string, options?: {
  timeout?: number
  since?: string
}): Promise<{ code: string; from: string; subject: string } | null> {
  const workerUrl = loadConfig().worker_url
  if (workerUrl) {
    const params = new URLSearchParams({
      to: mailbox,
      timeout: String(options?.timeout ?? 30),
    })
    if (options?.since) params.set('since', options.since)

    const response = await fetch(`${workerUrl}/api/code?${params.toString()}`)
    if (!response.ok) {
      throw new Error(`Worker code request failed: ${response.status} ${response.statusText}`)
    }

    const data = await response.json() as { code: string | null; from?: string; subject?: string }
    if (!data.code) return null
    return {
      code: data.code,
      from: data.from ?? '',
      subject: data.subject ?? '',
    }
  }

  const storage = await getStorage()
  return storage.getCode(mailbox, options)
}
