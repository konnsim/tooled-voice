# Repository Guidelines

This repository is a monorepo. Keep application-specific source, configuration, and dependencies within the relevant directory under `apps/`.

## Repository structure

- `apps/mobile` contains the Expo and React Native mobile application.
- Follow any nested `AGENTS.md` instructions when working within a subdirectory.

## Working conventions

- Run commands from the relevant application directory unless a command is explicitly configured at the repository root.
- Keep generated files, local environment files, credentials, build output, and dependencies out of version control.
- Make focused changes and avoid modifying unrelated applications or configuration.
