import { readFileSync } from 'node:fs';
import { strict as assert } from 'node:assert';
import { ComputeEngine } from '../../src/compute-engine';
import { installGroupTheory } from '../../src/compute-engine/library/group-theory';
import * as finite from '../../src/compute-engine/group-theory/finite-group';
import * as structure from '../../src/compute-engine/group-theory/finite-structure';
import * as matrix from '../../src/compute-engine/group-theory/matrix';
import * as pc from '../../src/compute-engine/group-theory/polycyclic';
import * as quotient from '../../src/compute-engine/group-theory/polycyclic-quotient';
import * as actions from '../../src/compute-engine/group-theory/polycyclic-actions';
import * as permutation from '../../src/compute-engine/group-theory/permutation/groups';
const inventory = JSON.parse(
  readFileSync(
    new URL('../../docs/group-theory/CHAPTER-COVERAGE.json', import.meta.url),
    'utf8'
  )
);
const ce = new ComputeEngine();
installGroupTheory(ce);
const host = {
  ...finite,
  ...structure,
  ...matrix,
  ...pc,
  ...quotient,
  ...actions,
  ...permutation,
};
const statuses = new Set([
  'bounded-native',
  'bounded-host',
  'partial-native',
  'missing',
  'gap-runtime-specific',
]);
const ids = new Set<string>();
let total = 0;
for (const chapter of inventory.chapters) {
  assert([39, 44, 45].includes(chapter.chapter));
  for (const entry of chapter.entries) {
    assert(entry.id.startsWith(`${chapter.chapter}.`));
    assert(!ids.has(entry.id));
    ids.add(entry.id);
    assert(statuses.has(entry.status));
    assert(entry.limitation.length > 0);
    for (const name of entry.epsil)
      assert(ce.lookupDefinition(name), `Missing Epsil operation ${name}`);
    for (const name of entry.host)
      assert(name.split('.')[0] in host, `Missing host export ${name}`);
    if (entry.status === 'missing') assert.equal(entry.epsil.length, 0);
    total++;
  }
}
assert.equal(total, 323);
assert.equal(inventory.status, 'incomplete');
console.log(
  `Validated ${total} chapter entries and all listed Epsil/host export names.`
);
