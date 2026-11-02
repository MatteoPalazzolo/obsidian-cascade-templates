# YOUDO.md

Documento che registra tutte le operazioni che l'agente suggerisce all'user.
La rimozione delle entry da questo file implica che i controlli siano già stati eseguiti e che eventuali anomalie siano già state riportate all'agent.
Di norma questo file dovrebbe essere vuoto.

Formato: `- [ ] <controllo> — <come/dove eseguirlo> (origine: <file:riga>)`.

---

- [ ] Baseline 1.13: plugin caricato e flussi invariati su Obsidian 1.13 desktop e mobile — attivare il plugin su un vault con Obsidian 1.13 sia desktop sia mobile e provare pannello Properties, reconform, Back, auto-apply su nota nuova e bridge Templater (origine: manifest.json:5)