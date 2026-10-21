import type { CapturedChunk } from "./live-audio";
export interface StoredChunk extends CapturedChunk {
  id: string;
  jobId: string;
  uploaded: boolean;
}
export interface StoredCapture {
  id: "capture";
  jobId: string;
  title: string;
  expected_chunks?: number;
  duration: number;
}
function open() {
  return new Promise<IDBDatabase>((resolve, reject) => {
    const request = indexedDB.open("audiowhisper-live", 1);
    request.onupgradeneeded = () => {
      request.result.createObjectStore("chunks", { keyPath: "id" });
      request.result.createObjectStore("sessions", { keyPath: "id" });
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => reject(request.error);
  });
}
async function action<T>(
  store: string,
  mode: IDBTransactionMode,
  operation: (store: IDBObjectStore) => IDBRequest<T>,
): Promise<T> {
  const database = await open();
  return new Promise((resolve, reject) => {
    const transaction = database.transaction(store, mode);
    const request = operation(transaction.objectStore(store));
    transaction.oncomplete = () => {
      database.close();
      resolve(request.result);
    };
    transaction.onerror = () => {
      database.close();
      reject(transaction.error);
    };
    transaction.onabort = () => {
      database.close();
      reject(transaction.error);
    };
  });
}
export const liveStore = {
  putChunk: (chunk: StoredChunk) =>
    action("chunks", "readwrite", (s) => s.put(chunk)),
  chunks: () => action<StoredChunk[]>("chunks", "readonly", (s) => s.getAll()),
  putCapture: (capture: StoredCapture) =>
    action("sessions", "readwrite", (s) => s.put(capture)),
  capture: () =>
    action<StoredCapture | undefined>("sessions", "readonly", (s) =>
      s.get("capture"),
    ),
  clear: async () => {
    await action("chunks", "readwrite", (s) => s.clear());
    await action("sessions", "readwrite", (s) => s.clear());
  },
};
