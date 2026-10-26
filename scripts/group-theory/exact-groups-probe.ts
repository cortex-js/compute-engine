/** End-to-end Epsil example for the bounded finite, matrix, and polycyclic systems. */
import { readFileSync } from 'node:fs';
import { deepStrictEqual } from 'node:assert';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { installGroupTheory } from '../../src/compute-engine/library/group-theory';
const ce = new ComputeEngine();
installGroupTheory(ce);
const result = executeEpsil(
  ce,
  readFileSync(new URL('./exact-groups.epsil', import.meta.url), 'utf8')
);
deepStrictEqual(result.diagnostics, []);
deepStrictEqual(result.value.json, [
  'Tuple',
  3,
  ['List', 2],
  18,
  ['List', 2, 3],
  168,
  'True',
]);
console.log(JSON.stringify(result.value.json, null, 2));
