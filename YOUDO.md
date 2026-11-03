# YOUDO.md

Documento che registra tutte le operazioni che l'agente suggerisce all'user.
La rimozione delle entry da questo file implica che i controlli siano già stati eseguiti e che eventuali anomalie siano già state riportate all'agent.
Di norma questo file dovrebbe essere vuoto.

Formato: `- [ ] <controllo> — <come/dove eseguirlo> (origine: <file:riga>)`.

---

- [ ] Menu cartella su desktop (right-click) e mobile (long-press): `New root cascade template` senza template antenato, `New child cascade template` con parent, icona `file-plus`; con template locale presente voce disabilitata `Cascade template already in folder` con icona `file` e nessun click; verificare in devtools raggruppamento/sezione della voce (origine: src/features/folderTemplateMenu.ts:65)
- [ ] Command palette `Create cascade template in current folder` su desktop e mobile: root del vault, root di cascata e cartella child; con template locale presente resta eseguibile e mostra la Notice con il path; senza nota attiva il comando è disabilitato (origine: src/features/folderTemplateMenu.ts:51)
- [ ] Casi cartella: root del vault, root di cascata e cartella child; path normalizzato anche per la root del vault (origine: src/core/templateAPI.ts:127)
- [ ] Creazione: il file nasce vuoto, si apre in una nuova tab e riceve subito le proprietà del parent anche con auto-apply `off`; con `properties` il body resta vuoto; con `full` il body viene copiato dall'auto-apply (origine: src/features/folderTemplateMenu.ts:85)
- [ ] Espressioni `<% %>` nel parent: il nuovo template resta raw, nessuna espressione valutata (origine: src/features/folderTemplateMenu.ts:85)
- [ ] Templater attivo con `trigger_on_file_creation` e `files_with_pending_templates`: il template appena creato non viene valutato né sovrascritto al passaggio ~300 ms; il path viene rilasciato dopo ~1 s (origine: src/core/templaterBridge.ts:115)
- [ ] `npm run build` verde fuori sandbox — eseguire su Windows: nel container manca il binario esbuild per Linux e solo `tsc` gira (origine: package.json:9)
