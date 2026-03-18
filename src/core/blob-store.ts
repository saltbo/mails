import { loadConfig } from './config.js'
import type { AttachmentBlobStore } from './types.js'
import { createFilesystemAttachmentBlobStore } from '../providers/blob/filesystem.js'

let blobStore: AttachmentBlobStore | null = null

export function getAttachmentBlobStore(): AttachmentBlobStore {
  if (blobStore) return blobStore

  const config = loadConfig()
  switch (config.attachment_blob_store) {
    case undefined:
    case 'filesystem':
      blobStore = createFilesystemAttachmentBlobStore(config.attachment_blob_path)
      break
    default:
      throw new Error(`Unknown attachment_blob_store: ${config.attachment_blob_store}`)
  }

  return blobStore
}
