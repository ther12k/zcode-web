# Register this plan on GitHub

**Target repository:** `ther12k/zcode-web`.

This pack only creates local Markdown planning documents. No issue, pull request, label, milestone, project, assignment or repository modification has been performed. Commands below are for an authorized maintainer to review and run; creation commands are writes.

## 1. Prepare and avoid duplicates

Extract the ZIP and open a terminal in the `zcode-web-ui-ux-pack` directory. Read `01-PRD.md`, `10-ISSUE-REGISTER.md` and the optional-scope boundary before filing.

Confirm the account and repository deliberately:

```sh
gh auth status
gh repo view ther12k/zcode-web --json nameWithOwner,url
```

Search both open and closed issues before creating each planning ID:

```sh
gh issue list --repo ther12k/zcode-web --state all \
  --search '"ZWUI-001" in:title' --limit 100 \
  --json number,title,url,state
```

Inspect matching titles and bodies for the exact marker `<!-- zcode-ui-plan:ZWUI-001 -->`. Search-index results are not a transactional uniqueness guarantee. If a create command times out, check for the created issue before retrying. Do not blindly bulk-rerun creation after a partial failure. Never overwrite an existing discussion automatically.

Current CLI option references: [issue list](https://cli.github.com/manual/gh_issue_list), [issue create](https://cli.github.com/manual/gh_issue_create). Confirm installed support with `gh issue create --help` before using optional newer fields.

## 2. Establish labels and milestone names

Suggested labels: `ui-ux`, `type:epic`, `type:task`, `priority:P0`, `priority:P1`, `priority:P2`, `scope:core`, `scope:optional`. Reuse the repository's existing conventions where appropriate instead of creating duplicate synonyms. Ensure labels exist before adding them; review [label create](https://cli.github.com/manual/gh_label_create) when using the CLI.

Suggested milestone titles are exactly `M0`, `M1`, `M2`, `M3`; descriptions are in the register. If those names already mean something else in this repository, choose unambiguous UI-specific names and update the example arguments. Do not rename existing milestones without agreement. No dates are implied by this plan.

## 3. File six epics, then selected tasks

Create the six epic bodies under `epics/` first, labeling the first four core and the last two optional. An epic issue is a grouping body, not a claim that GitHub has a custom issue type named Epic. Save each returned URL and number.

Example — after the listed labels exist:

```sh
gh issue create --repo ther12k/zcode-web \
  --title '[ZWUI-E01] Foundation and execution contracts' \
  --body-file epics/ZWUI-E01.md \
  --label ui-ux --label type:epic --label scope:core
```

Create tasks from their complete `issues/` bodies in the valid order in the register. Example — after labels and milestone M0 exist:

```sh
gh issue create --repo ther12k/zcode-web \
  --title '[ZWUI-001] Capture baseline contracts, source identity and regression fixtures' \
  --body-file issues/ZWUI-001-capture-baseline-contracts-source-identity-and-regression-fixtures.md \
  --label ui-ux --label type:task --label priority:P0 --label scope:core \
  --milestone M0
```

The body already includes the proposed owner role, requirements, dependency IDs, work checklist, acceptance criteria, verification scenarios and evidence requirements. Assign a real person only after they accept ownership. Keep the issue title's planning ID to support cross-reference and deduplication.

There are **42 proposed issue bodies** if all six epics and 36 tasks are registered. Filing optional items as backlog does not put them in the core release. Teams preferring a smaller initial backlog may register the four core epics plus 27 core tasks, then add the two optional epics and nine tasks later.

## 4. Map real issue numbers and dependencies

Maintain a local or repository planning table as registration proceeds:

| Planning ID | Actual issue number / URL | State | Notes |
|---|---|---|---|
| ZWUI-E01 | Fill from the real create response | Not filed until confirmed | Parent grouping |
| ZWUI-001 | Fill from the real create response | Not filed until confirmed | Baseline |

Do not turn `ZWUI-007` into `#7`; planning IDs and GitHub numbers are unrelated. Replace dependency entries with the actual issue links only after resolution. Update the epic checklist with the actual child issue references. Keep the planning ID alongside each link for auditability.

Recent GitHub CLI documentation includes `--parent` and `--blocked-by` on `gh issue create`. When supported by the installed CLI and target repository, use real numeric IDs from the mapping table to set these relationships during creation. Never pass unresolved planning IDs to those flags. Where native relationships are unavailable, the body’s explicit dependency links and epic checklists remain the required fallback. Use GitHub's issue interface to attach relationships after filing when simpler.

Do not infer dependencies from consecutive numbering. ZWUI-015 is early hardening, and cross-epic prerequisites are deliberate.

## 5. Registration review

- [ ] Every filed ID is unique across open and closed issues, with its full body and marker preserved.
- [ ] Every core task has its correct priority, owner decision, milestone and dependency links.
- [ ] Optional scope remains explicitly optional, especially Code, Changes and Preview.
- [ ] The four core epics link all 27 core tasks; the optional epics link only selected backlog scope.
- [ ] No acceptance checkbox or test-result claim was marked complete merely by filing.
- [ ] No generated demo status, terminal simulation or desktop artifact-path guessing was imported as production scope.

## 6. Implementation handoff and closure

For each PR, cite its actual issue number, tested full commit hash, CLI version, protocol version and build identity. Include exact test commands/results, a representative redacted screenshot or browser trace when relevant, and explicit skipped checks. Close the issue only when its acceptance criteria are met; release closure requires the combined candidate gates, not a sum of unrelated historical green runs.

This guide intentionally does not provide an unattended bulk creation script. Per-issue deduplication, scope selection, real ownership and dependency mapping need maintainer review, particularly when some items may already be implemented after the planning baseline.
