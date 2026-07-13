# Repository Guidelines

Tooled Voice is a pnpm/Turborepo monorepo for a native voice assistant. Keep application-specific source, configuration, and dependencies within the owning workspace.

## Repository structure

- `apps/mobile` contains the Expo/React Native development-build app. It authenticates with Supabase and connects directly to OpenAI Realtime over WebRTC using a short-lived credential from the API.
- `apps/api` contains the Hono API used locally with Node and deployed to Vercel. It owns JWT verification, OpenAI credential minting, Composio user-scoped MCP session creation, local tool dispatch, and persistence. Legacy Linear OAuth remains only as a temporary fallback when Composio is not configured.
- `packages/shared` contains Zod schemas and types shared by the API and mobile app.
- Follow any nested `AGENTS.md` instructions when working within a subdirectory.

## Common commands

- `pnpm install` installs all workspace dependencies.
- `pnpm dev:api` runs the local API on port 3000 from `apps/api/.env`.
- `pnpm dev:native` starts Expo Metro for an already-installed development build.
- `pnpm android` or `pnpm ios` creates, installs, and runs the corresponding native development build.
- `pnpm check` type-checks every workspace; `pnpm test` runs the repository test suite.

Run database generation and migration commands from `apps/api`. Run application-specific commands from their workspace unless a root script is provided.

## Environment and security

- Local API secrets belong in `apps/api/.env`; mobile public configuration belongs in `apps/mobile/.env`. Start from each workspace's `.env.example`.
- Never commit `.env` files, Supabase service credentials, database URLs, OpenAI keys, provider tokens, encryption keys, native build output, or generated dependencies.
- Only `EXPO_PUBLIC_*` values may enter the mobile bundle. The Supabase publishable key and public API URL are intentionally public; privileged values stay server-side.
- Preserve the authenticated boundary: the device obtains short-lived Realtime credentials from the API. Local tool execution and persistence pass through the API; third-party execution runs through a user-scoped Composio MCP session. Never return the Composio API key or provider credentials to the device.
- Keep Linear MCP mutation approval default-deny. Persist explicit user opt-in before setting `require_approval` to `never`, and apply permission changes only to newly created Realtime sessions.
- Treat Composio connection IDs and tool preferences as user-owned data. Validate ownership before account actions, keep new services enabled with ask-before-write defaults, and apply account/tool filters only when creating a new Realtime session.

## Working conventions

- Keep changes focused and avoid modifying unrelated applications or configuration.
- Define local tools through the typed registry instead of adding one-off endpoints. Validate untrusted inputs and keep dispatch idempotent per user and call ID. Prefer the official Linear MCP over reimplementing Linear operations.
- Preserve Supabase row-level security and ownership checks for user data.
- Rebuild the native app after changing native dependencies, Expo plugins, permissions, bundle identifiers, or URL schemes. JavaScript-only changes can use Metro reload.
- Update `README.md`, `.env.example` files, migrations, and tests when setup or runtime behavior changes.
