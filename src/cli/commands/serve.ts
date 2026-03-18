import { createServer, type IncomingMessage, type ServerResponse } from 'node:http'
import { saveInboundEmail } from '../../core/inbound.js'

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (!arg.startsWith('--')) continue

    const key = arg.slice(2)
    const value = args[i + 1]
    if (value && !value.startsWith('--')) {
      result[key] = value
      i++
    } else {
      result[key] = 'true'
    }
  }
  return result
}

export async function serveCommand(args: string[]) {
  const opts = parseArgs(args)
  const host = opts.host ?? '127.0.0.1'
  const port = parseInt(opts.port ?? process.env.MAILS_INBOUND_PORT ?? '8787', 10)
  const token = opts.token ?? process.env.MAILS_INBOUND_TOKEN

  if (!Number.isFinite(port) || port <= 0) {
    throw new Error('Invalid --port value')
  }

  const server = createServer(async (req, res) => {
    try {
      const url = new URL(req.url ?? '/', `http://${req.headers.host ?? `${host}:${port}`}`)

      if (req.method === 'GET' && url.pathname === '/health') {
        writeJson(res, 200, { ok: true })
        return
      }

      if (req.method === 'POST' && url.pathname === '/api/inbound-email') {
        if (token && !isAuthorized(req.headers.authorization, token)) {
          writeJson(res, 401, { error: 'Unauthorized' })
          return
        }

        const body = await readBody(req)
        const email = await saveInboundEmail(JSON.parse(body))
        writeJson(res, 200, {
          ok: true,
          id: email.id,
          mailbox: email.mailbox,
          attachment_count: email.attachment_count ?? email.attachments?.length ?? 0,
        })
        return
      }

      writeJson(res, 404, { error: 'Not found' })
    } catch (error) {
      writeJson(res, 400, {
        error: error instanceof Error ? error.message : 'Invalid request',
      })
    }
  })

  await new Promise<void>((resolve, reject) => {
    server.once('error', reject)
    server.listen(port, host, () => resolve())
  })

  console.log(`Inbound server listening on http://${host}:${port}`)
  console.log('POST /api/inbound-email to persist inbound emails locally')
  if (token) {
    console.log('Bearer token authentication is enabled')
  }
}

function isAuthorized(authorization: string | undefined, token: string): boolean {
  if (!authorization) return false
  return authorization === `Bearer ${token}`
}

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let body = ''
    req.setEncoding('utf8')
    req.on('data', (chunk) => {
      body += chunk
    })
    req.on('end', () => resolve(body))
    req.on('error', reject)
  })
}

function writeJson(
  res: ServerResponse<IncomingMessage>,
  status: number,
  body: Record<string, unknown>
) {
  res.statusCode = status
  res.setHeader('Content-Type', 'application/json')
  res.end(JSON.stringify(body))
}
