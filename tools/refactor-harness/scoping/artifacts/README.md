# Fremde Artefakte — wofür sie da sind

Zwei Dateien, die **nicht** vom Autor des Korpus stammen. Genau das ist ihr
Wert, und genau deshalb steht hier, wozu sie dienen: ohne diesen Text sind sie
in einem halben Jahr Dateien, die niemand zu löschen wagt und niemand versteht.

## `nj-v4-lastwins`

Ein `nj`, das sich vom Prüfling in **einer Zeile** unterscheidet:

```diff
-    if (!byId.has(el.id)) byId.set(el.id, el);
+    byId.set(el.id, el);
```

Also **last-wins statt first-wins** bei doppelt vergebenen IDs. Das ist der
Handgriff, den eine Pass-Zerlegung mit `Map.set` in einer Schleife macht, und
er passiert **beide Netze**: das Orakel bleibt 56/56 grün, und vor den
Duplikat-Fixtures blieb auch der Replay still.

**Verwendung — Abnahmetest für die beiden Duplikat-Szenarien:**

```sh
node tools/refactor-harness/baseline.js verify \
  --nj=tools/refactor-harness/scoping/artifacts/nj-v4-lastwins
```

Erwartet wird **rot**, und zwar prüfbar, nicht bloß rot:

| Element | Szenario | echtes nj | last-wins |
|---|---|---|---|
| `SUB-001` | `dup-across-archive` | `(none)` | `archive:split` |
| `TSK-002` | `dup-across-archive` | `(none)` | `active_refs_archived` |
| `TSK-001` | `dup-across-archive-epic` | `(none)` | `archive:split` |

Bleibt er grün, sind die Szenarien wertlos geworden — dann ist das ein Befund
und kein Betriebsunfall.

**Warum ein fremder Mutant und keine eigene Kopie:** er wurde von Verifier II
gebaut, gegen ein Netz, das er nicht kannte. Eine selbstgebaute Kopie und die
Fixture, die sie fangen soll, können aus derselben Annahme stammen und sich
deshalb treffen, ohne dass der Mechanismus wirklich gedeckt ist. Ein unabhängig
entstandener Mutant schließt diese Zirkularität aus.

## `probe-lastwins.js`

Die freistehende Sonde desselben Verifiers, unverändert. Sie zeigt denselben
Unterschied ohne Korpus, direkt über `test/lib/harness.js`, und war die
Vorlage für das Szenario `dup-across-archive-epic`.

Sie ist hier, weil die Form, die sie beschreibt, **komplementär** zur ersten
ist: `dup-across-archive` dupliziert die Task und hängt Kind plus Dependent
daran, `dup-across-archive-epic` dupliziert den Elternteil und hängt eine
gewöhnliche Task darunter. Dieselbe Klasse, zwei Richtungen, zwei Köpfe.

## Warum beide im Repo liegen

Sie lagen in `/tmp`. Das war heute der vierte Fall dieser Art; die drei davor
hätten einen Neustart nicht überlebt, die Scratch-Sonden sogar mit
verwirrendem Fehlerbild. **Ein Abnahmetest, der verschwindet, bevor er
abgenommen hat, ist keiner.**
