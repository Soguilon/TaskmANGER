# TaskmANGER / Angerly — Repair and QA Report

## What was repaired
- Added stricter client-side and Apps Script validation for duplicate member names, duplicate task IDs, unknown task owners, invalid status values, malformed email addresses, malformed deadlines, unsafe/non-Google document URLs, overlong task titles, and overlong instructions.
- Prevented cloud refresh from silently replacing unsaved edits; the user is asked to confirm first.
- Fixed task status badges and metrics so they update immediately when status changes.
- Made local-storage write failures explicit and prevented the app from falsely treating a failed local save as successful.
- Added a defensive validation step before accepting cloud data, retaining the previous workspace if incoming data is invalid.
- Preserved the existing UI, task assignments, loading GIF, and existing spreadsheet identifiers.

## Important limitation: opening `index.html`
The frontend can be opened directly from the extracted folder. Local mode works without a server and saves to that browser's local storage. Google Sheets synchronization and email notifications still require internet access, a correctly deployed and authorized Google Apps Script Web App, and a browser that permits the request/response flow. No static HTML file can guarantee cloud availability when Google, the network, browser storage, or authorization is unavailable.

The current app uses JSONP for reads and cross-origin `fetch` POST requests for writes/notifications. Apps Script redirects and browser CORS policies can block POST responses in some configurations. This package does not claim that remote saves or emails were live-tested; those require access to the owner's Google account and spreadsheet. If POST responses are blocked, the durable fix is to host the frontend through Apps Script HTML Service (using `google.script.run`) or on an HTTPS origin configured for the backend—not to disable browser security.

## Manual acceptance checklist
1. Extract the ZIP and open `index.html` in Chrome or Edge.
2. Confirm the loading overlay disappears and all task cards render.
3. Edit an email, task link, deadline, instructions, and status; confirm the unsaved indicator changes and status metrics/badge update.
4. Enter malformed email or a non-Google URL and try Save; confirm validation blocks it with a useful message.
5. Refresh with unsaved edits; confirm the app asks before replacing them.
6. Save, refresh from Google Sheets, and compare records in the intended spreadsheet.
7. Test notifications with one consenting test recipient; check the notification log and sender identity before using All Members.
8. Test offline mode and browser-storage restrictions; errors must be visible and must not claim cloud success.

## Not independently verifiable here
- Live Google Apps Script deployment permissions and URL validity.
- Spreadsheet permissions, quota availability, Apps Script authorization, and actual email delivery.
- Cross-origin POST response behavior in the target browser/account.
