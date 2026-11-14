# Source history and extraction

## Git installation packaging fix (2026-11-14)

Git snapshots now include the existing compiled JavaScript backend, classic-IIFE panel and bundled local service. Previously these files were ignored, so OpenChamber rejected a repository URL installation even though an npm archive or locally built folder worked. A dependency-free Git-index installation regression covers the unified root and legacy UI-only folder, and CI rejects stale or missing runtime bundles. The extension's version and OpenChamber ≥2.7.1 requirement are unchanged; no runtime behavior or permissions are added.

Context Churn Monitor was extracted on 2026-11-10 from [lrq3000/lrq3000_agent_skills](https://github.com/lrq3000/lrq3000_agent_skills) at source commit `f138c926411e3f25e06ed84fb90e9f31e75e4c04`. Its independent source is now [lrq3000/context-churn-monitor](https://github.com/lrq3000/context-churn-monitor). The collection retains its original history and references this repository as a commit-pinned Git submodule configured to update from `main`; it does not follow the remote branch automatically.

## Retained content and attribution

The extraction promotes `plugins/context-churn-monitor/` to this repository's root and retains the thirteen dedicated design, plan and verification documents under their existing `docs/` paths. It excludes all other collection files and histories. Eight relevant commits remain, with every retained snapshot's file contents/modes, authors, committers, timestamps and complete commit messages verified against the source. Tree and parent changes necessarily produce new commit identifiers; commit-message references to historical identifiers deliberately remain unchanged.

The exact source paths and complete old-to-new mapping are in [docs/history/extraction.json](https://github.com/lrq3000/context-churn-monitor/blob/main/docs/history/extraction.json):

| Original collection commit | Extracted commit |
| --- | --- |
| `105332aa5686dfae3567752d1cc2a291e0115a7b` | `e238f445425aa0f526e52d955004c9eea3dfa113` |
| `2e9f8222d2673aec3d89ffed46e29f11ff4195eb` | `35ee10198f38c477f0fdfc0493cebb1dcd3f9761` |
| `72c2233215aee79d1ecc3e64ecca69e1f118a473` | `cb70ab8440adeb24689c71e3ceacd54e785ad34e` |
| `1bb7822cd7e16da6e021796fdd77c971f87a3623` | `679f99a6191b2873f7af0643a05eb2290c3388ea` |
| `bf5b3462cf8e71e71fc91fdf8c062515cff07326` | `b3fba031c25a8a488baeafae35ee61ae783226c2` |
| `f5086fb29c028f0ac9893127a346baefcfb611e2` | `359a7edc9bcd8c220e4b1f7375203bbae02089f8` |
| `591b11405959c1c58622a1d0ea870258e9cb2b2c` | `b44e3301e1e8bde935b2f45ab863c7a3ec01e9a3` |
| `f138c926411e3f25e06ed84fb90e9f31e75e4c04` | `366e74bed245f3d679bec4538529ee1129c22000` |

Original feature-branch commits quoted in squash messages remain historical references in the original collection, not extra branches imported into this repository. Publication pushes only this filtered `main` history and later standalone changes, never the unfiltered collection or its tags.

## Reproduction and verification

Use `git-filter-repo==2.47.0` in a fresh isolated clone of the original collection's `main` at the source commit, without tags or local object sharing. Create a path manifest containing `plugins/context-churn-monitor/` followed by the thirteen `documents` entries from the JSON above, one path per line. Run:

```sh
python /PATH/TO/git_filter_repo.py --paths-from-file /PATH/TO/paths.txt --path-rename plugins/context-churn-monitor/: --preserve-commit-hashes
```

The `--preserve-commit-hashes` option prevents rewriting SHA references inside commit messages; it does not preserve the identifiers of rewritten commits. Verify this repository against a local source checkout containing the original objects:

```sh
python tests/review/verify-extraction.py --source /PATH/TO/lrq3000_agent_skills
```

The verifier checks all eight relevant commits, every historical selected tree, attribution/messages, ancestry and the absence of extra historical commits, not just the final filesystem. The original collection is never rewritten.

## Historical documents and reproduction artifacts

The thirteen transferred documents and original review scripts intentionally preserve their historical wording, absolute machine paths and then-current limitations. In these artifacts, `plugins/context-churn-monitor/` means this repository's root; other collection-root references refer to the original collection at the source baseline. Historical branch or worktree identifiers are not active installation paths. See [tests/review/README.md](https://github.com/lrq3000/context-churn-monitor/blob/main/tests/review/README.md) before running reproduction scripts; some intentionally assert former defects. Current installation and release metadata are in [README.md](README.md), and maintained tests are the normal package test scripts.

Release 0.4.1 changes ownership URLs and source layout, not the monitoring runtime or dependencies. npm 0.4.0 remains immutable. Copyright and Apache-2.0 attribution remain Stephen Karl Larroque <LRQ3000@gmail.com>; historical author names are retained verbatim rather than normalized.
