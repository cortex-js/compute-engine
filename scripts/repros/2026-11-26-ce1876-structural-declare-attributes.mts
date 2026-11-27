/**
 * CE-1876: a `Declare` boxed in the structural form whose attributes are a
 * function-form `Dictionary` (what `parseEpsil("let n: real = 2")` emits).
 *
 * Run: npx tsx scripts/repros/2026-11-26-ce1876-structural-declare-attributes.mts
 *
 * Prints, for each case, the value of the evaluated statement, the value of
 * the declared name, and the validity and the JSON of `.canonical`.
 * Expected: (1) and (2) give 3; (3) is invalid with
 * `invalid-declaration-attribute`.
 */
import { ComputeEngine } from '../../src/compute-engine';

const cases: Array<[string, unknown]> = [
  [
    '(1) structural, function-form attributes',
    ['Declare', 'm', { str: 'real' }, ['Dictionary', ['KeyValuePair', 'value', 3]]],
  ],
  [
    '(2) structural, dict literal attributes',
    ['Declare', 'm', { str: 'real' }, { dict: { value: 3 } }],
  ],
  [
    '(3) structural, a key that is not an attribute',
    [
      'Declare',
      'q',
      { str: 'unknown' },
      ['Dictionary', ['KeyValuePair', { str: 'foo' }, 2]],
    ],
  ],
];

for (const [label, json] of cases) {
  const ce = new ComputeEngine();
  const statement = ce.box(json as any, { form: 'structural' });
  const canonical = statement.canonical;
  const result = statement.evaluate();
  const name = label.startsWith('(3)') ? 'q' : 'm';
  console.log(label);
  console.log('  evaluate:', JSON.stringify(result.json));
  console.log('  value:', ce.box(name).value?.toString());
  console.log('  canonical.isValid:', canonical.isValid);
  console.log('  canonical:', JSON.stringify(canonical.json));
}
