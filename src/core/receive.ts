import type { Email } from './types.js'
import { getStorage } from './storage.js'

export async function getInbox(mailbox: string, options?: {
  limit?: number
  offset?: number
  direction?: 'inbound' | 'outbound'
}): Promise<Email[]> {
  const storage = await getStorage()
  return storage.getEmails(mailbox, options)
}

export async function getEmail(id: string): Promise<Email | null> {
  const storage = await getStorage()
  return storage.getEmail(id)
}

export async function waitForCode(mailbox: string, options?: {
  timeout?: number
  since?: string
}): Promise<{ code: string; from: string; subject: string } | null> {
  const storage = await getStorage()
  return storage.getCode(mailbox, options)
}
