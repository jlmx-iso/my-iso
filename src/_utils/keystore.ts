/**
 * IndexedDB helpers for persisting E2EE keys client-side.
 *
 * All key material stored here is CryptoKey objects (non-extractable for
 * the private key once loaded, extractable for thread keys so they can be
 * re-imported from the server backup if needed).
 */

const DB_NAME = "iso-keystore";
const DB_VERSION = 1;
const PRIVATE_KEY_STORE = "private-keys";
const THREAD_KEY_STORE = "thread-keys";

function openDb(): Promise<IDBDatabase> {
  return new Promise((resolve, reject) => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (event) => {
      const db = (event.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(PRIVATE_KEY_STORE)) {
        db.createObjectStore(PRIVATE_KEY_STORE);
      }
      if (!db.objectStoreNames.contains(THREAD_KEY_STORE)) {
        db.createObjectStore(THREAD_KEY_STORE);
      }
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet<T>(db: IDBDatabase, store: string, key: string): Promise<T | undefined> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readonly");
    const req = tx.objectStore(store).get(key);
    req.onsuccess = () => resolve(req.result as T | undefined);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db: IDBDatabase, store: string, key: string, value: unknown): Promise<void> {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(store, "readwrite");
    const req = tx.objectStore(store).put(value, key);
    req.onsuccess = () => resolve();
    req.onerror = () => reject(req.error);
  });
}

// ---------------------------------------------------------------------------
// Private key (ECDH)
// ---------------------------------------------------------------------------

export async function storePrivateKey(userId: string, key: CryptoKey): Promise<void> {
  const db = await openDb();
  await idbPut(db, PRIVATE_KEY_STORE, userId, key);
}

export async function getPrivateKey(userId: string): Promise<CryptoKey | undefined> {
  const db = await openDb();
  return idbGet<CryptoKey>(db, PRIVATE_KEY_STORE, userId);
}

// ---------------------------------------------------------------------------
// Thread keys (AES-256-GCM)
// ---------------------------------------------------------------------------

export async function storeThreadKey(threadId: string, key: CryptoKey): Promise<void> {
  const db = await openDb();
  await idbPut(db, THREAD_KEY_STORE, threadId, key);
}

export async function getThreadKey(threadId: string): Promise<CryptoKey | undefined> {
  const db = await openDb();
  return idbGet<CryptoKey>(db, THREAD_KEY_STORE, threadId);
}
