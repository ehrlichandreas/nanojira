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
$NODE tools/refactor-harness/baseline.js record --nj="$PWD/nj"

# nach jedem Refactor-Schritt
$NODE tools/refactor-harness/baseline.js verify --nj="$PWD/nj"
```

Der nj-Pfad ist **immer** explizit. Kein Default, kein PATH-Lookup, keine
Ableitung aus dem cwd. Eine Baseline gegen das falsche Binary ist schlimmer als
gar keine.

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

**Welcher rote Lauf bedeutet was.** „Rot heißt zurückrollen" gilt für **Exit 1**
und sonst für keinen Code:

| Code | Aussage über | richtige Reaktion |
|---|---|---|
| `1` | den **Prüfling** | zurückrollen auf den letzten grünen Schritt, nicht nachbessern |
| `2` | den Aufruf | Kommando korrigieren |
| `4`, `5` | die **Deckung** | Voraussetzung herstellen, erneut laufen |
| `6`, `7` | das **Instrument** | Baseline neu aufzeichnen |

Codes 4 bis 7 sagen nichts über `nj`. Wer ihretwegen zurückrollt, wirft gute
Arbeit aus einem Grund weg, der nichts mit ihr zu tun hat — beinahe passiert,
als ein Kontrolllauf gegen **unverändertes** `nj` rot kam, weil zwei Läufe sich
dasselbe Scratch teilten. Daraus die Regel, an der die Codes hängen:
**ein Zusammenstoß darf nie die Form eines Befunds tragen.**

Code `4` ist der wichtigste. `test/run-all.js` meldet ohne gesetztes `NJ`
für jede Suite „cannot run" und endet trotzdem ohne Drama — korrekte Black-box-Disziplin
für ein Orakel, das vor seiner Implementierung geschrieben wurde, aber im
Refactor eine Falle: ein vergessenes Env würde eine echte Regression als
harmloses Überspringen tarnen. Deshalb trennt dieser Harness „cannot run" hart
von „failed" und bricht bei jeder Lücke selbst ab. **Ein Durchlauf, der nichts
geprüft hat, darf nie wie ein bestandener aussehen.**

## Aufbau

| Datei | Zweck |
|---|---|
| `nj-shim` | steht überall dort, wo ein nj-Pfad erwartet wird; leitet weiter und zeichnet auf |
| `lib/record.js` | Normalisierung, Backlog-Snapshot, mtime-Pinning |
| `fixtures.js` | 22 Szenarien: alle Kommandos, alle erreichbaren Fehlercodes, die Liste aus review-verifier.md §3 |
| `baseline.js` | Treiber: Korpus fahren, aufzeichnen, vergleichen |
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
wartet auf die Vergangenheit. Der belastbare Test zählt Prozesse:

```sh
pgrep -f 'bin/node' | wc -l      # 0 = ruhig; alles andere ist Last
```

**Und ein einzelner Messsatz reicht auch auf einer ruhigen Maschine nicht.**
Ein erster Satz lag einmal bei `tree` 282 ms und damit über der Schranke; ein
interleaved A/B gegen das vorige Binary auf demselben Backlog ergab 197/197.
Die Regression war die Last dreier parallel arbeitender Agenten, nicht der
Schritt. Abwechselnd A/B zu messen trennt beides, eine Einzelmessung nicht —
und ein Perf-Alarm, der sich als Maschinenlast herausstellt, kostet denselben
Rückrollvorgang wie ein echter.

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
