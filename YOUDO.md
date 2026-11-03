# YOUDO.md

Documento che registra tutte le operazioni che l'agente suggerisce all'user.
La rimozione delle entry da questo file implica che i controlli siano già stati eseguiti e che eventuali anomalie siano già state riportate all'agent.
Di norma questo file dovrebbe essere vuoto.

Formato: `- [ ] <controllo> — <come/dove eseguirlo> (origine: <file:riga>)`.

---

- [ ] Menu cartella su desktop (right-click) e mobile (long-press): `New root template (!Template.md)` senza template antenato, `New child template (!Template.md)` con parent, in sezione `action` con icona `file-plus`; con template locale presente voce disabilitata `Template already exists (!Template.md)` con icona `file` e nessun click (origine: src/features/folderTemplateMenu.ts:42)
- [ ] Casi cartella: root del vault, root di cascata e cartella child; path normalizzato anche per la root del vault (origine: src/core/templateAPI.ts:127)
- [ ] Creazione: il file nasce vuoto, si apre in una nuova tab e riceve subito le proprietà del parent anche con auto-apply `off`; con `properties` il body resta vuoto; con `full` il body viene copiato dall'auto-apply (origine: src/features/folderTemplateMenu.ts:85)
- [ ] Espressioni `<% %>` nel parent: il nuovo template resta raw, nessuna espressione valutata (origine: src/features/folderTemplateMenu.ts:85)
- [ ] Templater attivo con `trigger_on_file_creation` e `files_with_pending_templates`: il template appena creato non viene valutato né sovrascritto al passaggio ~300 ms; il path viene rilasciato dopo ~1 s (origine: src/core/templaterBridge.ts:115)
- [ ] `npm run build` verde fuori sandbox — eseguire su Windows: nel container manca il binario esbuild per Linux e solo `tsc` gira (origine: package.json:9)
