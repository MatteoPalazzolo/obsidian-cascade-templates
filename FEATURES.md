# FEATURES

Workbench delle feature non ancora concluse. Le voci restano qui finché non
sono completate: solo allora si spostano in `PROJECT.md` (archivio della
documentazione) e si rimuovono da questo file. `PROJECT.md` non anticipa mai
feature pianificate.

## Stati

Quattro stati in sequenza. Lo stato misura il lavoro **fatto**: `spec` dice che
il disegno è chiuso, non che il codice esista.

- **`idea`** — la feature è annotata e motivata, ma il contratto non c'è: manca
  il comportamento, o l'impatto sul codice, o i criteri di completamento,
  oppure resta una decisione che ridisegna la feature. Non è implementabile
  senza progettare.
- **`spec`** — disegno chiuso: comportamento, impatto sul codice e criteri di
  completamento sono scritti e coerenti. Gli `Aperti` sono decisioni locali e
  circoscritte, dichiarate nella voce, che si chiudono durante
  l'implementazione senza ridisegnare la feature. Codice assente.
- **`in corso`** — esiste codice non ancora completo; la voce indica cosa manca
  rispetto ai criteri di completamento. Di norma una sola feature per volta è
  `in corso`.
- **`completata`** — criteri di completamento soddisfatti e documentazione
  aggiornata: la voce si sposta in `PROJECT.md` e si rimuove da qui, quindi
  `completata` non resta mai scritto in questo file.

Ciclo: `idea` → `spec` → `in corso` → `completata` (da spostare). Ogni passo
avanti presuppone il precedente: non si entra `in corso` su una `idea` e non si
esegue una `spec` che non è chiusa. Il passo indietro è ammesso quando il
lavoro si ferma (`in corso` → `spec` se il codice non si regge, `spec` → `idea`
se una decisione salta): lo stato è una fotografia, non una promessa.

I controlli manuali non si annotano qui: vivono in `YOUDO.md`, che è
l'unico elenco delle verifiche a carico dell'utente.

## Mappa e ordine di lavoro

Ogni feature ha una lettera stabile, usata anche nei rimandi incrociati di
questo file. La tabella è in **ordine di lavoro**, non alfabetico.

| Lettera | Feature | Stato |
|---|---|---|
| **D** | Interfaces (`ct-interfaces`) | spec |
| **D2** | Interfaces without a template (sequel di D) | idea |

La colonna Stato segue «Stati»; a dire cosa viene prima è l'ordine, non lo
stato.

Ordine deciso: **D**. D2 non entra in piano finché D non è validata sul
campo. A, B, C, F e G sono completate e archiviate in `PROJECT.md`.

Perché questo ordine:

- **D per ultima.** Tocca pannello, foresta e dashboard: arriva quando
  l'universo della foresta è stabile, dopo che B ha introdotto il ritorno
  `{before, changes, changed}` di `reconformFile` e gli helper della foresta.
- **D2 fuori piano.** Dipende dagli aperti di D.

Vincoli da rispettare durante l'implementazione:

- **Seam lasciata da B.** B deriva il riferimento con un `referenceFor(node)`
  iniettabile; oggi risolve al template della cartella, con D diventa
  template + interfacce della nota. La foresta non deve assumere un riferimento
  per cartella, altrimenti D rifà `forest.ts`, `journal.ts` e i relativi test.
- **Semantica della dashboard B.** La regola «`ok` = stesso insieme di chiavi»
  è già nel README e non va cambiata: l'aperto «`ct-interfaces` è un'eccezione
  value-level?» (vedi D) deve chiudersi senza smentirla.
- **Release.** B è già rilasciata come dashboard; D arriva dopo.
- **Lettere storiche nel codice.** I commenti usano ancora le sessioni
  (C = pannello, D = impostazioni, E = scanner, G = bridge), che non
  coincidono con queste lettere: non si rinominano, se ne tiene conto in
  lettura. Nei rimandi un aperto con due lettere (es. `D/B`) è condiviso dalle
  due feature.

## (D) Interfaces (ct-interfaces)

Stato: spec — minor dedicata, prossima e ultima, con due decisioni
locali ancora aperte (eccezione value-level di `ct-interfaces` e politica dei
link non risolti).

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
- **dichiarazione**: il valore della prop `ct-interfaces`, cioè l'array di link;
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
- Link irrisolti, self-link, link a file non `.md`, valori non-stringa e link
  malformati **non contribuiscono al riferimento**. Non esiste uno stato
  `invalid` e nessun link blocca Update/Align/Reset. Se un link non risolto
  debba essere segnalato in silenzio o con un warning non bloccante è un aperto
  di questa feature, da decidere all'implementazione.
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
coperto da (D2).

### Conformità

- **Nota vs riferimento**: `ok` / `extra` / `missing`, come oggi, ma il
  riferimento include le chiavi delle interfacce. `ct-interfaces` è filtrata
  dal confronto.
- **Template vs parent**: props dichiarate come oggi, più il check di
  sottoinsieme sui link di `ct-interfaces`. Link del parent mancanti nel figlio
  = template incoerente; link extra del figlio = specializzazione ammessa.
- **Link non risolto**: non contribuisce al riferimento e non produce uno stato
  dedicato. Update/Align/Reset usano i soli link risolti; la segnalazione
  (silenziosa o warning non bloccante) è un aperto.
- Un'interfaccia vuota (nessun frontmatter) è valida e non contribuisce nulla.

### Reconform

Matrice dei tre stati. `ct-interfaces` non è mai una prop del contratto: è una
dichiarazione che sopravvive alle azioni.

| File | Update | Align | Reset |
|---|---|---|---|
| Nota con template | aggiunge le chiavi mancanti del riferimento (template + interfacce), preserva i valori esistenti, riporta l'ordine al riferimento e lascia le prop extra in coda; preserva `ct-interfaces` | rimuove le prop non presenti nel riferimento; preserva `ct-interfaces` | riporta le prop ai default del riferimento; preserva `ct-interfaces` |
| Template con parent | aggiunge le prop mancanti del parent e fa il merge dei link `ct-interfaces` del parent con quelli del figlio; non materializza le chiavi delle interfacce | default: se il parent ha `ct-interfaces` la chiave resta con l'array del figlio; se il parent non ce l'ha, la chiave viene rimossa come prop extra | riporta le prop dichiarate al parent; `ct-interfaces` diventa l'array del parent, o viene rimossa se il parent non ce l'ha; non materializza le chiavi |
| Nota senza template | inerte in fase 1 | inerte | inerte |
| Link non risolto | prosegue sui link risolti | prosegue sui link risolti | prosegue sui link risolti |

Note:
- `Reset` resta **solo del pannello Properties**: la dashboard B non lo espone e
  non lo aggiunge.
- Sulle note la dichiarazione `ct-interfaces` è sempre preservata: è ciò che
  definisce il riferimento. Rimuoverla cambierebbe il significato dell'azione.
- Sui template `ct-interfaces` segue il comportamento di default rispetto al
  parent. Un template figlio che aggiunge interfacce non presenti nel parent le
  perde con Align/Reset: è il comportamento prevedibile, non un caso speciale.
- Non esiste uno stato `invalid`: un link non risolto non blocca il pulsante e
  non fa ripartire il cursore. Il tooltip può elencarlo, ma la policy di
  segnalazione è l'aperto D/B.
- Il no-op di una fase usa lo stesso calcolo del reconform, inclusa la
  preservazione della chiave riservata.
- Back/history locale continua a funzionare: lo snapshot della nota contiene
  anche `ct-interfaces`.

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
  delle interfacce con la provenienza (`template` o `nota`). I link non risolti
  possono comparire nel tooltip; la policy di segnalazione è aperta.
- **Template**: l'icona continua a confrontare le props dichiarate con il
  parent. Il tooltip elenca le interfacce dichiarate.
- **Link non risolto**: non c'è uno stato dedicato né hard-disable; il tooltip
  può elencarlo. La segnalazione è l'aperto D/B.
- **Nota senza template**: stato neutro e pulsante disabilitato, come oggi;
  `ct-interfaces` resta inerte in fase 1.
- **Refresh**: quando cambia il frontmatter di una nota-interfaccia, vanno
  aggiornate le view la cui nota o il cui template la usano. Oggi
  `refreshViewsForFile` guarda solo il template diretto: va esteso.
- **Navigazione dal badge**: resta quella attuale (template per le note, parent
  per i template). Le interfacce si aprono dai link nella prop.

### Dashboard

- **Note**: usano il riferimento effettivo (template + interfacce), filtrano
  `ct-interfaces` e non creano uno stato dedicato per le note con link non
  risolti; la segnalazione è l'aperto D/B.
- **Template**: props dichiarate come oggi, più il check di sottoinsieme sui
  link `ct-interfaces`. Il valore della chiave non partecipa al confronto delle
  props.
- **Link non risolti**: non c'è uno scanner dedicato in questa fase; la policy
  di segnalazione è l'aperto D/B.

### Settings

- Toggle "Enable interfaces", default `off`.
- Descrizione: riserva `ct-interfaces`; la prop contiene una lista di link a
  note; le props mancanti vengono aggiunte con Update o su note nuove; nessuna
  scrittura automatica; i link non risolti non contribuiscono al riferimento e
  la loro segnalazione è un aperto; le note senza template non sono supportate
  in questa fase.
- Il toggle deve aggiornare i pannelli aperti, come le altre setting.

### Casi limite

- Interfaccia cancellata o rinominata: il link non è più risolto finché non
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
- Nessuna interfaccia per note senza template in questa fase (vedi D2).
- Nessuna scrittura automatica al salvataggio.
- Nessuna cartella o grammatica sul nome file: le interfacce sono link.
- Nessuna ereditarietà implicita tra template: vale la regola esistente delle
  props dichiarate, con il check di sottoinsieme per `ct-interfaces`.

### Impatto sul codice

- `src/conts.ts`: costante `INTERFACES_PROP = "ct-interfaces"`.
- `src/settings.ts`: `enableInterfaces`, normalizzazione, toggle e descrizione
  nella tab dichiarativa delle impostazioni.
- Nuovo `src/core/interfaceProps.ts` (puro): parsing dei linkpath, filtro della
  chiave riservata, append/merge, preservazione della chiave, check di
  sottoinsieme, conformità del riferimento. Da aggiungere a
  `tsconfig.test.json` e coprire con test.
- `src/core/templateAPI.ts`: risoluzione dei link, riferimento effettivo,
  `reconformFile`, auto-apply.
- `src/core/conformance.ts`: eventuale helper puro per il sottoinsieme; il merge
  resta in `interfaceProps.ts`.
- `src/features/metadataPanel.ts`: riferimento effettivo, tooltip, refresh sulle
  interfacce; nessuno stato `invalid`.
- `src/features/dashboard/`: filtro e riferimento effettivo, innestato sulla
  seam `referenceFor(node)` lasciata da B; nessuno scanner per i link non
  risolti in questa fase.
- `styles.css`: nessuno stato `invalid`; l'eventuale warning per i link non
  risolti dipende dall'aperto D/B.
- `README.md`, `PROJECT.md`, `YOUDO.md`: documentazione e check manuali.

### Criteri di completamento

- `npm run build`, `npm run lint`, `npm test` verdi.
- Setting `off` invariato rispetto a oggi; setting `on` verificato su note e
  template.
- Update/Align/Reset verificati per nota con template, template con parent e
  link non risolto; nessun link blocca le azioni.
- Auto-apply verificato per nuova nota e nuovo template.
- Tooltip, link non risolti, refresh su cambio interfaccia e mobile verificati in
  `YOUDO.md`.
- README e PROJECT.md aggiornati; voce spostata in `PROJECT.md` e rimossa da
  `FEATURES.md`.

### Aperti

- Politica dei link `ct-interfaces` non risolti: skip silenzioso o warning non
  bloccante; da decidere all'implementazione. Nessuno stato `invalid`.
- `ct-interfaces` è un'eccezione value-level alla regola `ok` della dashboard
  B (stesso insieme di chiavi), o la regola vale solo per le note?
- Universo della foresta: le note senza template restano fuori; panel-only o
  emendamento alla foresta di B. Vedi (D2).

Restano fuori scope la ricorsione, il picker e le note senza template (vedi D2).

## (D2) Interfaces without a template (sequel di D)

Stato: idea — comportamento proposto, ma universo e comunicazione UI sono
ancora da decidere; fuori piano finché D non è validata.

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
- dashboard dedicata o estensione del tab `Issues`; l'universo resta un aperto
  (panel-only o emendamento alla foresta di B).

Aperti:
- comunicazione UI dello stato parziale;
- interazione con auto-apply e note create fuori da un template;
- se il caso valga la complessità o se richiedere sempre un template sia
  sufficiente.
