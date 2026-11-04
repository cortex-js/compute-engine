import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { checkSource } from '../../src/cli/check';

//
// The `let` and `const` locals of a block get their bindings when a run of
// the block starts (each iteration of a loop body, each run of an `if` or
// `do` block, each call of a function body), as in JavaScript
// (`createBlockLocals`, `src/compute-engine/function-utils.ts`; user
// decision 2026-10-17).
//
// A closure created in the body BEFORE the `let` of a local it reads then
// captures the binding of its own run, and the `let` writes the value into
// that binding. Before, the binding was created only when the `let` ran: the
// closure of the first iteration read the bare symbol and the closure of a
// later iteration read the binding of the previous iteration, so
// `for i in [1, 2] { fs = [...fs, () => k]; let k = i }` gave `[k, 1]`.
//
// A read of the local before its `let` has run in this run of the block is
// an error, `read-before-declaration` (the temporal dead zone of
// JavaScript).
//

function run(source: string): unknown {
  return executeEpsil(new ComputeEngine(), source).value?.json;
}

const READ_BEFORE_DECLARATION = (name: string) => [
  'Error',
  ['ErrorCode', "'read-before-declaration'", `'${name}'`],
];

describe('a closure created before a `let` of the same body', () => {
  test('do block', () => {
    expect(run('let f = do { let g = () => k; let k = 7; g }\nf()')).toEqual(7);
  });

  test('function body', () => {
    expect(
      run('function mk(n) { let g = () => k; let k = n * 2; g }\n(mk(1)(), mk(2)())')
    ).toEqual(['Tuple', 2, 4]);
  });

  test('the static check reports nothing for these programs', () => {
    for (const source of [
      'let fs = []; for i in [1, 2] { fs = [...fs, () => k]; let k = i }; [fs[1](), fs[2]()]',
      'let fs = []; let j = 0; while j < 2 { j = j + 1; fs = [...fs, () => k]; let k = j * 10 }; [fs[1](), fs[2]()]',
      'let f = do { let g = () => k; let k = 7; g }\nf()',
    ])
      expect([source, checkSource(source).diagnostics]).toEqual([source, []]);
  });
});

describe('what does not change', () => {
  test('the initializer of a shadowing `let` reads the outer name', () => {
    expect(
      run(
        'let t = 1\nlet xs = []\nfor k in 1..3 { let t = t * 2\n xs = Append(xs, t) }\n(t, xs)'
      )
    ).toEqual(['Tuple', 1, ['List', 2, 2, 2]]);
  });

  test('a recursive function literal in a block', () => {
    expect(
      run(
        'let r = do { let f = (n) => if n > 0 { n + f(n - 1) } else { 0 }; f(3) }\nr'
      )
    ).toEqual(6);
  });

  test('a top-level read before a later `let` stays symbolic', () => {
    // Top-level statements do not run as a block: each one runs in the
    // session scope, so `a` holds the symbol `k`, which later reads 2.
    expect(run('let a = k\nlet k = 2\na')).toEqual(2);
  });

  test('each call of a counter factory counts separately', () => {
    expect(
      run(`function mk() { let n = 0; () => do { n = n + 1; n } }
let c1 = mk()
let c2 = mk()
(c1(), c1(), c2())`)
    ).toEqual(['Tuple', 1, 2, 1]);
  });
});

//
// A top-level `const` whose value is a function literal, after an earlier
// statement that referenced the name (so the canonicalization auto-declared
// it). The `Declare` handler upgraded the auto-declared binding in place by
// assigning the literal, which made it an operator definition, and then
// threw "Cannot set properties of undefined (setting '_isConstant')". It now
// declares the constant as for a first declaration of the name.
//
describe('a `const` function declared after a reference to its name', () => {
  test('it is declared, and it is a constant', () => {
    const r = executeEpsil(
      new ComputeEngine(),
      'g(1)\nconst g = (x) => 2 * x\ng(3)'
    );
    expect(r.diagnostics).toEqual([]);
    expect(r.value.json).toEqual(6);
    expect(run('g(1)\nconst g = (x) => 2 * x\ng = 5')).toEqual([
      'Error',
      ['ErrorCode', "'constant-assignment'", "'g'"],
    ]);
  });
});
