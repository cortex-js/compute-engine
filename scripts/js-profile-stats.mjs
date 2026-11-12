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
//
// The counters of the shadow measure (`CE_JS_PROFILE_SHADOW=1`), under
// `shadow` in each file, are printed after it: per consumer, the
// compilations, those that the existing compiler compiled (baseline), how
// many of these the profile admitted, declined or failed on, and how many of
// the compilations the existing compiler declined and the profile admitted;
// then the declines and failures of all its consumers, grouped by the
// normalized message, with one example of each, and the declines of the
// existing compiler that the profile admitted, by message.
// `CE_JS_PROFILE=ir` and `CE_JS_PROFILE_SHADOW=ir` measure the profile `ir`
// in the same format.

import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

const dir = process.argv[2];
if (dir === undefined) {
  console.error('Usage: node scripts/js-profile-stats.mjs <directory>');
  process.exit(2);
}

const files = readdirSync(dir).filter((f) => f.endsWith('.json'));
const totals = new Map();
const shadow = new Map();
const shadowMessages = new Map();
const admittedOverBaseline = new Map();
for (const file of files) {
  const data = JSON.parse(readFileSync(join(dir, file), 'utf8'));
  for (const [name, s] of Object.entries(data.shadow ?? {})) {
    let t = shadow.get(name);
    if (t === undefined)
      shadow.set(
        name,
        (t = {
          attempts: 0,
          admitted: 0,
          declined: 0,
          failed: 0,
          otherMessages: 0,
          baselineDeclined: 0,
          baselineDeclinedAdmitted: 0,
        })
      );
    for (const k of Object.keys(t)) t[k] += s[k] ?? 0;
    for (const [message, n] of Object.entries(
      s.baselineDeclinedAdmittedMessages ?? {}
    ))
      admittedOverBaseline.set(
        message,
        (admittedOverBaseline.get(message) ?? 0) + n
      );
    for (const [kind, map] of [
      ['declined', s.declinedMessages],
      ['failed', s.failedMessages],
    ])
      for (const [message, n] of Object.entries(map ?? {})) {
        const key = `${kind}: ${message}`;
        const m = shadowMessages.get(key);
        if (m === undefined)
          shadowMessages.set(key, {
            count: n,
            example: s.examples?.[message] ?? message,
          });
        else m.count += n;
      }
  }
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

if (shadow.size > 0) {
  const shadowRows = [...shadow.entries()].sort(
    (a, b) =>
      b[1].attempts +
      b[1].baselineDeclined -
      a[1].attempts -
      a[1].baselineDeclined
  );
  const sum = {
    attempts: 0,
    admitted: 0,
    declined: 0,
    failed: 0,
    otherMessages: 0,
    baselineDeclined: 0,
    baselineDeclinedAdmitted: 0,
  };
  const w = Math.max(8, ...shadowRows.map(([name]) => name.length));
  const pct = (n, d) => (d === 0 ? '' : `${((100 * n) / d).toFixed(1)}%`);
  const row = (name, t) =>
    `${name.padEnd(w)} ${num(t.attempts + t.baselineDeclined)} ${num(t.attempts)} ${num(t.admitted)} ${pct(t.admitted, t.attempts).padStart(7)} ${num(t.declined)} ${num(t.failed)} ${num(t.baselineDeclined)} ${num(t.baselineDeclinedAdmitted)}`;
  console.log('\nShadow measure (CE_JS_PROFILE_SHADOW)\n');
  console.log(
    `${'consumer'.padEnd(w)} ${num('compiled')} ${num('baseline')} ${num('admitted')} ${'%'.padStart(7)} ${num('declined')} ${num('failed')} ${num('base-decl')} ${num('b-d-adm')}`
  );
  for (const [name, t] of shadowRows) {
    for (const k of Object.keys(sum)) sum[k] += t[k];
    console.log(row(name, t));
  }
  console.log(row('total', sum));
  console.log(
    `\n'baseline': compilations that the existing compiler compiled; 'admitted', 'declined', 'failed': the profile on these. 'base-decl': compilations that the existing compiler declined; 'b-d-adm': of those, admitted by the profile.`
  );
  const top = [...shadowMessages.entries()].sort(
    (a, b) => b[1].count - a[1].count
  );
  const oneLine = (m) => {
    const line = m.replace(/\s+/g, ' ');
    return line.length > 220 ? line.slice(0, 217) + '...' : line;
  };
  console.log(
    `\nShadow measure: ${top.length} distinct normalized message(s) of a decline or a failure, most frequent first`
  );
  for (const [key, { count, example }] of top.slice(0, 60)) {
    console.log(`  ${String(count).padStart(6)}  ${oneLine(key)}`);
    const kind = key.slice(0, key.indexOf(': ') + 2);
    if (`${kind}${example}` !== key)
      console.log(`          e.g. ${oneLine(example)}`);
  }
  if (sum.otherMessages > 0)
    console.log(
      `  ${String(sum.otherMessages).padStart(6)}  (messages not kept)`
    );
}
if (admittedOverBaseline.size > 0) {
  console.log(
    `\nShadow measure: the declines of the existing compiler that the profile admitted, by message`
  );
  for (const [message, n] of [...admittedOverBaseline.entries()]
    .sort((a, b) => b[1] - a[1])
    .slice(0, 40)) {
    const line = message.replace(/\s+/g, ' ');
    console.log(
      `  ${String(n).padStart(6)}  ${line.length > 220 ? line.slice(0, 217) + '...' : line}`
    );
  }
}
