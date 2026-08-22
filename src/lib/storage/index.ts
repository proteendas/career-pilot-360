/**
 * Document storage behind a two-driver adapter. Server-only.
 *
 *  - `blob`  : Vercel Blob with `access: 'private'`. Objects are NOT publicly
 *              addressable; bytes are streamed back only through our own
 *              authenticated download route.
 *  - `local` : filesystem under `LOCAL_STORAGE_DIR` (default `.storage`), for
 *              local development without a Blob token. Gitignored.
 *
 * Driver selection: `STORAGE_DRIVER=auto` (default) uses Blob when
 * `BLOB_READ_WRITE_TOKEN` is present, otherwise local. Production deployments
 * should set the token; the UI shows a setup notice when running on `local`.
 */
import { env } from '@/lib/env';

export interface StoredObject {
  /** Stable key we persist in the database. */
  path: string;
  /** Provider URL when one exists. Never handed to the browser directly. */
  url: string | null;
  size: number;
  contentType: string;
}

export interface StorageDriver {
  readonly id: 'blob' | 'local';
  put(path: string, bytes: Uint8Array, contentType: string): Promise<StoredObject>;
  get(path: string): Promise<{ bytes: Uint8Array; contentType: string } | null>;
  remove(path: string): Promise<void>;
}

export class StorageError extends Error {
  constructor(message: string) {
    super(message);
    this.name = 'StorageError';
  }
}

/** Reject traversal and absolute paths before any driver sees the key. */
export function assertSafeStoragePath(path: string): string {
  const p = (path ?? '').trim();
  if (!p) throw new StorageError('Storage path is required.');
  if (p.startsWith('/') || p.includes('..') || p.includes('\\') || /[\x00-\x1f]/.test(p)) {
    throw new StorageError('Unsafe storage path.');
  }
  if (!/^[A-Za-z0-9][A-Za-z0-9._/-]{0,300}$/.test(p)) throw new StorageError('Unsafe storage path.');
  return p;
}

/* --------------------------------------------------------- Vercel Blob --- */

class VercelBlobDriver implements StorageDriver {
  readonly id = 'blob' as const;

  async put(path: string, bytes: Uint8Array, contentType: string): Promise<StoredObject> {
    const safe = assertSafeStoragePath(path);
    const { put } = await import('@vercel/blob');
    const res = await put(safe, Buffer.from(bytes), {
      access: 'private',
      contentType,
      addRandomSuffix: false,
      token: env().BLOB_READ_WRITE_TOKEN,
      allowOverwrite: false,
    });
    return { path: res.pathname, url: res.url, size: bytes.byteLength, contentType };
  }

  async get(path: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const safe = assertSafeStoragePath(path);
    const { get } = await import('@vercel/blob');
    const res = await get(safe, { access: 'private', token: env().BLOB_READ_WRITE_TOKEN });
    if (!res) return null;
    const buf = new Uint8Array(await new Response(res.stream).arrayBuffer());
    return { bytes: buf, contentType: res.blob?.contentType ?? 'application/octet-stream' };
  }

  async remove(path: string): Promise<void> {
    const safe = assertSafeStoragePath(path);
    const { del } = await import('@vercel/blob');
    await del(safe, { token: env().BLOB_READ_WRITE_TOKEN });
  }
}

/* ------------------------------------------------------------- local fs --- */

class LocalFsDriver implements StorageDriver {
  readonly id = 'local' as const;

  private async paths(path: string) {
    const [{ resolve, dirname, sep }, { mkdir }] = await Promise.all([
      import('node:path'),
      import('node:fs/promises'),
    ]);
    const root = resolve(process.cwd(), env().LOCAL_STORAGE_DIR);
    const full = resolve(root, assertSafeStoragePath(path));
    if (!full.startsWith(root + sep)) {
      throw new StorageError('Resolved storage path escaped the storage root.');
    }
    await mkdir(dirname(full), { recursive: true });
    return { root, full };
  }

  async put(path: string, bytes: Uint8Array, contentType: string): Promise<StoredObject> {
    const { full } = await this.paths(path);
    const { writeFile } = await import('node:fs/promises');
    await writeFile(full, bytes);
    await writeFile(`${full}.meta`, JSON.stringify({ contentType }), 'utf8');
    return { path: assertSafeStoragePath(path), url: null, size: bytes.byteLength, contentType };
  }

  async get(path: string): Promise<{ bytes: Uint8Array; contentType: string } | null> {
    const { full } = await this.paths(path);
    const { readFile } = await import('node:fs/promises');
    try {
      const bytes = new Uint8Array(await readFile(full));
      let contentType = 'application/octet-stream';
      try {
        const meta = JSON.parse(await readFile(`${full}.meta`, 'utf8')) as { contentType?: string };
        if (meta.contentType) contentType = meta.contentType;
      } catch {
        // no sidecar metadata - fall back to octet-stream
      }
      return { bytes, contentType };
    } catch {
      return null;
    }
  }

  async remove(path: string): Promise<void> {
    const { full } = await this.paths(path);
    const { rm } = await import('node:fs/promises');
    await rm(full, { force: true });
    await rm(`${full}.meta`, { force: true });
  }
}

let driver: StorageDriver | null = null;

export function getStorage(): StorageDriver {
  if (driver) return driver;
  const e = env();
  const useBlob =
    e.STORAGE_DRIVER === 'blob' || (e.STORAGE_DRIVER === 'auto' && Boolean(e.BLOB_READ_WRITE_TOKEN));
  if (e.STORAGE_DRIVER === 'blob' && !e.BLOB_READ_WRITE_TOKEN) {
    throw new StorageError('STORAGE_DRIVER=blob but BLOB_READ_WRITE_TOKEN is not set.');
  }
  // On Vercel, `auto` falling back to the local filesystem driver is a
  // silent trap: the function's filesystem is read-only outside `/tmp`, so
  // every write fails with a cryptic ENOENT rather than a message that says
  // what's actually missing. Vercel sets VERCEL=1 on every deployment, so
  // this only ever fires in a real deployment, never in local dev.
  if (!useBlob && process.env.VERCEL) {
    throw new StorageError(
      'Running on Vercel with no BLOB_READ_WRITE_TOKEN configured. Connect a Vercel Blob store to this ' +
        'project (Storage tab → Create Database → Blob) and redeploy — the token is injected automatically. ' +
        'The local filesystem driver only works in local development.',
    );
  }
  driver = useBlob ? new VercelBlobDriver() : new LocalFsDriver();
  return driver;
}

/** Test-only override. */
export function __setStorageDriver(d: StorageDriver | null): void {
  driver = d;
}

export function storageDriverId(): 'blob' | 'local' {
  return getStorage().id;
}

/* ------------------------------------------------------------ key naming -- */

/** Tenant-scoped, unguessable object keys. */
export function resumeOriginalPath(userId: string, documentId: string, filename: string): string {
  return `u/${userId}/resumes/original/${documentId}/${filename}`;
}

export function resumePdfPath(userId: string, versionId: string, hash: string): string {
  return `u/${userId}/resumes/pdf/${versionId}/${hash.slice(0, 16)}.pdf`;
}

export function packetPath(userId: string, packetId: string, filename: string): string {
  return `u/${userId}/packets/${packetId}/${filename}`;
}
