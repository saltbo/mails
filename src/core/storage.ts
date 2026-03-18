import type { StorageProvider } from './types.js'
import { loadConfig } from './config.js'
import { createSqliteProvider } from '../providers/storage/sqlite.js'
import { createDb9Provider } from '../providers/storage/db9.js'
import { createRemoteProvider } from '../providers/storage/remote.js'

let _provider: StorageProvider | null = null

export async function getStorage(): Promise<StorageProvider> {
  if (_provider) return _provider

  const config = loadConfig()

  // Explicit storage_provider takes priority
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
    case 'remote': {
      if (!config.api_key) {
        throw new Error('api_key not configured. Run: mails claim <name>')
      }
      _provider = createRemoteProvider(config.api_key)
      break
    }
    case 'sqlite': {
      _provider = createSqliteProvider()
      break
    }
    default: {
      // Auto-detect: if api_key exists but no explicit storage_provider,
      // use remote (light client). Otherwise fall back to sqlite.
      if (config.api_key) {
        _provider = createRemoteProvider(config.api_key)
      } else {
        _provider = createSqliteProvider()
      }
      break
    }
  }

  await _provider.init()
  return _provider
}
