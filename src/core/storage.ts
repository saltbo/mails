import type { StorageProvider } from './types.js'
import { loadConfig } from './config.js'
import { createSqliteProvider } from '../providers/storage/sqlite.js'
import { createDb9Provider } from '../providers/storage/db9.js'

let _provider: StorageProvider | null = null

export async function getStorage(): Promise<StorageProvider> {
  if (_provider) return _provider

  const config = loadConfig()

  switch (config.storage_provider) {
    case 'db9': {
      if (!config.db9_token) {
        throw new Error('db9_token not configured. Run: mails config set db9_token <token>')
      }
      if (!config.db9_database_id) {
        throw new Error('db9_database_id not configured. Run: mails config set db9_database_id <id>')
      }
      _provider = createDb9Provider(config.db9_token, config.db9_database_id)
      break
    }
    case 'sqlite':
    default: {
      _provider = createSqliteProvider()
      break
    }
  }

  await _provider.init()
  return _provider
}
