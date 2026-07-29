# Tauri Desktop Foundation

This branch contains the first-pass desktop preparation for running the current Vite/React game inside a Tauri shell.

## Current State

- The web game/runtime remains the primary implementation.
- Editor file operations now go through `src/platform/fileApi.ts`.
- That adapter still supports the current Vite `/api/*` middleware flow.
- A matching `src-tauri` backend scaffold was added with commands for:
  - listing project files;
  - ensuring files exist;
  - saving files;
  - reading files;
  - deleting files;
  - opening files/folders in the system shell.

## Important Caveat

The current Rust command layer resolves paths relative to the process working directory. That is good enough for early local development and architectural validation, but it is not yet the final packaged-project model.

For a production editor build we should decide where project data lives:

- open/edit a user-selected project folder;
- work from a dedicated workspace path;
- or separate the desktop editor from the packaged player.

## Expected Local Prerequisites

1. Install Rust/Cargo.
2. Install the Tauri CLI:

```bash
npm install -D @tauri-apps/cli
```

3. Then run:

```bash
npm run tauri:dev
```

For a desktop package:

```bash
npm run tauri:build
```

## macOS CI Build (GitHub Actions)

A GitHub Actions workflow is configured in `.github/workflows/tauri-build-macos.yml`.

To build for macOS:
1. **Manual trigger**: Go to GitHub Actions tab -> select **Tauri macOS Build** -> click **Run workflow**. The resulting `.dmg` / `.app` artifact will be available under the run summary.
2. **Release trigger**: Push a release tag starting with `v` (e.g. `git tag v0.1.0 && git push origin v0.1.0`). `tauri-action` will build the macOS bundle and create a GitHub Release draft automatically.

