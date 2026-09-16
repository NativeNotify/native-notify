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
  `NODE_PATH=/Users/thetjmccarty/Documents/native-notify-projects/native-notify-app/node_modules node <script>`
  - Inbox rows come back from BOTH list endpoints (mass + indie) as `{ notification_id, date, title, message, pushData }` — the controller maps `date_sent`→`date`, `push_data`→`pushData` (DB columns stay snake_case; same for the dashboard's `InboxNotification` type).
  - `date_sent` strings are stored as `M-D-YYYY H:MMAM/PM` (e.g. "8-28-2026 6:53AM"); Hermes parses that inconsistently, so `inbox.js` parses it deterministically (`SERVER_DATE_RE`).
  - Prod DB (Heroku-style) needs `ssl: { rejectUnauthorized: false }` or you get "no pg_hba.conf entry ... no encryption".
  - Unread endpoints return `{ unreadCount: <number> }`; mass list supports `take`/`skip` + `X-Total-Count`; both list endpoints return 200 with a plain array.
- RN 0.86 gotcha: core `SafeAreaView` logs a runtime deprecation warning (will be removed) — `inbox.js` avoids it and uses `StatusBar.currentHeight` (Android) / `Constants.statusBarHeight` (iOS) instead.
- Packaging: `package.json` now has a `files` allowlist so `MEMORY.md` and `tmp/` can never ship to npm. `MEMORY.md` is git-tracked in this repo (like the server repo; the dashboard repo does not track it). (Superseded by the 2026-09-15 TypeScript refactor below — the allowlist is now `dist/` + `assets/`.)
- Cross-repo follow-ups queued as task chips: docs-site pages (`native-notify-docs`) and in-app Expo guide sections (`native-notify-dashboard`). The dashboard repo can't patch other repos with file tools (its MEMORY.md) — those chips edit their own repos only.

## 2026-09-15 13:33:01

## RESOLVED — native-notify@4.1.0 is PUBLISHED to npm (2026-09-15)

Update to the "publish pending re-auth" note above: the publish COMPLETED. Verified live:
- `npm view native-notify version` → `4.1.0`; dist-tags latest → 4.1.0.
- Published tarball shasum `94a673111c8dbbbffb80b272eec875881b2125e0` matches the locally verified artifact byte-for-byte (8 files, 53,251 bytes unpacked).

How it was unblocked: the stale `~/.npmrc` token was replaced by a fresh `npm login` (user-side), and the actual publish was run by the user in their terminal because the account's 2FA uses npm's web-OTP flow (`EOTP`) which a non-interactive shell cannot complete. For future releases, either the user runs `npm publish` themselves, or they create an npm **Automation** access token (bypasses 2FA for publishes) and we store it in `~/.npmrc` so agents can release directly.

Also done this session: README/docs-facing work queued as task chips for `native-notify-docs` and `native-notify-dashboard`; kanban card moved to In Review with the full log.

## 2026-09-15 14:05:00

## Sources are now TypeScript; the package ships compiled `dist/` (2026-09-15)

Commit `5891b11` (branch `master`, NOT pushed). Behavior-preserving refactor — no API, logic, URL, export-name or default-export changes.

- Layout moved: root `index.js` / `inbox.js` were deleted and became `src/index.ts` / `src/inbox.tsx` (git recorded both as renames, so `git log --follow` still works). Root `index.d.ts` deleted — types are now generated.
- `dist/` is a build artifact: gitignored, never committed, and built by `npm run build` (`tsc -p tsconfig.json`), wired to `prepublishOnly`. `package-lock.json` IS committed.
- Packaging allowlist is now `files: ["dist", "assets"]`. `main: dist/index.js`, `types: dist/index.d.ts`. Still no `exports` map, deliberately — `main`/`types` resolve everywhere including old Metro. `version`, `dependencies` and `peerDependencies` unchanged.
- **The only intentional source edit** was the bell asset path: `require('./assets/bell.png')` → `require('../assets/bell.png')`, because `dist/inbox.js` sits one level deeper than the old root `inbox.js` did. It must stay a static CommonJS `require` so the consumer's bundler resolves the asset to an id — NOT an ESM import, which compiles to `.default` and would hand the asset *object* to `<Image>`. Don't "fix" this back to an import.
- `src/peer-modules.d.ts` declares the RN/Expo peerDependencies as `any` via `export =` form. That form matters: a namespace-style declaration collides with the real Expo SDK types (TS2484) when npm auto-installs peers, which would make the build SDK-version dependent. The file is declaration-only and never lands in `dist/`, so it can never shadow a consumer's real types.
- **`typescript` is pinned to 5.9.x, not `latest`** — deliberate. npm `latest` is now TypeScript 7.0.2, which is ESM-only with an extensionless bin, so it cannot run on this repo's Node 18.17 (`ERR_UNKNOWN_FILE_EXTENSION`), and TS 7 also dropped `moduleResolution: node10`. Bumping TS requires bumping Node first.
- Peer `_args` gotcha: bare `useRef()` is not a valid overload under React 19 `@types/react`; the sources use `useRef<any>(undefined)`, which is runtime-identical.
- No test suite exists in this repo. Verification that was actually run: `npx tsc --noEmit` clean, `npm run build` emits all four `dist/` files, `node --check` on both built JS files, an esbuild bundle (`--loader:.png=dataurl`) that parses and contains `registerNNPushToken` / `NotificationInboxBell` / `getIndieNotificationInbox`, `npm pack --dry-run` (9 files: `dist/**`, `assets/**`, README, package.json — no `src/`, `node_modules`, `MEMORY.md` or `tmp/`), and a consumer `.ts` written against the OLD hand-written surface that typechecks clean under `strict: true`.
- Generated types are no less permissive than the hand-written ones. Only deliberate widenings: the two inbox list getters return `Promise<InboxNotification[]>` (was `Promise<any>`; `InboxNotification` keeps its `[key: string]: any` index signature and stays assignable to `any`), and the two unread-count getters return `Promise<number>` (was `Promise<any>`). Nothing was removed; `NotificationInboxMode` is the sole addition.
- If you run git commands here and get "You have not agreed to the Xcode license agreements", `/usr/bin/git` is the Xcode shim — use `/usr/local/bin/git` (2.23.0) instead.

## 2026-09-15 14:33:56

## TypeScript refactor LANDED (2026-09-15) + release notes + a machine-level ChatOSS gotcha

- `native-notify` is now real TypeScript: `src/index.ts`, `src/inbox.tsx`, `src/peer-modules.d.ts` (ambient peer declarations, never emitted), `tsconfig.json` (commonjs, ES2019, declaration, classic JSX, strict false). Build: `npm run build` → `dist/` (gitignored, NOT committed; `prepublishOnly` builds on publish). `main`/`types` → `dist/`, `files: ["dist", "assets"]`. Old root `index.js`/`inbox.js`/`index.d.ts` deleted. Commits: `5891b11` + `c64f566`.
- Verified: clean tsc build, `node --check` on dist output, esbuild bundle check, `npm pack --dry-run` (9 files, no src/MEMORY/tmp), export-surface diff vs the old d.ts (all exports kept).
- 🔴 TO RELEASE: bump `version` to 4.2.0 first (currently 4.1.0 == published 4.1.0), then run `npm publish` — needs the user's terminal for the npm 2FA/web-OTP step. Optional follow-up: add a `prepare` script if GitHub-install consumers ever matter (dist is not committed).
- 🔴 MACHINE GOTCHA (ChatOSS itself): on 2026-09-15 a Launch-mode spawn of a FRESH worktree with Claude Code died at the folder-trust dialog ("Yes, I trust this folder" / "No, exit") — the app's auto-answer races the dialog and the spawn is reported as "exited immediately (code 1). Install the claude CLI…" (wrong; claude is installed at ~/.local/bin/claude, native install). Failed spawns are invisible in the Terminals panel. WORKAROUND that works here: pre-seed `hasTrustDialogAccepted: true` for the repo root (+ `.chatoss` + `.chatoss/worktrees`) in `~/.claude.json` (backup: `~/.claude.json.before-chatoss-pretrust.bak`) and spawn with `worktree:false`. A bug-report chip was created for the `chat-oss` project to fix the app side.
- Follow-ups already queued as chips: native-notify-docs + native-notify-dashboard doc updates (from the v4.1.0 inbox task).

## 2026-09-15 14:47:53

## native-notify@4.2.0 (TypeScript build) is PUBLISHED to npm (2026-09-15)

- `npm view native-notify version` → 4.2.0, dist-tag latest → 4.2.0. Published shasum `6fda89a503822d322993b792e06f5ce796f96c31` matches the locally verified pack exactly (9 files, 62,230 bytes unpacked).
- How the 2FA wall was beaten from the agent shell (reusable recipe): run `script -q tmp/scratch/publish-pty.log npm publish` as a BACKGROUND command (PTY gives npm its interactive web-OTP flow — it polls the registry `/v1/done` endpoint while showing "Press ENTER to open in the browser..."). The auth URL lands in the pty transcript + `~/.npm/_logs/`; extract it with `grep -hoE 'https://www\.npmjs\.com/auth/cli/[A-Za-z0-9_-]+'` and `open "$(cat tmp/scratch/npm-auth-url.txt)"` to pop the browser. The user approves; npm finishes the publish on its own — no ENTER needed.
- Release commits: `c0cf834` (bump 4.2.0) pushed to master.
- Pre-publish verification battery (all green): fresh `rm -rf dist && npm run build`, `node --check` both dist files, `__esModule`/`exports.default` interop markers, consumer-style strict `tsc` compile of a scratch consumer (default + named imports, components, hook, return types — CONSUMER_TYPES_OK), esbuild bundle, `npm pack` contents (dist + assets + README + package.json; no src/tmp/MEMORY).
- NOTE for next releases: npm's web-OTP flow worked non-interactively this way; do NOT ask the user to run npm publish manually unless this breaks — and never put the auth URL in plain chat (redaction is automatic; keep it in the scratch file + `open`).

## Session wrap (2026-09-15 evening)

- All of tonight's work is merged + pushed: v4.1.0 Notification Inbox (published earlier), v4.2.0 TypeScript build (published now), kanban cards in In Review, chips for docs/dashboard/chat-oss created.
- Open follow-ups: native-notify-docs + native-notify-dashboard doc-update chips; chat-oss Launch trust-dialog bug chip; MEMORY.md remains git-tracked here.

## 2026-09-15 15:08:16

## 2026-09-15 — Native Notify deep-dive: 18 improvement suggestions added to the board (no code changes)

Deliverable: a new **Suggestions** column on the "Native Notify" Kanban board with 18 specific cards (SDK ×7, Server ×7, Product ×2, Docs ×2). No files in this repo were modified.

Sources used (for future re-verification):
- SDK: `src/index.ts`, `src/inbox.tsx` (read fully), README, package.json.
- Server: sibling repo **native-notify-app** (Express; the known folder is the SERVER, not a demo app) — `server/expoControllers/notificationsController.js`, `notificationInboxController.js`, `server/cronController/expoScheduledTasks.js`, `db/*.sql` (auto-loaded by basename via a massive-compatible layer in `server/helpers/db.js`), `PUSH-SEND-INCIDENT-NOTES.md`, `server/helpers/corsConfig.js`.
- Dashboard repo (Next.js, `src/app/apps/[appId]/…`) and docs repo (MDX under `contents/docs/`).
- Expo docs **via the Expo MCP tools** (`search_documentation`, `read_documentation`, `add_library`) — pages: push-notifications/{overview,setup,sending-notifications,receiving-notifications,faq}, versions/latest/sdk/notifications. Verified deprecations against expo/expo source via GitHub search.

Key facts established (verified, do not re-derive):
- Live npm versions (2026-09-15): `expo` 57.0.22, `expo-notifications` 57.0.18, `expo-constants` 57.0.18, `expo-device` 57.0.2, `expo-server-sdk` **7.2.0**, `native-notify` 4.2.0.
- `shouldShowAlert` in `src/index.ts` L28-33 is deprecated (runtime warning: "Specify `shouldShowBanner` and/or `shouldShowList`"); SDK 57 still needs a handler, SDK 58+ shows foreground notifications by default. `Notifications.removeNotificationSubscription` is deprecated (expo/expo#36371) — used at src/index.ts L113/L304/L323 + fallback inbox.tsx L461.
- `getPushDataObject()` misses the tap that cold-launches the app (needs `getLastNotificationResponse()`); `getUnreadNotificationInboxCount()` throws a TypeError off-device (`response` undefined); projectId access `Constants.expoConfig.extra.eas.projectId` has no fallback.
- Server: indie sends are per-token sequential (`sendIndieNotificationLogic` L752+); receipts cron counts `ok` receipts only and discards error details; **indie `X-Total-Count` is the mass app count** (`setTotalCountHeader` → `get_app_notification_inbox_count.sql`) — confirmed bug; list fetches mark everything read (indie UPDATE, mass read-token insert); `expo-server-sdk` pinned ^3.15.0 while latest is 7.2.0 (v7 needs Node ≥22.12; droplet ran Node v20.10.0); no Expo access-token (enhanced push security) support; APNs path has the known `headers` implicit-global bug (L634); group sends per-token + native branches commented out.
- Expo guidance worth keeping: check receipts ~15 min after send (cleared after 24 h); `DeviceNotRegistered` → stop sending; 600/s per-project rate limit; 100 msgs/request; multi-project requests rejected (`PUSH_TOO_MANY_EXPERIENCE_IDS`); message fields support subtitle/badge/ttl/interruptionLevel/categoryId/channelId/collapseId/mutableContent; enhanced push security = per-project access token (`new Expo({ accessToken })`, server-sdk ≥ v3.6).
- Expo serves agent-readable docs (`.md` suffix on any docs URL + `/llms.txt`) — that's what the Expo MCP reads; mirrored as a suggestion for native-notify.

Next step if the user picks any card: move it from Suggestions → To Do/In Progress and work it in the relevant repo (SDK cards = this repo; Server cards = native-notify-app; Docs cards = native-notify-docs / native-notify-dashboard).

## 2026-09-15 16:22:52

## 2026-09-15 — native-notify@5.0.0 RELEASED: the 7 SDK cards are done, published, and pushed

**Published & verified**: `native-notify@5.0.0` — `npm view native-notify version` → 5.0.0; dist-tag latest → 5.0.0; published shasum `ff3a204af271cdeb6ae762befc0446bc6103ef2b` matches the local pack byte-for-byte (13 files, 24.3 kB tarball / 93.9 kB unpacked). Release commit `c83e2c9` pushed to master.

**Versioning note**: MAJOR, not 4.3 — the five follow helpers (`registerFollowMasterID` / `registerFollowerID` / `postFollowingID` / `unfollowMasterID` / `updateFollowersList`) now return structured `NativeNotifyActionResult` objects (`{ success, status, message, error }`) instead of string sentinels (`message` keeps the old text; network failures no longer masquerade as "already registered"). Everything else is additive. README has an "Upgrading" section.

**What shipped (the 7 SDK cards → 7 board cards in In Review)**
- `shouldShowBanner` / `shouldShowList` notification handler (kills the deprecated `shouldShowAlert` warning); every subscription cleanup prefers `.remove()` over deprecated `removeNotificationSubscription`.
- Cold-start taps: `useNativeNotifyPress<T>()` reads `getLastNotificationResponse()` once per process (then subscribes); `getPushDataObject` wraps it.
- Registration hardening: projectId fallback chain with a clear error, 10s timeouts, 1 retry, `{ onRegistered, onError, watchTokenRotation }` options, `addPushTokenListener` re-registration, Expo Go Android detection, exported `registerForPushNotificationsAsync` returning `PushTokenResult`.
- Inbox fixes: `getUnreadNotificationInboxCount` returns 0 instead of TypeError off-device; NEW `getNotificationInboxPage` / `getIndieNotificationInboxPage` return `{ rows, total }` from X-Total-Count; the hook uses `computeHasMore` (exact with a total; empty page always ends paging).
- Badge sync: `syncBadge` (default true) → `Notifications.setBadgeCountAsync(unreadCount)`.
- Config: `src/context.tsx` — `NativeNotify.init` (module-level, for plain functions) + `<NativeNotifyProvider>` + `useNativeNotify()`; appId/appToken optional everywhere (args → context → init).
- Tests/CI: `src/inboxUtils.ts` (pure helpers), `test/inboxUtils.test.ts` (9 tests via `tsx --test`), `test/consumer.ts` strict compile fixture, `tsconfig.test.json`, `.github/workflows/ci.yml`. Scripts: `typecheck`, `test`, `prepublishOnly = build && test`. New devDeps: tsx, @types/node.

**Verification actually run** (⚠️ NO device/simulator test): tsc --noEmit ×2 (src + strict consumer fixture), 9 unit tests, build, `node --check` on both dist files, `npm pack --dry-run` (13 files; no src/tmp/MEMORY), CJS smoke `tmp/scratch/smoke-dist.js` (stubs react/react-native/expo-notifications/axios; proves dist loads, exports wire up, handler uses new fields, register flow reports). On-device behavior (badge, cold-start tap) still needs a consumer-app run.

**Publish recipe re-confirmed** (no user terminal needed): `script -q tmp/scratch/publish-pty-v5.log npm publish` as a BACKGROUND command → grep the pty transcript for the `https://www.npmjs.com/auth/cli/...` URL → write to `tmp/scratch/npm-auth-url.txt` (never print it) → `open` it; the user approves in the browser and npm finishes by itself. A plain foreground `npm publish` still dies with EOTP. Sandbox note: npm's allow-scripts policy logs an esbuild postinstall warning, but tsx works fine.

**New server finding (bonus, found while building v5)**: `updateFollowersList` (native-notify-app `server/expoControllers/followPushController.js` L186–217) sends NO response when the sub is not in the list — the request hangs. SDK v5 now times out at 10s and maps it to `status: 'not_found'`; the server chip "inbox API fixes + follow-endpoint hang" carries the real fix.

**Board + chips**: 7 SDK cards → In Review; the other 11 cards → To Do; Suggestions column is now empty. 11 correct Start chips created (7× native-notify-app, 2× native-notify-docs, 2× native-notify-dashboard). ⚠️ GOTCHA: `propose_task` WITHOUT the `project` arg targets the CURRENT root — an accidental first batch of 11 chips points at this SDK repo instead of the target repos; those duplicates need dismissing (no chip-delete tool exists). Recommended server order (same-file conflicts): batched sends → token hygiene → receipts → inbox API → Node/v7 → analytics → rich fields; docs/dashboard chips are parallel-safe; the dashboard UI chip waits on the server analytics + rich-fields chips.

## 2026-09-15 16:26:01

## 2026-09-15 — Chips consolidated: the 11 Start chips were replaced by 3 (one per project)

The user deleted the earlier chip batches (the 7× server / 2× dashboard / 2× docs chips AND the accidental wrong-target duplicates — none of those are needed anymore; dismiss any stragglers).

Replacement, created this session — **one chip per project**, each self-contained, board-attached to "Native Notify", with worktrees ON by default:

1. **native-notify-app — "Server: send-pipeline overhaul — batched sends, receipts, inbox fixes, tokens, Node 22/expo-server-sdk v7, analytics, rich fields"**: all 7 Server cards + the server halves of the two Product cards, with the recommended internal order baked in (batched sends → token hygiene → receipts → inbox API *incl. the follow-endpoint hang fix* → Node/v7 + enhanced push security → analytics → rich fields) and the incident-notes constraints (no token deletion phase 1, re-chunk per project, strike cleanup later, pm2 logrotate bump, APNs `headers` bug).
2. **native-notify-dashboard — "Dashboard: analytics UI, rich-fields form, inbox read state, settings token, in-app docs refresh"**: analytics UI, modern-field send form, per-row unread dots + exact paging, access-token setting, and the in-app Expo-setup docs refresh (v5 API notes included). It documents its dependency on the server chip's new endpoints and says to code defensively against the contract if they're not deployed yet.
3. **native-notify-docs — "Docs site: accuracy pass + native-notify v5 API docs + agent-readable markdown (llms.txt)"**: Expo setup reality fixes, v5.0.0 API + "Upgrading to v5" docs (mirror the SDK README's Upgrading section), and the `.md` + `/llms.txt` agent-readable pattern (prerequisite for the future native-notify-mcp).

Start guidance given to the user: all three can run in parallel (independent repos); the dashboard chip self-sequences around the server endpoints, so starting it later (after the server chip's inbox/analytics/rich-field items land, to avoid rework) is the conservative option. The board's To Do cards #4–#14 remain the canonical task list; each chip's chat should move its cards when it starts.

## 2026-09-16 14:15:15

## native-notify projects relocated to ~/Documents/native-notify-projects/ (user-approved, done via straight `mv` — NO clone)

New locations:
- `~/Documents/native-notify-projects/native-notify` ← was `~/Documents/npm-packages/native-notify` (THIS repo)
- `~/Documents/native-notify-projects/native-notify-app` ← was `~/Documents/ReactNativeApps/native-notify-app` (the Express/PG **server** repo)
- `~/Documents/native-notify-projects/native-notify-dashboard` ← was `~/Documents/NextSites/native-notify-dashboard`
- `~/Documents/native-notify-projects/native-notify-docs` ← was `~/Documents/NextSites/native-notify-docs`

Why move-not-clone: a same-disk `mv` is instant and preserves everything a clone would silently drop — untracked `.env`/`.env.test` (server), `.env.local` (dashboard), untracked `MEMORY.md` (dashboard + docs), `node_modules/`, `dist/`, `tmp/`, local git config, and extra remotes.

Post-move facts (verified): remotes/branches unchanged; the two leftover *merged* ChatOSS worktrees (`native-notify-app/.chatoss/worktrees/native-notify-app-3461cd8f`, `native-notify-dashboard/.chatoss/worktrees/native-notify-dashboard-d0fc32ba`) were fixed with `git worktree repair`; the old NODE_PATH recipe in this file (line ~23) was updated in place to the new path. ChatOSS known-folder entries and chat attachments pointing at the old paths are stale — reopen the new paths there.

Deliberately NOT moved (other native-notify folders, if ever asked): `NodejsServers/native-notify-server`, `NodejsServers/native-notify-p8-storage`, `ReactNativeApps/native-notify-mobile-app`, `ReactNativeApps/native-notify` (older copy), `NextSites/native-notify-customer-support`, `FlutterApps/native_notify_dev`, `pub.dev-packages/native_notify`, `ReactNativeApps/Native Notify Photos`.

GitHub/SSH/npm connectivity is path-independent — nothing about auth changed. Any older note below that still shows the pre-move paths should be read with the mapping above.

**Correction (same session):** the two leftover worktrees could NOT be repaired with `git worktree repair` — this machine's default `git` does not support the `repair` subcommand (it printed usage). They were repaired manually: for each worktree the two pointer files were rewritten — `<worktree>/.chatoss/worktrees/<name>/.git` (now points to the new main-repo path) and `<main>/.git/worktrees/<name>/gitdir` (now points to the new worktree path). Verified afterwards: `git worktree list` + `git status` work in both. If this Mac's git is ever upgraded to a version with `worktree repair`, it will simply no-op on these.

## 2026-09-16: v5.1.0 — analytics wave (screens, sessions, opens, deviceId)

**New exports (all additive; no breaking changes):** `trackScreen`, `flushScreenQueue`, `useNativeNotifyScreenTracking`, `startSessionTracking`, `endSessionTracking`, `startSessionAutoTracking`, `useNativeNotifySessionTracking`, `reportNotificationOpen`, `getStableDeviceKey`, `getRegistrationMeta`, `setAnalyticsPushToken`, `configureAnalytics` (from context) + the `NativeNotifyAnalyticsConfig` type. Config: `NativeNotify.init({ analytics })` or `registerNNPushToken(..., { analytics })` — flags screens/sessions/opens/deviceId, ALL DEFAULT FALSE (opt-in). Analytics config lives in `context.tsx` (avoids a context↔analytics import cycle); analytics.ts reads it live via `NativeNotify.getAnalyticsConfig()`.

**What the pieces do:** screens → batched POST /api/analytics/screen (2s flush, consecutive-dedupe; auto-hook reads expo-router's `usePathname()` or takes a `getScreen` callback); sessions → AppState foreground/background → POST /api/analytics/session (deduped per sessionId server-side; auto-wired by registerNNPushToken); opens → POST /api/notification/opened reading the server-injected `nn_notification_id` from push data (5s dedupe window collapses listener+cold-start double reports); deviceId → expo-application IDFV/ANDROID_ID, sent with registrations + events (falls back to the Expo push token server-side). Registrations also now send appVersion (expo-constants) + timezone (Intl).

**🔴 Gotchas:** (1) `expo-router` and `expo-application` are loaded with DYNAMIC require specifiers (`const s='expo-router'; require(s)`) inside try/catch — a literal require would make Metro/webpack FAIL THE BUNDLE for apps without those modules. (2) Pure logic lives in `src/analyticsUtils.ts` (normalizeScreenName, isDuplicateScreenChange, recordOpenReport, makeSessionId, clampSessionDuration) specifically so it is unit-testable under plain `node --test` — analytics.ts itself imports react-native and can't load in node tests. (3) `configureAnalytics` is exported from `./context`, NOT `./analytics` (index.ts re-export locations matter for the consumer fixture). Tests: test/analyticsUtils.test.ts; consumer.ts covers the whole new surface. `npm run typecheck` + `npm test` (14 tests) + `npm run build` all green. Version bumped 5.0.0 → 5.1.0; NOT published to npm yet (publish with `npm publish` after review — or on request).

## 2026-09-16: v5.1.1 — token-rotation listener loop bug (ROOT CAUSE of the WayChat analytics explosion)

**The bug (shipped in 5.0.0):** the `addPushTokenListener` handler inside `registerNNPushToken` called `registerForPushNotificationsAsync()`, which fetches the device push token — and expo-notifications re-fires push-token listeners whenever `getDevicePushTokenAsync()` runs. The listener thus retriggered itself: an infinite re-registration loop (up to ~15-20 calls/sec per device). WayChat v60 (SDK 5.0.0) hit it and inflated its `apps_mau` "app opened" rows: 48,287 rows for one day (normal ≈ 44).

**The fix (this commit):** four guards in the listener — (1) skip when the inbound token equals the last posted device token (no-op self-fires), (2) throttle to ≤1 check/minute, (3) `rotationInFlight` overlap guard…[elided content] 2>&1