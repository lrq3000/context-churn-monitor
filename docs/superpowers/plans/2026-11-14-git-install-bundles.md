# Git Installation Bundles Implementation Plan

> **For agentic workers:** REQUIRED SUB-SKILL: Use superpowers:executing-plans to implement this plan task-by-task. Steps use checkbox (`- [ ]`) syntax for tracking.

**Goal:** Make the repository URL a complete, prebuilt OpenChamber extension installation.

**Architecture:** Reuse the existing TypeScript and esbuild outputs and ship their runtime JavaScript in Git. Test Git-indexed resources separately from npm's built archive, and enforce output freshness in CI.

**Tech Stack:** Node.js, TypeScript, esbuild, node:test, OpenChamber SDK 2.7.1, GitHub Actions.

**Spec:** `docs/superpowers/specs/2026-11-14-git-install-bundles-design.md`

## Global Constraints

- Preserve `openchamber/panel/app.js` as a classic IIFE and keep OpenChamber `>=2.7.1`.
- Preserve package version, contribution paths, permissions, and runtime behavior.
- No push, merge, publication, deletion, host upgrade, or live registration.
- Mutations belong to the approved worktree and retained temporary artifacts, not the main checkout.

## Review Focus

- A clean Git installation must not depend on ignored files from the developer's checkout.
- The panel, local service, backend, export worker, and optional skill must all be shipped.
- Relative backend imports must resolve without extension-local `node_modules`.
- The legacy UI-only subfolder must remain independently installable.
- A source edit without refreshed bundles must fail CI rather than shipping stale code.

## Task 1: Ship and validate Git-install runtime resources

**Files:** Create `tests/git-install.test.ts` and `.github/workflows/ci.yml`; modify `.gitignore`, `README.md`, and `HISTORY.md`; generate and track `dist/**/*.js`, `openchamber/panel/app.js`, and `openchamber/service.cjs`.

**Interfaces:** Consume `package.json` contribution paths, `git ls-files`, `parseManifestJson`, and the SDK's existing `scripts/check-guest.ts`; produce an isolated installation with no dependency directory and no new runtime API.

- [x] Establish a focused passing baseline in the new worktree.
- [x] Write the failing Git-install regression. Assert that every manifest resource and each local HTML script is Git-indexed; run the existing SDK checker against a Git-only fixture; import the backend and core from that fixture.
- [x] Run `node --import tsx --test tests/git-install.test.ts` and confirm failure specifically for missing compiled Git resources.
- [x] Adjust `.gitignore`, run `npm run build`, and stage the approved runtime files so the Git-indexed regression can pass.
- [x] Add CI with `npm ci`, `npm run typecheck`, `npm test`, and a post-build `git diff --exit-code` check for tracked runtime freshness; document Git installation and the existing version floor.
- [x] Run the regression, `npm run typecheck`, and `npm test`, with temporary outputs retained in the approved temporary directory.
- [ ] Request fresh-context read-only validation and address verified findings within scope.
- [ ] Inspect the diff, stage only approved files, create a conventional local commit with OpenCode/model attribution, and verify the commit and clean branch state.

## Execution record

Pre-flight: no shared interfaces; this is one cohesive packaging milestone.

The focused baseline passed 12 tests. All three new Git-install tests failed before implementation with missing `app.js`, `service.cjs`, and `dist/reports/export-worker.js`. After staging the 35 generated runtime JavaScript files, all three passed, including both SDK extension-checker runs and the dependency-free backend import. `npm run typecheck` passed. `npm test` passed all 114 tests with no failures or skips on Node.js v24.22.2; its retained log is `C:/Users/33632/AppData/Local/Temp/opencode/context-churn-git-install-tests.log`.

Existing locked dependencies were copied into this isolated worktree without downloading anything so esbuild's dependency-path comments match a normal standalone installation. CI uses the validated Node.js 24 major. The Git index is deliberately the fixture source so checks can run before committing while still excluding every ignored build artifact.
