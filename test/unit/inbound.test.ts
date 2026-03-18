import { describe, expect, test } from 'bun:test'
import { parseInboundEmail } from '../../src/core/inbound'

describe('inbound payload parsing', () => {
  test('normalizes forwarded worker payload into an inbound email record', () => {
    const email = parseInboundEmail({
      id: 'email-1',
      mailbox: 'agent@test.com',
      from_address: 'sender@example.com',
      to_address: 'agent@test.com',
      subject: 'Invoice',
      body_text: 'See attachment',
      attachments: [
        {
          id: 'att-1',
          filename: 'invoice.txt',
          content_type: 'text/plain',
          mime_part_index: 0,
          text_content: 'invoice 42',
          text_extraction_status: 'done',
          content_base64: Buffer.from('invoice 42').toString('base64'),
        },
      ],
    })

    expect(email.direction).toBe('inbound')
    expect(email.status).toBe('received')
    expect(email.mailbox).toBe('agent@test.com')
    expect(email.attachments).toHaveLength(1)
    expect(email.attachments![0]!.email_id).toBe('email-1')
    expect(email.attachments![0]!.downloadable).toBeUndefined()
  })
})
