'use strict';

// The text of `nj help`.

import type {} from './types.ts';

// --------------------------------------------------------------------- help

const HELP = `nj — NanoJira, a local file-based task tool for agents

  nj --version                           print the version and exit
  nj                                     short status: counts, top ready, problems
  nj init                                create the backlog layout
  nj <any command> --backlog=<path>      use this backlog (else NJ_BACKLOG, else .njrc/backlog/ upward)
  nj new   --type=task --parent=EPIC-001 --title="…"
           [--status=…] [--priority=…] [--tags=a,b] [--assignee=…] [--depends-on=…]
           [--description=… | --description-file=…] [--acceptance=… | --acceptance-file=…]
  nj set   --id=TSK-009 [--title=…] [--status=…] [--priority=…]
           [--tags=…] [--assignee=…] [--depends-on=…] [--force] [--allow-open-children]
           [--description=… | --description-file=…] [--acceptance=… | --acceptance-file=…]

Section writes replace the section; --<role>-file=- reads stdin.
  nj note  --id=TSK-009 "text" [--as=…]
  nj check --id=TSK-009 [--text=<substring> | --item=<n>] [--on | --off] [--force]
  nj show  --id=TSK-009
  nj list  [--status=…] [--type=…] [--tag=…] [--parent=…] [--assignee=…] [--ready] [--all]
  nj find  "<text>" [--status=…] [--type=…] [--tag=…] [--parent=…] [--assignee=…] [--all] [--case-sensitive]
  nj tree  [--id=EPIC-001] [--all]
  nj rm    --id=TSK-009 [--cascade]
  nj archive --id=EPIC-001
  nj unarchive --id=EPIC-001
  nj claim   --id=TSK-009 [--as=…] [--status=…] [--steal=<holder>]
  nj release --id=TSK-009 [--as=…]
  nj doctor [--fix]

Every command accepts --json. Write commands accept --file=<path> instead of
--id to address one file of a duplicated ID unambiguously. set/note/check/
claim/release accept --id=A,B,C (two or more) to apply the same write to
every named element; results come back as {ok, results: [...]}.

Exit codes: 0 success · 1 command failed · 2 doctor found at least one error.
`;

export { HELP };
