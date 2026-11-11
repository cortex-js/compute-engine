#!/usr/bin/env node
// Sum the counters of the `numeric-kernel` switch of `implicitCompile()`
// over the files that the instances of the module wrote, and print one table.
//
//   CE_JS_PROFILE=numeric-kernel CE_JS_PROFILE_STATS=<dir> npx jest ...
//   node scripts/js-profile-stats.mjs <dir>
//
// Each file `<dir>/<pid>-<suffix>.json` holds `{ pid, consumers }`, the
// totals of one instance of the module (one per Jest test file), rewritten
// after each attempt (`src/compute-engine/js-profile-switch.ts`). The table
// has one row per consumer: attempts, admitted, declined, failed, then the
// five most frequent messages of a decline or a failure of that consumer.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (dir === undefined) {
  console.error('Usage: node scripts/js-profile-stats.mjs <directory>');
  process.exit(2);
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const totals = new Map();
for (const file of files) {
  const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  for (const [name, s] of Object.entries(data.consumers ?? {})) {
    let t = totals.get(name);
    if (t === undefined)
      totals.set(
        name,
        (t = {
          attempts: 0,
          admitted: 0,
          declined: 0,
          failed: 0,
          otherMessages: 0,
          messages: new Map(),
        })
      );
    for (const k of ['attempts', 'admitted', 'declined', 'failed'])
      t[k] += s[k] ?? 0;
    t.otherMessages += s.otherMessages ?? 0;
    for (const [kind, map] of [
      ['declined', s.declinedMessages],
      ['failed', s.failedMessages],
    ])
      for (const [message, n] of Object.entries(map ?? {})) {
        const key = `${kind}: ${message}`;
        t.messages.set(key, (t.messages.get(key) ?? 0) + n);
      }
  }
}

const rows = [...totals.entries()].sort(
  (a, b) => b[1].attempts - a[1].attempts
);
const all = { attempts: 0, admitted: 0, declined: 0, failed: 0 };
const width = Math.max(8, ...rows.map(([name]) => name.length));
const num = (n) => String(n).padStart(9);
console.log(`${files.length} file(s) in ${dir}\n`);
console.log(
  `${'consumer'.padEnd(width)} ${num('attempts')} ${num('admitted')} ${num('declined')} ${num('failed')}`
);
for (const [name, t] of rows) {
  for (const k of Object.keys(all)) all[k] += t[k];
  console.log(
    `${name.padEnd(width)} ${num(t.attempts)} ${num(t.admitted)} ${num(t.declined)} ${num(t.failed)}`
  );
}
console.log(
  `${'total'.padEnd(width)} ${num(all.attempts)} ${num(all.admitted)} ${num(all.declined)} ${num(all.failed)}`
);

for (const [name, t] of rows) {
  if (t.messages.size === 0 && t.otherMessages === 0) continue;
  console.log(`\n${name}: the five most frequent messages`);
  const top = [...t.messages.entries()].sort((a, b) => b[1] - a[1]).slice(0, 5);
  for (const [message, n] of top) {
    const oneLine = message.replace(/\s+/g, ' ');
    console.log(
      `  ${String(n).padStart(6)}  ${oneLine.length > 220 ? oneLine.slice(0, 217) + '...' : oneLine}`
    );
  }
  if (t.otherMessages > 0)
    console.log(
      `  ${String(t.otherMessages).padStart(6)}  (messages not kept)`
    );
}
