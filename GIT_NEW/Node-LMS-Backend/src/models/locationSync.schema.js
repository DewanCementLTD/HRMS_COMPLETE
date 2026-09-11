import { z } from 'zod';

import { pyFloat } from '../utils/pydanticTypes.js';

// ---------------------------------------------------------------------------
// Offline location sync
//
// Shape-level checks only. Whether a coordinate is plausible, whether the
// timestamp is a real moment and whether the point is a duplicate are decided
// in locationSync.service.js, because those answers are per-point and the batch
// must survive a bad one — a Zod failure would 422 the entire upload and strand
// a phone's whole backlog behind one corrupt row.
// ---------------------------------------------------------------------------

const MAX_BATCH = 500;

const SyncPointSchema = z.object({
  // The phone's own UUID for this fix, and the entire basis of idempotency.
  client_event_id: z.string().min(1, 'client_event_id is required').max(100),
  latitude: pyFloat(),
  longitude: pyFloat(),
  accuracy: pyFloat().optional().nullable(),
  // ISO 8601 from the phone, e.g. "2026-09-04T10:00:00+05:00". Kept as the
  // capture time — never replaced with the upload time.
  recorded_at: z.string().min(1, 'recorded_at is required'),
  attendance_date: z.string().optional(),
});

export const locationSyncSchema = z.object({
  query: z.object({}).passthrough().optional(),
  body: z.object({
    card_no: z.string().min(1, 'card_no is required'),
    // Capped so one upload cannot hold a connection open indefinitely; the app
    // pages a longer backlog. An empty batch is a valid no-op, matching the
    // existing /location/batch behaviour.
    points: z
      .array(SyncPointSchema)
      .max(MAX_BATCH, `A batch may contain at most ${MAX_BATCH} points`),
  }),
});

export const trackingStateSchema = z.object({
  params: z.object({
    card_no: z.string().min(1),
  }),
});

export const syncStatusSchema = z.object({
  body: z.object({
    card_no: z.string().min(1, 'card_no is required'),
    client_event_ids: z
      .array(z.string().min(1).max(100))
      .max(2000, 'At most 2000 ids can be checked at once'),
  }),
});

export const MAX_SYNC_BATCH = MAX_BATCH;
