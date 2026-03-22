export const DEFAULT_MAILS_API_URL = 'https://api.mails.dev'

export function resolveHostedApiUrl(explicitUrl?: string): string {
  return explicitUrl || process.env.MAILS_API_URL || DEFAULT_MAILS_API_URL
}
