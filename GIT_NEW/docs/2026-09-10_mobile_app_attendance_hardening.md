# LMS App — attendance hardening brief (hand this to the mobile team)

Context for whoever picks this up: the "attendance marked but not showing in HRMS"
complaints were **not** caused by the app. Every punch the app sent was saved.
An ERP trigger was filing any check-in made after the branch's cut-off hour
(12:59 at most sites, 11:30 at Soorty Nooriabad) as a check-**out**, so the day
read as absent. That is being fixed server-side.

The app changes below are not that fix. They are the safety net that would have
made the problem visible in a day instead of a month, and they close two real
gaps the investigation did turn up. **None of them should change the behaviour of
a punch that already works today.**

---

## 1. Idempotent punches (highest value)

Today, if the request reaches the server and the *response* is lost (dropped
connection, app killed, phone switches network), the employee sees a failure,
taps again — and because the server sees an existing check-in more than 60
minutes old, the second tap **checks them out**. We found 14 days across 11
employees in the last 30 with a 60–150 minute "work day", which is what that
looks like in the data.

Change:

- Generate a UUID `client_event_id` when the employee taps, **before** sending.
- Send it in the punch body: `{"card_no": "...", "attendance_type": "check_in", "client_event_id": "<uuid>", ...}`.
- On timeout or network error, retry **the same `client_event_id`** (up to ~3
  times, backing off). Never generate a new one for the same tap.
- Only generate a new id when the employee deliberately taps again.

### Server side: DONE — this is no longer inert

`LMS_PUNCH_EVENT` exists and the punch endpoints dedupe on `client_event_id`.
The app build is safe to ship **once the backend process is restarted** with the
current code. Three possible answers to a retry:

| what happened | response |
|---|---|
| the first attempt finished | the **original response**, byte for byte, plus `"duplicate": true`. Same HTTP status it had. |
| the first attempt is still running | the server waits up to 3s for it, then answers as below |
| the first attempt claimed the id and never finished, and nothing is marked | **409** `{"success": false, "code": "DUPLICATE_IN_FLIGHT", "message": "Could not confirm your attendance. Please try again.", "today": {…}}` |
| the first attempt failed (business rejection, crash) | the id is **released** — the retry is processed as a genuine new attempt |

Notes for the app:

- `duplicate: true` means "this is the answer to your earlier tap". Render it
  exactly like the original — it is not an error and not a second punch.
- On **409**, show the message and stop retrying that id. The `today` object in
  the body is the authoritative state (same shape as the endpoint in item 5).
- A rejection releasing the id is deliberate: nothing was stored, so the
  employee's next tap must really be attempted.

Verified: a replay returns the stored answer, survives a server restart, a
different id is unaffected, a released id can be reclaimed, and a punch with no
`client_event_id` behaves exactly as before.

## 2. Never turn an accidental tap into a check-out

Independent of idempotency: if the employee is checked in and taps the button
again, the server currently converts that into a check-out once 60 minutes have
passed. The app must make that an explicit choice, not a side effect.

- Before sending a punch that would be a check-out, show a confirm sheet:
  *"You checked in at 09:00. Check out now?"* — Cancel / Check out.
- **Do not reimplement the 60-minute rule.** `GET /auth/attendance/today/{card_no}`
  (item 5) returns `next_action_needs_confirmation` — show the sheet when that
  is true. The rule lives on the server; if it ever changes, the app follows
  automatically.

(The earlier draft pointed at `/auth/location/tracking-state/{card_no}` for
this. Ignore that: it needs a session token, it answers a location-tracking
question, and it is not wired up in the app. The endpoint below is the one.)

## 3. Read the new `posted_to_erp` flag

The punch response now carries `posted_to_erp`:

| value | meaning | what the app should do |
|---|---|---|
| `true` | the punch is on the ERP duty roster; HRMS will show the day as present | normal success screen |
| `false` | the punch is saved, but the roster did not take it — the day will read as absent until HR corrects it | success screen **plus** a soft note: "Attendance saved. HR sync pending." |
| `null` / absent | not applicable (check-out) or could not be checked | treat exactly as today |

`false` is **not** an error. Do not fail the punch, do not retry it, do not
queue it. Show the note and move on. It exists so the employee raises it with HR
the same day instead of finding out at month-end.

## 4. Confirmation screen shows what the server said, not what the phone assumed

Already partly in place — keep it strict:

- Name from `marked_for`, card from `marked_card_no`, time from `marked_at`,
  and the action from `action` (`check_in` / `check_out` / `noop`).
- `noop` means "you were already checked in" — say that, don't show a fresh
  check-in animation.
- Never render a success screen from local state before the response arrives.

## 5. Show the current state on the home screen

Fetch today's attendance state from the server when the attendance screen opens,
and show "Checked in at 09:00" / "Not marked yet". Most re-tapping happens
because the employee cannot tell whether the earlier tap worked. This alone will
cut the duplicate-tap traffic.

### Server side: DONE — use this instead of report-range

`GET /auth/attendance/today/{card_no}` — one row, straight from
ATTENDANCE_RECORDS, no month report to parse:

```json
{
  "card_no": "100002.1",
  "date": "2026-09-10",
  "state": "CHECKED_IN",
  "check_in_time": "15:22",
  "check_out_time": null,
  "attendance_id": "8382",
  "minutes_since_check_in": 77,
  "next_action": "check_out",
  "next_action_needs_confirmation": true,
  "minutes_until_check_out_allowed": 0,
  "server_time": "16:39"
}
```

- `state`: `NOT_MARKED` | `CHECKED_IN` | `CHECKED_OUT`
- `next_action`: what a tap right now would do — `check_in`, `check_out`, or
  `noop` (inside the 60-minute window, where a tap changes nothing)
- `minutes_until_check_out_allowed`: how long until a tap would become a
  check-out; useful if you want to grey the button or explain the wait

Report-range was answering "what does the ERP roster say", which is a different
question — and the wrong one while the roster was mis-filing late check-ins.
This endpoint answers "what has this person actually punched today".

Keep the existing behaviour of painting the local record first and correcting
from the server; on an unreachable server, keep the local view exactly as you
do now.

## 6. Errors

The backend now returns a readable `message` on every failure with an accurate
status code. Show `message` verbatim (the app already does). Specifically:

- `success: false` with a message → show the message, stay on the screen, let
  them retry. The punch was **not** saved.
- Network/timeout with no response → do **not** claim failure. Retry with the
  same `client_event_id` (item 1); if it still fails, say "Could not confirm —
  check your connection and try again."

## 7. What NOT to change

- **Do not add offline queuing for attendance.** Online-only is correct and must
  stay: a punch replayed hours later would be stamped with the arrival time and
  land on the wrong side of the shift. Offline buffering stays limited to
  location tracking points.
- Do not change how check-in vs check-out is decided; the server decides.
- Do not send clock times for anything the server can derive.

---

## Verification checklist

0. **Server must be restarted** with the current backend code before any of
   this is testable — the dedupe and the today endpoint ship in that build.
1. Kill the network right after tapping check-in → app retries the same id →
   exactly one attendance row exists for that day, and the retry's response
   carries `duplicate: true`.
2. Tap check-in twice within a minute → one row, second response `action: noop`,
   no check-out.
3. Tap again 90 minutes later → confirm sheet appears; cancelling sends nothing.
4. Punch after the branch cut-off with the ERP fix not yet applied →
   `posted_to_erp: false` → success screen with the "HR sync pending" note.
5. Punch normally → `posted_to_erp: true`, no note, behaviour identical to today.
