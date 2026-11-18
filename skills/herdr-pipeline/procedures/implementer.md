Plan this task yourself, then hand the implementation to {{implementer}} instead of writing the code:
- Read what you need and decide the approach first. Split larger work into steps that each stand on their own.
- For each step, write a brief to the file `git rev-parse --git-path herdr-brief.md` prints (Git's own folder, so it is never committed): the goal, the files and functions involved, what must not change, and how to verify it. The implementer knows nothing of this conversation or of earlier steps.
- Run this from {{where}} and wait for it to finish. It can take many minutes, so give it a long timeout or run it in the background and wait:
  {{command}}
- Read the diff it leaves and run the project's checks. When something is wrong, send a corrected brief; fix small things yourself.
- The implementer only edits files: you commit. If the command can't start, or a step fails twice, do that work yourself and say so on the summary's Unsure line.
