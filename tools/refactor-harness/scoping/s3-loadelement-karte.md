# S3 — die Karte vor dem Schnitt

`loadElement` (`nj:532`, 109 Zeilen). Analyse, kein Eingriff. `nj` und `test/`
sind nicht angefasst; `test/` wurde nur gelesen, Digest davor und danach
`66891340`.

## 1. Es sind neun, nicht acht — und das ist ein Befund über den Plan

DECISIONS 75 nennt acht Ableiter. Der natürliche Schnitt ergibt **neun**. Acht
ließe sich nur durch einen willkürlichen Zusammenschluss erreichen.

| # | Ableiter | übernimmt (rel. zu `nj:532`) | liest | schreibt | Codes |
|---|---|---|---|---|---|
| 0 | *(bleibt in `loadElement`)* | 1–17 | `file`, `folder` | Rohlesen, `parseFile`, Skelett, `archived` | `file:unreadable`, `frontmatter:unreadable` |
| 1 | `deriveId` | 19–27 | `fields`, `base`, `parsed` | `el.id` | `id:derived`, `id:mismatch` |
| 2 | `deriveType` | 29–45 | `el.id`, `folder`, `el.archived`, `parsed` | `el.type` | `type:derived`, `type:folder` |
| 3 | `deriveTitle` | 47–49 | `fields` | `el.title` | `missing:title` |
| 4 | `deriveStatus` | 51–58 | `fields`, `cfg.statuses`, `parsed` | `el.status` | `missing:status`, `unknown:status` |
| 5 | `deriveParent` | 60–66 | `fields`, **`el.type`** | **`el.parent`** | `parent:hierarchy`, `parent:orphaned` |
| 6 | `deriveOptionals` | 68–81 | `fields` | `priority`, `assignee`, `tags`, `depends_on` | `unknown:priority` |
| 7 | `deriveTimestamps` | 83–91 | `fields`, `file` (mtime), `parsed` | `created`, `updated` | `missing:created`, `missing:updated` |
| 8 | `deriveArchiveState` | 92–95 | `fields`, `el.archived`, `el.status` | `archivedAt` | `archive:not_done` |
| 9 | `deriveBody` | 97–106 | `body`, `el.title`, `el.type`, `parsed` | — | `title:h1_mismatch`, `incomplete:description`, `incomplete:acceptance` |

**Wollte man acht**, wäre der einzige vertretbare Zusammenschluss 3 + 9
(`deriveTitle` zu `deriveBody`), weil die H1-Prüfung der einzige Konsument von
`el.title` ist. Dagegen spricht, dass die Vollständigkeitsprüfung mit dem Titel
nichts zu tun hat — der Zusammenschluss wäre eine Zahl, kein Grund.

Empfehlung: **neun**, und DECISIONS 75 auf neun berichtigen. Die Acht war eine
Absicht aus der Planungsphase, keine Messung.

## 2. Die Reihenfolge ist hier TRAGEND — anders als bei `deriveGraph`

Bei `deriveGraph` ist die Pass-Reihenfolge frei, und der Grund war messbar:
kein Pass liest das `problems`-Set eines anderen, jeder Zugriff ist ein `.add`.

**Hier gilt das Gegenteil.** Die Ableiter schreiben `el.*`-Felder, die spätere
Ableiter **lesen**:

```
deriveId      ──> el.id       ──> deriveType         (Präfix kommt aus der id)
deriveType    ──> el.type     ──> deriveParent       (Epic-Regel vs. orphaned)
                              ──> deriveBody         (Acceptance nur task/subtask)
deriveStatus  ──> el.status   ──> deriveArchiveState (archive:not_done)
deriveTitle   ──> el.title    ──> deriveBody         (H1-Vergleich)
Skelett       ──> el.archived ──> deriveType, deriveArchiveState
```

Frei sind nur 6 (`deriveOptionals`) und 7 (`deriveTimestamps`): sie lesen
ausschließlich `fields`/`file`, und niemand liest ihre Ausgabe innerhalb von
`loadElement`.

**Folge für den Schnitt:** die Reihenfolge gehört als Vertrag in den Kommentar,
nicht in den Zufall. Und sie ist **nicht durch Absturz erzwungen** — ein
verschobener Ableiter liest `undefined` und erzeugt still ein anderes Ergebnis:
`deriveParent` vor `deriveType` liefert `parent:orphaned` statt
`parent:hierarchy`, ohne dass irgendetwas bricht.

## 3. Die `parent`-Invariante — die gefährlichste Stelle

Zeile 61:

```js
el.parent = typeof parent === 'string' && parent.trim() !== '' ? parent.trim() : null;
```

**Leer oder Whitespace wird `null`, nie `''`.** `childMap` prüft
`e.parent === null`, nicht falsy — diese Normalisierung ist der Grund, warum das
korrekt ist.

> **Berichtigt nach der S2-Verifikation.** Hier stand, die Normalisierung trage
> „die Äquivalenz der beiden zusammengeführten Fassungen". Das ist falsch und
> stammt aus der S2-Commit-Message: **beide** Fassungen prüften `=== null`,
> zeichengleich, ihre Äquivalenz *zueinander* beruhte auf demselben Guard. Die
> Normalisierung schützt die Korrektheit von `=== null` **als solcher** — in
> jeder der beiden Fassungen und ebenso vor S2. Der Code-Kommentar in `nj` sagt
> es richtig; nur die Commit-Message, diese Karte und die Aufgabenstellung des
> Leads haben es zu etwas befördert, das es nicht war. Für den Schnitt ändert
> das nichts: die Auflage bleibt, weil sie ohne S2 genauso gilt.

**Sie liegt künftig in `deriveParent` (Ableiter 5) und muss auf JEDEM Pfad
laufen.** Wer auf ihr sitzt:

| Aufrufer | Stelle | Test |
|---|---|---|
| `childMap` | `nj:685` | `e.parent === null` |
| `markParentEdges` | Pass 2 | `el.parent === null` |
| `markParentCycles` | Pass 3 | `cur.parent === null` |
| `cmdTree` (Wurzeln) | `nj:1663 ff.` | `e.parent === null` |
| `deriveParent` selbst | | `el.parent !== null` |

**Der Bruch, den ein Schnitt hier verursachen kann, ist rückwirkend und
unsichtbar:** verschiebt jemand die Normalisierung in einen Ableiter, den nicht
jeder Pfad durchläuft — etwa hinter eine `parsed`-Bedingung —, dann trägt ein
Element mit leerem `parent:` plötzlich `''` statt `null`. `childMap` gruppiert
es dann unter dem Schlüssel `''`, statt es zu überspringen. **S2 bricht, ohne
dass sich an S2 etwas ändert**, und das Orakel merkt es nicht, weil es die Form
nicht kennt.

Auflage für den Schnitt: `deriveParent` läuft unbedingt, ohne Vorbedingung, und
der Kommentar nennt die vier Aufrufer, die auf `null` prüfen.

**Ein zweiter Fall derselben Art**, beim Lesen gefunden: `el.assignee`
(Zeile 78) normalisiert **nicht** — ein fehlendes `assignee` wird `''`, kein
`null`. `cmdSet` vergleicht `assignee !== el.assignee` und setzt bei `''` ein
`undefined` in die Overrides, was das Feld löscht. Wer `deriveOptionals`
„aufräumt" und `assignee` auf `null` vereinheitlicht, ändert damit still das
Löschverhalten von `nj set --assignee=`. Gehört ebenfalls in den Kommentar.

## 4. Deckung — gemessen, nicht geschätzt

Zähler in einer Kopie von `nj` unter `/tmp`, gefahren über die Fixtures (1752
Aufrufe, 26 Szenarien) **und** das volle Orakel (61/61). Insgesamt **68 094
`loadElement`-Aufrufe**.

| Ableiter | Aufrufe | Anteil | |
|---|---|---|---|
| 1 `deriveId` — Pfad „id vorhanden" | 68 080 | 100 % | |
| 1 `deriveId` — Pfad „id fehlt" | **14** | 0,0 % | **dünn** |
| 2 `deriveType` | 68 094 | 100 % | |
| 2 — Pfad „Typ aus Präfix" | **31** | 0,0 % | **dünn** |
| 3 `deriveTitle` | 68 094 | 100 % | |
| 4 `deriveStatus` — Wert vorhanden | 68 046 | 99,9 % | |
| 4 — Wert fehlt | **48** | 0,1 % | **dünn** |
| 5 `deriveParent` | 68 094 | 100 % | |
| 6 `deriveOptionals` | 68 094 | 100 % | |
| 7 `deriveTimestamps` | 68 094 | 100 % | |
| 8 `deriveArchiveState` | 68 094 | 100 % | |
| 9 `deriveBody` | 68 094 | 100 % | |
| 0 — unlesbare Datei | **149** | 0,2 % | |

Jeder Ableiter wird **mindestens einmal pro geladenem Element** durchlaufen —
anders als bei `markParentCycles`, wo zwei Dateien die ganze Deckung trugen.
Die Hauptpfade sind dicht gedeckt.

**Dünn sind die Ausnahmepfade.** Dort zählt, wie viele der 3317 aufgezeichneten
Aufrufe den Code überhaupt in ihrer Ausgabe zeigen:

```
incomplete:description  344     archive:not_done   18
incomplete:acceptance   305     parent:hierarchy   17
file:unreadable          87     title:h1_mismatch  16
id:mismatch              62     missing:created    10
parent:orphaned          45     type:derived        9
unknown:status           34     unknown:priority    9
frontmatter:unreadable   29     missing:status      8
                                missing:updated     7
                                missing:title       6
                                type:folder         4
                                id:derived          4
```

**Vier Codes hängen an ≤ 7 Aufrufen:** `type:folder` (4), `id:derived` (4),
`missing:title` (6), `missing:updated` (7).

**Vorschlag, nicht dringend:** vor dem Schnitt je eine Fixture für
`type:folder` und `id:derived`. Beide sitzen in Ableiter 1 und 2 — also genau
dort, wo die Abhängigkeit `id → type` liegt, und ein vertauschter Schnitt wäre
dort still. Für `missing:title` und `missing:updated` halte ich die vorhandene
Deckung für ausreichend, weil ihre Ableiter keine Eingabe von anderen beziehen.

Wenn du die zwei Fixtures willst, gehören sie in dasselbe Testfenster wie
TSK-016 — sie kosten je ein Szenario im Korpus, nichts unter `test/`.

## 4b. Was in S3 als Kommentar mit hinein muss

Nachgetragen am 22.09., nachdem die drei Fixtures gebaut und gemessen waren.

**Die Reihenfolgekette** `id → type → parent`, mit dem Zusatz, dass ihre
Verletzung **still** ist — kein Absturz, nur ein anderes Ergebnis. Gemessen
durch `EPIC-900.md` unter `tasks/` im Szenario `id-derived`: über das Präfix
wird es ein `epic` und trägt `type:derived` + `type:folder`; ohne Präfix bliebe
der Typ `null` und `type:derived` verschwände.

**Die `parent`-Invariante** aus Abschnitt 3 und **der `assignee`-Fall** — beide
wörtlich, weil eine Inkonsistenz, die jemand als Schlamperei liest und behebt,
gefährlicher ist als eine, die offensichtlich Absicht ist.

**Der Ordner-Zweig der Typableitung ist unerreichbar.** `TYPE_DIR` ist nach Typ
verschlüsselt (`epic → epics`), abgefragt wird es mit dem Ordner
(`TYPE_DIR['tasks']`) und ist deshalb immer `undefined`; der Zweig darunter
sucht im Archiv nach einem Typ, dessen Ordner `archive` heißt, und findet
keinen. **`type:derived` kommt ausschließlich aus dem Präfix, nie aus dem
Ordner.** Gemessen im Szenario `type-folder`: `lose-notiz` und
`lose-archiv-notiz` bekommen `type:folder` und kein `type:derived`. Wer beim
Schneiden den vermeintlich gemeinten Weg herstellt, gibt beiden einen Typ — und
das Orakel sähe es nicht. Jetzt hält es der Korpus.

**Die Grenze der Memo-Harmlosigkeit.** Der `ctx.kids`-Memo ist heute
folgenlos, weil in dieser Runde **kein Kommando die Elternschaft verschieben
kann**: `set` nimmt kein `--parent` (`SETTABLE_FIELDS`, `nj:27`), `doctor --fix`
fasst `parent` nicht an, `rm` leitet nach dem Schreiben gar nicht neu ab. Das
sind Eigenschaften dieser Runde, **keine Zusicherungen der Spezifikation** — § 4
sieht Re-Parenting ausdrücklich vor. Sobald ein Verb die Elternschaft
verschiebt, wird der Memo im selben Moment zu einem echten Fehler, und kein
Netz zeigt ihn an; eine Fixture dafür ist heute nicht baubar, weil der
auslösende Zustand per Kommandosatz unerreichbar ist. Die Frage ist nicht *ob*
das Verb kommt, sondern *wann* — und dann gehört die Fixture in denselben
Schritt, nicht danach.

**Die in S2 gelöschte Begründung der Map** — O(n²), 971 ms, § 13, und dass die
Einfügereihenfolge die Scan-Reihenfolge ist, weshalb die unsortierten Aufrufer
ihre Ausgabe byte-genau behalten. Der neue Kommentar sagt noch „in scan order",
aber nicht mehr, warum das zählt. Auflage des Leads, ausgelöst durch Verifier II.

## 5. Was diese Karte NICHT beantwortet

Ob der Schnitt verhaltensneutral ist. Das entscheidet der Replay danach, nicht
diese Analyse. Die Karte sagt nur, **wo** es schiefginge: an der
`parent`-Normalisierung (rückwirkender Bruch von S2), an der Kette
`id → type → parent`, und an `assignee`, wenn jemand es „einheitlich" macht.
