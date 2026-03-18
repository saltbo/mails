import { describe, expect, test } from 'bun:test'
import { mkdtempSync, rmSync } from 'node:fs'
import { tmpdir } from 'node:os'
import { join } from 'node:path'
import { createFilesystemAttachmentBlobStore } from '../../src/providers/blob/filesystem'

describe('filesystem attachment blob store', () => {
  test('rejects keys that escape the blob store root', async () => {
    const dir = mkdtempSync(join(tmpdir(), 'mails-blob-store-'))
    const store = createFilesystemAttachmentBlobStore(dir)

    try {
      await expect(store.put('../escape.txt', new Uint8Array([1, 2, 3]))).rejects.toThrow(
        'Attachment key escapes blob store root'
      )
    } finally {
      rmSync(dir, { recursive: true, force: true })
    }
  })
})
