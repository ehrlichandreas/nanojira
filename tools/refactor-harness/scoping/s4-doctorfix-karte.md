# S4 — die Karte vor dem Schnitt

`doctorFix` (`lib/cmd-doctor.ts:139-288`, 150 Zeilen — `cmdDoctor`s Aufruf davor
und `fixSkip` davor nicht mitgezählt). Analyse, kein Eingriff. `test/` wurde
nur gelesen; Digest davor und danach `64ad0610` (Bezugspunkt `oracle-frozen-4`,
per `tools/blindness-matrix/run.js`s `testDigest()`).

## 0. Vorarbeit: die Matrix war blind, nicht die Nadel

`tools/blindness-matrix/run.js`s Nadel `rm-dependents` traf 0× statt 2× (S4s
Auftrag, Verifier IIs Fund) — behoben, Text auf `(d: Element) =>` nachgezogen.
Beim Nachziehen zeigte sich ein zweiter, größerer Fehler: **jede** Mutation
eines `lib/*.ts`-Moduls war seit der ESM-Umstellung tot. Der injizierte
`__hit()`-Schnipsel rief `require('fs')` — in einer Datei mit echtem `export`
ist `require` kein Global mehr, jeder Treffer crashte mit `ReferenceError:
require is not defined`, was die Matrix als „RED WITHOUT HIT (mutant side
effect?)" meldete statt als Treffer. Betraf nicht nur `rm-dependents`, sondern
jede Mutation in `lib/`. Behoben: `HIT` ist jetzt `hitSnippet(target)` — für
`nj` (bleibt CommonJS) die alte `require`-Form, für jedes `lib/*.ts` (ESM) ein
`import * as __fs from 'fs'` unter einem Namen, den keine Quelle schon bindet.
Ohne diese Korrektur wäre jede Deckungsaussage in Abschnitt 4 unten Zufall
gewesen — die Matrix hätte nicht gemessen, sondern geraten.

## 1. Acht Schritte laut § 14 — plus ein neunter, der nicht mitgezählt wird

| # | Schritt | Zeilen (rel.) | liest | schreibt | Codes |
|---|---|---|---|---|---|
| — | mtime-Schnappschuss | 164–169 | jede Datei (`mtimeIso`) | `mtimes`-Map | — |
| 1 | `id`/`type` in Frontmatter schreiben | 171–183 | `fields`, `parsed`, `problems` | Datei (`atomicWrite`), `actions` | `id:derived`, `type:derived` |
| 2 | Datei auf `id` umbenennen | 185–194 | `el.id`, `el.file` | Dateiname, `actions`/`notes` | `id:mismatch` |
| 3 | in den richtigen Typ-Ordner verschieben | 196–212 | `el.id`-Präfix, `el.type`, `el.archived` | Dateiname, `actions`/`notes` | `type:folder` |
| 4 | Tombstones nachtragen | 214–227 | `el.id`, `.ids/`-Inhalt | `.ids/<id>`, `actions`/`notes` | `id:no_tombstone`, `backlog:ids_missing` |
| 5 | `status`/`created`/`updated` schreiben | 229–244 | `fields`, `mtimes`, `parsed` | Datei, `actions` | `missing:status`, `missing:created`, `missing:updated` |
| 6 | H1 aus `title` ziehen | 246–252 | `el.title`, `el.body` | Datei, `actions` | `title:h1_mismatch` |
| 7 | verwaiste `.nj-tmp-*` löschen | 254–265 | Verzeichnisinhalt | Dateisystem, `actions` | `backlog:stray_tmp` |
| 8 | Index neu aufbauen (No-op) + Bericht | 267–287 | — | `ctx`, `findings` fürs Reporting | — |

Der mtime-Schnappschuss steht nicht in § 14s Liste (die zählt acht), ist aber
exakt so eine Auflage wie jeder der acht Schritte — siehe Abschnitt 2. Analog
zu S3s Befund „neun statt acht Ableiter": auch hier ist die Zahl in der
Spezifikation eine Absicht aus der Planung, keine vollständige Aufzählung
dessen, was der Code tut.

**Was die Schritte teilen (→ `fixCtx`):** `actions: string[]`, `notes:
string[]`, `guard(el)` (überspringt unlesbare/kaputte Frontmatter, § 7 "keine
Information darf verschwinden"), `absent(el, k)` (leer zählt bei bekannten
Feldern als fehlend, § 14), die `mtimes`-Map und `rename()` (verschiebt den
mtime-Eintrag mit). Jeder Schritt lädt sich seinen `ctx` **selbst** frisch
(`reload()`) — das ist kein gemeinsamer Zustand, sondern bewusst pro Schritt
neu, weil Schritt *n* die Schreibungen von Schritt *n-1* sehen muss (§ 14: „the
tombstone backfill claims the frontmatter id").

## 2. Die Reihenfolge — eine echte Auflage, zwei falsche Begründungen und eine Kontrolle, die sie auffängt

**Echt und gemessen:** der mtime-Schnappschuss muss vor Schritt 1 laufen. Probe
gebaut (`/tmp`, außerhalb des Repos): eine Datei ohne `id`, `created`,
`updated`, mtime von Hand auf `2020-01-01` gesetzt. Mit dem Schnappschuss vor
Schritt 1 (Ist-Zustand): `created` = `2020-01-01T00:00:00Z` — richtig. Den
Schnappschuss hinter Schritt 1 verschoben (Mutant, sonst identisch): `created`
= der Zeitpunkt des Testlaufs — Schritt 1s `atomicWrite` hat die mtime schon
überschrieben, bevor sie gelesen wurde. Genau die Auflage, die der bestehende
Kommentar nennt ("the true mtime has to be taken before anything runs"), jetzt
mit Zahlen belegt statt nur behauptet.

**Behauptet, aber nicht die Ursache, die im Kommentar steht:** Schritt 2 vor
Schritt 4 — der Kommentar sagt, die Tombstone-Vergabe „claims the frontmatter
id, so it must run after the rename, or it would claim the wrong number". Probe
gebaut: eine Datei `TSK-001.md` mit Frontmatter-`id: TSK-002` (Mismatch), ohne
Tombstone für `TSK-002`. Mit der Ist-Reihenfolge (2 vor 4): Umbenennung zu
`TSK-002.md`, danach Tombstone für `TSK-002`. Mit 2 und 4 vertauscht
(Mutant): **identischer Dateisystem-Endzustand** — `TSK-002.md` existiert,
`.ids/TSK-002` existiert. Der Grund: `deriveId` (`lib/load.ts`) setzt `el.id`
schon beim ersten Laden auf den Frontmatter-Wert, unabhängig vom Dateinamen —
die Umbenennung ändert `el.id` nicht, sie ändert nur, wie die Datei heißt. Die
im Kommentar behauptete Gefahr ("claim the wrong number") tritt für **keine**
ID-Vergabe ein, weil `doctor --fix` nie eine neue ID vergibt (das tut nur
`allocateId` in `nj new`) — es gibt hier keine "Nummer", die "geclaimt" werden
könnte, richtig oder falsch. Das ist derselbe Befund wie bei S3s
Ordner-Zweig der Typableitung: eine Begründung, die im Code nicht mehr trägt.

**Die Entscheidung bleibt trotzdem richtig — aus einem anderen Grund.**
`test/edge/exit-doctor-fix.js` (Zeile ~187) pinnt `fixed[]` explizit
**in Schritt-Reihenfolge** ("Steps run in this order" · § 14), unabhängig vom
Dateisystem-Endzustand: mit 2 und 4 vertauscht meldet meine Probe
`fixed: ["created 1 missing tombstone…", "renamed …"]` statt
`["renamed …", "created 1 missing tombstone…"]` — byte-verschieden, und genau
das prüft dieser Test in mehreren Szenarien. Eine vertauschte Reihenfolge wäre
hier also **auch ohne** die Compiler-Kontrolle unten vom Orakel/Replay rot
geschlagen worden — die Kontrolle unten macht daraus zusätzlich einen
Compile-Fehler, bevor überhaupt getestet wird.

**Frei:** Schritt 7 (verwaiste Temp-Dateien) liest nichts, was ein anderer
Schritt schreibt, und schreibt nichts, was ein anderer liest — reine
Aufräumarbeit am Dateisystem, unabhängig plazierbar. Schritt 6 (H1 aus
`title`) liest `el.title`, das kein vorheriger Fix-Schritt ändert (nur die
normale Ladephase in `deriveTitle`). Beide sind aber trotzdem Teil der
**gemeldeten** Reihenfolge (§ 14, `exit-doctor-fix.js`) — "frei" heißt hier:
kein *funktionaler* Unterschied im Dateisystem, nicht "das Orakel ist ihm
gegenüber blind".

**Folge für den Schnitt:** die Reihenfolge 1→8 (plus der Schnappschuss davor)
bleibt eine harte Kette — nicht weil jedes Paar funktional kollidiert (das tut
nur der Schnappschuss vs. Schritt 1 nachweislich), sondern weil § 14 und
`exit-doctor-fix.js` die **gemeldete** Reihenfolge als Vertrag behandeln. Der
Compiler sollte deshalb die volle Kette 0→8 durchsetzen, nicht nur das eine
Paar mit echtem Dateisystem-Effekt.

## 3. Was NICHT geteilt wird — und wo ein Schnitt trotzdem etwas verschieben kann

Jeder Schritt ruft `reload()` (→ `context({lenient: true, tolerateConfig:
true})`) **selbst**, unabhängig von den anderen. Eine Versuchung beim
Schneiden: den `ctx` **einmal** laden und an alle Schrittfunktionen
durchreichen, um `reload()` zu sparen. Das wäre ein stiller Verhaltensbruch —
Schritt 2 muss Schritt 1s Schreibungen sehen, Schritt 5 Schritt 2/3s
Umbenennungen (der `mtimes`-Eintrag ist extra deshalb pfad-, nicht ID-basiert
und wird bei jeder Umbenennung nachgezogen). Jede Schrittfunktion muss ihren
eigenen `reload()`-Aufruf behalten.

## 4. Deckung — gemessen über die Blindheits-Matrix

Die drei vom Auftrag genannten Nadeln, **nach** der Reparatur in Abschnitt 0
(Ergebnis vorher = jetzt, da noch nicht geschnitten — dies ist der
Vergleichspunkt für Abschnitt 3 der Aufgabe):

| Nadel | BLIND | COVERING |
|---|---|---|
| `fix-notes` | 0 | 2 (`doctor-fix-surface.js`, `exit-doctor-fix.js`) |
| `fix-fixed` | 1 — `doctor-fix-surface.js` (2 Treffer) | 2 (`encoding-json-key-order.js`, `exit-doctor-fix.js`) |
| `fix-prose-warn` | 1 — `doctor-fix-surface.js` (1 Treffer) | 0 |

`fix-fixed` und `fix-prose-warn` sind **teilweise blind** — nicht neu, nicht
durch S4 verursacht, gehört aber in den Vergleich nach dem Schnitt: wird eine
der beiden Nadeln durch die Umstrukturierung **zusätzlich** blind (eine dritte
Stelle, an der `doctor-fix-surface.js` sie jetzt auch nicht mehr sieht), ist
das eine Regression; bleibt es bei den bestehenden zwei BLIND-Zeilen, nicht.

Volles Ergebnis als Artefakt gesichert:
`tools/refactor-harness/scoping/artifacts/matrix-64ad0610-51fd805a.json`
(Code-Identität `51fd805a`, 23 Dateien — der Stand nach S3, vor diesem
Schnitt). `--compare` dagegen nach dem Schnitt läuft automatisch gegen genau
diesen Stand.

Auffällig, aber außerhalb des Auftrags: `read-extra-problem` ist mit 36
BLIND-Suiten die mit Abstand blindeste Nadel im ganzen Baum (u. a.
`ac-07-concurrency.js` mit 100 Treffern) — kein `doctorFix`-Fund, wird hier nur
vermerkt, weil die volle Matrix ohnehin lief.

## 5. Was für den Schnitt zu tun bleibt

`fixCtx` (Abschnitt 1) plus eine Funktion je Schritt (0 bis 8, neun
Funktionen — der Schnappschuss zählt mit, siehe Abschnitt 1). Die Kette 0→8
wird über Zwischenstand-Typen erzwungen, wie bei S3s `Skeleton → WithId → …`:
jede Schrittfunktion verlangt genau den Zwischenstand der vorigen, keinen
anderen — eine vertauschte Reihenfolge im Aufruf wird ein echter
`tsc`-Fehler, nicht nur ein Kommentar. Anders als bei den Ableitern gibt es
hier keine wachsende Nutzlast (kein Schritt liefert ein Datenfeld, das der
nächste braucht) — der Zwischenstand ist ein reiner Phantomtyp, der die
Aufrufreihenfolge markiert, während `actions`/`notes`/`mtimes` als dieselbe
gemeinsame, mutierte Struktur durchgereicht werden.

## 6. Was diese Karte NICHT beantwortet

Ob der Schnitt verhaltensneutral ist — das entscheidet der Replay danach.
Auch nicht beantwortet: ob die Blindheit von `fix-fixed`/`fix-prose-warn`
(Abschnitt 4) behoben werden sollte — das ist eine Entscheidung für den Lead,
keine, die dieser Schnitt automatisch trifft.
