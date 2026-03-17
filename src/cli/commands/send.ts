import { send } from '../../core/send.js'

function parseArgs(args: string[]): Record<string, string> {
  const result: Record<string, string> = {}
  for (let i = 0; i < args.length; i++) {
    const arg = args[i]!
    if (arg.startsWith('--')) {
      const key = arg.slice(2)
      const value = args[i + 1]
      if (value && !value.startsWith('--')) {
        result[key] = value
        i++
      }
    }
  }
  return result
}

export async function sendCommand(args: string[]) {
  const opts = parseArgs(args)

  if (!opts['to']) {
    console.error('Usage: mails send --to <email> --subject <subject> --body <text> [--html <html>] [--from <from>] [--reply-to <email>]')
    process.exit(1)
  }

  if (!opts['subject']) {
    console.error('Missing --subject')
    process.exit(1)
  }

  if (!opts['body'] && !opts['html']) {
    console.error('Missing --body or --html')
    process.exit(1)
  }

  const result = await send({
    from: opts['from'],
    to: opts['to'],
    subject: opts['subject'],
    text: opts['body'],
    html: opts['html'],
    replyTo: opts['reply-to'],
  })

  console.log(`Sent via ${result.provider} (id: ${result.id})`)
}
