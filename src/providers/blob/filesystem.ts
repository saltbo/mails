import { mkdir, readFile, rm, writeFile } from 'node:fs/promises'
import { existsSync, mkdirSync } from 'node:fs'
import { homedir } from 'node:os'
import { basename, dirname, isAbsolute, join, relative, resolve } from 'node:path'
import type { AttachmentBlobStore } from '../../core/types.js'

const DEFAULT_DIR = join(homedir(), '.mails', 'attachments')

export function createFilesystemAttachmentBlobStore(baseDir = DEFAULT_DIR): AttachmentBlobStore {
  if (!existsSync(baseDir)) {
    mkdirSync(baseDir, { recursive: true })
  }

  return {
    name: 'filesystem',

    async put(key, content) {
      const path = resolvePath(baseDir, key)
      await mkdir(dirname(path), { recursive: true })
      await writeFile(path, content)
    },

    async get(key) {
      const path = resolvePath(baseDir, key)
      try {
        return new Uint8Array(await readFile(path))
      } catch {
        return null
      }
    },

    async delete(key) {
      const path = resolvePath(baseDir, key)
      try {
        await rm(path, { force: true })
      } catch {
        // Ignore delete failures for missing files
      }
    },
  }
}

function resolvePath(baseDir: string, key: string): string {
  const resolvedBaseDir = resolve(baseDir)
  const resolvedPath = resolve(resolvedBaseDir, key)
  const relativePath = relative(resolvedBaseDir, resolvedPath)

  if (relativePath === '' || (!relativePath.startsWith('..') && !isAbsolute(relativePath))) {
    return resolvedPath
  }

  throw new Error(`Attachment key escapes blob store root: ${key}`)
}

export function buildFilesystemAttachmentKey(emailId: string, attachmentId: string, filename: string): string {
  const safeFilename = basename(filename).replace(/[^A-Za-z0-9._-]/g, '_')
  return join(emailId, `${attachmentId}-${safeFilename}`)
}
