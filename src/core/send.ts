import type { SendOptions, SendProvider, SendResult } from './types.js'
import { loadConfig } from './config.js'
import { createResendProvider } from '../providers/send/resend.js'

function resolveProvider(): SendProvider {
  const config = loadConfig()

  switch (config.send_provider) {
    case 'resend': {
      if (!config.resend_api_key) {
        throw new Error('resend_api_key not configured. Run: mails config set resend_api_key <key>')
      }
      return createResendProvider(config.resend_api_key)
    }
    default:
      throw new Error(`Unknown send provider: ${config.send_provider}`)
  }
}

export async function send(options: SendOptions): Promise<SendResult> {
  const config = loadConfig()
  const provider = resolveProvider()

  const from = options.from ?? config.default_from
  if (!from) {
    throw new Error('No "from" address. Set default_from or pass --from')
  }

  const to = Array.isArray(options.to) ? options.to : [options.to]

  if (!options.text && !options.html) {
    throw new Error('Either text or html body is required')
  }

  return provider.send({
    from,
    to,
    subject: options.subject,
    text: options.text,
    html: options.html,
    replyTo: options.replyTo,
  })
}
