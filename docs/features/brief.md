# Since you left

The **Brief** toolbar button opens a persistent handoff for the current space. Its
count shows unread results and requests for input. **Mark as read** clears that view; **History**
keeps reviewed updates available. Opening a space or focusing an agent does not
mark its brief read. Each space has its own read receipts, even when several
spaces share a project folder.

While Herdr is open on `main-custom`, the toolbar records requests for input
across spaces. Finishing a turn no longer creates an update. Existing finished-turn
notices and routine reports whose title and opening sentence announce a commit or
push are kept in **History**, without adding to the unread count. Reports with
questions, caveats or reported failures remain in the main feed. The initial agent state
is a baseline; activity while the app is closed is not reconstructed.

For substantive results, Codex and Claude can leave a handoff using the installed
`herdr-brief` skill and command:

```sh
herdr-brief post --title "Hide quiet spaces" \
  --summary "Hide a space until a time you choose." \
  --change "Terminals keep running; restore early from Hidden spaces." \
  --test "All sidebar tests passed; checked hiding and early restore in the app."
```

Briefs show a short title and a one-sentence summary. **Read more** expands
optional practical changes. Questions stay visible under
**Needs your answer**. Use `--caveat` for important failures or limitations; these
stay visible under **Keep in mind**. Validation stays in the saved record and is
not displayed in the panel. Older briefs without caveats still load normally. The installed
skill asks for plain-language outcomes and skips routine commit, push and status notices. The optional flags
repeat. **Open conversation** (or **Reply to agent**) returns to
the handoff's exact live terminal in its original space. Handoffs are routed by
terminal identity, with a unique working agent in the exact task folder as a
fallback; ambiguous matches fail instead of using the focused space. The command
uses local `herdr-app` and `hc` access. Existing agents may need to load the new
skill before they start posting richer handoffs.

The panel can **Move to pane** like the other panels. A moved brief remains bound
to its tab's space. Shared activity and read receipts survive restarts. Handoffs
are stored atomically under `~/.config/herdr-app/brief/items/`; the panel loads the
newest 500 handoffs and retains the last 500 observed events across spaces. It
refreshes handoffs every ten seconds, keeps previous results on errors, and never
reads terminal transcripts or treats a status indicator as a test result.
