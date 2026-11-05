---
name: herdr-mods-upgrade
description: Merge a new Herdr version's shipped mods into the herdr-mods clones, resolve conflicts, and verify in Herdr.
disable-model-invocation: true
---

# Upgrading the herdr-mods clones

The clones (every mod whose `mod.json` has `cloned_from`, and `layouts/main-custom.json`) are
copies of Herdr's shipped mods with our edits. The `upstream` branch holds Herdr's pristine
originals, one commit per Herdr version, so merging it into `main` is a three-way merge: Herdr's
changes since the last version land on top of our edits.

Work in the herdr-mods repo on `main` with a clean tree.

1. Run `./upgrade.sh`. It commits Herdr's current originals to `upstream` and merges them.
   - "Up to date": report that and stop.
   - "Merged … cleanly": go to step 3.
   - "left conflicts in": go to step 2.

   In steps 2 and 3, `base` is the last merged Herdr version, the same during and after the merge:
   `base=$(git merge-base ORIG_HEAD upstream)`.

2. Resolve every listed conflict. For each file, read both sides of the change:
   - Herdr's: `git diff $base upstream -- <path>`
   - Ours: `git diff $base ORIG_HEAD -- <path>`, plus `git log --oneline -- <path>` and the
     README's "What's in here" for the intent behind it.

   Write Herdr's new line, then re-apply our edit on top of it, so the file has both. Where Herdr
   changed code our clone deleted (the panels' inline viewers), carry the change over only if our
   dialog needs it, and say which you skipped in the report. Done when `git diff --check` is clean,
   no `<<<<<<<` is left, and `git commit --no-edit` has made the merge commit.

3. Hunt for dangling references: our clones removed state Herdr's code may now use (`files-modal`
   dropped `this.file`; `changes-modal`'s panel never sets `this.open`). For every identifier
   Herdr's diff adds or renames (`git diff $base upstream`), confirm the merged clone still
   defines or sets it. Done when each one is accounted for: present, fixed, or listed in the report.

4. Verify in Herdr:
   - `./install.sh`: every mod says "check passed" and no "Clones behind Herdr" is printed.
   - `herdr-app status`: `"errors": []`.
   - Open each changed clone. For the Files and Changes dialogs, use the throwaway overlay mod
     recipe in the repo's `CLAUDE.md` on a repo with uncommitted changes, both Split and Unified
     for Changes. `herdr-app shot`, then post the screenshots with `herdr-show`.

   Done when status is clean and every screenshot shows the dialog rendering real content.

5. Report: the Herdr version; what Herdr changed in each clone, one line each; every conflict and
   how you resolved it; anything skipped or dangling. Leave the push to the user:
   `git push origin main upstream`.
