# Git installation runtime packaging

## Intent and approved scope

Installing the repository URL in OpenChamber must work without compiling sources or installing dependencies into the extension. The user approved this scope through the OpenChamber approval form on 2026-11-14.

## Approaches

- Ship the existing compiled JavaScript in Git. This matches OpenChamber's documented installation contract and preserves the current unified extension manifest. This is the selected approach.
- Add an installation lifecycle build. OpenChamber explicitly never compiles extensions, so this would not fix its Git installer.
- Require npm installation or a separate release ZIP. These remain valid alternatives but do not meet the requested direct repository URL installation.

## Design

Track the runtime JavaScript under `dist/`, `openchamber/panel/app.js`, and `openchamber/service.cjs`. Preserve the current `app.js` classic-IIFE entry, manifest contributions, permissions, package version, and OpenChamber `>=2.7.1` requirement. Keep declarations, dependency directories, local worktrees, and test artifacts ignored.

Add a Git-install regression that constructs a dependency-free installation from Git-indexed runtime resources and checks its manifests, HTML script references, SDK checker, and backend importability. Do not let a preceding build or npm packaging hide missing Git resources. Add CI that builds and rejects stale tracked runtime files.

Update installation guidance and history. Work only in `.worktrees/fix-git-install-bundles`, retain temporary artifacts under `C:/Users/33632/AppData/Local/Temp/opencode`, obtain a fresh-context read-only review, and commit the verified milestone locally. No push, merge, publication, deletion, host upgrade, or live registration is authorized.
