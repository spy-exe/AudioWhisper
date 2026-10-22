/** In-page signal that queued work changed (a job started or finished), so indicators refresh
 * at once instead of waiting for their next poll. */
export const QUEUE_CHANGED = "audiowhisper:queue-changed";

export function signalQueueChanged() {
  if (typeof window !== "undefined") window.dispatchEvent(new Event(QUEUE_CHANGED));
}
