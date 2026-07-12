# Mobile Application Guidelines

This workspace is an Expo development-build application, not an Expo Go application. Read the exact Expo SDK and React Native versioned documentation before changing framework configuration or native behavior.

- Keep Supabase session storage in SecureStore and never add privileged credentials to `EXPO_PUBLIC_*` variables.
- Preserve the `tooledvoice://auth/callback` deep link and PKCE exchange used by email confirmation.
- Keep OpenAI audio on the direct WebRTC connection; obtain only short-lived Realtime credentials from the authenticated API.
- Rebuild with `pnpm android` or `pnpm ios` after native dependency, plugin, permission, package identifier, or URL-scheme changes. Use root `pnpm dev:native` for Metro-only development after a build is installed.
- Test keyboard behavior, safe areas, microphone permission, app background/foreground transitions, and reconnect behavior on a native device or emulator.
