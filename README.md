# Tooled Voice

Tooled Voice is a native live voice assistant built with Expo development builds, OpenAI Realtime over direct WebRTC, Supabase Auth/Postgres, an authenticated Hono backend, and user-scoped Composio MCP sessions. Audio travels between the device and OpenAI; local tools and application data travel through the API, while connected third-party operations run through Composio.

## Architecture

- `apps/mobile`: Expo/React Native app with Supabase email/password auth, SecureStore-backed sessions, PKCE confirmation deep links, `react-native-webrtc`, and native in-call audio routing/focus management.
- `apps/api`: Hono API for Supabase JWT verification, OpenAI Realtime client-secret minting, Composio session creation, conversation persistence, and typed local-tool dispatch.
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

Set `COMPOSIO_API_KEY` to enable managed connections for Linear, GitHub, Gmail, Slack, and Notion. Composio associates connections with the authenticated Supabase user ID and returns a short-lived, user-scoped MCP session to the API; the Composio API key is never sent to the mobile app or OpenAI.

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

## Tool integrations

With `COMPOSIO_API_KEY` configured, the **Connected Tools** card lets each user connect or remove Linear, GitHub, Gmail, Slack, and Notion accounts through Composio managed authentication. Realtime sessions receive one user-scoped Composio MCP endpoint with runtime tool discovery. **Ask me** automatically permits read-like operations and requires explicit approval for changes; **Allow** permits changes without confirmation. Permission changes apply to the next voice session.

### Legacy Linear fallback

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

When Composio is not configured, the existing Linear connection remains available as a compatibility fallback. Its OAuth token is refreshed by the API and attached to Linear's official hosted MCP. Keep the Linear environment variables only until the Composio cutover has been verified, then remove the legacy OAuth code and encrypted credentials in a separate migration.

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

The server listens on `http://localhost:3000`; `GET /api/health` is public. Conversation, Realtime, integration, and local-tool endpoints require a Supabase access token. The API verifies JWTs against Supabase JWKS and gives the device only a short-lived OpenAI Realtime client secret.

## Native development

`react-native-webrtc` and `react-native-incall-manager` require a native development build and do not work in Expo Go. Live voice starts in hands-free speaker mode, follows wired/Bluetooth route changes, acquires Android audio focus, and exposes a speaker/earpiece control. Android 12 and newer will request Bluetooth-connect permission so an attached headset can participate in the call audio route.

Expo Doctor excludes `react-native-webrtc` and `react-native-incall-manager` from its React Native Directory metadata check. The directory currently marks both packages as untested on the New Architecture, while this repository's Android development build exercises the Realtime WebRTC and native call-audio paths directly. Keep that runtime check in the release checklist when upgrading Expo, React Native, or either native package.

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

Sign in or create an account, confirm the email on the device, then tap **Start Live Voice** and allow microphone access. The microphone remains live for a continuous conversation: speak naturally, pause to let semantic turn detection respond, and speak over the assistant to interrupt. Use **Mute** without ending the session, switch between **Speaker** and **Earpiece**, or **End** to close it. **Turn Speed** switches live between fast (`high`) and natural (`auto`) semantic VAD so both can be compared without reconnecting. Asking “What time is it in Sydney?” exercises the complete `getCurrentTime` tool path.

Tap **Voice Lab** while connected to see the current connection, turn-response, first-audio, latest-tool, interruption, route, and VAD metrics. Detailed events remain in the Metro terminal as one-line JSON records with `scope: "tooled-voice/realtime"`. `first_audio` reports total time from detected speech stop, with model-response time in its detail field.

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

For release-quality voice verification, use physical Android and iOS devices and run the same short conversation through:

- Quiet room and background speech/noise.
- Speaker, earpiece, wired headset, and Bluetooth headset routes.
- Fast and natural turn-speed modes, including hesitation and self-correction.
- Speaking over the assistant to confirm immediate interruption.
- Background/foreground reconnection and an incoming audio-focus interruption.
- A normal reply and a tool call, comparing `speech_stopped`, `response_created`, `first_audio`, and `tool_finished` timings in Voice Lab.
