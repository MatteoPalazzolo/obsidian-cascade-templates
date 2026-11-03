# YOUDO.md

Documento che registra tutte le operazioni che l'agente suggerisce all'user.
La rimozione delle entry da questo file implica che i controlli siano già stati eseguiti e che eventuali anomalie siano già state riportate all'agent.
Di norma questo file dovrebbe essere vuoto.

Formato: `- [ ] <controllo> — <come/dove eseguirlo> (origine: <file:riga>)`.

---

- [ ] Dashboard, tabs off (default): no tabs, no header actions, read-only tree with local roots, reference paths, note groups and the outside-cascade footer — open the ribbon or the command palette (origine: `src/features/dashboard/CascadeDashboardModal.ts`).
- [ ] Dashboard, tabs on: `Issues` and `History` counters, disabled tabs at 0, empty state in place, `Fix all` count equal to `Issues` — Settings → Cascade Templates → “Issues and History tabs (experimental)” (origine: `src/settings.ts`).
- [ ] Issues: `Update` always available, `Align` locked with the chain-not-sound reason until templates are updated; row `⋯` on desktop and mobile — create a template missing a parent key and a note with an extra key (origine: `src/features/dashboard/CascadeDashboardModal.ts`).
- [ ] History: undo, confirmation with counts/diff, Fix all group with surviving phases, missing-file warning, truncated-history line and error card on a failed rewind — run a small batch, then change a touched key by hand before undoing (origine: `src/core/journal.ts`).
- [ ] Dashboard rendering in light/dark and on mobile; long tree depth, 12 px indentation, tap actions, long-press/`⋯`, `prefers-reduced-motion` progress line, popout window and dragging the modal tab between panes — on desktop and a phone/tablet (origine: `styles.css`).
- [ ] Ribbon icon (`git-fork`) and command `Open cascade dashboard` open the dashboard; the note properties toolbar is unchanged (reconform + Back only) and Back remains note-local, unaffected by dashboard undo — with two tabs on the same note (origine: `main.ts`).
- [ ] Confirm the warning is readable before enabling the experimental tabs, and keep a copy of the vault outside Obsidian before running `Fix all` (origine: `src/settings.ts`).

