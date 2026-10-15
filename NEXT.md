[x] conforma + ADD MISSING con la spaziatura corretta custom (togli margine sinistro prima del +)
    → DROPPATO (punto A escluso dalla Sessione H, non più rilevante)

[x] struttura meglio pulsante a stati:
- vorrei che si ciclasse sempre sui 3 stati in modo da abituare e non confondere l'utente, idealmente il pulsante dovrebbe avere una larghezza pari alla dimensione del testo più grande che deve contenere usando ch da css (solo sullo specifico pulsante di reconform, non su UNDO)
    → H1 (parte sempre dal base, avanzamento a fasi) + H5 (min-width in `ch` sul solo reconform).
      Nessun wrap: il cursore si blocca su Reset.
- in termini di interazione, visto la natura progressivamente più invadente dei comandi (ordine giustificato), non penso sia un problema far premere 3 volte il pulsante di reconform per fare un clear, mi sembra una scelta di UX interessante da testare;
    → H1 (1° click Reconform, 2° Remove extra, 3° Reset)
- vorrei quindi che lo stato parta sempre da quello base e che l'utente debba sempre premere il pulsante più volte per accedere sempre all'opzione più invasiva; anche a costo di passare per stati di no-op (click inutili)
    → H1
- l'undo dovrebbe catturare sempre uno snapshot ogni qualvolta venga premuto il pulsante "reconform" e premendo undo lo stato del pulsante deve arretrare allo stato precedente
    → H2 (snapshot incondizionato a ogni pressione + fase nello snapshot; undo ripristina props e fase)
- il percorso sarebbe Reconform -> Remove extra -> Clear (che deve diventare Reset)
    → H1/H3 (etichetta Clear → Reset)
- vorrei poi stabilire una convezione a 3 fasi di colori per il pulsante
1. normale per azioni attive
2. meno evidente per azioni no-op pur sempre mantenendo la palette grigia di default
3. il classico disabled
    → H4

[x] tooltip di obsidian quando over sullo status check che fornisca il path del template di riferimento, spostandolo da add missing a status check; sotto il reconform rimane un tooltip con la descrizione dello stato corrente
    → H3 (status = stato + path template; reconform = descrizione stato corrente; warning Templater G4 resta sul reconform)
