import { extractCode } from './extract-code'

export interface Env {
  DB: D1Database
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url)
    const corsHeaders = {
      'Access-Control-Allow-Origin': '*',
      'Access-Control-Allow-Methods': 'GET, POST, OPTIONS',
      'Access-Control-Allow-Headers': 'Content-Type, Authorization',
    }

    if (request.method === 'OPTIONS') {
      return new Response(null, { headers: corsHeaders })
    }

    let response: Response

    switch (url.pathname) {
      case '/api/inbox':
        response = await handleInbox(url, env)
        break
      case '/api/code':
        response = await handleGetCode(url, env)
        break
      case '/api/email':
        response = await handleGetEmail(url, env)
        break
      case '/health':
        response = Response.json({ ok: true })
        break
      default:
        response = Response.json({ name: 'mails-worker', version: '1.0.0' })
    }

    // Add CORS headers to all responses
    for (const [key, value] of Object.entries(corsHeaders)) {
      response.headers.set(key, value)
    }
    return response
  },

  async email(message: ForwardableEmailMessage, env: Env): Promise<void> {
    const to = message.to
    const from = message.from
    const subject = message.headers.get('subject') ?? ''

    const raw = await new Response(message.raw).text()

    const body = extractBody(raw)
    const bodyHtml = extractHtmlBody(raw)
    const code = extractCode(subject + ' ' + body)
    const fromName = parseFromName(message.headers.get('from') ?? from)

    const id = crypto.randomUUID()
    const now = new Date().toISOString()

    await env.DB.prepare(`
      INSERT INTO emails (id, mailbox, from_address, from_name, to_address, subject, body_text, body_html, code, direction, status, received_at, created_at)
      VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, 'inbound', 'received', ?, ?)
    `).bind(
      id, to, from, fromName, to, subject,
      body.slice(0, 50000), bodyHtml.slice(0, 100000),
      code, now, now
    ).run()
  },
} satisfies ExportedHandler<Env>

// --- HTTP Handlers ---

async function handleGetCode(url: URL, env: Env): Promise<Response> {
  const to = url.searchParams.get('to')
  if (!to) return Response.json({ error: 'Missing ?to= parameter' }, { status: 400 })

  const timeoutSec = Math.min(parseInt(url.searchParams.get('timeout') ?? '30'), 55)
  const since = url.searchParams.get('since')
  const deadline = Date.now() + timeoutSec * 1000

  while (Date.now() < deadline) {
    let query = 'SELECT id, code, from_address, subject, received_at FROM emails WHERE mailbox = ? AND code IS NOT NULL'
    const params: string[] = [to]

    if (since) {
      query += ' AND received_at > ?'
      params.push(since)
    }

    query += ' ORDER BY received_at DESC LIMIT 1'

    const row = await env.DB.prepare(query).bind(...params).first<{
      id: string; code: string; from_address: string; subject: string; received_at: string
    }>()

    if (row) {
      return Response.json({
        id: row.id,
        code: row.code,
        from: row.from_address,
        subject: row.subject,
        received_at: row.received_at,
      })
    }

    await new Promise(r => setTimeout(r, 2000))
  }

  return Response.json({ code: null })
}

async function handleInbox(url: URL, env: Env): Promise<Response> {
  const to = url.searchParams.get('to')
  if (!to) return Response.json({ error: 'Missing ?to= parameter' }, { status: 400 })

  const limit = Math.min(parseInt(url.searchParams.get('limit') ?? '20'), 100)
  const offset = parseInt(url.searchParams.get('offset') ?? '0')

  const rows = await env.DB.prepare(
    'SELECT id, mailbox, from_address, from_name, subject, code, direction, status, received_at FROM emails WHERE mailbox = ? ORDER BY received_at DESC LIMIT ? OFFSET ?'
  ).bind(to, limit, offset).all()

  return Response.json({ emails: rows.results })
}

async function handleGetEmail(url: URL, env: Env): Promise<Response> {
  const id = url.searchParams.get('id')
  if (!id) return Response.json({ error: 'Missing ?id= parameter' }, { status: 400 })

  const row = await env.DB.prepare(
    'SELECT * FROM emails WHERE id = ?'
  ).bind(id).first()

  if (!row) return Response.json({ error: 'Email not found' }, { status: 404 })

  return Response.json(row)
}

// --- MIME Parsing ---

function extractBody(raw: string): string {
  const plainMatch = raw.match(
    /Content-Type:\s*text\/plain[^\r\n]*\r?\n(?:Content-Transfer-Encoding:[^\r\n]*\r?\n)?(?:\r?\n)([\s\S]*?)(?:\r?\n--|\r?\n\r?\n\S*$)/i
  )
  if (plainMatch) return decodeTransferEncoding(plainMatch[1]!, raw).trim()

  const headerEnd = raw.indexOf('\r\n\r\n')
  if (headerEnd > 0) return raw.slice(headerEnd + 4).trim()
  return raw
}

function extractHtmlBody(raw: string): string {
  const htmlMatch = raw.match(
    /Content-Type:\s*text\/html[^\r\n]*\r?\n(?:Content-Transfer-Encoding:[^\r\n]*\r?\n)?(?:\r?\n)([\s\S]*?)(?:\r?\n--)/i
  )
  if (htmlMatch) return decodeTransferEncoding(htmlMatch[1]!, raw).trim()
  return ''
}

function decodeTransferEncoding(content: string, rawSection: string): string {
  if (/Content-Transfer-Encoding:\s*base64/i.test(rawSection)) {
    try {
      return atob(content.replace(/\s/g, ''))
    } catch {
      return content
    }
  }
  if (/Content-Transfer-Encoding:\s*quoted-printable/i.test(rawSection)) {
    return content
      .replace(/=\r?\n/g, '')
      .replace(/=([0-9A-Fa-f]{2})/g, (_, hex) => String.fromCharCode(parseInt(hex, 16)))
  }
  return content
}

function parseFromName(from: string): string {
  const match = from.match(/^"?([^"<]+)"?\s*</)
  return match ? match[1]!.trim() : ''
}
