# Project memory

Durable lessons recorded by coding agents working in this project. The engine reads this file at the start of every session and shows it to the next agent — append anything the next session should know.


## 2026-09-15 11:59:12

## Standing user preference — always recommend an option when asking (added 2026-09-14)

The user asked that this be recorded here so every future session follows it:

**When you need to ask the user what to do, ALWAYS include your recommendation if you are able to recommend an option** (state the option you'd pick and briefly why). If no option can reasonably be recommended, it is still OK to ask the question without recommendations — but never omit a recommendation you are capable of giving.

This applies to clarifying questions (ask_question), decision points, plan reviews, and any "what should we do about X" moment.

## 2026-09-15 12:18:04

## v4.1.0 Notification Inbox shipped + npm publish pending re-auth (2026-09-15)

- Built and pushed `native-notify@4.1.0` to master. Commits: `3ba6157` = repo sync with the as-published 4.0.9 state (the working tree was dirty with changes that shipped to npm in Dec 2024 but were never committed — verified byte-identical against the registry tarball); `3068114` = the feature. New exports in `inbox.js` (re-exported from `index.js`): `NotificationInboxBell`, `NotificationInboxScreen`, `useNotificationInbox`.
- 🔴 **npm publish is BLOCKED**: the npm token in `~/.npmrc` is stale (`npm whoami` → 401; `npm publish` → E404 permission). Run `npm login` (as the `native-notify` account), then `npm publish` from the repo root. Everything else is release-ready (tarball verified: 8 files, 13.9 kB, no MEMORY.md/tmp).
- Live API facts verified against production — recipes in `tmp/scratch/verify-inbox-boundary.js` and `verify-inbox-sql.js`, run with:
  `NODE_PATH=/Users/thetjmccarty/Documents/ReactNativeApps/native-notify-app/node_modules node <script>`
  - Inbox rows come back from BOTH list endpoints (mass + indie) as `{ notification_id, date, title, message, pushData }` — the controller maps `date_sent`→`date`, `push_data`→`pushData` (DB columns stay snake_case; same for the dashboard's `InboxNotification` type).
  - `date_sent` strings are stored as `M-D-YYYY H:MMAM/PM` (e.g. "8-28-2026 6:53AM"); Hermes parses that inconsistently, so `inbox.js` parses it deterministically (`SERVER_DATE_RE`).
  - Prod DB (Heroku-style) needs `ssl: { rejectUnauthorized: false }` or you get "no pg_hba.conf entry ... no encryption".
  - Unread endpoints return `{ unreadCount: <number> }`; mass list supports `take`/`skip` + `X-Total-Count`; both list endpoints return 200 with a plain array.
- RN 0.86 gotcha: core `SafeAreaView` logs a runtime deprecation warning (will be removed) — `inbox.js` avoids it and uses `StatusBar.currentHeight` (Android) / `Constants.statusBarHeight` (iOS) instead.
- Packaging: `package.json` now has a `files` allowlist (`index.js`, `index.d.ts`, `inbox.js`, `assets/`) so `MEMORY.md` and `tmp/` can never ship to npm. `MEMORY.md` is git-tracked in this repo (like the server repo; the dashboard repo does not track it).
- Cross-repo follow-ups queued as task chips: docs-site pages (`native-notify-docs`) and in-app Expo guide sections (`native-notify-dashboard`). The dashboard repo can't patch other repos with file tools (its MEMORY.md) — those chips edit their own repos only.

## 2026-09-15 13:33:01

## RESOLVED — native-notify@4.1.0 is PUBLISHED to npm (2026-09-15)

Update to the "publish pending re-auth" note above: the publish COMPLETED. Verified live:
- `npm view native-notify version` → `4.1.0`; dist-tags latest → 4.1.0.
- Published tarball shasum `94a673111c8dbbbffb80b272eec875881b2125e0` matches the locally verified artifact byte-for-byte (8 files, 53,251 bytes unpacked).

How it was unblocked: the stale `~/.npmrc` token was replaced by a fresh `npm login` (user-side), and the actual publish was run by the user in their terminal because the account's 2FA uses npm's web-OTP flow (`EOTP`) which a non-interactive shell cannot complete. For future releases, either the user runs `npm publish` themselves, or they create an npm **Automation** access token (bypasses 2FA for publishes) and we store it in `~/.npmrc` so agents can release directly.

Also done this session: README/docs-facing work queued as task chips for `native-notify-docs` and `native-notify-dashboard`; kanban card moved to In Review with the full log.
