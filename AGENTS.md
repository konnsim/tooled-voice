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
- `pnpm check` checks formatting and lint rules with Ultracite; `pnpm fix` applies safe fixes.
- `pnpm typecheck` type-checks every workspace; `pnpm test` runs the repository test suite.

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

# Ultracite Code Standards

This project uses **Ultracite**, a zero-config preset that enforces strict code quality standards through automated formatting and linting.

## Quick Reference

- **Format code**: `pnpm fix`
- **Check for issues**: `pnpm check`
- **Type-check workspaces**: `pnpm typecheck`
- **Diagnose setup**: `pnpm dlx ultracite doctor`

Biome (the underlying engine) provides robust linting and formatting. Most issues are automatically fixable.

---

## Core Principles

Write code that is **accessible, performant, type-safe, and maintainable**. Focus on clarity and explicit intent over brevity.

### Type Safety & Explicitness

- Use explicit types for function parameters and return values when they enhance clarity
- Prefer `unknown` over `any` when the type is genuinely unknown
- Use const assertions (`as const`) for immutable values and literal types
- Leverage TypeScript's type narrowing instead of type assertions
- Use meaningful variable names instead of magic numbers - extract constants with descriptive names

### Modern JavaScript/TypeScript

- Use arrow functions for callbacks and short functions
- Prefer `for...of` loops over `.forEach()` and indexed `for` loops
- Use optional chaining (`?.`) and nullish coalescing (`??`) for safer property access
- Prefer template literals over string concatenation
- Use destructuring for object and array assignments
- Use `const` by default, `let` only when reassignment is needed, never `var`

### Async & Promises

- Always `await` promises in async functions - don't forget to use the return value
- Use `async/await` syntax instead of promise chains for better readability
- Handle errors appropriately in async code with try-catch blocks
- Don't use async functions as Promise executors

### React & JSX

- Use function components over class components
- Call hooks at the top level only, never conditionally
- Specify all dependencies in hook dependency arrays correctly
- Use the `key` prop for elements in iterables (prefer unique IDs over array indices)
- Nest children between opening and closing tags instead of passing as props
- Don't define components inside other components
- Use semantic HTML and ARIA attributes for accessibility:
  - Provide meaningful alt text for images
  - Use proper heading hierarchy
  - Add labels for form inputs
  - Include keyboard event handlers alongside mouse events
  - Use semantic elements (`<button>`, `<nav>`, etc.) instead of divs with roles

### Error Handling & Debugging

- Remove `console.log`, `debugger`, and `alert` statements from production code
- Throw `Error` objects with descriptive messages, not strings or other values
- Use `try-catch` blocks meaningfully - don't catch errors just to rethrow them
- Prefer early returns over nested conditionals for error cases

### Code Organization

- Keep functions focused and under reasonable cognitive complexity limits
- Extract complex conditions into well-named boolean variables
- Use early returns to reduce nesting
- Prefer simple conditionals over nested ternary operators
- Group related code together and separate concerns

### Security

- Add `rel="noopener"` when using `target="_blank"` on links
- Avoid `dangerouslySetInnerHTML` unless absolutely necessary
- Don't use `eval()` or assign directly to `document.cookie`
- Validate and sanitize user input

### Performance

- Avoid spread syntax in accumulators within loops
- Use top-level regex literals instead of creating them in loops
- Prefer specific imports over namespace imports
- Avoid barrel files (index files that re-export everything)
- Use proper image components (e.g., Next.js `<Image>`) over `<img>` tags

### Framework-Specific Guidance

**Next.js:**
- Use Next.js `<Image>` component for images
- Use `next/head` or App Router metadata API for head elements
- Use Server Components for async data fetching instead of async Client Components

**React 19+:**
- Use ref as a prop instead of `React.forwardRef`

**Solid/Svelte/Vue/Qwik:**
- Use `class` and `for` attributes (not `className` or `htmlFor`)

---

## Testing

- Write assertions inside `it()` or `test()` blocks
- Avoid done callbacks in async tests - use async/await instead
- Don't use `.only` or `.skip` in committed code
- Keep test suites reasonably flat - avoid excessive `describe` nesting

## When Biome Can't Help

Biome's linter will catch most issues automatically. Focus your attention on:

1. **Business logic correctness** - Biome can't validate your algorithms
2. **Meaningful naming** - Use descriptive names for functions, variables, and types
3. **Architecture decisions** - Component structure, data flow, and API design
4. **Edge cases** - Handle boundary conditions and error states
5. **User experience** - Accessibility, performance, and usability considerations
6. **Documentation** - Add comments for complex logic, but prefer self-documenting code

---

Most formatting and common issues are automatically fixed by Biome. Run `pnpm fix` before committing to ensure compliance.
