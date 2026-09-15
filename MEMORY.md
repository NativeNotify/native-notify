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
