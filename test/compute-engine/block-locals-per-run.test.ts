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
  test('for loop (the reported case)', () => {
    expect(
      run(
        'let fs = []; for i in [1, 2] { fs = [...fs, () => k]; let k = i }; [fs[1](), fs[2]()]'
      )
    ).toEqual(['List', 1, 2]);
  });

  test('for loop inside a function', () => {
    expect(
      run(`function mk() { let fs = []; for i in [1, 2] { fs = [...fs, () => k]; let k = i * 10 }; fs }
let fs = mk()
(fs[1](), fs[2]())`)
    ).toEqual(['Tuple', 10, 20]);
  });

  test('while loop', () => {
    expect(
      run(
        'let fs = []; let j = 0; while j < 2 { j = j + 1; fs = [...fs, () => k]; let k = j * 10 }; [fs[1](), fs[2]()]'
      )
    ).toEqual(['List', 10, 20]);
  });

  test('if block in a loop body', () => {
    expect(
      run(
        'let fs = []; for i in [1, 2] { if true { fs = [...fs, () => k]; let k = i * 3 } }; [fs[1](), fs[2]()]'
      )
    ).toEqual(['List', 3, 6]);
  });

  test('do block', () => {
    expect(run('let f = do { let g = () => k; let k = 7; g }\nf()')).toEqual(7);
  });

  test('function body', () => {
    expect(
      run('function mk(n) { let g = () => k; let k = n * 2; g }\n(mk(1)(), mk(2)())')
    ).toEqual(['Tuple', 2, 4]);
  });

  test('`const` local', () => {
    expect(
      run(
        'let fs = []; for i in [1, 2] { fs = [...fs, () => k]; const k = i }; [fs[1](), fs[2]()]'
      )
    ).toEqual(['List', 1, 2]);
  });

  test('destructuring `let`', () => {
    expect(
      run(
        'let fs = []; for i in [1, 2] { fs = [...fs, () => a + b]; let (a, b) = (i, 10 * i) }; [fs[1](), fs[2]()]'
      )
    ).toEqual(['List', 11, 22]);
  });

  test('an assignment that changes the kind of the local is visible to the closure', () => {
    // `k = (x) => i * x` replaces the value definition of `k` with an
    // operator definition. The closure created before `let k = i` holds the
    // same binding record as the block, so it calls the function.
    expect(
      run(
        'let fs = []; for i in [1, 2] { fs = [...fs, () => k(5)]; let k = i; k = (x) => i * x }; [fs[1](), fs[2]()]'
      )
    ).toEqual(['List', 5, 10]);
  });

  test('a write after the `let` is visible to the closure of the same iteration', () => {
    expect(
      run(
        'let fs = []; for i in [1, 2] { fs = [...fs, () => k]; let k = i; k = k + 100 }; [fs[1](), fs[2]()]'
      )
    ).toEqual(['List', 101, 102]);
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

describe('a read before the `let` has run is an error', () => {
  test('a closure called before the `let` of its iteration', () => {
    expect(
      run('let r = 0; for i in [1, 2] { let f = () => k; r = f(); let k = i }; r')
    ).toEqual(READ_BEFORE_DECLARATION('k'));
  });

  test('a direct read in a block', () => {
    expect(run('let r = do { let a = k; let k = 2; a }\nr')).toEqual(
      READ_BEFORE_DECLARATION('k')
    );
  });

  test('a closure called before the `let` in a function body', () => {
    expect(
      run('function g() { let f = () => k; let r = f(); let k = 2; [r, f()] }\ng()')
    ).toEqual(READ_BEFORE_DECLARATION('k'));
  });

  test('a numeric read `N(k)` in a block', () => {
    expect(run('let r = do { N(k); let k = 2; 99 }\nr')).toEqual(
      READ_BEFORE_DECLARATION('k')
    );
    expect(run('let r = do { let a = N(k); let k = 2; a }\nr')).toEqual(
      READ_BEFORE_DECLARATION('k')
    );
  });

  test('an assignment before the `let` does not write the enclosing name', () => {
    expect(run('let k = 1\nlet r = do { k = 5; let k = 2; k }\n(r, k)')).toEqual([
      'Tuple',
      READ_BEFORE_DECLARATION('k'),
      1,
    ]);
  });

  test('a destructuring assignment before the `let`', () => {
    expect(run('let r = do { (k, j) := (5, 6); let k = 2; k }\nr')).toEqual(
      READ_BEFORE_DECLARATION('k')
    );
  });

  test('a closure that assigns the local, called before the `let`', () => {
    expect(
      run('let r = do { let f = () => do { k = 5 }; f(); let k = 2; k }\nr')
    ).toEqual(READ_BEFORE_DECLARATION('k'));
  });

  test('the error is reported as a runtime error of the statement', () => {
    const { diagnostics } = executeEpsil(
      new ComputeEngine(),
      'let r = do { let a = k; let k = 2; a }\nr'
    );
    expect(diagnostics.map((d) => d.message[0])).toEqual(['runtime-error']);
    expect(diagnostics[0].message.at(-1)).toBe('read-before-declaration');
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

describe('box route', () => {
  const declare = (name: string, value: unknown): unknown => [
    'Declare',
    name,
    ['Dictionary', ['KeyValuePair', { str: 'value' }, value]],
  ];

  const loop = (): unknown => [
    'Block',
    declare('fs', ['List']),
    [
      'Loop',
      [
        'Block',
        ['Assign', 'fs', ['List', ['Spread', 'fs'], ['Function', 'k']]],
        declare('k', 'i'),
      ],
      ['Element', 'i', ['List', 1, 2]],
    ],
    [
      'List',
      ['Apply', ['At', 'fs', 1]],
      ['Apply', ['At', 'fs', 2]],
    ],
  ];

  test('Loop over a Block with a closure before the Declare', () => {
    const ce = new ComputeEngine();
    expect(ce.box(loop() as any).evaluate().json).toEqual(['List', 1, 2]);
  });

  test('asynchronous evaluation', async () => {
    const ce = new ComputeEngine();
    const result = await ce.box(loop() as any).evaluateAsync();
    expect(result.json).toEqual(['List', 1, 2]);
  });

  test('a read before the Declare', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box([
          'Block',
          declare('a', 'k'),
          declare('k', 2),
          ['Hold', 'a'],
        ] as any)
        .evaluate().json
    ).toEqual(READ_BEFORE_DECLARATION('k'));
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
    expect(
      run('g(1)\nconst g = (x) => 2 * x\ng = 5')
    ).toEqual(['Error', ['ErrorCode', "'constant-assignment'", "'g'"]]);
  });
});
