# Not-covered — zehn Stellen, einzeln entschieden

Stand nach dem Endgate (DECISIONS 84). Entschieden von Verifier II, festgehalten
vom Lead (TSK-002). Diese Liste existierte vorher nur verstreut: die Nummern NC1–NC10
stammen aus `scoping-implementer.md` (Z. 100–160, 188) und `scoping-v2.md` (Z. 49–55),
beschrieben waren dort nur sechs davon. Deshalb steht sie jetzt hier.

| # | Stelle | Urteil | Beleg |
|---|---|---|---|
| NC1 | — | nicht rekonstruierbar | Nur in der Sammelzeile „NC1, NC2, NC7, NC9, NC10: vom Refactor nicht berührt" (`scoping-implementer.md:157`, `scoping-v2.md:55`), nirgends einzeln beschrieben. |
| NC2 | — | nicht rekonstruierbar | Dito. |
| NC3 | Fault-Hook-Codes bei `--json` nicht als exakter String gepinnt | geschlossen | `test/fault/fault-hook-json.js`: `fault:before-rename` und `fault:before-compare` jetzt als exakte `--json`-Strings gepinnt (`fault:after-tmp-write` war bereits in `edge/failure-vocabulary.js` gepinnt) — alle drei Hooks damit string-gepinnt. |
| NC4 | `doctor --fix`-Exit-Codes nur `[0,2]`-toleriert | geschlossen | SUB-002: alle 8 Stellen auf genau einen Wert; `T.exit` wirft bei Array-Form (`test/lib/harness.js`). |
| NC5 | `archive` nennt keine `dependents` — nie mit Nicht-Leer-Fall geprüft | geschlossen | `test/edge/archive-hint-dependents.js`: `_problems`-Union real befüllt, kein `dependents`-Schlüssel. |
| NC6 | `rm`/`archive`-Byte-Identität nur per Codelesen | geschlossen | `test/edge/archive-rm-byte-identity.js` (ganzer `backlog/`-Baum vor/nach), dazu der Korpus-Replay. |
| NC7 | — | nicht rekonstruierbar | Wie NC1. |
| NC8 | Nur `darwin-arm64` ausgeführt | offen, getrackt | Von darwin-arm64 aus nicht schließbar. SUB-001 „linux-x64 Lauf nachholen". |
| NC9 | — | nicht rekonstruierbar | Wie NC1. |
| NC10a | `--tag`/`--assignee`: Flag-Tippfehler unvalidiert | geschlossen | `test/edge/norm-tag-assignee-typos.js` (§ 9: unbekannte Flags → `unknown_field`). |
| NC10b | `--tag`/`--assignee`: Unicode-Werte byte-exakt | geschlossen | `test/ac/ac-16-language.js` (`Jörg`, `hören,日本語,🎉`, Datei und JSON). |

**Stand:** 5 geschlossen (NC3–6, NC10 in beiden Lesarten),
1 offen und getrackt (NC8), 4 nicht rekonstruierbar (NC1/2/7/9).

## Weitere bekannte Grenzen, nicht Teil von NC1–10

Ausdrücklich akzeptiert, mit Grund:

- `deriveGraph`-Pass-Reihenfolge frei unter drei Bedingungen — DECISIONS 77.
- `childMap`/`ctx.kids`-Memo harmlos, solange kein Verb Elternschaft verschiebt — DECISIONS 81.
- `assignee` `''` statt `null`: nur das Orakel schützt vor „Aufräumen" — ARCHITECTURE.md.
- `depends_on:cycle` „member" vs. „reaches" — AMBIGUITIES 25, von der Spec nicht entschieden.
- AC-7 Retry-Abort-Zweig nicht deterministisch erreichbar — AMBIGUITIES 8.
- „Ohne Netz" nur indirekt — AMBIGUITIES 21.
