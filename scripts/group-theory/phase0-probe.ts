/** Research assertions for the existing CE/Epsil substrate, not a public API. */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { ComputeEngine, isFunction } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

const model = readFileSync(
  new URL('./phase0-model.epsil', import.meta.url),
  'utf8'
);
const ce = new ComputeEngine();
let checks = 0;

function run(source: string, engine = ce) {
  const result = executeEpsil(engine, source);
  assert.deepEqual(result.diagnostics, [], `Unexpected diagnostics: ${source}`);
  return result.value;
}
function check(name: string, body: () => void) {
  body();
  checks++;
  console.log(`PASS ${name}`);
}
function permutation(images: number[]) {
  return ['PhasePermutation', ['List', ...images]];
}
function expectError(source: string, code: string) {
  const value = run(source);
  assert.equal(value.operator, 'Error');
  assert.ok(JSON.stringify(value.json).includes(code));
}

run(model);
const p = 'PhasePermutation([2, 1, 3])';
const q = 'PhasePermutation([1, 3, 2])';
const groupSource = `PhasePermutationGroup([${p}, ${q}])`;

check('generic Epsil function works for two nominal element types', () => {
  assert.deepEqual(
    run('phase_square(PhasePermutation([2, 3, 1]))').json,
    permutation([3, 1, 2])
  );
  assert.deepEqual(run('phase_square(PhaseResidue(5, 3))').json, [
    'PhaseResidue',
    5,
    1,
  ]);
});
check('right action convention distinguishes p*q from q*p', () => {
  assert.deepEqual(
    run(`PhaseGroupElement.phase_compose(${p}, ${q})`).json,
    permutation([3, 1, 2])
  );
  assert.deepEqual(
    run(`PhaseGroupElement.phase_compose(${q}, ${p})`).json,
    permutation([2, 3, 1])
  );
  assert.deepEqual(
    run(`PhaseGroupElement.phase_identity(${p})`).json,
    permutation([1, 2, 3])
  );
});
check('runtime domain compatibility is independent of nominal type', () => {
  expectError(
    'PhaseGroupElement.phase_compose(PhaseResidue(5, 1), PhaseResidue(7, 1))',
    'phase-domain-mismatch'
  );
});
check('nominal payload construction does not certify bijectivity', () => {
  const invalid = run('PhasePermutation([1, 1, 1])');
  assert.equal(invalid.type.toString(), 'PhasePermutation');
  assert.deepEqual(invalid.json, permutation([1, 1, 1]));
});
check(
  'bounded Epsil closure contains exactly the six permutations of three points',
  () => {
    const elements = run(`phase_elements(${groupSource}, 6)`);
    assert.equal(elements.operator, 'List');
    assert.ok(isFunction(elements));
    const actual = elements.ops.map((x) => JSON.stringify(x.json)).sort();
    // Independent, complete mathematical fixture, not another closure algorithm.
    const expected = [
      [1, 2, 3],
      [1, 3, 2],
      [2, 1, 3],
      [2, 3, 1],
      [3, 1, 2],
      [3, 2, 1],
    ];
    assert.deepEqual(
      actual,
      expected.map((x) => JSON.stringify(permutation(x))).sort()
    );
  }
);
check(
  'closure refuses insufficient capacity and empty generator fixtures',
  () => {
    expectError(`phase_elements(${groupSource}, 5)`, 'phase-element-limit');
    expectError(`phase_elements(${groupSource}, 0)`, 'phase-element-limit');
    expectError(
      'phase_elements(PhasePermutationGroup([]), 6)',
      'phase-empty-generators'
    );
  }
);
check(
  'MathJSON reload preserves a group descriptor with definitions installed',
  () => {
    const group = run(groupSource);
    const serialized = JSON.stringify(group.json);
    const fresh = new ComputeEngine();
    run(model, fresh);
    const restored = fresh.box(JSON.parse(serialized)).evaluate();
    assert.deepEqual(restored.json, group.json);
    assert.equal(restored.type.toString(), 'PhasePermutationGroup');
    fresh.assign('phase_restored', restored);
    assert.equal(
      run('count(phase_elements(phase_restored, 6))', fresh).toString(),
      '6'
    );
    const bare = new ComputeEngine();
    assert.notEqual(
      bare.box(JSON.parse(serialized)).type.toString(),
      'PhasePermutationGroup'
    );
  }
);
check(
  'checkpoint restores values and permits protocol dispatch afterwards',
  () => {
    run(`let phase_saved = ${p}`);
    const checkpoint = ce.checkpoint();
    run(`phase_saved = ${q}`);
    assert.deepEqual(run('phase_saved').json, permutation([1, 3, 2]));
    ce.restore(checkpoint);
    assert.deepEqual(run('phase_saved').json, permutation([2, 1, 3]));
    assert.deepEqual(
      run('phase_square(phase_saved)').json,
      permutation([1, 2, 3])
    );
  }
);
check('exact integer larger than 2^53 survives JSON transport', () => {
  const exact = run('20!');
  assert.deepEqual(exact.json, { num: '2432902008176640000' });
  const fresh = new ComputeEngine();
  assert.deepEqual(
    fresh.box(JSON.parse(JSON.stringify(exact.json))).evaluate().json,
    exact.json
  );
});
check('Append nominal-type restriction is reproduced at this baseline', () => {
  const result = executeEpsil(
    ce,
    'function phase_append_probe(xs: list<PhasePermutation>, x: PhasePermutation) { append(xs, x) }'
  );
  assert.ok(result.diagnostics.some((x) => x.severity === 'error'));
  assert.ok(JSON.stringify(result.diagnostics).includes('incompatible-type'));
});
console.log(
  `${checks} research checks passed. No GAP executable or production group library used.`
);
