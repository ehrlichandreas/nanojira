'use strict';

// The text of `nj help`.

import type {} from './types.ts';

// --------------------------------------------------------------------- help

const HELP = `nj — NanoJira, a local file-based task tool for agents

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
  nj note  --id=TSK-009 "text"
  nj show  --id=TSK-009
  nj list  [--status=…] [--type=…] [--tag=…] [--parent=…] [--assignee=…] [--ready] [--all]
  nj tree  [--id=EPIC-001] [--all]
  nj rm    --id=TSK-009 [--cascade]
  nj archive --id=EPIC-001
  nj doctor [--fix]

Every command accepts --json. Write commands accept --file=<path> instead of
--id to address one file of a duplicated ID unambiguously.

Exit codes: 0 success · 1 command failed · 2 doctor found at least one error.
`;

export { HELP };
