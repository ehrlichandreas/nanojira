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

Code `4` ist der wichtigste. `test/run-all.js` meldet ohne gesetztes `NJ`
39/39 „cannot run" und endet trotzdem ohne Drama — korrekte Black-box-Disziplin
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
| `baseline/header.json` | nj-sha256, Node, Plattform, Aufrufzahlen, Deckungslücken |
| `baseline/corpus.ndjson.gz` | ein Datensatz je Aufruf (gzip: 3,3 MB statt 29 MB) |

Aufgezeichnet wird pro Aufruf: `argv`, `cwd`, die relevante Env
(`NJ_NOW`/`NJ_FAULT`/`NJ_BACKLOG`), `exit`, `stdout`, `stderr` und danach der
SHA256 **jeder** Backlog-Datei, das `.ids/`-Listing und die Anzahl
`.nj-tmp-*`.

## Was bewusst NICHT verglichen wird

Alles hier ist eine benannte Entscheidung, keine Nachlässigkeit. Wer etwas
davon aufweicht, weicht das Netz auf.

1. **Scratch-Pfade** → `<SCRATCH>`. Das Orakel nutzt `mkdtemp`; die absoluten
   Pfade stehen in JSON-`file`, in `duplicate_id`-Meldungen und in
   `rm`-Ausgaben. Erfasst werden `/tmp`, `/var/tmp` und der echte `os.tmpdir()`
   (auf macOS `/var/folders/…/T`), inklusive `/private`-Auflösung.
2. **Verschachtelte mkdtemp-Suffixe** → `-<RAND>`, z. B. `r4-stub-38m50x`.
   Erkannt wird ein sechsstelliger Rest, der nicht rein kleinbuchstabig ist;
   alle absichtlichen Verzeichnisnamen hier sind es (`fault-before-rename`,
   `disc-badcfg`) und bleiben damit im Diff lesbar.
3. **`.nj-tmp-<pid>-<rand>`** → `.nj-tmp-<PID>-<RAND>`. Pid und `Math.random`
   per Konstruktion (§ 12). Die **Anzahl** der Stray-Dateien wird verglichen.
4. **Zeitstempel, die nicht die gepinnten sind** → `<TS>`. `doctor --fix`
   leitet `created` aus der mtime ab; Fixtures bekommen `utimes`, die
   Orakel-Fixtures nicht. `2026-09-21T18:00:00Z` und `2026-09-21T19:30:00Z`
   bleiben sichtbar — das beweist, dass die `NJ_NOW`-Verkabelung noch steht.
5. **Roh-SHA je Datei.** Verglichen wird `nsha` (Hash über den normalisierten
   Inhalt). Der Roh-SHA bleibt für Forensik im Datensatz, taugt aber nicht als
   Schlüssel, solange eine ungepinnte mtime in den Inhalt fließt.
6. **Projektpfad** → `<PROJ>`, **Home** → `<HOME>`.
7. **`cwdHash`.** Gruppiert Aufrufe nach Backlog, ohne einen absoluten Pfad
   aufzunehmen. Wird nicht verglichen, nur zur Gruppierung benutzt.
8. **Absichtlich nebenläufige Suiten**, aufgezählt in `CONCURRENT_SUITES`:
   `ac/ac-07-concurrency.js` und `edge/tombstone-partial-loss.js`. Welcher
   Aufruf welche ID gewinnt und wie viele Temp-Dateien gerade fliegen, ist dort
   *die geprüfte Eigenschaft*. Die Markierung erbt jeder Aufruf auf demselben
   Backlog — nach 100 wettrennenden `nj new` ist auch jedes spätere `show`
   davon abhängig. 511 von 2696 Aufrufen. Die Liste ist explizit: eine **neue**
   nebenläufige Suite wird nicht stillschweigend geduldet, sie fällt als roter
   Diff auf und muss bewusst eingetragen werden.

Nicht im Korpus, weil nicht deterministisch erreichbar: `id_allocation_failed`
und `internal_error`.

## Regel

Ein abweichender Aufruf ist ein **Stopp**, kein Anlass, die Baseline
nachzuziehen. Die Baseline wird nur neu aufgezeichnet, wenn eine
Verhaltensänderung ausdrücklich beschlossen wurde — dann mit eigenem Commit und
Begründung.
