# AGENTS.md — native-notify (SDK)

Guidance for AI agents (and humans) working in this repo. This is the
`native-notify` npm package — the Expo / React Native SDK that apps install to
register devices, receive pushes, and power the Notification Inbox + analytics.

## Golden rules (apply to every Native Notify repo)

### 1. Agent-first is the product direction

The focus of Native Notify is that **AI agents can do everything for users** —
the future is agents doing the work. When you design or change SDK surface,
ask *"can an agent set this up and use it for the user?"* Every capability the
SDK gains should be reachable by an agent through the API + MCP server
(`native-notify-mcp`); SDK-side docs should show the exact calls an agent (or
a developer acting for one) can make.

### 2. Every new feature ships documented — in the MCP server's reach

When you add or change a feature, in the SAME wave:

1. **Document it on the docs site** (`native-notify-docs`), including the
   upgrading notes if behavior changes. The hosted MCP server serves those
   docs live (`search_docs` / `read_doc`), so a feature that isn't documented
   there is invisible to agents.
2. If the feature maps to a server capability, make sure the MCP server has a
   tool (or tool field) that can drive it — see `native-notify-mcp`.
3. Keep this README and the docs site in sync (README is what npm shows;
   docs are what agents read).

Do not ship a feature an agent cannot discover or use.

## Repo facts

- Source in `src/` (`index.ts`, `inbox.tsx`, `analytics.ts`, `context.tsx`,
  utils), compiled with `tsc` to `dist/`. Ships `dist/` + `README.md` only.
- Checks: `npm run build`, `npm run typecheck` (both tsconfigs), `npm test`
  (`tsx --test test/*.test.ts`; fake fetch at the boundary, no network).
- Versioning: breaking changes bump major (v5 added `NativeNotify.init` /
  provider and changed the follow helpers to `NativeNotifyActionResult`);
  document upgrades on the docs site's "Upgrading to v5" page pattern.
- Publish: `npm publish` from this repo (requires the build to be green —
  `prepublishOnly` runs build + tests). Publish only when the user asks; the
  hosted MCP server + `native-notify-mcp` package are separate codebases.
- Default branch is `master` (not main) — push there.

## Gotchas

- Metro/Expo apps must never be forced to install optional native modules:
  `getStableDeviceKey` resolves `expo-application` via DYNAMIC require
  specifiers on purpose — literal requires would break downstream builds.
- Do not log or echo device tokens / app tokens anywhere.
- `npm test` uses Node's test runner via tsx; keep tests hermetic (no real
  Expo/API calls).
