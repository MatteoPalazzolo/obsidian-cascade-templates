# FEATURES

Workbench delle feature non ancora concluse. Le voci restano qui finché non
sono completate: solo allora si spostano in `PROJECT.md` (archivio della
documentazione) e si rimuovono da questo file. `PROJECT.md` non anticipa mai
feature pianificate.

Stati: `idea` → `in corso` → `completata` (da spostare).

I controlli manuali non si annotano qui: vivono in `YOUDO.md`, che è
l'unico elenco delle verifiche a carico dell'utente.

## Voce di menu per creare il template di cartella

Stato: idea.

Perché: creare a mano un template richiede di ricordare il `templateBasename`
configurato e di posizionare il file nella cartella giusta. Una voce nel menu
contestuale della cartella rende l'azione scopribile, esplicita e disponibile
anche su mobile (long-press), senza introdurre comandi in palette. La
distinzione root/child rende inoltre visibile se l'azione inizierà una cascata
o estenderà il template parent.

Comportamento:
- solo menu di una `TFolder` (in pratica il file explorer), non il menu di un
  file: il flusso è template prima, note dopo;
- template locale assente e nessun template antenato:
  `New root template (<nome>.md)`, sezione `action`, icona `file-plus`;
- template locale assente ma template antenato presente:
  `New child template (<nome>.md)`, stessa sezione e icona: erediterà le
  proprietà dal parent. "Root" significa inizio della cascata, non root del
  vault;
- template locale presente: voce disabled
  `Template already exists (<nome>.md)`, icona neutra (`file`, non
  `file-check` per non sovrapporsi alla semantica di conformità), nessun click;
  serve solo a segnalare l'esistenza, anche se il file non è visibile. Il
  titolo resta generico, senza distinzione root/child;
- il file nasce vuoto e riceve subito le proprietà del template antenato più
  vicino, anche con auto-apply `off`: è un'azione esplicita, non una cascata
  automatica;
- il body segue auto-apply: `off`/`properties` → body vuoto, `full` → body del
  parent copiato dal listener esistente;
- le espressioni `<% %>` restano raw: la destinazione è un template;
- apertura in una nuova tab; path normalizzato anche per la root del vault.

Note implementative:
- riusare `reconformFile(created, "add-missing")` dopo `vault.create(path, "")`
  per il seed delle proprietà: stesso motore della UI, già template-safe;
- il seed legge il parent diretto, non fonde l'intera catena: un parent non
  conforme resta un errore dello scanner;
- la distinzione root/child usa lo stesso walk sincrono di `getTemplateOfFile`:
  nessun costo aggiuntivo;
- registrarsi su `file-menu` con la sola guardia `TFolder`; la verifica dal vivo
  (`source`, `setSection("action")`, long-press mobile) è tracciata in
  `YOUDO.md`;
- aggiornare README e descrizione della setting auto-apply: l'azione esplicita
  eredita le proprietà anche con auto-apply disattivato.

Criteri di completamento:
- desktop e mobile (verifica tracciata in `YOUDO.md`); `off`, `properties`,
  `full`;
- root del vault, root di cascata e cartelle child;
- cartella con template locale, con solo template antenato, senza nessuno dei
  due;
- `npm run build` e `npm test` verdi;
- documentazione utente aggiornata;
- voce spostata in `PROJECT.md` e rimossa da `FEATURES.md`.

Aperti:
- se il template esiste, valutare un `Open template` separato in una sezione
  `view` (non nello slot create);
- se differenziare anche il disabled (`Root/Child template already exists`) o
  lasciarlo generico come da design attuale;
- interazione con `trigger_on_file_creation` di Templater;
- eventuale seed del body immediato invece di attendere i 200 ms di auto-apply.
