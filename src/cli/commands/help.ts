export function helpCommand() {
  console.log(`
mails - Email infrastructure for AI agents

Usage:
  mails <command> [options]

Commands:
  send          Send an email
  inbox         List received emails
  code          Wait for a verification code
  config        View or modify configuration
  setup         Interactive setup wizard (coming soon)
  help          Show this help message
  version       Show version

Send:
  mails send --to <email> --subject <subject> --body <text>
  mails send --to <email> --subject <subject> --html <html>
  mails send --from "Name <email>" --to <email> --subject <subject> --body <text>

Inbox:
  mails inbox                           List recent emails
  mails inbox --mailbox <address>       List emails for a specific mailbox
  mails inbox <id>                      Show email details

Code:
  mails code --to <address>             Wait for a verification code
  mails code --to <address> --timeout 60

Config:
  mails config                    Show current config
  mails config set <key> <value>  Set a config value
  mails config get <key>          Get a config value
  mails config path               Show config file path

Config keys:
  mode              hosted | selfhosted
  domain            Your email domain
  mailbox           Your mailbox address
  send_provider     resend (default)
  storage_provider  sqlite | db9
  resend_api_key    Resend API key
  db9_token         db9.ai token
  db9_database_id   db9.ai database ID
  default_from      Default sender address

https://mails.dev
`.trim())
}
