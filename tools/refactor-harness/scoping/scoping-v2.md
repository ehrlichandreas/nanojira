SCOPING nj-Refactoring — Fassung 2 (in deinem Format, auf NOT-COVERED 1–10 umgestellt). Read-only, nichts in projects/nanojira verändert.

**1. EMPFEHLUNG: (i) eine Datei intern refactoren. §3-Auswirkung: keine.**
§3 pinnt "one executable script `nj`" normativ. 1636 Code-Zeilen sind klein, und die 19 Sektionen markieren die Modulgrenzen bereits — ein Split kauft Grenzen, die da sind. Entscheidend: das Orakel ist black-box, es prüft CLI/Exit/Bytes. Genau die Pfade, die ein Split neu erzeugt (Modul-Init, Binding-Semantik), sieht es nicht. Höchstes Risiko dort, wo der Schutz am dünnsten ist.
(ii) `lib/*.js` — verworfen, aufgeschoben mit Trigger: >3000 Zeilen ODER Bedarf an Unit-Tests auf Interna. Idiom wie §13 beim Index: nicht verworfen, gemessen vertagt.
(iii) ESM/.mjs — verworfen. Ändert `require.main`, `__dirname`, Stack-Form und Fehlerzeitpunkte; zero-dependency ist CJS bereits. Reines Risiko ohne Gegenwert.
**Gegenvorschlag statt (ii):** `module.exports = {…}` hinter `if (require.main === module)`-Guard. ~6 Zeilen, §3 unberührt (es bleibt ein ausführbares Skript), liefert den einzigen echten (ii)-Gewinn: Unit-Tests auf Interna, dort wo das black-box-Orakel nicht hinkommt.

**2. ZIELSTRUKTUR — Sektionen BLEIBEN Sektionen**, werden aber normativ: Kopfkarte + Regel "kein Aufruf nach oben".
core: constants, errors, clock, frontmatter values, file parse, body logic
store: configuration, discover, tombstones, atomic writes
model: element load, derivations
commands: commands, doctor, help
cli: arg parsing, context, printing
entry: main
Abhängigkeit nur abwärts (entry→cli→commands→model→store→core). Zwei bestehende Kopplungen benennen, vor jedem späteren Split aufzulösen: (a) `deriveGraph` hängt `el.byId`/`el.children` an die Elemente (nj:645-648), `cmdSet` liest `el.children` — Graph-Referenzen in Modellobjekten. (b) `descendants()` cached `ctx.kids` auf dem cli-Context, model schreibt also in ein cli-Objekt.

**3. SCHRITTFOLGE.** Risikoklassen: A = reine Extraktion (Output per Konstruktion bitgleich), B = Ausführungsänderung ohne Output-Änderung, C = Zustands-Umbau. Kein Schritt mischt.
**S0 Baseline-Harness (M, Vorbedingung).** Referenz-Backlog unter festem NJ_NOW, friert ein: Datei-SHAs, stdout, stderr, Exit-Code — je --json und Prosa, alle 11 Commands, alle Fehlercodes. *Kein Schritt vor S0.*
S1 deriveGraph → 8 Pässe (M, A)
S2 deriveGraph nutzt `childMap()` statt eigener children-Map nj:630-635 (S, B) — Duplikat seit Runde zwei
S3 loadElement → 8 Deriver (M, A)
S4 doctorFix → fixCtx + 8 Schritt-Funktionen (L, A) — bewusst nach S1–S3
S5 cmdNew-Validierung extrahieren (S, A)
S6 cmdSet-Overrides extrahieren (S, A)
S7 JSON_MODE → `output`-Objekt (S, C)
S8 JSDoc + Kopfkarte (M, kommentarlos)
S9 optional require.main-Guard + exports (S, C)
Verhaltensneutral bei A per Konstruktion (Code wandert, Reihenfolge bleibt), bei B/C per S0-Diff.

**4. HOTSPOT-ZERLEGUNG**
`doctorFix`: `fixCtx = {backlog, actions:[], notes:[], skipped:Set, mtimes:Map<path,iso>, reload(), guard(el), absent(el,key), rename(from,to)}` → `fixWriteIdType(fixCtx)`, `fixRenameToId`, `fixMoveToTypeDir`, `fixBackfillTombstones`, `fixWriteStatusCreated`, `fixSyncH1`, `fixRemoveStrayTmp`, `fixRebuildIndex` (no-op). Die acht Aufrufe bleiben als **eine sichtbare Liste** in doctorFix — diese Liste IST die normative §14-Reihenfolge und muss prüfbar bleiben. `rename()` wandert nach fixCtx (Schritt 2+3 teilen es seit Runde drei).
`loadElement` → `deriveId(el,p,base,problems)`, `deriveType(el,p,folder,problems)`, `deriveTitle`, `deriveStatus(el,p,cfg,problems)`, `deriveParent`, `deriveOptionals`, `deriveTimestamps(el,p,file,problems)`, `deriveBody(el,p,cfg,problems)`. Reihenfolge bleibt (type hängt an id, parent-Regeln an type).
`deriveGraph` → `markDuplicateIds`, `markParentEdges`, `markParentCycles`, `markDependsOnEdges`, `markDependsOnCycles`, `markOpenChildren`, `markMissingTombstones`, `attachGraph`; alle `(els, byId|kids)`, attachGraph zuletzt.
`cmdNew` → `validateNewFlags(ctx,flags) → spec` (Reihenfolge Existenz→unreadable→Typ bleibt in EINER Funktion sichtbar, Runde drei), `buildNewFields(spec,id,ts) → Map`.
`cmdSet` → `collectSetOverrides(ctx,el,flags,allowOpen) → {overrides, changed, newBody}`.

**5. GLOBALS / JSON_MODE.** Die 20 sind: 2 requires, **17 konstante Tabellen**, 1 mutabel. 17 unveränderliche Lookups auf Modulebene sind die richtige Form — kein Umbau, keine Context-Durchreichung. Nur `let JSON_MODE` (Z.85) ist Zustand → `const output = {json:false}`, gesetzt in main, gelesen in `hardExit`+`emitFailure`. Ein Context-Objekt durchzureichen wären ~15 Signaturänderungen für einen Wert, den zwei Funktionen lesen.
Für (ii) kritisch: **`let` über eine CJS-Modulgrenze ist kein Live-Binding** — `module.exports.JSON_MODE` kopiert. Ein naiver Split ließe JSON_MODE im Fehlerpfad dauerhaft `false` und bräche §9 ("mit --json schreibt jeder Exit-Pfad JSON") still. NC3 (Fehlercode-Strings ungepinnt) würde das evtl. nicht fangen. S7 entschärft das vorab.

**6. DOKU — ich weiche hier begründet ab.** JSDoc für alle 80 wären ~400 Zeilen auf 1636 Code-Zeilen; Blöcke, die den Funktionsnamen wiederholen, veralten und begraben die 97 vorhandenen Kommentare, die echte Warum-Information tragen. Vorschlag in drei Stufen: **T1 (12)** Vertragsfunktionen mit Byte-/Shape-Garantie — parseFile, serialize, renderElement, atomicWrite, compareGuard, guardedWrite, entryJson, emitWriteResult, elementProblems, isReady, compareElements, allocateId. **T2 (18)** nicht offensichtliche Kontrakte — die neuen Deriver/Pässe/Fix-Schritte, resolveTarget, requireNoStubs, absent. **T3 (~50)** nur wo der Name nicht reicht. Wenn du die vollen 80 willst: sag es, es ist mechanisch, ich liefere es — aber ich halte T1+T2 für den besseren Zustand.
Dateikopf: 19-zeilige Sektionskarte + 5-zeiliger Datenfluss `argv → parseArgs → context() [findBacklog → loadConfig → loadBacklog → loadElement* → deriveGraph] → cmd* → guardedWrite/atomicWrite → emitWriteResult/print`.

**7. SPEC-DELTAS.** Bei (i): **keine SPECIFICATION.md-Änderung.** Das ist das Hauptargument für (i).
Neue DECISIONS: **68** nj bleibt eine Datei (§3); Split vertagt mit Trigger, Idiom wie §13. **69** Die 8 --fix-Schritte sind 8 benannte Funktionen; ihre Aufrufliste in doctorFix ist die normative §14-Reihenfolge. **70** deriveGraph nutzt childMap() (ergänzt 58). **71** `output.json` statt `let JSON_MODE`, inkl. CJS-Live-Binding-Begründung. **72** nur falls S9.
Nur bei (ii)/(iii): §3-Zeile "Entry point" und der AC-15-Satz "ohne node_modules" (gilt weiter, sollte `lib/` aber ausdrücklich ausnehmen).

**8. RISIKO-REGISTER (Schritt × not-covered)**
**S4 × NC4 — schwerste Paarung.** Größter Hotspot trifft unschärfstes Orakel: 7 Stellen akzeptieren [0,2] statt der §14-Regel, und genau dort lagen drei Defekte in drei Runden. Absicherung: S0 pinnt für jede der 7 Stellen den nach §14 exakt erwarteten Exit-Code; Abweichung = Stopp statt Anpassen. Nebenbefund: dass das Orakel hier unscharf ist, sollte the Oracle unabhängig vom Refactor schließen.
**S1/S2 × NC6** (rm/archive-Byte-Identität nur per Codelesen): S0 friert rm/archive-Bytes + stdout ein — NC6 ist damit für alles nach S0 geschlossen.
**S4/S7 × NC3**: S0 pinnt `fault:after-tmp-write`, `before-rename`, `before-compare` als Strings.
**S7 × NC3/§9**: berührt jeden --json-Fehlerpfad → S0 braucht je Fehlercode einen --json-Fall.
**Alle × NC8** (nur darwin-arm64): Refactor ändert nichts Plattformspezifisches; NC8 bleibt offen, wird weder besser noch schlechter. Nicht in Scope.
**NC5**: S0 friert den archive-Hint-String ein. "archive nennt keine dependents" ist ein offener Spec-Punkt, nicht meiner (→10).
NC1, NC2, NC7, NC9, NC10: vom Refactor nicht berührt.

**9. VERIFIKATIONSPROTOKOLL je Schritt** — alle sechs grün, sonst zurückrollen statt nachbessern:
1 `node --check nj` · 2 S0-Diff **leer** (SHAs, stdout, stderr, Exit, je --json und Prosa) · 3 Orakel **38/38, 1528 Checks**, gleiche Zahl · 4 `--json`-Diff auf der Fix-Fixture: `problems[]`, `fixed[]`, `notes[]` identisch **inklusive Reihenfolge** · 5 Perf-Baseline 10k: tree ≤ ~200 ms (aktuell 188 ms Median), list ~177 ms — nur S1/S2 relevant · 6 **Author≠Verifier**: ich committe, the Oracle verifiziert; bei S4 zusätzlich Vier-Augen auf die Schrittliste gegen den §14-Wortlaut. Ein Commit pro Schritt.

**10. NICHT BESTIMMBAR + TOP-3**
Nicht meine Entscheidung: (a) Darf `tools/snapshot.sh` ins Projekt (neue Datei neben test/) oder bleibt S0 unter /tmp? Im Projekt ist er deutlich mehr wert. (b) **Ziel des Refactors** — Lesbarkeit, Testbarkeit oder Vorbereitung Runde zwei? Bei "Runde zwei" kehrt sich die Reihenfolge um: zuerst S4 (Index-Rebuild landet als --fix-Schritt 8) und S1/S2 (Index cached den Graph). (c) JSDoc-Umfang. (d) Drei Spec-Punkte aus euren Dogfooding-Befunden, die ich **benenne, nicht entscheide**: kein CLI-Schreibweg für `## Description`/`## Acceptance Criteria` (§9 sieht keinen vor → jedes CLI-Element bleibt dauerhaft incomplete; Spec-Loch, kein Bug); `nj note` ohne `--`-Ende-der-Optionen (§9 pinnt kein `--`; Text mit führendem `--` ist unerreichbar — verhaltensändernd, gehört NICHT in den Refactor); NC10 --tag/--assignee unvalidiert, während §9 für --status/--parent Validierung pinnt (Entscheidung 56 hält das für gewollt — falls nicht, eigener Task).
**Top-3-Risiken:** **R1** S0 fehlt oder ist unvollständig → der ganze Plan ist ungesichert, weil das Orakel Spec-Konformität prüft, nicht Byte-Identität zum Vorzustand; NC6 belegt genau das. Deshalb ist S0 Vorbedingung, kein Schritt. **R2** S4 trifft NC4 (s. o.). **R3** Prosa-Ausgabe ist praktisch ungedeckt: AC-13 pinnt JSON-Shapes, AC-14 die Sortierung — die Textform von printEntryLine, problemSuffix, writeFeedback, tree-Einrückung und doctor-Summary hat keine AC. Jeder Schritt, der printing berührt, läuft blind; nur S0 schließt das.
