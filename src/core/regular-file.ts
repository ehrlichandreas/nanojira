'use strict';

// Reading one file nanojira did not just write itself: an element file, the
// configuration, STATUS.md/TAGS.md, README.md, .gitignore, a claim entry
// (§ 4, § 7 `file:unreadable`). Any of them may be something other than a
// regular file — a file symlink is read like a file (DECISIONS 91 B11), and
// a cloned backlog can hold anything — and a plain read then misbehaves: a
// FIFO blocks the open forever, a device such as `/dev/zero` never ends
// (the survey's repro grew to about 42 GB before it was killed). So the
// file is opened non-blocking, must be a regular file, and is read only up
// to a cap the caller chooses — all through one file descriptor, the same
// pattern as `.njrc` (config.ts). Every refusal throws; each caller already
// has its answer for a file that cannot be read (DECISIONS 215).

import * as fs from 'fs';

const MiB = 1024 * 1024;

/** The largest element file nanojira reads (and writes): 1 MiB (§ 7 `file:unreadable`). */
const ELEMENT_FILE_CAP = MiB;

/** For the small text files around the elements: the configuration, .gitignore, README.md, a claim entry. */
const TEXT_FILE_CAP = MiB;

function capText(cap: number): string {
  return cap % MiB === 0 ? `${cap / MiB} MiB` : cap % 1024 === 0 ? `${cap / 1024} KiB` : `${cap} bytes`;
}

/**
 * The whole file as UTF-8, or a throw: not a regular file, larger than
 * `cap` bytes, or any error `open` itself raises. `noFollow` refuses a
 * symlink outright (`ELOOP`) — for nanojira's own bookkeeping, which is
 * never a link (DECISIONS 215).
 */
function readRegularFile(file: string, cap: number, opts: { noFollow?: boolean } = {}): string {
  const flags = fs.constants.O_RDONLY | fs.constants.O_NONBLOCK | (opts.noFollow ? fs.constants.O_NOFOLLOW : 0);
  const fd = fs.openSync(file, flags);
  try {
    const st = fs.fstatSync(fd);
    if (!st.isFile()) throw new Error('not a regular file');
    if (st.size > cap) throw new Error(`larger than ${capText(cap)} (${st.size} bytes)`);
    // One byte more than the size fstat saw, so EOF is seen in one pass; a
    // file still growing is read on, but never past one byte over the cap.
    let buf = Buffer.alloc(st.size + 1);
    let n = 0;
    for (;;) {
      if (n === buf.length) {
        if (n > cap) throw new Error(`larger than ${capText(cap)}`);
        const grown = Buffer.alloc(Math.min(buf.length * 2, cap + 1));
        buf.copy(grown, 0, 0, n);
        buf = grown;
      }
      const r = fs.readSync(fd, buf, n, buf.length - n, null);
      if (r === 0) break;
      n += r;
    }
    return buf.toString('utf8', 0, n);
  } finally {
    fs.closeSync(fd);
  }
}

function readElementFile(file: string): string {
  return readRegularFile(file, ELEMENT_FILE_CAP);
}

export { ELEMENT_FILE_CAP, TEXT_FILE_CAP, readRegularFile, readElementFile };
