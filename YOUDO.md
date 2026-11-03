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
- [ ] Primo avvio dopo l'aggiornamento: Notice una tantum per dispositivo/vault, non ripetuta al reload; su un secondo dispositivo o un altro vault compare di nuovo (origine: src/core/templaterConsent.ts:63)
- [ ] Bridge OFF di default: nessuna valutazione, tooltip del reconform che invita ad attivarlo, e nessuna chiave Templater in `data.json` (origine: src/core/templaterConsent.ts:34)
- [ ] Attivazione: modal con "I understand the risks", `Enable` bloccato finché la checkbox non è spuntata; Annulla/Esc/X lasciano il toggle OFF, non scrivono nulla e il modal si può riaprire (origine: src/features/TemplaterConsentModal.ts:19)
- [ ] Consenso per dispositivo/vault: due vault sullo stesso dispositivo hanno flag separati; su un secondo dispositivo sincronizzato il toggle è OFF (origine: src/core/templaterConsent.ts:46)
- [ ] Probe: con Templater attivo "Checking…" → "Templater detected vX — bridge verified" e toggle abilitato; con Templater disattivato "Templater not detected — option unavailable" e toggle disabilitato; con vault senza note "Create a note first to verify the bridge"; `Test again` ripete il probe (origine: src/settings.ts:421)
- [ ] `<%* %>` in un template: tooltip del reconform che avvisa dell'esecuzione di codice; con consenso ON ma Templater poi disattivato il tooltip dice che le espressioni sono scritte verbatim (origine: src/features/metadataPanel.ts:585)
- [ ] Resa del modal di consenso su desktop e mobile, light e dark: X nativa, checkbox e bottoni nativi (origine: src/features/TemplaterConsentModal.ts:19)