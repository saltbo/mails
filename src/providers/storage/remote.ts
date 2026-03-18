import type { Email, EmailQueryOptions, EmailSearchOptions, StorageProvider } from '../../core/types.js'

const DEFAULT_API_URL = 'https://mails-dev-worker.o-u-turing.workers.dev'

export function createRemoteProvider(apiKey: string, apiUrl?: string): StorageProvider {
  const baseUrl = apiUrl || process.env.MAILS_API_URL || DEFAULT_API_URL

  async function apiFetch(path: string, params?: Record<string, string | number>): Promise<Response> {
    const url = new URL(path, baseUrl)
    if (params) {
      for (const [k, v] of Object.entries(params)) {
        if (v !== undefined && v !== null) url.searchParams.set(k, String(v))
      }
    }
    return fetch(url.toString(), {
      headers: { 'Authorization': `Bearer ${apiKey}` },
    })
  }

  return {
    name: 'remote',

    async init() {
      // Nothing to initialize — remote API is always ready
    },

    async saveEmail(_email: Email) {
      // Remote provider is read-only from the CLI side.
      // Emails are written by the Worker's email() handler.
      throw new Error('Remote provider is read-only. Emails are received by the Worker.')
    },

    async getEmails(_mailbox, options) {
      const res = await apiFetch('/v1/inbox', {
        limit: options?.limit ?? 20,
        offset: options?.offset ?? 0,
        ...(options?.direction ? { direction: options.direction } : {}),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(`API error: ${data.error ?? res.statusText}`)
      }
      const data = await res.json() as { emails: Email[] }
      return data.emails
    },

    async searchEmails(_mailbox, options) {
      const res = await apiFetch('/v1/inbox', {
        query: options.query,
        limit: options.limit ?? 20,
        offset: options.offset ?? 0,
        ...(options.direction ? { direction: options.direction } : {}),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(`API error: ${data.error ?? res.statusText}`)
      }
      const data = await res.json() as { emails: Email[] }
      return data.emails
    },

    async getEmail(id) {
      const res = await apiFetch('/v1/email', { id })
      if (!res.ok) {
        if (res.status === 404) return null
        const data = await res.json() as { error?: string }
        throw new Error(`API error: ${data.error ?? res.statusText}`)
      }
      return await res.json() as Email
    },

    async getCode(_mailbox, options) {
      const res = await apiFetch('/v1/code', {
        timeout: options?.timeout ?? 30,
        ...(options?.since ? { since: options.since } : {}),
      })
      if (!res.ok) {
        const data = await res.json() as { error?: string }
        throw new Error(`API error: ${data.error ?? res.statusText}`)
      }
      const data = await res.json() as { code: string | null; from?: string; subject?: string }
      if (!data.code) return null
      return { code: data.code, from: data.from ?? '', subject: data.subject ?? '' }
    },
  }
}
