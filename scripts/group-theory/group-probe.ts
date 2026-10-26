/** Runs a complete, bounded group workflow; assertions live in test/. */
import { readFileSync } from 'node:fs';
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { installPermutationFoundation } from '../../src/compute-engine/library/group-theory';

const ce = new ComputeEngine();
installPermutationFoundation(ce);
const source = readFileSync(
  new URL('./group-closure.epsil', import.meta.url),
  'utf8'
);
const result = executeEpsil(ce, source);
if (result.diagnostics.length || result.value.operator === 'Error')
  throw new Error(
    JSON.stringify({
      diagnostics: result.diagnostics,
      value: result.value.json,
    })
  );
console.log(JSON.stringify(result.value.json, null, 2));
