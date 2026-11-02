# YOUDO.md

Documento che registra tutte le operazioni che l'agente suggerisce all'user.
La rimozione delle entry da questo file implica che i controlli siano già stati eseguiti e che eventuali anomalie siano già state riportate all'agent.
Di norma questo file dovrebbe essere vuoto.

Formato: `- [ ] <controllo> — <come/dove eseguirlo> (origine: <file:riga>)`.

---

- [X] Baseline 1.13: plugin caricato e flussi invariati su Obsidian 1.13 desktop e mobile — attivare il plugin su un vault con Obsidian 1.13 sia desktop sia mobile e provare pannello Properties, reconform, Back, auto-apply su nota nuova e bridge Templater (origine: manifest.json:5)
- [ ] Resa della tab impostazioni su desktop e mobile, light e dark: card unica con righe separate da hairline, nessun heading ridondante, controlli allineati a destra come nelle tab core — aprire Settings → Cascade Templates su desktop e mobile, in tema chiaro e scuro (origine: src/settings.ts:254)
- [ ] Ogni riga compare nella ricerca globale delle impostazioni — digitare "Template file name", "Apply the template to new files", "Evaluate template expressions in notes", "Templater bridge test" e "Show the properties toolbar" nella ricerca impostazioni e verificare che ognuna apra la tab (origine: src/settings.ts:254)
- [ ] Persistenza e refresh invariati: cambiare template file name, auto-apply, toggle Templater e toolbar, riaprire le impostazioni e verificare che i valori restino e che il pannello Properties si aggiorni (origine: src/settings.ts:352)
- [ ] Toggle Templater: disabilitato con descrizione "Templater is not installed or not enabled…" quando Templater è assente/disattivato, abilitato quando presente — provare con Templater attivo e disattivo (origine: src/settings.ts:290)
- [ ] Bridge test: senza nota attiva "Open a note before testing"; con Templater attivo "Templater detected vX — bridge established"; con Templater disattivato "Templater not detected" (origine: src/settings.ts:294)
- [ ] `npm run build` verde fuori sandbox — eseguire su Windows: nel container manca il binario esbuild per Linux e solo `tsc` gira (origine: package.json:9)