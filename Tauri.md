# Tauri Desktop Foundation

The Vite/React game runs inside a Tauri shell, with editor file operations routed through `src/platform/fileApi.ts` to native commands.

## Current State

- The web game/runtime remains the primary implementation.
- Editor file operations now go through `src/platform/fileApi.ts`.
- That adapter still supports the current Vite `/api/*` middleware flow.
- The `src-tauri` backend provides commands for:
  - listing project files;
  - ensuring files exist;
  - saving files;
  - appending to files;
  - reading files;
  - deleting files;
  - opening files/folders in the system shell.

## Project Root and File Writes

The backend selects its project root in this order:

- An existing path named by `QUEST_PROJECT_ROOT` (expected to be the project directory).
- In debug builds, the parent of `CARGO_MANIFEST_DIR`.
- In release builds, the directory containing the executable.

Release install directories may not be writable; set `QUEST_PROJECT_ROOT` to a writable project directory when needed. The editor does not yet provide a project-folder picker. Native save operations replace files atomically, and append operations use the native `append_project_file` command.

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

