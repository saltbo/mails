export { send } from './core/send.js'
export { getAttachmentBlobStore } from './core/blob-store.js'
export { getInbox, getEmail, waitForCode } from './core/receive.js'
export { getStorage } from './core/storage.js'
export { parseInboundEmail, saveInboundEmail } from './core/inbound.js'
export { loadConfig, saveConfig, getConfigValue, setConfigValue } from './core/config.js'
export { createResendProvider } from './providers/send/resend.js'
export { createSqliteProvider } from './providers/storage/sqlite.js'
export { createDb9Provider } from './providers/storage/db9.js'

export type {
  Attachment,
  AttachmentBlobStore,
  AttachmentTextExtractionStatus,
  Email,
  PreparedAttachment,
  SendAttachment,
  SendOptions,
  SendResult,
  SendProvider,
  StorageProvider,
  MailsConfig,
} from './core/types.js'
