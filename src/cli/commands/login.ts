import { setConfigValue, getConfigValue } from '../../core/config.js'

const API_BASE = 'https://mails-dev-worker.o-u-turing.workers.dev'

export async function loginCommand(args: string[]) {
  // If --token is provided, store it directly
  const tokenIdx = args.indexOf('--token')
  if (tokenIdx !== -1 && args[tokenIdx + 1]) {
    const token = args[tokenIdx + 1]!
    setConfigValue('user_token', token)
    console.log('Token saved. You can now use: mails claim <name>')
    return
  }

  // Open mails.dev/setup in browser for Clerk login
  // The setup page will show the user their token after login
  const setupUrl = 'https://mails.dev/setup'
  console.log(`Opening ${setupUrl} in your browser...`)
  console.log('After signing in, copy your token and run:')
  console.log('')
  console.log('  mails login --token <your-token>')
  console.log('')

  // Try to open browser
  const { exec } = await import('child_process')
  const platform = process.platform
  const cmd = platform === 'darwin' ? 'open' : platform === 'win32' ? 'start' : 'xdg-open'
  exec(`${cmd} ${setupUrl}`)
}
