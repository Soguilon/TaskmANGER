# Angerly — repaired task assignment manager

## Included files
- `index.html` — standalone responsive interface
- `styles.css` — red academic glassmorphism design
- `app.js` — rendering, filtering, local fallback, sync, validation and email actions
- `config.js` — **the one frontend configuration file**
- `seed-data.js` — starting Chapter 1 assignments and existing task details
- `Code.gs` — Google Apps Script backend for Google Sheets and email notifications
- `angerloading.gif` — original supplied logo/loading animation

## Quick start
1. Extract the ZIP.
2. Open `index.html` in a current Chrome or Edge browser.
3. The supplied `config.js` already contains a Web App URL. If it is still deployed and accessible to your Google account, no configuration edit is needed. If connection fails, replace `GOOGLE_APPS_SCRIPT_URL` with the current deployed Apps Script Web App URL ending in `/exec`, then save and reopen `index.html`.

Without a configured backend, Angerly remains usable in local browser mode. Local edits are saved only in that browser and are **not** a substitute for Google Sheets persistence.

## Apps Script setup
1. Open the Google account that owns the target spreadsheet.
2. Visit [Google Apps Script](https://script.google.com/) and create a project.
3. Paste the contents of `Code.gs` into the editor and save.
4. Confirm `SPREADSHEET_ID` in `ANGERLY_CONFIG` is the intended spreadsheet. The ID was recovered from the original app's visible spreadsheet link: `1T8GTU6wO1aGHwu3cNCxla1qOc_KKxRR5hCSp4C1HOYE`.
5. Deploy → New deployment → Web app.
6. Set **Execute as** to the account authorized to access the spreadsheet and send the email. Set access according to your organization's policy. A publicly accessible deployment exposes the read endpoint; do not use it for confidential data without adding appropriate authentication.
7. Authorize spreadsheet and email permissions when prompted.
8. Copy the deployed `/exec` URL into `config.js`.

On first backend access, the script creates an `AngerlyData` sheet and an `AngerlyNotificationLog` sheet if needed. It does not delete existing sheets or rows. It stores the app's task data as a JSON record in `AngerlyData`, leaving unrelated sheet content untouched.

## Sender identity and email
The backend is configured to require `csoguilon24-0063@cca.edu.ph` as the effective Apps Script user. Deploy and authorize while signed in as that account. If your organization does not permit this account to authorize the script, the backend deliberately refuses automatic email sending rather than spoofing the sender. The actual sender is the authorized execution account; it cannot be forged by setting a display name.

The backend sends HTML and plain-text email content and logs submission attempts. A successful `MailApp.sendEmail` call means Google accepted the send request; it does not prove inbox delivery. Spam placement cannot be guaranteed. The supplied GIF is used in the app UI; it is not embedded in email because a local file is not accessible to the Apps Script server. Email layout uses compatible crimson/burgundy styling and a valid document link only when one is supplied.

## Important browser limitation
A static page opened using `file://` is subject to browser cross-origin restrictions. This project uses JSONP for reads and a `fetch` POST for writes. Google Apps Script deployments can redirect responses and browser CORS behavior can vary; therefore the POST response and email actions must be verified in the target browser after deployment. If the browser blocks cross-origin POST responses, the reliable solution is to serve the same UI through Apps Script HTML Service (using `google.script.run`) or host the static frontend on an HTTPS origin you control. No client-side implementation can override browser CORS security. Do not assume a save succeeded if the UI reports that cloud save was not confirmed.

## Testing status and known limits
### Verified locally in this package
- ZIP contents and required assets were extracted and rebuilt.
- The original `angerloading.gif` was preserved byte-for-byte.
- The ten original task assignments and their available email, link, deadline, status, and instruction fields were recovered from the saved app view and carried into seed data.
- Frontend JS syntax and Apps Script JS syntax were checked.
- The UI includes a refresh overlay with the exact message `Loading Angrily...`, disabled refresh while sync is running, error feedback, filtering, status metrics, and local fallback.

### Requires owner/browser verification
- Google authorization, real spreadsheet reads/writes, email quota availability, actual sender account, and recipient inbox placement cannot be verified from this offline environment.
- The original ZIP contained a saved browser copy of the deployed web app, not the original Apps Script source. Consequently the backend schema and original `Code.gs` implementation could not be audited. This package provides a new backend contract and a dedicated `AngerlyData` storage sheet; it does not claim compatibility with undocumented existing backend logic.
- Test actual read/save/refresh/email flows after deployment. Use test recipients first. Confirm the spreadsheet ID before first use.
