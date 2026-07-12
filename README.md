# Tooled Voice

Tooled Voice is a native push-to-talk assistant built with Expo development builds, OpenAI Realtime over direct WebRTC, Supabase Auth/Postgres, and an authenticated Hono tool backend. Audio travels between the device and OpenAI; tool calls and application data travel through the API.

## Architecture

- `apps/mobile`: Expo/React Native app with Supabase email/password auth, SecureStore-backed sessions, PKCE confirmation deep links, and `react-native-webrtc`.
- `apps/api`: Hono API for Supabase JWT verification, OpenAI Realtime client-secret minting, conversation persistence, encrypted provider credentials, and typed tool dispatch.
- `packages/shared`: shared Zod contracts and TypeScript types.

The API is deployed at `https://tooled-voice-api.vercel.app`. Its Vercel project uses `apps/api` as the monorepo Root Directory.

## Prerequisites

- Node.js and pnpm 10.33.0
- A Supabase project
- An OpenAI API key with Realtime access
- Android Studio/JDK 21 for Android, or Xcode for iOS

Install all dependencies from the repository root:

```sh
pnpm install
```

## Environment

Create the local API environment file:

```sh
cp apps/api/.env.example apps/api/.env
```

Set `DATABASE_URL`, `SUPABASE_URL`, `OPENAI_API_KEY`, and the token-encryption values. Generate `TOKEN_ENCRYPTION_KEY` with:

```sh
openssl rand -base64 32
```

Use the Supabase transaction-pooler connection string for `DATABASE_URL`. Stored integration credentials record their encryption-key version. When rotating, move prior base64 keys into the server-only `TOKEN_ENCRYPTION_PREVIOUS_KEYS` JSON object (for example `{"v1":"..."}`), set the new `TOKEN_ENCRYPTION_KEY` and version, and retain old entries until all rows have been re-encrypted.

Create the public mobile environment file:

```sh
cp apps/mobile/.env.example apps/mobile/.env
```

The mobile bundle may contain only the Supabase project URL, publishable key, and public API URL. Never prefix server secrets with `EXPO_PUBLIC_`.

For a local API, set `EXPO_PUBLIC_API_URL` to:

- Android emulator: `http://10.0.2.2:3000`
- iOS simulator: `http://localhost:3000`
- Physical device: `http://<computer-LAN-IP>:3000`

## Supabase Auth configuration

In Supabase Authentication URL Configuration:

- Add `tooledvoice://auth/callback` to the allowed redirect URLs.
- Use a reachable HTTPS Site URL as the fallback. Production currently uses `https://tooled-voice-api.vercel.app/auth/confirmed`.

Signup passes the mobile callback explicitly. The app exchanges the returned PKCE code for a session, so open confirmation emails on the device running the development build.

## Linear integration

Create a Linear OAuth application in Linear's API settings with `read` and `write` access. The redirect URI must exactly match the environment in which the API is running:

- Local Android emulator with ADB reverse: `http://localhost:3000/oauth/linear/callback`
- Production: `https://tooled-voice-api.vercel.app/oauth/linear/callback`

Set these server-only values in `apps/api/.env` locally and in Vercel for production:

```sh
LINEAR_CLIENT_ID=
LINEAR_CLIENT_SECRET=
LINEAR_REDIRECT_URI=http://localhost:3000/oauth/linear/callback
LINEAR_MOBILE_REDIRECT_URI=tooledvoice://integrations/linear
```

Do not put the Linear client secret or provider tokens in the mobile environment. In the app, use the Linear Connect control to authorize the account. The backend stores one-time PKCE state in Postgres, exchanges the code, encrypts access and refresh tokens with AES-256-GCM, refreshes expiring credentials, and returns to the app through `tooledvoice://integrations/linear`.

Once connected, ask the assistant to create a Linear issue. The backend defaults to the first team returned for the connected account, so users do not need to know a team name. A spoken team name or key remains available as an explicit override.

## Database and API

Apply the checked-in migrations from `apps/api` to a database managed by the repository's Drizzle migration journal:

```sh
cd apps/api
pnpm db:migrate
```

Run the backend locally from the repository root:

```sh
pnpm dev:api
```

The server listens on `http://localhost:3000`; `GET /api/health` is public. Conversation, Realtime, and tool endpoints require a Supabase access token. The API verifies JWTs against Supabase JWKS and gives the device only a short-lived OpenAI Realtime client secret.

## Native development

`react-native-webrtc` requires a native development build and does not work in Expo Go.

Expo Doctor excludes `react-native-webrtc` from its React Native Directory metadata check. The directory currently marks the package as untested on the New Architecture, while this repository's Android development build and Realtime WebRTC audio/data-channel path are exercised directly. Keep that runtime check in the release checklist when upgrading Expo, React Native, or `react-native-webrtc`.

Build, install, and run Android or iOS from the repository root:

```sh
pnpm android
# or
pnpm ios
```

After a development build is installed, start Metro without rebuilding native code:

```sh
pnpm dev:native
```

Rebuild after changing native dependencies, Expo plugins, microphone permissions, identifiers, or the URL scheme. JavaScript-only changes can be picked up by Metro reload.

Sign in or create an account, confirm the email on the device, tap Connect, allow microphone access, then hold the talk button while speaking. Asking “What time is it in Sydney?” exercises the complete `getCurrentTime` tool path.

## Root scripts

| Command | Purpose |
| --- | --- |
| `pnpm dev:api` | Run the Hono API locally with watch mode |
| `pnpm dev:native` | Start Expo Metro for an installed development build |
| `pnpm android` | Build, install, and run the Android app |
| `pnpm ios` | Build, install, and run the iOS app |
| `pnpm check` | Type-check all workspaces |
| `pnpm test` | Run all workspace tests |

## Verification

```sh
pnpm check
pnpm test
cd apps/mobile && pnpm dlx expo-doctor@latest
```

Live verification additionally requires configured Supabase/OpenAI services and a native device or emulator with microphone and audio support. The Vercel Hobby deployment is suitable for this personal proof of concept; review duration, logging, and concurrency limits before commercial use.
