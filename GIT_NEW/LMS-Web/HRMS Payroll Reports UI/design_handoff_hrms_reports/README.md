# Handoff: HR & Payroll Reports redesign

## Overview
Redesign of the `/reports` screen in LMS-Web to replace the cramped two-level tab stack with a report picker + dedicated report screen. Goal: less clutter, clearer navigation, same data and filters.

## About the design file
`HR Payroll Reports.dc.html` in this folder is a **design reference**, not code to copy. It's a static HTML/JS prototype with hardcoded sample data. Recreate the layout/behavior below as real React/TSX in the existing Next.js app, using the app's real components (`Card`, `Button`, `PageHeader`, `SearchableSelect`) and real data (`reportService`, `referenceService`) — do not port the prototype's inline styles or its sample data verbatim.

## Fidelity
High-fidelity for layout, spacing, and interaction structure. Colors/type should follow the app's existing Tailwind tokens (indigo-600 primary, gray neutrals) already used in `page.tsx` / `Button.tsx` — not the prototype's literal hex values, which were reconstructed from those same tokens.

## What changes in `src/app/(auth)/reports/page.tsx`

### 1. Report picker replaces the two-level tab stack
Delete the "Level 1 — report areas" 2-column button grid and the "Level 2 — individual report" pill row. Replace with two sections, one per category, each a responsive card grid (`grid-template-columns: repeat(auto-fill, minmax(255px,1fr))`, gap 14px):

- Section header: category label (bold, 15px) + description (12.5px, gray-400), e.g. "Payroll Reports" / "Monetary reports built from the salary process."
- Report card (button, rounded-2xl, white, border gray-200, padding 16px, flex column gap 10px, hover shadow):
  - 34×34px rounded-xl icon chip: indigo tint for payroll reports, slate tint for general reports (reuse the existing `DollarSign`/`Users` category icons, or a small bar-chart glyph per card if you want per-report iconography — the prototype uses one glyph per category, not per report).
  - Title (13.5px bold, gray-800)
  - Description (12px, gray-500) — use each report's existing `description` from `REPORT_CATALOG`.
  - Selected state: indigo-600 border/ring + light indigo tinted background + filled indigo icon chip.

Iterate `REPORT_CATALOG` filtered by category, same data already in the file — just re-render as cards instead of pills.

### 2. Selecting a report navigates to a dedicated screen (replaces the grid, does not expand below it)
When `selectedReportId` is set, hide both category grids entirely and render the report detail view in their place:
- "← Back to reports" link (gray-500, 12.5px, chevron-left icon) that clears `selectedReportId` back to `null` and returns to the card grids.
- Report title (17px bold) + a small category badge pill ("Payroll" / "General", indigo or slate tint) + description below.
- Keep the existing `Generate Report ({{count}})` button; also add an "Export ▾" button (Excel / PDF / Print options in a small dropdown) next to it — currently the app only has print.

### 3. Filter bar (`ReportFilterBar.tsx`) — declutter with progressive disclosure
Currently every filter for a report renders inline in one flex-wrap row with Reset/Apply pushed to `margin-left:auto`, which leaves a large awkward gap for reports with few filters. Change to:

- **Primary fields row**: the first 3 filter groups from `REPORT_FILTERS[reportId]` (unchanged mapping/order), each field unchanged (`Field` component, `selectCls` styles) but on their own flex-wrap row with no trailing buttons.
- **Actions row** below it (border-top 1px solid gray-100, padding-top 12px): left side a "+ More filters" pill button (only rendered if the report has more than 3 filter groups) that toggles a `showMoreFilters` state; right side (`margin-left:auto`) the existing Reset/Apply buttons, unchanged logic.
- **Secondary fields row**: only rendered when `showMoreFilters` is true, contains the remaining filter groups (4th onward), same field styling, separated by a dashed top border.

This keeps `isRunnable`/`toParams`/`REPORT_FILTERS` exactly as-is — it's purely a layout split of already-rendered fields into two groups, not a data model change.

### 4. Table — no changes needed
Column/row rendering (`ReportHead`/`ReportRow`), sticky columns, search, and select-all all stay as they are — they already work well; the clutter was in the navigation and filter bar above them, not the table.

## Design tokens (already in the codebase)
- Primary: indigo-600 `#4f46e5` / hover indigo-700 `#4338ca`
- Selected tint: indigo-50 `#eef2ff` / border indigo-200-300
- Neutrals: gray-50 `#f9fafb` through gray-900 `#111827` (Tailwind defaults, already in use)
- Radius: `rounded-2xl` (16px) for cards/panels, `rounded-xl`/`rounded-lg` for buttons and icon chips
- Card shadow: `shadow-sm`, hover `shadow-md`

## Files
- `HR Payroll Reports.dc.html` — the design prototype (reference only)
- Real files to edit: `src/app/(auth)/reports/page.tsx`, `src/app/(auth)/reports/ReportFilterBar.tsx`
