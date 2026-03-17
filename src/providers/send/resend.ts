import type { SendProvider, SendResult } from '../../core/types.js'

interface ResendResponse {
  id: string
}

interface ResendError {
  statusCode: number
  message: string
  name: string
}

export function createResendProvider(apiKey: string): SendProvider {
  return {
    name: 'resend',

    async send(options): Promise<SendResult> {
      const body: Record<string, unknown> = {
        from: options.from,
        to: options.to,
        subject: options.subject,
      }
      if (options.text) body.text = options.text
      if (options.html) body.html = options.html
      if (options.replyTo) body.reply_to = options.replyTo

      const res = await fetch('https://api.resend.com/emails', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
        },
        body: JSON.stringify(body),
      })

      if (!res.ok) {
        const err = await res.json() as ResendError
        throw new Error(`Resend error: ${err.message}`)
      }

      const data = await res.json() as ResendResponse
      return { id: data.id, provider: 'resend' }
    },
  }
}
