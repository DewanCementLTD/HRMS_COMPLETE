/**
 * Background location tracker.
 *
 * - Captures GPS position every hour while the user is logged in.
 * - Buffers unsent points in localStorage so they survive page refreshes
 *   and brief network outages.
 * - Flushes the buffer to POST /auth/location/batch whenever online.
 */

const STORAGE_KEY = "lms_pending_locations";
const INTERVAL_MS = 60 * 60 * 1000; // 1 hour
const SYNC_RETRY_MS = 5 * 60 * 1000; // retry offline buffer every 5 min

interface PendingPoint {
  latitude: number;
  longitude: number;
  accuracy: number;
  recorded_at: string; // ISO 8601
}

function loadPending(): PendingPoint[] {
  try {
    return JSON.parse(localStorage.getItem(STORAGE_KEY) || "[]");
  } catch {
    return [];
  }
}

function savePending(points: PendingPoint[]) {
  localStorage.setItem(STORAGE_KEY, JSON.stringify(points));
}

function appendPending(point: PendingPoint) {
  const existing = loadPending();
  // Keep at most 72 points (3 days of hourly data) to avoid bloat
  const trimmed = existing.slice(-71);
  savePending([...trimmed, point]);
}

async function flush(cardNo: string): Promise<boolean> {
  const pending = loadPending();
  if (pending.length === 0) return true;

  try {
    const res = await fetch("/api/auth/location/batch", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({ card_no: cardNo, locations: pending }),
    });
    if (res.ok) {
      savePending([]);
      console.log(`[LocationTracker] Synced ${pending.length} point(s)`);
      return true;
    }
  } catch {
    // Offline or server error — keep points buffered
  }
  return false;
}

async function captureAndQueue(cardNo: string): Promise<void> {
  if (!("geolocation" in navigator)) return;

  return new Promise((resolve) => {
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const point: PendingPoint = {
          latitude: pos.coords.latitude,
          longitude: pos.coords.longitude,
          accuracy: pos.coords.accuracy,
          recorded_at: new Date().toISOString(),
        };
        appendPending(point);
        console.log(`[LocationTracker] Captured (${point.latitude.toFixed(5)}, ${point.longitude.toFixed(5)})`);
        // Attempt immediate sync; if offline, remains buffered
        await flush(cardNo);
        resolve();
      },
      () => resolve(), // denied or unavailable — silently skip
      { enableHighAccuracy: false, timeout: 10_000, maximumAge: 60_000 }
    );
  });
}

let captureTimer: ReturnType<typeof setInterval> | null = null;
let syncTimer: ReturnType<typeof setInterval> | null = null;
let currentCardNo = "";

export function startLocationTracking(cardNo: string) {
  if (captureTimer) return; // already running
  currentCardNo = cardNo;

  // Capture immediately on start, then every hour
  captureAndQueue(cardNo);
  captureTimer = setInterval(() => captureAndQueue(currentCardNo), INTERVAL_MS);

  // Retry pending buffer every 5 min (handles coming back online)
  syncTimer = setInterval(() => flush(currentCardNo), SYNC_RETRY_MS);

  // Also flush when the browser comes back online
  window.addEventListener("online", handleOnline);
  console.log("[LocationTracker] Started for card:", cardNo);
}

export function stopLocationTracking() {
  if (captureTimer) { clearInterval(captureTimer); captureTimer = null; }
  if (syncTimer)    { clearInterval(syncTimer);    syncTimer = null; }
  window.removeEventListener("online", handleOnline);
  console.log("[LocationTracker] Stopped");
}

function handleOnline() {
  if (currentCardNo) flush(currentCardNo);
}
