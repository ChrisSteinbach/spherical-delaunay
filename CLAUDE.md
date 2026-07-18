# CLAUDE.md — spherical-delaunay

Repo-specific notes for Claude Code. Issue tracking and session workflow live in
`AGENTS.md` (beads); this file covers git/release mechanics that have bitten
automation here.

## Git & PR policy (linear history)

- **Merge commits are disabled — history is linear.** Land PRs by **squash**
  (house style: the merge commit is titled `<PR title> (#N)`) or rebase. A
  merge-commit attempt returns `HTTP 405 "Merge commits are not allowed on this
repository."`
- **`main` is protected** — no direct pushes; every change goes through a PR.
- **`gh pr edit` and `gh pr merge` fail here** on a deprecated _Projects
  (classic)_ GraphQL field (`repository.pullRequest.projectCards`). Use the REST
  API instead:
  - Edit PR body: `jq -Rs '{body:.}' < body.md | gh api -X PATCH repos/OWNER/REPO/pulls/N --input -`
  - Merge PR: `gh api -X PUT repos/OWNER/REPO/pulls/N/merge -f merge_method=squash -f commit_title="<PR title> (#N)"`
  - `gh pr create` and `gh pr checks`/`--watch` work fine.

## Release & publish

- **No publish automation** — the only workflow is `ci.yml` (lint / type-check /
  build / test on Node 20 & 22). Publishing is manual.
- Flow: on the PR branch run `npm version <minor|patch> --no-git-tag-version`
  (additive API ⇒ **minor**), commit, squash-merge; then on `main` tag
  `vX.Y.Z`, push the tag, and `npm publish`.
- **`npm publish` requires a 2FA one-time password** (`--otp=<code>`) that only
  the maintainer can supply — the automation cannot self-serve it. Have the
  human run `npm publish --otp=<code>` (or `! npm publish --otp=<code>` in the
  Claude Code prompt).
- `publishConfig.access` is `public`. `prepublishOnly` runs
  typecheck+lint+format+test; `prepare` builds `dist/`.
- **0.x pin caveat:** `^0.1.0` does _not_ satisfy `0.2.0` (caret on 0.x means
  `>=0.1.0 <0.2.0`). Downstream consumers (isotherm, tour-guide) must widen
  their range to adopt new APIs.
