# YOUDO.md

Documento che registra tutte le operazioni che l'agente suggerisce all'user.
La rimozione delle entry da questo file implica che i controlli siano già stati eseguiti e che eventuali anomalie siano già state riportate all'agent.
Di norma questo file dovrebbe essere vuoto.

Formato: `- [ ] <controllo> — <come/dove eseguirlo> (origine: <file:riga>)`.

---

- [ ] Dashboard, tabs off (default): no tabs, no header actions, read-only tree with local roots, template folders, note groups and the outside-cascade footer; a folder has no template row of its own and clicking its label opens the template while the rest of the card expands it; folders without a template are flattened (their notes appear in the nearest template folder), and the tooltip shows the full path — open the ribbon or the command palette (origine: `src/features/dashboard/CascadeDashboardModal.ts`).
- [ ] Dashboard tree: notes under a `N notes` group share the group's indentation (they must not look like a nested tree level) while staying clickable and actionable; a folder with only a template and no notes/children has no chevron — expand a folder with notes (origine: `styles.css`).
- [ ] Dashboard tree: every folder row shows the template icon (`file`) independently of its expansion, the chevron is the only state signal, and the note/`N notes` icons stay distinct — expand and collapse a folder (origine: `src/features/dashboard/CascadeDashboardModal.ts`).
- [ ] Dashboard, tabs on: `Issues` and `History` counters, disabled tabs at 0, empty state in place, `Fix all` count equal to `Issues` — Settings → Cascade Templates → “Issues and History tabs (experimental)” (origine: `src/settings.ts`).
- [ ] Issues: one tree for all issue kinds, no separate template row; each folder row shows `Update templates` / `Update notes` / `Align notes` bulk verbs, on mobile only the `⋯` menu, which also has `Open template`; single-file rows keep their verb; `Align` shows the chain-not-sound reason until templates are updated — create a template missing a parent key, a note missing a key and a note with an extra key in different subfolders (origine: `src/features/dashboard/CascadeDashboardModal.ts`).
- [ ] History: undo, confirmation with counts/diff, Fix all group with surviving phases, missing-file warning, truncated-history line and error card on a failed rewind — run a small batch, then change a touched key by hand before undoing (origine: `src/core/journal.ts`).
- [ ] Dashboard rendering in light/dark and on mobile; clicking anywhere on a folder card (not just the chevron) expands/collapses it, while the verbs/menu inside the card still act without toggling; long tree depth, 12 px indentation, tap actions, long-press/`⋯`, `prefers-reduced-motion` progress line, popout window and dragging the modal tab between panes — on desktop and a phone/tablet (origine: `styles.css`).
- [ ] Ribbon icon (`git-fork`) and command `Open cascade dashboard` open the dashboard; the note properties toolbar is unchanged (reconform + Back only) and Back remains note-local, unaffected by dashboard undo — with two tabs on the same note (origine: `main.ts`).
- [ ] Confirm the warning is readable before enabling the experimental tabs, and keep a copy of the vault outside Obsidian before running `Fix all` (origine: `src/settings.ts`).

