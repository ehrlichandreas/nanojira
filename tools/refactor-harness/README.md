# S0 — Baseline-Harness

Das Sicherheitsnetz für den Refactor. Es beantwortet genau eine Frage:
**verhält sich dieses `nj` noch exakt so wie das eingefrorene?**

Das Orakel unter `test/` beantwortet eine andere: *ist dieses `nj`
spec-konform?* Beide werden gebraucht. Ein Refactor kann spec-konform bleiben
und trotzdem Bytes, `_problems`-Reihenfolge oder die Reihenfolge der
`--fix`-Aktionen verschieben — das sieht nur dieser Harness.

## Benutzung

```sh
NODE=…/runtime/darwin-arm64/bin/node

# einmalig, auf der eingefrorenen Revision
$NODE tools/refactor-harness/baseline.js record --nj="$PWD/src/nj.ts"

# nach jedem Refactor-Schritt
$NODE tools/refactor-harness/baseline.js verify --nj="$PWD/src/nj.ts"
```

Der nj-Pfad ist **immer** explizit. Kein Default, kein PATH-Lookup, keine
Ableitung aus dem cwd. Eine Baseline gegen das falsche Binary ist schlimmer als
gar keine.

Das Beispiel oben zeigt die erste Aufzeichnung, gegen `c1-baseline`. Das ist
nicht mehr die einzige gültige Quelle — siehe „Aufzeichnungsquelle" unten,
**bevor** hier erneut aufgezeichnet wird.

## Exit-Codes

| Code | Bedeutung |
|---|---|
| `0` | unverändert (`verify`) bzw. Baseline geschrieben (`record`) |
| `1` | **Verhalten geändert** — mindestens ein Aufruf weicht ab |
| `2` | Aufruffehler (kein `--nj`, keine Baseline vorhanden) |
| `4` | **Deckungslücke** — ein Korpusteil konnte nicht laufen |
| `5` | Orakel war beim Aufzeichnen rot |
| `6` | **Veraltete Baseline** — `test/` hat sich seit der Aufzeichnung geändert |
| `7` | **Header und Korpus gehören nicht zusammen** — zwei Aufzeichnungen haben sich überlappt |
| `8` | **Urteil rot** (`verify`) — eine Orakel-Suite ist durchgefallen oder `scratch/verify.js` meldet ein ✗; die Liste steht unter `RED VERDICTS` |

**Welcher rote Lauf bedeutet was.** „Rot heißt zurückrollen" gilt für **Exit 1
und 8** und sonst für keinen Code:

| Code | Aussage über | richtige Reaktion |
|---|---|---|
| `1` | den **Prüfling** | zurückrollen auf den letzten grünen Schritt, nicht nachbessern |
| `8` | den **Prüfling** | wie `1` — die Suite oder der Check ist benannt |
| `2` | den Aufruf | Kommando korrigieren |
| `4`, `5` | die **Deckung** | Voraussetzung herstellen, erneut laufen |
| `6`, `7` | das **Instrument** | Baseline neu aufzeichnen |

Codes 4 bis 7 sagen nichts über `nj`. Wer ihretwegen zurückrollt, wirft gute
Arbeit aus einem Grund weg, der nichts mit ihr zu tun hat — beinahe passiert,
als ein Kontrolllauf gegen **unverändertes** `nj` rot kam, weil zwei Läufe sich
dasselbe Scratch teilten. Daraus die Regel, an der die Codes hängen:
**ein Zusammenstoß darf nie die Form eines Befunds tragen.**

**Code `8` gibt es seit DECISIONS 90 B2.** Vorher las `verify` nur den
Byte-Diff: mit roter AC-15 druckte es `oracle suite FAILED` und `passed 63/64`
und endete trotzdem mit **0** und „BEHAVIOUR UNCHANGED". Eine rote
verdict-only-Suite (`stdout-epipe.js`, die preload-instrumentierten
`fault/det-*`) oder ein Bein, das am Shim vorbeiläuft, war damit **unsichtbar**
— das Instrument musste von Hand gelesen werden. Jetzt zählt jedes Urteil.

Vorrang, wenn mehreres zusammenkommt: **`8` vor `4` vor `1`**, gemeldet wird
alles. `8` steht vor `1`, weil ein Schritt mit benannten, gewollten Diffs
(DECISIONS 88) mit Exit 1 plus Durchsicht der Liste abgenommen wird — eine
gleichzeitig rote Suite ginge in diesem erwarteten Exit 1 unter. Bei einer
Deckungslücke wird der Byte-Diff wie bisher nicht gezeigt; ein rotes Urteil
schon.

Code `4` ist der wichtigste. `test/run-all.js` meldet ohne gesetztes `NJ`
für jede Suite „cannot run" und endet trotzdem ohne Drama — korrekte Black-box-Disziplin
für ein Orakel, das vor seiner Implementierung geschrieben wurde, aber im
Refactor eine Falle: ein vergessenes Env würde eine echte Regression als
harmloses Überspringen tarnen. Deshalb trennt dieser Harness „cannot run" hart
von „failed" und bricht bei jeder Lücke selbst ab. **Ein Durchlauf, der nichts
geprüft hat, darf nie wie ein bestandener aussehen.**

**Erwartete Lücken: `expected-gaps.js`.** Manche Suiten sind hier
**absichtlich** CANNOT RUN — `edge/hardening-njrc-foreign-link.js` (`718c230`)
braucht root oder einen Symlink eines fremden uid, den ein normales Konto nicht
hat. Eine dauerhafte, umgebungsbedingte Lücke darf nicht jedes Gate zu Exit 4
machen — und nie stillschweigend übergangen werden. Deshalb eine explizite
Liste, je Eintrag Suite und Grund. `baseline.js` und `gate.js` melden jede
getroffene Lücke **mit Namen** („expected gaps … NOT a pass, not a stop"),
jede Lücke **nicht** auf der Liste bleibt Exit 4. Eine Suite auf der Liste ist
zugleich verdict-only: ihre Aufrufe kommen nie in den Korpus, sonst hinge der
Korpus davon ab, ob die aufzeichnende Maschine sie laufen lassen konnte. Ein
Eintrag ist eine Entscheidung wie `VERDICT_ONLY_SUITES`: mit Grund und dem
Commit, der die Suite umgebungsabhängig gemacht hat.

## Aufbau

| Datei | Zweck |
|---|---|
| `nj-shim` | steht überall dort, wo ein nj-Pfad erwartet wird; leitet weiter und zeichnet auf |
| `lib/record.js` | Normalisierung, Backlog-Snapshot, mtime-Pinning |
| `fixtures.js` | 29 Szenarien: alle Kommandos, alle erreichbaren Fehlercodes, die Liste aus review-verifier.md §3 |
| `baseline.js` | Treiber: Korpus fahren, aufzeichnen, vergleichen |
| `expected-gaps.js` | Suiten, die hier absichtlich CANNOT RUN sind, je mit Grund (siehe Exit-Codes) |
| `gate.js` | das DECISIONS-90-B1-Gate in einem Befehl: Wegwerf-Worktree, eingefrorenes `test/`, Replay, dann `run-all.js` (siehe unten) |
| `scratch/` | die Ad-hoc-Sonden des Verifiers, aus `/tmp` gerettet — dort waren sie nach einem Neustart weg und `record` brach mit Code 4 ab |

Eine Sonde zählt nur, wenn sie **Aufrufe beiträgt**. „Ohne Fehler gestartet"
ist etwas anderes: acht der Sonden hatten den nj-Pfad absolut verdrahtet,
ignorierten den übergebenen und liefen damit am Shim vorbei — sie trugen nichts
bei und prüften obendrein ein anderes nj als das unter Test, während die
Zusammenfassung „11/11 scripts executed" meldete. Wer 0 Aufrufe liefert, mit
Status ≠ 0 endet oder gar nicht lädt, landet jetzt unter „cannot run" und damit
im harten Abbruch.

`verify.js` ist davon ausgenommen und steht in `DIRECT_ONLY_SCRIPTS`: die Sonde
liest nj's **Quelltext** und zerlegt dessen `SEVERITY`-Tabelle. Mit dem Shim
findet sie die Tabelle nicht, stirbt mittendrin und hinterlässt eine
abgeschnittene Spur im Korpus — schlimmer als gar keine. Sie läuft direkt, ihr
Urteil zählt, und sie steht als `notRecorded` im Header.

**Wie ihr Urteil zählt.** `verify.js` druckt als letzte Zeile
`N/M checks passed, K failed` und endet bei jedem ✗ mit Exit 1 (vorher immer
0, v3-preflight.md A4). `baseline.js` liest genau diese Zeile (`VERDICT_LINE`):
Zeile da und K > 0 → **rotes Urteil** (`8`), **gleich mit welchem Exit** —
die Zeile ist der Vertrag, der Exit nur die Rückversicherung (I1: mit
`process.exitCode = 0` lief ein ✗ vorher als „ran and passed" durch); jede
✗-Zeile wird einzeln gemeldet. Zeile fehlt, oder „0 failed" mit Exit ≠ 0 →
die Sonde ist nicht sauber zu Ende gelaufen, das ist eine
**Deckungslücke** (`4`), kein Befund. Am Exit allein ist ✗ und Absturz nicht
zu unterscheiden — ein ungefangener Fehler endet auch mit 1. Beim `record` führt
ein ✗ wie eine rote Suite zu Exit `5`.

Zwei ✗ gab es vorher, beide stehen nicht mehr: „no backlog at all" lief in
`$HOME/Downloads`, das es in einer Agenten-Session nicht gibt (jetzt ein
frisches leeres Verzeichnis), und der Pin „NJ_BACKLOG at configless dir"
prüft jetzt das v3-Verhalten `invalid_backlog_env` (DECISIONS 88/90). Gegen
v2 (`5b666a0:dist/nj`) ist dieser Pin deshalb **korrekt rot**, 122/123; gegen
V3-1 `d517837` 123/123.

Der Pin „SEVERITY has 30 distinct codes" war eine nackte Zahl. V3-2 fügte
`layout:misplaced` und `backlog:unreadable_dir` gewollt hinzu (DECISIONS
91/93), es wurden 32, und der Pin ein stehendes ✗ ohne Fehler — auf `9fa11d9`
das einzige Rot des Gates neben den erwarteten ac-23/ac-24. Jetzt prüft er
gegen die Spec statt gegen eine Zahl: die Problemcode-Tabelle aus § 7 der
`docs/SPECIFICATION.md` **des Schritts** ist das geschlossene Vokabular. Jeder
Code in `SEVERITY` muss darin stehen, mit der Doctor-Stufe der Tabelle („—" =
`null`); jeder Code der Tabelle muss deklariert sein, außer denen, deren
Schritt noch nicht gelandet ist (`PENDING`, mit Schritt benannt:
`backlog:status_stale` V3-3, `backlog:legacy_layout` V3-4). Gegenprobe: eine
Spec-Kopie mit `id:derived` als `error` → ✗ „wrong level: id:derived".

Die übrigen Sonden (`bc.js`, `r3.js`, `r3bc.js`, `r6.js` …) drucken zum Teil
ebenfalls ✗ — Befunde früherer Runden, gegen v2 und V3-1 identisch (1, 2, 1,
10). Das sind **keine** Urteile: ihre nj-Aufrufe laufen durch den Shim und
werden byte-verglichen, das ist ihr Gate.
| `baseline/header.json` | nj-sha256, `test/`-Digest, Suitenliste, Node, Plattform, Aufrufzahlen, Deckungslücken |
| `baseline/corpus.ndjson.gz` | ein Datensatz je Aufruf (gzip: ~3 MB statt ~29 MB) |

Code `6` verdient eine eigene Erklärung. Der Orakel-Teil des Korpus ist nur
vergleichbar, solange `test/` dasselbe Verhalten hat. Verglichen wird deshalb
beides: die **Suitenliste** (fängt neue und entfernte Dateien) und ein
**Digest** (fängt eine Suite, die sich ändert, ohne ihren Namen zu ändern —
das würde die Liste allein durchwinken).

Der Digest läuft über **ausführbaren Testinhalt**, nicht über den ganzen Baum:

```sh
# aus der Projektwurzel, nicht aus test/
find test/ac test/edge test/fault test/golden test/lib test/run-all.js \
     test/stress -type f | sort | xargs shasum -a 256 | shasum -a 256
```

Die **Pfade gehen in den Hash ein**, das `test/`-Präfix ist also Teil des
Werts. Dasselbe Kommando aus `test/` heraus ergibt einen anderen Digest — nicht
weil der Inhalt ein anderer wäre, sondern weil die Zeilen anders lauten. Die
Implementierung normalisiert deshalb auf `test/<...>`; ein Digest über eine
Kopie des Baums liefert denselben Wert wie über das Original.

`run-all.js` ist mit drin, obwohl es im Wurzelverzeichnis liegt: es ist kein
Dokument, sondern der **Treiber**. Es entscheidet, welche Suiten eingesammelt
werden und was als `cannot run` gilt — und genau diese Klassifizierung war die
Stelle, an der „gelaufen" dreimal mit „hat geprüft" verwechselt wurde.

Der Geltungsbereich steht als `testDigestScope` im Header — ein Digest ohne
benannten Bereich ist in einem halben Jahr nicht mehr nachvollziehbar.

**Warum nicht über ganz `test/`:** eine einzige ergänzte Zeile in
`AMBIGUITIES.md` hat den Digest springen lassen und hätte jeden `verify`
abgebrochen — für eine Datei, die keine Suite je liest. Ein Schutz, der bei
einem Kommentar anschlägt, bringt Leute dazu, Code 6 wegzuklicken; und dann
geht der Fall durch, für den er gebaut wurde. Prosa unter `test/`
(`AMBIGUITIES.md`, `AC-MATRIX.md`, `README.md`) bleibt deshalb draußen.
Gegengeprüft an Kopien: geänderte Suite → weicht ab, geändertes Golden →
weicht ab, geänderte Doku → unverändert.

Weicht er ab, ist die Baseline veraltet — **nicht** nj regressiert. Genau das
sagt der Abbruch dann auch, damit niemand den Fehler in nj sucht.

Aufgezeichnet wird pro Aufruf: `argv`, `cwd`, die relevante Env
(`NJ_NOW`/`NJ_FAULT`/`NJ_BACKLOG`), `exit`, `stdout`, `stderr` und danach der
SHA256 **jeder** Backlog-Datei, das `.ids/`-Listing und die Anzahl
`.nj-tmp-*`.

## Gate für einen Schritt, der Suiten hinzufügt (DECISIONS 90 B1)

Der Korpus pinnt den `test/`-Digest, und eine neue Suite macht die
Aufzeichnungsquelle rot. Also läuft weder `verify` gegen das `test/` des
Schritts (Exit 6) noch ein neues `record` gegen `c2-baseline` (Exit 5).
Verfahren: **eingefrorenes Orakel replayen, neues Orakel getrennt laufen.**

In einem Befehl:

```sh
$NODE tools/refactor-harness/gate.js --step=<commit> --frozen=<letzter oracle-frozen-Tag>
# z. B. V3-1, gegen den c2-Korpus (bis 90a8347):
$NODE tools/refactor-harness/gate.js --step=d517837 --frozen=oracle-frozen-7
```

`--frozen` muss zum Korpus passen, den der laufende Harness mitbringt (sein
`header.json` nennt den Digest) — seit dem c3-Korpus ist das
`oracle-frozen-8`. `gate.js` prüft das vorab (`baseline.js digest` druckt
beide Digests) und bricht bei einer Fehlpaarung sofort mit Exit 2 ab, den
passenden Tag benannt — statt nach dem Aufbau mit Exit 6 „veraltete
Baseline, neu aufzeichnen", was hier der falsche Rat wäre.

`gate.js` tut genau das Folgende und fasst den Hauptarbeitsbaum und dessen
Index nie an (nur git's eigene Buchführung unter `.git/worktrees/`, die es
wieder entfernt):

1. Wegwerf-Worktree am Schritt, angelegt als `<tmp>/projects/nanojira` mit
   `<tmp>/runtime/<platform>` → Runtime dieses Node. Das eingefrorene AC-15
   sucht die Runtime vier Ebenen über `test/ac/` (v3-preflight.md A2); ohne
   dieses Layout wäre es im Wegwerf-Worktree rot und der Replay Exit 8.
2. `test/` **erst löschen**, dann `git checkout <frozen> -- test`. Nur
   `checkout` reicht nicht: es überschreibt, löscht aber nicht — ab V3-1 bleibt
   `ac/ac-21-backlog-location.js` liegen, und der Replay bricht mit Exit 6 ab
   (Suitenliste geändert). Geprüft in beide Richtungen: die Dateien auf der
   Platte sind genau die Liste von `git ls-tree -r <frozen> -- test` (eine
   unversionierte Extradatei sieht `git diff` nicht, I6), und ihr Inhalt ist
   der des Tags (`git diff --quiet`).
3. **Dieser** Harness über den des Schritts kopiert: das Instrument ist das,
   das `gate.js` gerade ausführt (Commit und „uncommitted" stehen im Kopf der
   Ausgabe), nicht das, mit dem der Schritt ausgeliefert wurde — ein Schritt
   vor DECISIONS 90 B2 würde sonst nicht auf Urteile gaten. Mit
   `--harness=<rev>` stattdessen der Harness von `<rev>`, samt seinem Korpus:
   so läuft ein **altes** Gate (V3-1 gegen `oracle-frozen-7`) erneut, mit einem
   Commit, der den c2-Korpus noch trägt (etwa `aa584b1`). Der laufende Harness
   allein kann das nicht, er bringt den **aktuellen** Korpus mit.
4. `baseline.js verify --nj=<worktree>/dist/nj` — der Replay.
5. `test/` ebenso gegen `--tests=<rev>` getauscht (Standard: der Schritt
   selbst) und `test/run-all.js <worktree>/dist/nj` — das Urteil der neuen
   Suiten. Übersprungen, wenn der Replay `2`, `6` oder `7` meldet: dann liegt
   der Fehler im Aufruf oder Instrument, und `run-all` änderte daran nichts (I5).
6. Worktree entfernen (`--keep` lässt ihn samt `gate.log` stehen).

**Aufräumen, auch wenn es schiefgeht** (I2, I3). Jeder Kindprozess läuft in
**eigener Prozessgruppe**. SIGINT, SIGTERM und SIGHUP halten erst die ganze
Gruppe an (`baseline.js`, seine Suiten, deren `nj`-Aufrufe; nach 10 s SIGKILL),
warten auf ihr Ende, dann erst geht der Worktree — vorher lief der Replay nach
SIGINT noch eine Minute weiter, in einen gelöschten Worktree, auf einer
Maschine, auf der Perf gemessen wird. Ein Absturz von `gate.js` selbst räumt
über `uncaughtException` und `process.on('exit')` auf; ein Log, das nicht mehr
schreibbar ist, wird abgeschaltet statt den Lauf mitzureißen. Was SIGKILL
hinterlässt, räumt der **nächste Start**: jede Gate-Wurzel trägt `owner.pid`,
und `nj-gate-*`-Wurzeln sowie `nj-s0-*`-Scratch, deren Besitzer tot ist,
werden entfernt (samt `git worktree prune`); eine Wurzel ohne `owner.pid`
(älteres `gate.js`) wird nur gemeldet. Das Scratch eines angehaltenen
`baseline.js` (nach dessen pid benannt) entfernt `gate.js`, sobald die Gruppe
weg ist. `baseline.js` selbst hat bewusst **keine** Signal-Handler: es läuft
als eine synchrone `spawnSync`-Schleife, ein JS-Handler käme nie dran — und
schon sein Registrieren schaltet Nodes „bei SIGTERM sterben" ab; so eine
Fassung lebte bis zum SIGKILL 10 s später weiter (beim Testen gefunden).
Gemessen: SIGINT, SIGTERM, SIGHUP mitten im Replay → Gate weg nach ~2 s, keine
Kindprozesse, keine Wurzel, keine Registrierung, kein `nj-s0-*`; ein
erzwungener Absturz von `gate.js` 8 s nach dem Start ebenso (Exit 2).

`--nj=<pfad>` legt eine andere Datei als `dist/nj` in den Worktree
(Kandidat vor dem Commit, oder eine absichtlich kaputte Kopie als
Gegenprobe); die Suiten, die `dist/nj` selbst suchen (AC-15), sehen dieselbe.

Exit von `gate.js`: `8`, wenn der Replay `8` meldet oder eine `run-all`-Suite
durchfällt; sonst `4` bei jeder Lücke in einem der beiden Läufe (erwartete
Lücken aus `expected-gaps.js` ausgenommen, aber benannt); sonst der Exit des
Replays (`0`, `1`, `6`, `7`). `2`: Aufruf- oder Einrichtungsfehler. `128+n`:
durch Signal n angehalten, nach dem Aufräumen.
**`1` ist für einen Schritt mit benannten Diffs das erwartete Ergebnis** —
dann muss jeder gelistete Diff in eine benannte Klasse fallen (für V3-1: die
19 aus der Commit-Message von `d517837`).

Nach der Abnahme wird der Schritt die nächste `c`-Baseline und mit dem neuen
`test/` unter einem neuen `oracle-frozen`-Tag aufgezeichnet (DECISIONS 85/90).

## nj umschalten: `show >`, nicht `checkout --`

Beim Aufzeichnen und beim Zurückrollen wird `nj` zwischen Revisionen
umgeschaltet. Dafür gilt:

```sh
git show c1-baseline:nj > nj      # richtig — schreibt NUR den Arbeitsbaum
git checkout c1-baseline -- nj    # FALSCH — schreibt Arbeitsbaum UND Index
```

Beide liefern denselben Dateiinhalt, aber `checkout --` legt die Revision
zusätzlich in den **Index**. Der bleibt dort stehen, auch nachdem der
Arbeitsbaum längst wieder auf dem aktuellen Stand ist — `git status` zeigt dann
`MM nj`.

Das ist keine Kosmetik. Der Index ist **gemeinsam**: das nächste `git add nj`
eines beliebigen Beteiligten übernimmt den dort liegenden Stand in seinen
Commit. Einmal stand so die Rücknahme eines ganzen Refactor-Schritts im Index,
und ein Schritt-Commit hätte sie eingebaut — unter einer Message, die von etwas
anderem erzählt. Aufgefallen ist es nur, weil vor dem Commit `git status`
gelesen wurde.

Deshalb zusätzlich, vor **jedem** Schritt-Commit:

```sh
git diff --cached --name-only    # gegen die erwartete Dateiliste prüfen
```

## Aufzeichnungsquelle: nicht mehr immer `c1-baseline`

Bis TSK-018 war `c1-baseline` (die Revision vor dem Refactor) die einzig
sinnvolle Aufzeichnungsquelle, weil jeder Schritt bis dahin *verhaltenserhaltend*
sein sollte — jede Abweichung von `c1-baseline` wäre ein Fehler gewesen.
TSK-018 ist die erste **gewollte** Verhaltensänderung (EPIPE beim früh
geschlossenen Leser ist jetzt still statt eines Absturzes, DECISIONS 85): eine
Aufzeichnung gegen `c1-baseline` würde jetzt strukturell an `stdout-epipe.js`
scheitern, weil dessen Ergebnis gegen `c1-baseline` korrekt rot ist — `record`
bricht dann mit Exit 5 ab, obwohl nichts falsch lief.

Deshalb: **neue Aufzeichnungen laufen gegen `c2-baseline`** (der TSK-018-Fix-
Commit), und zwar gegen dessen **`dist/nj`**, nicht dessen `nj`. Seit dem
Modul-Split identifiziert der bloße Einstiegspunkt `nj` den Code nicht mehr
allein — er lädt zur Laufzeit `lib/*.ts` nach, `dist/nj` ist die eine Datei,
die den vollständigen gebündelten Stand trägt.

```sh
git show c2-baseline:dist/nj > /tmp/c2-dist-nj   # Kopie, NICHT den Arbeitsbaum umschalten
$NODE tools/refactor-harness/baseline.js record --nj=/tmp/c2-dist-nj
```

Der Arbeitsbaum bleibt dabei unangetastet — anders als beim `c1-baseline`-
Verfahren oben (`git show c1-baseline:nj > nj`, danach zurückschalten). Ein
Wechsel des Arbeitsbaums war dort nötig, weil `record --nj=` einen einzelnen
Dateipfad nimmt, `nj` aber `lib/` relativ zu sich selbst nachlädt; `dist/nj`
hat dieses Problem nicht, es ist bereits vollständig gebündelt, also reicht
eine Kopie an beliebigem Pfad.

`stdout-epipe.js` selbst ist als **verdict-only** in `baseline.js` eingetragen
(`VERDICT_ONLY_SUITES`, analog zu den preload-instrumentierten Suiten): wie
viel Ausgabe vor dem Schließen des Lesers ankommt, hängt vom Timing und lässt
sich nicht byte-genau aufzeichnen. Das Urteil (bestanden/durchgefallen) zählt
trotzdem zum Orakel-Gate.

Seit `3b563e8` steht auch **`ac/ac-15-no-dependencies.js`** dort: sein
Einzelkopie-Bein kopiert jetzt das nj unter Test statt `<project>/dist/nj` —
unter dem Harness also `nj-shim`, der allein nicht läuft (er braucht
`lib/record.js` neben sich). Durch den Shim rot, direkt grün; `record` lehnte
`c3-baseline` deshalb mit Exit 5 ab. „Läuft als einzelne Datei" ist genau die
Eigenschaft, die ein Stellvertreter nicht haben kann, also wird das Urteil am
echten nj genommen. Ein `— CANNOT RUN` einer verdict-only-Suite zählt wie
überall als Lücke (`4`), nicht als rotes Urteil.

Mit V3-4s `--fix`-G2-Runde kam **`edge/hardening-v3-1.js`** dazu, aus einem
anderen Grund als ac-15: seine F4- und D96-Beine machen das CWD selbst
unerreichbar (gelöscht, oder ein Vorfahre unsuchbar gemacht) und prüfen dann
njs eigene einzeilige `io_error`-Prosa. `nj-shim` ruft `process.cwd()` auf
seiner eigenen obersten Ebene auf, bevor es das echte nj überhaupt erreicht
(um dem weiterleitenden `spawnSync` ein explizites `cwd` zu geben) — und in
genau diesem kaputten CWD wirft `process.cwd()` selbst, ungefangen, was einen
18-zeiligen Node-internen Stack statt njs sauberer einzeiliger Meldung
ausgibt. Das echte nj wird gar nicht erst erreicht. Durch den Shim: rot.
Direkt: grün (637/637). Gleiche Form wie bei ac-15 — eine Eigenschaft, die
ein Stellvertreter nicht haben kann (hier: "überlebt einen CWD-Zugriff,
bevor das echte Binary überhaupt läuft") —, also wird das Urteil am echten
nj genommen.

**Die verdict-only-Menge gehört zum Korpus.** Eine Suite in der Menge hat
keine Aufrufe im Korpus, eine außerhalb hat welche. Wer mit einer anderen
Menge verifiziert, verschiebt jeden späteren Aufruf — gefunden vom
Implementer, als `gate.js` den Harness von `90a8347` (ac-15 verdict-only)
gegen den c2-Korpus (ac-15 aufgezeichnet) laufen ließ: ab ac-15 war jeder
Aufruf ein Label/argv-Versatz. Deshalb schreibt `record` die Menge als
`verdictOnlySuites` in den Header, und `verify` nimmt **die des Headers**,
nicht die dieses Harness (eine Abweichung wird als `note:` gemeldet). Header
von davor (c2, c3) nennen sie nur in `notRecorded`; daraus abgeleitet ergibt
sich für c2 `{stdout-epipe}` und für c3 `{ac-15, stdout-epipe}` — genau die
Mengen, mit denen sie aufgezeichnet wurden.

### Seit V3-1: `c3-baseline`

V3-1 ist abgenommen (DECISIONS 93), also ist **`c3-baseline` = `1e85263`** die
Aufzeichnungsquelle, nach derselben Regel wie `c2-baseline` (DECISIONS 85/90).
Aufgezeichnet in einem Wegwerf-Worktree, damit weder der Arbeitsbaum noch
unfertiges `test/` anderer hineinspielt:

```sh
# Worktree wie bei gate.js: <tmp>/projects/nanojira neben <tmp>/runtime/<platform>
git worktree add --detach <tmp>/projects/nanojira 3b563e8   # test/: AC-21 drin, AC-22 noch nicht
git -C <tmp>/projects/nanojira checkout <harness-commit> -- tools/refactor-harness
git show c3-baseline:dist/nj > /tmp/nj-c3-dist-nj
NJ_NODE=$NODE $NODE tools/refactor-harness/baseline.js record --nj=/tmp/nj-c3-dist-nj   # im Worktree
```

Ergebnis: 3586 Aufrufe (fixtures 1878, oracle 1473, scratch 235), Orakel
65/65, `verify.js` 123/123, nj `e5138d56…`, `test/`-Digest `c582855a…`; ein
direkt anschließendes `verify` gegen dieselbe Kopie: 0 Diffs / 3075
verglichen. **`oracle-frozen-8` = `3b563e8`**, das Commit, dessen `test/`
aufgezeichnet ist — `gate.js --frozen=oracle-frozen-8` passt zu diesem
Korpus, `oracle-frozen-7` nicht mehr (Exit 6).

## Parallele Läufe

Scratch-Wurzel und Rohdatei sind **pro Lauf** eindeutig (`nj-s0-scratch-<pid>`).
Vorher lagen beide auf festen Pfaden, und zwei gleichzeitige Läufe rissen an
denselben Fixtures. Das Ergebnis war von einer echten Regression **nicht zu
unterscheiden**: gleicher Exit 1, dieselbe Wand von Inhaltsdiffs, keine
unterscheidende Meldung.

Das ist schlimmer als ein seltener Fehlalarm. Die tragende Regel „rot heißt
zurückrollen, nicht nachbessern" ist nur so lange richtig, wie Rot etwas über
den Code aussagt. Wer sie bei einem Zusammenstoß befolgt, wirft einen sauberen
Schritt weg — und beim nächsten Mal glaubt er roten Läufen nicht mehr.

Die Determinismus-Eigenschaft leidet nicht: die Normalisierung faltet die
Wurzel zu `<FIXTURES>`, **bevor** irgendetwas aufgezeichnet wird. Zwei Läufe
mit verschiedenen Wurzeln liefern deshalb byte-identische Einträge — geprüft,
nicht angenommen.

Was bleibt: zwei gleichzeitige `record`-Läufe schreiben weiterhin dieselben
zwei Ausgabedateien. Dagegen steht **kein Lock**, sondern eine Erkennung — der
Header nennt den sha256 des Korpus, zu dem er gehört, und `verify` bricht bei
einer Fehlpaarung mit Code `7` ab. Ein hängengebliebenes Lock nach einem
Absturz ist genau die Fehlerform, die `nj` selbst ablehnt (§ 12); erkennen ist
hier ehrlicher als ausschließen.

### Ruhe für das Perf-Gate: messen, nicht schätzen

Die § 13-Schranken sagen nur dann etwas über `nj` aus, wenn während der Messung
sonst nichts läuft. Mehrere Agenten auf derselben Maschine sind der Normalfall,
nicht die Ausnahme.

**Load Average taugt als Ruhenachweis nicht.** Gemessen: 2,86, während
gleichzeitig **null** node-Prozesse liefen. Ein Minutenmittel klingt ab und
besteht deshalb aus Geschichte, nicht aus laufender Arbeit — wer darauf wartet,
wartet auf die Vergangenheit.

**Prozessnamen taugen als Ruhenachweis auch nicht — in beide Richtungen
falsch.** `pgrep -f 'bin/node' | wc -l` stand hier zuerst, hat sich aber als
falsch erwiesen: ein normal gestartetes `node -e '...'` im Hintergrund
enthält den vollen Pfad nicht und rutscht durch (Verifier II belegt: `npm run
perf` lief mit Exit 0, obwohl ein solcher Hintergrundprozess aktiv war).
Umgekehrt laufen auf dieser Maschine dauerhaft untätige node-Prozesse (MCP-
Server) — ein reiner Namenstreffer würde jede Messung blockieren, obwohl
nichts Last erzeugt. Was zählt, ist **Last, nicht Name oder Anwesenheit**:

```sh
ps -A -o pid=,ppid=,pcpu=,comm=      # eigene Kindprozesse ausschliessen (ppid)
```

`tools/perf.js` prüft genau das: ein fremder Prozess über 50 % oder die Summe
aller fremden Prozesse über 200 % bricht mit Exit 3 ab und nennt den
Prozess. Die Zahlen sind auf dieser Maschine gemessen, nicht geschätzt: fünf
Stichproben im Leerlauf summierten sich auf 70–114 % (WindowServer, ein
Bildschirm-Sharing-Helfer, ein Terminal, der Agent selbst — bei 10 echten
Kernen kommt das schnell zusammen), kein einzelner Prozess lag über ~23 %;
eine `node -e 'while(1){}'`-Schleife zeigte 100,0 %, ein untätiges
`setTimeout` 0,0 %. Die Schranken liegen mit Abstand über dem gemessenen
Leerlauf und mit Abstand unter einem ausgelasteten Kern.

**Und ein einzelner Messsatz reicht auch auf einer ruhigen Maschine nicht.**
Ein erster Satz lag einmal bei `tree` 282 ms und damit über der Schranke; ein
interleaved A/B gegen das vorige Binary auf demselben Backlog ergab 197/197.
Die Regression war die Last dreier parallel arbeitender Agenten, nicht der
Schritt. Abwechselnd A/B zu messen trennt beides, eine Einzelmessung nicht —
und ein Perf-Alarm, der sich als Maschinenlast herausstellt, kostet denselben
Rückrollvorgang wie ein echter.

**Und CPU-Last ist nicht das Einzige, was die Uhr verschiebt.** Im Akkubetrieb
mit Stromsparmodus brauchte der Build, den DECISIONS 84 mit 206 ms gemessen
hatte, ~390 ms — jeder andere Build ebenso —, während die CPU-Prüfung bestand
und der Lauf OVER BAR auf unverändertem Code meldete (v3-preflight.md A5).
`perf.js` liest deshalb auf darwin `pmset -g` (`lowpowermode 1`) und
`pmset -g batt` (`'Battery Power'`) und bricht im absoluten Modus mit Exit 3
ab: `perf: not a quiet machine (power): <Grund>`. Gelesen, nie verstellt —
das ist die Einstellung des Nutzers.

**A/B-Modus: das Perf-Gate, solange die absolute Schranke nicht erreichbar ist**
(DECISIONS 90):

```sh
$NODE tools/perf.js --ab=<nj A> --ab=<nj B> [--rounds=N] [--gate=all|reads]   # N Standard 7
# z. B. v2 gegen V3-1:
git show 5318888:dist/nj > /tmp/nj-A; git show d517837:dist/nj > /tmp/nj-B
$NODE tools/perf.js --ab=/tmp/nj-A --ab=/tmp/nj-B
```

Drei Seiten, jede auf **eigenem** 10k-Backlog, gebaut mit ihrem **eigenen**
`nj init` und in dem Layout, das dieses `init` anlegt (v2: `.nanojira.json`,
`.ids/`; ab V3-4: `.nanojira/config.json`, `.nanojira/ids/`) — sonst bekäme
ein V3-4-Build ein v2-Layout vorgesetzt, das er als `legacy_layout` ablehnt
(I8). Die Seiten sind A, B und **A noch einmal als A/A-Kontrolle**; ihre
Reihenfolge rotiert jede Runde (A B C, B C A, C A B), sonst bekäme eine Seite
immer den wärmeren Cache oder den ruhigeren Moment. Ausgabe je Kommando:
Median/Max für A und B, der Median der **gepaarten** Verhältnisse A/A und B/A
je Runde. Last und Stromzustand werden **gemeldet, nicht abgelehnt** — genau
dafür ist der Modus da; die Ausgabe zählt, wie viele Runden unter fremder
Last begannen, und nennt die größte A/A-Abweichung der Sitzung. Exit 0, außer
B ist bei einem Kommando mehr als **10 %** langsamer (`PERF_AB_TOLERANCE_PCT`)
**und das reproduziert sich**, dann Exit 1 mit `REGRESSION (reproduced …)` am
Kommando. Die 10 % sind gemessen: drei Builds ohne perf-relevante Änderung
(`5b666a0`, `c2-baseline`, `2ca5c9f`) lagen im Median bis 5,6 %
auseinander, im Max bis 17 % — deshalb gatet das Max nicht.
Exit 2: Aufruffehler oder ein Kommando endet ≠ 0.

**Warum gepaart, reproduziert und mit Kontrolle** (I4, gate-instrument.md).
Die erste Fassung verglich die beiden Mediane. Zwei Läufe v2 gegen c3 (an den
Lesebefehlen nichts perf-relevant geändert) scheiterten an je einem
**anderen** Kommando — `note` +12,5 % im einen, `list --json` +13,7 % im
nächsten, jeweils unauffällig im anderen Lauf; der Verifier maß
`tree` +11,1 % und in der nächsten Runde −0,7 % für dasselbe Paar. Die Last
paralleler Agenten kommt in Schüben von Sekunden (einzelne Aufrufe mit 1–2 s
in der Max-Spalte); die Seiten einer Runde laufen direkt hintereinander, ein
Schub trifft meist alle, ein Median über den ganzen Lauf trifft ihn einseitig.
Ein Kommando über der Toleranz bekommt einen **zweiten, eigenen Durchgang**
gleicher Länge und ist nur dann Regression, wenn auch dieser darüber liegt —
beide Werte stehen da, sonst `not reproduced … -> load, not nj`. Die
A/A-Kontrolle zeigt, wie weit „gar keine Änderung" in genau dieser Sitzung
streut; liegt sie über der Toleranz, sagt die Ausgabe, dass ein Grün hier
wenig bedeutet. Gegenprobe: eine c3-Kopie mit 60 ms Warteschleife am Start
muss als reproduzierte Regression erscheinen.

`ps` und `pmset` laufen über feste Pfade (`/bin/ps`, `/usr/bin/pmset`), und
beide Prüfungen scheitern **geschlossen**: ohne lesbare Prozessliste gilt die
Maschine nicht als ruhig (I7).

**Schreibbefehle** (DECISIONS 95 B20). Ab V3-3 erzeugt jeder Schreibbefehl
`STATUS.md` aus einem vollen Scan neu, also misst `perf.js` auch `new`,
`set --title` und `note` auf demselben 10k-Backlog, jeder Aufruf mit neuem
Inhalt (sonst würde compare-before-write ihn zum No-op machen), alle nach den
Lesebefehlen. § 13 hat noch keine Schreibschranke (TSK-027 trägt eine ein):
im absoluten Modus werden sie **gemeldet, nicht gegatet**; im A/B-Modus gaten
sie wie die Lesebefehle. `--gate=reads` nimmt sie aus dem Gate — für einen
Schritt, dessen Schreibkosten **gewollt** steigen (V3-3), damit das gewollte
nicht als Regression erscheint und die Lesebefehle, die sich nicht bewegen
dürfen, trotzdem gaten.

## Was bewusst NICHT verglichen wird

Alles hier ist eine benannte Entscheidung, keine Nachlässigkeit. Wer etwas
davon aufweicht, weicht das Netz auf.

1. **Scratch-Pfade** → `<SCRATCH>`. Das Orakel nutzt `mkdtemp`; die absoluten
   Pfade stehen in JSON-`file`, in `duplicate_id`-Meldungen und in
   `rm`-Ausgaben. Erfasst werden `/tmp`, `/var/tmp` und der echte `os.tmpdir()`
   (auf macOS `/var/folders/…/T`), inklusive `/private`-Auflösung.
2. **Verschachtelte mkdtemp-Suffixe** → `-<RAND>`, z. B. `r4-stub-38m50x`.
   Erkannt wird am **Kontext**, nicht am Zeichenvorrat: ein Segment direkt
   unter `<SCRATCH>`, dessen Ende nach einem `-` genau sechs alphanumerische
   Zeichen trägt. Die eigenen Fixtures liegen unter `<FIXTURES>` — ein eigener
   Token, vergeben **vor** der Scratch-Ersetzung — und werden von dieser Regel
   nie berührt; `fault-before-rename` und `disc-badcfg` bleiben im Diff lesbar.

   Zwei Fassungen davor waren falsch, beide auf dieselbe Art: sie rieten, statt
   den Ort zu kennen.
   - „Rest ist nicht rein kleinbuchstabig" hielt `sreibx` für einen Namen. Das
     Gate wurde mit ein paar Prozent Wahrscheinlichkeit **grundlos rot** — und
     ein Gate, das zufällig rot wird, kostet entweder richtige Arbeit (wer der
     Regel „rot → zurückrollen" folgt) oder das Vertrauen in jeden roten Lauf.
   - Ein nicht-gieriger Präfix traf die *erste* Sechserkomponente statt der
     letzten und ließ den echten Rest stehen (`r4-<RAND>-mFeHhb`). mkdtemp
     hängt seine Zufälligkeit hinten an, also wird hinten gesucht: gieriger
     Präfix, Rest am Segmentende verankert.
3. **`.nj-tmp-<pid>-<rand>`** → `.nj-tmp-<PID>-<RAND>`. Pid und `Math.random`
   per Konstruktion (§ 12). Die **Anzahl** der Stray-Dateien wird verglichen.
4. **Zeitstempel, die nicht die gepinnten sind** → `<TS>`. `doctor --fix`
   leitet `created` aus der mtime ab; Fixtures bekommen `utimes`, die
   Orakel-Fixtures nicht. `2026-09-21T18:00:00Z` und `2026-09-21T19:30:00Z`
   bleiben sichtbar — das beweist, dass die `NJ_NOW`-Verkabelung noch steht.
5. **Roh-SHA je Datei.** Verglichen wird `nsha` (Hash über den normalisierten
   Inhalt). Der Roh-SHA bleibt für Forensik im Datensatz, taugt aber nicht als
   Schlüssel, solange eine ungepinnte mtime in den Inhalt fließt.
6. **Projektpfad** → `<PROJ>`, **Home** → `<HOME>`, **Fixture-Wurzel** → `<FIXTURES>`.
7. **`cwdHash`.** Gruppiert Aufrufe nach Backlog, ohne einen absoluten Pfad
   aufzunehmen. Wird nicht verglichen, nur zur Gruppierung benutzt.
8. **Absichtlich nebenläufige Suiten**, aufgezählt in `CONCURRENT_SUITES`:
   `ac/ac-07-concurrency.js` und `edge/tombstone-partial-loss.js`. Welcher
   Aufruf welche ID gewinnt und wie viele Temp-Dateien gerade fliegen, ist dort
   *die geprüfte Eigenschaft*. Die Markierung erbt jeder Aufruf auf demselben
   Backlog — nach 100 wettrennenden `nj new` ist auch jedes spätere `show`
   davon abhängig. 511 von 2901 Aufrufen. Die Liste ist explizit: eine **neue**
   nebenläufige Suite wird nicht stillschweigend geduldet, sie fällt als roter
   Diff auf und muss bewusst eingetragen werden.

Nicht im Korpus, weil nicht deterministisch erreichbar: `id_allocation_failed`
und `internal_error`.

## Gepinnte Präzedenz

Der Korpus hält fest, **welche Prüfung gewinnt**, wenn eine Sektionsquelle und
ein anderes Flag gleichzeitig ungültig sind — Szenario `flagerr`, Fixtures
`prec-*`. Das ist beobachtetes Verhalten und gehört deshalb hierher, nicht ins
Orakel: § 9 kennt keine Präzedenzregel, ein Orakel-Pin wäre aus nj abgeleitet
statt aus der Spec.

Die beiden Verben sind absichtlich asymmetrisch:

| Verb | liest Sektionen | es entscheidet |
|---|---|---|
| `set` | zuerst | die Sektionsquelle (`not_found`) |
| `new` | zuletzt | die Feldprüfung (`invalid_value`) |

`new` liest zuletzt, weil es für einen Aufruf, den es ablehnt, keine ID
vergeben darf (§ 8). Das sieht aus wie eine Inkonsistenz und ist keine — wer
die beiden „vereinheitlicht", bricht einen der zwei Verträge.

Gegengeprüft per Mutation: schiebt man `readSectionFlags` hinter die
Status-Prüfung, bleibt das Orakel **56/56 grün**, während der Replay auf genau
diesen Fixtures rot wird.

## Regel

Ein abweichender Aufruf ist ein **Stopp**, kein Anlass, die Baseline
nachzuziehen. Die Baseline wird nur neu aufgezeichnet, wenn eine
Verhaltensänderung ausdrücklich beschlossen wurde — dann mit eigenem Commit und
Begründung.
