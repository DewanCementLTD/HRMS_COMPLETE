# Task: "My Payslips" in the mobile app

Add a **My Payslips** feature to this mobile app. Employees open it from a button on the **Dashboard**, see every payslip that has been **finally processed (posted by HR)** for them, open any one, and **download / share it as a PDF** that is identical to the payslip HR prints from the web app.

The backend is already built and tested. Do not change the backend or add your own salary calculations. The app only calls the endpoints below and displays what they return.

## 1. Read the codebase first
Before writing code, work out and follow the app's existing patterns:
- the framework (React Native/Expo, Flutter, etc.), navigation, state management and folder layout
- the shared API client: base URL, how headers are attached, how errors and timeouts are handled
- where the login response is stored. Find `session_token` (returned by `POST /auth/login`) and the logged-in employee's `card_no`. The offline location sync (`POST /auth/location/sync`) already sends `session_token` as a Bearer token, so reuse however it reads the token.
- how the Dashboard lays out its action buttons/tiles, and the theme (colours, typography, icons)

Use the same libraries the app already uses. Only add a new dependency if nothing in the app can do the job (PDF viewing, file saving, sharing). If you add one, choose the standard option for the framework, e.g. Expo: `expo-file-system` + `expo-sharing` (+ `react-native-pdf` or a WebView for viewing); Flutter: `dio`/`http` + `path_provider` + `share_plus` + a PDF viewer package.

## 2. Backend API (already live)
All three endpoints **require** `Authorization: Bearer <session_token>`. `:card_no` must be the logged-in employee's own card (e.g. `100002.1`).

| Method & path | Returns |
|---|---|
| `GET /auth/payslips/:card_no` | `{ "items": [ { "period": 97, "period_frm": "2026-08-01", "period_to": "2026-08-31", "label": "AUG - 2026", "total_earning": 136500, "total_deduction": 4515, "net_payable": 131985 }, ... ] }`, newest first, **finalised months only** |
| `GET /auth/payslips/:card_no/:period` | Full payslip JSON: `{ header, earnings[], deductions[], master, totals, loans[] }`, the same shape the web payslip uses |
| `GET /auth/payslips/:card_no/:period/pdf` | `application/pdf` (A4). The same layout as the web payslip, with the company logo. `Content-Disposition` gives a filename like `payslip_100002.1_AUG-2026.pdf` |

Errors:
- `401 { detail: { code: "SESSION_REQUIRED" } }`: token missing, expired or invalid. Send the user to log in again (the same way the rest of the app handles an expired session), then return them to the payslips screen.
- `403 { detail: { code: "CARD_MISMATCH" } }`: the card doesn't match the token. Treat it as a session problem: log in again.
- `404`: that period is not finalised for this employee, or the employee is unknown. Show "Payslip not available".
- Network / `5xx`: show an error with a Retry button.

The server does the "final processed only" filtering. The app must **never** try to build or show a payslip from any other endpoint, and must never show a month that the list endpoint didn't return.

## 3. UI

### Dashboard
- Add a **"My Payslips"** button/tile next to the existing dashboard actions, in the same style and with a suitable icon (receipt/document).

### Payslips list screen
- Title "My Payslips". Call `GET /auth/payslips/:card_no` on open, with pull-to-refresh.
- Each row shows the month `label` (e.g. "AUG - 2026"), a period range line (`period_frm` to `period_to`, formatted nicely), and **Net Payable** prominently. Total earning and total deduction can be shown smaller.
- Money: round to a whole number with thousands separators (`131,985`). This matches the web.
- Loading state (skeleton or spinner), error state with Retry, and an empty state: "No payslips yet. Your payslip appears here once HR finalises the month's salary."
- Tapping a row opens the detail screen for that `period`.

### Payslip detail screen
The requirement is that it looks the **same as the web payslip**. The server-generated PDF *is* the web layout, so:
- Download `GET /auth/payslips/:card_no/:period/pdf` (with the Bearer header) to the app's cache/documents directory and **display that PDF in-app** with pinch-to-zoom. Do not rebuild the payslip layout in native widgets; a hand-built copy would drift from the web.
- Header/app bar: the month label, plus actions:
  - **Download / Save**: save the PDF to the device (Android: Downloads via the system save dialog / MediaStore / Storage Access Framework as the app already does elsewhere; iOS: the share sheet's "Save to Files"). Use the server's filename. Show a success toast/snackbar.
  - **Share**: open the native share sheet with the PDF file.
- Cache the downloaded file per `card_no + period` so reopening is instant. A finalised payslip doesn't change, so the cache can be kept, but refresh it if the user pulls to refresh. **Clear these cached files on logout**, because payslips are private.
- While the PDF downloads, show a spinner with "Preparing payslip…". Handle 401/404/network errors as in section 2.
- Optional: above the PDF, show a small native summary card (Net Payable / Total Earning / Total Deduction) using the values from the list item you tapped, so the key numbers are readable without zooming.

## 4. Rules
- Always send the Bearer token. Never call these endpoints with a card other than the logged-in user's.
- Don't log salary figures, PDF bytes or the token.
- Don't store payslip JSON/PDFs anywhere shared or backed up in plain view beyond the app's own cache/documents directory, except when the user explicitly chooses Download/Share.
- Keep the existing Dashboard and all other screens behaving exactly as they do now.

## 5. Done when
- The Dashboard shows "My Payslips"; the list shows only finalised months (compare with `GET /auth/payslips/:card_no` in Postman).
- Opening a month shows the PDF, identical to the payslip HR sees on the web (Payroll → Salary → Payslip) for the same month.
- Download saves a working PDF on both Android and iOS; Share opens the share sheet.
- An expired or missing token sends the user to log in; the empty, error and offline states all work.
- Logging out removes cached payslip files.
- At the end, summarise which files you changed and any dependency you added.
