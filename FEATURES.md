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

## Interfaces (ct-interfaces)

Stato: idea — pianificata per una minor dedicata.

Perché: la cascata attuale condivide proprietà solo lungo l'asse cartella. Le
interfacce aggiungono un secondo asse: una nota può dichiarare un insieme di
note-interfaccia e ricevere da queste le proprietà che le mancano, senza
duplicare template o creare sottocartelle. È il caso d'uso
"mixin/composizione per riferimento": `Ratable`, `Image`, `Reviewable` si
definiscono una volta e si applicano a qualsiasi nota, indipendentemente dalla
posizione nella cascata.

La feature è attivabile dalle settings e spenta di default. Non introduce
scritture automatiche: cambia il criterio di conformità e l'effetto del
pulsante di reconform.

Lessico:
- **nota-interfaccia**: una qualsiasi nota o template linkato da
  `ct-interfaces`;
- **nota ricevente**: il file che dichiara `ct-interfaces`;
- **dichiarazione**: il valore della prop `ct-interfaces`, cioè l'array di
  link;
- **riferimento**: la mappa di proprietà contro cui si confronta la nota;
- **materializzazione**: la scrittura delle chiavi dell'interfaccia nel
  frontmatter della nota ricevente.

### Attivazione

- Setting `enableInterfaces`, default `off`.
- Con la feature `off`, `ct-interfaces` è una proprietà normale: il plugin la
  ignora, non la filtra e non risolve i link.
- Con la feature `on`, `ct-interfaces` è riservata in qualsiasi `.md` (nota o
  template).
- Accendere la feature non scrive nulla: cambia solo il riferimento calcolato.
  Le note esistenti che dichiarano `ct-interfaces` diventano non conformi
  finché l'utente non esegue Update.
- Spegnere la feature riporta `ct-interfaces` a proprietà normale; nessun dato
  viene perso.

### Sintassi e validità

`ct-interfaces` è una lista di link a note:

```yaml
ct-interfaces:
  - "[[Ratable]]"
  - "[[Image]]"
```

- Si accetta anche un singolo link come stringa.
- La risoluzione usa `metadataCache.getFirstLinkpathDest(linkpath, sourcePath)`.
  Alias, heading e block vengono ignorati: conta la nota.
- La lista può stare in una nota o in un template. Ogni nota è una potenziale
  interfaccia, template compresi.
- Nel contratto dei dati la dichiarazione è riservata: non viene confrontata
  come prop della nota e non viene copiata da un template a una nota.
  Nell'eredità tra template è invece una prop normale (vedi sotto).
- Sono **invalidi**: link irrisolti, self-link, link a file non `.md`, valori
  non-stringa, link malformati. Un solo link invalido rende invalido l'intero
  riferimento e blocca il reconform.
- I duplicati vengono deduplicati per path risolto; vince la prima occorrenza.
- Un'interfaccia contribuisce solo con il proprio frontmatter, **esclusa
  `ct-interfaces`**. Non c'è ricorsione: se la nota-interfaccia dichiara a sua
  volta delle interfacce, queste non si propagano. La composizione si ottiene
  elencando più link nell'array o mettendo l'array nel template.
- Se la nota-interfaccia è un template, si usa solo il suo frontmatter
  dichiarato: non si espande il suo template parent e non si espandono le sue
  interfacce.
- Il body della nota-interfaccia è ignorato.
- Templater: il file interfaccia è sempre letto raw, mai eseguito. La
  valutazione di `<% %>` resta quella attuale: avviene solo scrivendo su una
  nota, se il bridge è attivo. Non ci sono eccezioni per i valori che arrivano
  da un'interfaccia.

### Risoluzione del riferimento

Per una **nota con template**:

1. si parte dalle props dichiarate del template più vicino, meno
   `ct-interfaces`;
2. si appendono le props delle interfacce dichiarate dal template, nell'ordine
   del suo array, solo per le chiavi non ancora presenti;
3. si appendono le props delle interfacce dichiarate dalla nota, nell'ordine
   del suo array, solo per le chiavi non ancora presenti;
4. i valori già presenti nella nota vincono sempre; le props del template
   precedono i default delle interfacce.

L'ordine risultante è: props del template, interfacce del template, interfacce
della nota, prop extra della nota. La prima interfaccia che definisce una
chiave vince. Presenza = chiave, non valore: una prop vuota nella nota non
viene sovrascritta.

Per un **template con parent**:

- la conformità e il reconform restano sulle props dichiarate, come oggi;
- `ct-interfaces` è una prop normale per l'eredità: il parent può dichiarare
  dei link e il figlio deve includerli per restare coerente;
- il check è di **sottoinsieme**: i link risolti del parent devono essere
  presenti nei link risolti del figlio; il figlio può aggiungerne altri;
- le chiavi prodotte dalle interfacce non vengono mai materializzate nel
  template: il template dichiara, le note ricevono.

Per una **nota senza template**: in fase 1 la feature è inerte. `ct-interfaces`
non viene risolta e il pannello resta nello stato "no template". Il caso è
coperto dalla feature sequel.

### Conformità

- **Nota vs riferimento**: `ok` / `extra` / `missing`, come oggi, ma il
  riferimento include le chiavi delle interfacce. `ct-interfaces` è filtrata
  dal confronto.
- **Template vs parent**: props dichiarate come oggi, più il check di
  sottoinsieme sui link di `ct-interfaces`. Link del parent mancanti nel figlio
  = template incoerente; link extra del figlio = specializzazione ammessa.
- **Link invalido**: il riferimento è incompleto. Lo stato non è `ok`/`missing`:
  è un warning dedicato. Il pulsante entra nello stato `invalid`.
- Un'interfaccia vuota (nessun frontmatter) è valida e non contribuisce nulla.

### Reconform

Matrice dei tre stati. `ct-interfaces` non è mai una prop del contratto: è una
dichiarazione che sopravvive alle azioni.

| File | Update | Align | Reset |
|---|---|---|---|
| Nota con template | aggiunge le chiavi mancanti del riferimento (template + interfacce), preserva i valori esistenti, riporta l'ordine al riferimento e lascia le prop extra in coda; preserva `ct-interfaces` | rimuove le prop non presenti nel riferimento; preserva `ct-interfaces` | riporta le prop ai default del riferimento; preserva `ct-interfaces` |
| Template con parent | aggiunge le prop mancanti del parent e fa il merge dei link `ct-interfaces` del parent con quelli del figlio; non materializza le chiavi delle interfacce | default: se il parent ha `ct-interfaces` la chiave resta con l'array del figlio; se il parent non ce l'ha, la chiave viene rimossa come prop extra | riporta le prop dichiarate al parent; `ct-interfaces` diventa l'array del parent, o viene rimossa se il parent non ce l'ha; non materializza le chiavi |
| Nota senza template | inerte in fase 1 | inerte | inerte |
| Link invalido | bloccato | bloccato | bloccato |

Note:
- Sulle note la dichiarazione `ct-interfaces` è sempre preservata: è ciò che
  definisce il riferimento. Rimuoverla cambierebbe il significato dell'azione.
- Sui template `ct-interfaces` segue il comportamento di default rispetto al
  parent. Un template figlio che aggiunge interfacce non presenti nel parent le
  perde con Align/Reset: è il comportamento prevedibile, non un caso speciale.
- Il pulsante entra nello stato `invalid` (hard-disabled, icona dedicata,
  tooltip con il link rotto) se la nota o il suo template hanno un link
  invalido. Quando il link torna valido, il cursore riparte dalla fase base.
- Il no-op di una fase usa lo stesso calcolo del reconform, inclusa la
  preservazione della chiave riservata.
- Back/history continua a funzionare: lo snapshot contiene anche
  `ct-interfaces`.

### Auto-apply

- **Nuova nota**: riceve le props effettive del template (dichiarate +
  interfacce del template) e le eventuali interfacce già dichiarate nella nota.
  Non copia l'array `ct-interfaces` dal template: l'effetto è ereditato, la
  dichiarazione no.
- **Nuovo template**: riceve le props dichiarate del parent, incluso l'array
  `ct-interfaces` come prop normale (merge dei link del parent con eventuali
  link già presenti). Non riceve le chiavi prodotte dalle interfacce.
- Se il file nasce già con `ct-interfaces` (Base, Templater, import), la
  dichiarazione viene preservata e le sue interfacce contribuiscono al merge.
- Templater resta invariato: solo note, solo con il setting attivo, mai sui
  template.

### Pannello

- **Nota**: l'icona confronta la nota con il riferimento (template +
  interfacce). Il tooltip riporta lo stato, il path del template e l'elenco
  delle interfacce con la provenienza (`template` o `nota`). I link invalidi
  compaiono nel tooltip.
- **Template**: l'icona continua a confrontare le props dichiarate con il
  parent. Il tooltip elenca le interfacce dichiarate.
- **Link invalido**: icona di stato in warning, non `ok`/`missing`. Il pulsante
  di reconform è hard-disabled con stato `invalid`.
- **Nota senza template**: stato neutro e pulsante disabilitato, come oggi;
  `ct-interfaces` resta inerte in fase 1.
- **Refresh**: quando cambia il frontmatter di una nota-interfaccia, vanno
  aggiornate le view la cui nota o il cui template la usano. Oggi
  `refreshViewsForFile` guarda solo il template diretto: va esteso.
- **Navigazione dal badge**: resta quella attuale (template per le note, parent
  per i template). Le interfacce si aprono dai link nella prop.

### Scanner

- **Note scanner**: usa il riferimento effettivo (template + interfacce),
  filtra `ct-interfaces` e ignora le note con riferimento invalido, che sono
  gestite dallo scanner dedicato.
- **Template scanner**: props dichiarate come oggi, più il check di
  sottoinsieme sui link `ct-interfaces`. Il valore della chiave non partecipa al
  confronto delle props.
- **Invalid-link scanner**: segnala link irrisolti, self-link, link a file non
  `.md`, valori non-stringa. Cache-only, come gli altri scanner.
- Autofix resta fuori scope (E2).

### Settings

- Toggle "Enable interfaces", default `off`.
- Descrizione: riserva `ct-interfaces`; la prop contiene una lista di link a
  note; le props mancanti vengono aggiunte con Update o su note nuove; nessuna
  scrittura automatica; i link invalidi bloccano il reconform; le note senza
  template non sono supportate in questa fase.
- Il toggle deve aggiornare i pannelli aperti, come le altre setting.

### Casi limite

- Interfaccia cancellata o rinominata: il link diventa invalido finché non
  viene corretto. Se Obsidian aggiorna i link interni al rename, la prop si
  aggiorna da sola.
- Interfaccia che è un template: si usa solo il suo frontmatter dichiarato.
- Interfaccia che ha un template: il suo template non contribuisce.
- Interfaccia che dichiara `ct-interfaces`: la chiave è esclusa, nessuna
  ricorsione.
- Template root: può dichiarare interfacce e le sue note le ricevono; il
  reconform del template resta disabilitato perché non ha parent.
- Feature attivata su un vault con `ct-interfaces` già usata per altro: la prop
  diventa riservata; è una scelta esplicita dell'utente.
- `position` in cache: ignorata come sempre.
- Espressioni `<% %>` nelle interfacce: raw nella sorgente, valutate solo
  scrivendo su una nota se il bridge è attivo.
- Body dell'interfaccia: ignorato.

### Non-obiettivi

- Nessuna ricorsione tra interfacce.
- Nessun picker o registro globale: ogni nota è già un'interfaccia e la prop si
  edita nel pannello Properties nativo.
- Nessuna interfaccia per note senza template in questa fase (feature sequel).
- Nessuna scrittura automatica al salvataggio.
- Nessuna cartella o grammatica sul nome file: le interfacce sono link.
- Nessuna ereditarietà implicita tra template: vale la regola esistente delle
  props dichiarate, con il check di sottoinsieme per `ct-interfaces`.

### Impatto sul codice

- `src/conts.ts`: costante `INTERFACES_PROP = "ct-interfaces"`.
- `src/settings.ts`: `enableInterfaces`, normalizzazione, toggle e descrizione.
- Nuovo `src/core/interfaceProps.ts` (puro): parsing dei linkpath, filtro della
  chiave riservata, append/merge, preservazione della chiave, check di
  sottoinsieme, conformità del riferimento. Da aggiungere a
  `tsconfig.test.json` e coprire con test.
- `src/core/templateAPI.ts`: risoluzione dei link, riferimento effettivo,
  `reconformFile`, auto-apply.
- `src/core/conformance.ts`: eventuale helper puro per il sottoinsieme; il merge
  resta in `interfaceProps.ts`.
- `src/features/metadataPanel.ts`: riferimento effettivo, tooltip, stato
  `invalid`, refresh sulle interfacce.
- `src/scanner/CoherenceScanner.ts`, `TemplateCoherenceScanner.ts`: filtro e
  riferimento effettivo; nuovo scanner per i link invalidi.
- `styles.css`: stato `invalid` del pulsante e warning dell'icona.
- `README.md`, `PROJECT.md`, `YOUDO.md`: documentazione e check manuali.

### Criteri di completamento

- `npm run build`, `npm run lint`, `npm test` verdi.
- Setting `off` invariato rispetto a oggi; setting `on` verificato su note e
  template.
- Update/Align/Reset verificati per nota con template, template con parent,
  link invalido.
- Auto-apply verificato per nuova nota e nuovo template.
- Tooltip, stato `invalid`, refresh su cambio interfaccia e mobile verificati in
  `YOUDO.md`.
- README e PROJECT.md aggiornati; voce spostata in `PROJECT.md` e rimossa da
  `FEATURES.md`.

### Aperti

- Nessuno sul modello. Restano fuori scope la ricorsione, il picker e le note
  senza template (vedi feature sequel).

## Interfaces without a template (sequel)

Stato: idea.

Perché: la feature Interfaces richiede un template come schema di riferimento.
Una nota fuori da qualsiasi cascata non può usare `ct-interfaces`, anche se le
sue interfacce definirebbero uno schema parziale. Il caso è legittimo ma
introduce uno stato UI nuovo e va comunicato con attenzione.

Comportamento proposto:
- riferimento = solo le props delle interfacce dichiarate nella nota;
- conformità missing-only: `missing` se manca una chiave dell'interfaccia,
  `ok` se ci sono tutte; mai `extra`, perché non esiste un template che definisca
  cosa sia di troppo;
- reconform: solo Update (append delle chiavi mancanti); Align/Reset
  disabilitati;
- tooltip e stato del pannello devono spiegare che il riferimento è parziale;
- scanner dedicato o estensione dello scanner note.

Aperti:
- comunicazione UI dello stato parziale;
- interazione con auto-apply e note create fuori da un template;
- se il caso valga la complessità o se richiedere sempre un template sia
  sufficiente.