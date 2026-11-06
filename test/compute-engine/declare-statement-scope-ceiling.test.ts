import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// A named definition that states no effects must not write outside itself
// (`docs/EFFECTS-MODEL.md`, "Scope is opt-in"). A `Declare` statement checks
// this for a function literal written in the statement, when the binding goes
// in the global scope or in a scope that the host pushed. It does not check a
// local (a binding in the scope of a block or of a call), or a value that the
// statement computes, such as the closure that a factory returns.
//

const COUNTER = 'sc_ctr';
const writer = [
  'Function',
  ['Block', ['Assign', COUNTER, ['Add', COUNTER, 1]], COUNTER],
];

function engineWithCounter(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare(COUNTER, { type: 'number', value: 0 });
  return ce;
}

/** Evaluate the MathJSON `expr` and give the code of its error, if any. */
function errorCode(ce: ComputeEngine, expr: unknown): unknown {
  const json = ce.box(expr as never).evaluate().json;
  return Array.isArray(json) && json[0] === 'Error' ? json[1][1] : undefined;
}

const INCOMPATIBLE = "'incompatible-type'";

describe('a `Declare` statement in the global scope', () => {
  it.each([
    ['a declared signature', ['Declare', 'f', { str: '() -> number' }, writer]],
    ['no declared type', ['Declare', 'f', 'unknown', writer]],
    [
      'the attributes form',
      ['Declare', 'f', ['Dictionary', ['KeyValuePair', { str: 'value' }, writer]]],
    ],
  ])('refuses a writer with %s', (_label, statement) => {
    const ce = engineWithCounter();
    expect(errorCode(ce, statement)).toBe(INCOMPATIBLE);
    expect(ce.lookupDefinition('f')).toBeUndefined();
    expect(ce.box(COUNTER).evaluate().re).toBe(0);
  });

  it('installs a writer that states `scope`', () => {
    const ce = engineWithCounter();
    const statement = ['Declare', 'f', { str: '() scope -> number' }, writer];
    expect(errorCode(ce, statement)).toBeUndefined();
    expect(ce.box(['f'] as never).evaluate().re).toBe(1);
  });

  it('installs a literal that writes only its own local', () => {
    const ce = engineWithCounter();
    const own = [
      'Function',
      [
        'Block',
        ['Declare', 'k', 'integer', 1],
        ['Assign', 'k', ['Add', 'k', 1]],
        'k',
      ],
    ];
    expect(errorCode(ce, ['Declare', 'f', 'unknown', own])).toBeUndefined();
    expect(ce.box(['f'] as never).evaluate().re).toBe(2);
  });

  it('refuses on the asynchronous route too', async () => {
    const ce = engineWithCounter();
    const value = await ce
      .box(['Declare', 'f', { str: '() -> number' }, writer] as never)
      .evaluateAsync();
    expect((value.json as unknown[])[0]).toBe('Error');
    expect(ce.lookupDefinition('f')).toBeUndefined();
  });
});

describe('a `Declare` statement in a scope that the host pushed', () => {
  it('refuses a writer', () => {
    const ce = engineWithCounter();
    ce.pushScope();
    const statement = ['Declare', 'f', { str: '() -> number' }, writer];
    expect(errorCode(ce, statement)).toBe(INCOMPATIBLE);
    expect(ce.lookupDefinition('f')).toBeUndefined();
    ce.popScope();
  });
});

describe('a `Declare` statement that binds a local', () => {
  const writesLocal = [
    'Block',
    ['Declare', 'k', 'number', 0],
    [
      'Declare',
      'f',
      { str: '() -> number' },
      ['Function', ['Block', ['Assign', 'k', ['Add', 'k', 1]], 'k']],
    ],
    ['f'],
    ['f'],
    'k',
  ];

  it('installs the writer closure of a block', () => {
    expect(engineWithCounter().box(writesLocal as never).evaluate().re).toBe(2);
  });

  it('installs it in a block in a scope that the host pushed', () => {
    const ce = engineWithCounter();
    ce.pushScope();
    expect(ce.box(writesLocal as never).evaluate().re).toBe(2);
    ce.popScope();
  });

  it('installs it on the asynchronous route', async () => {
    const value = await engineWithCounter()
      .box(writesLocal as never)
      .evaluateAsync();
    expect(value.re).toBe(2);
  });

  it('installs it in the body of a function application', () => {
    const body = ['Function', writesLocal];
    expect(engineWithCounter().box([body] as never).evaluate().re).toBe(2);
  });
});

describe('a top-level `let` of an Epsil program', () => {
  const run = (source: string) => executeEpsil(new ComputeEngine(), source);
  const codes = (source: string) =>
    run(source).diagnostics.map((d) => (d.message as unknown[])[3]);

  it.each([
    ['let f: () -> number = () => do { c = c + 1; c }'],
    ['let f = () => do { c = c + 1; c }'],
    ['const f = () => do { c = c + 1; c }'],
  ])('`%s` is refused and the variable does not change', (statement) => {
    const result = run(`let c = 0\n${statement}\nf()\nc`);
    expect(result.value?.json).toBe(0);
    expect(
      result.diagnostics.map((d) => (d.message as unknown[])[3])
    ).toContain('incompatible-type');
  });

  it('a `let` of a program that states `scope` installs the writer', () => {
    const result = run(
      'let c = 0\nlet f: () scope -> number = () => do { c = c + 1; c }\nf()\nc'
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.value?.json).toBe(1);
  });

  it('is refused when a host runs the program in a scope that it pushed', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    const result = executeEpsil(
      ce,
      'let c = 0\nlet f = () => do { c = c + 1; c }\nf()\nc'
    );
    ce.popScope();
    expect(result.value?.json).toBe(0);
    expect(
      result.diagnostics.map((d) => (d.message as unknown[])[3])
    ).toContain('incompatible-type');
  });

  it('a `let` in a function body stays installable', () => {
    // The statements of a function body run in the frame of the call, which is
    // not the scope of an expression node.
    const result = run(
      'function h(x) { let g = () => do { x = x + 1; x }; 3 }\nh(1)'
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.value?.json).toBe(3);
  });

  it('a closure that a factory returns stays installable', () => {
    const factory =
      'let mk = () => do { let n = 0; () => do { n = n + 1; n } }\n';
    const result = run(`${factory}let counter = mk()\ncounter()\ncounter()`);
    expect(result.diagnostics).toEqual([]);
    expect(result.value?.json).toBe(2);
  });

  it('a block-local writer closure stays installable', () => {
    const result = run(
      'let r = do { let n = 0; let inc = () => do { n = n + 1; n }; inc(); inc() }\nr'
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.value?.json).toBe(2);
  });

  it('a copy of a function that states `scope` stays installable', () => {
    const result = run(
      'let c = 0\nfunction f() scope { c = c + 1; c }\nlet g = f\ng()\nc'
    );
    expect(result.diagnostics).toEqual([]);
    expect(result.value?.json).toBe(1);
  });

  it('a literal that reads the variable is not refused', () => {
    expect(codes('let c = 2\nlet f = () => c + 1\nf()')).toEqual([]);
  });
});

describe('a refused `Declare` statement', () => {
  it('leaves the binding of a previous run of a writer', () => {
    const ce = engineWithCounter();
    ce.box(['Declare', 'f', 'unknown', 5] as never).evaluate();
    const statement = ['Declare', 'f', 'unknown', writer];
    expect(errorCode(ce, statement)).toBe(INCOMPATIBLE);
    expect(ce.box('f').evaluate().re).toBe(5);
    ce.box(['Assign', 'f', 6] as never).evaluate();
    expect(ce.box('f').evaluate().re).toBe(6);
  });

  it('leaves the binding of a previous run of a value of another type', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let f = 5');
    expect(executeEpsil(ce, 'let f: string = 1').value?.json[0]).toBe('Error');
    expect(executeEpsil(ce, 'f').value?.json).toBe(5);
  });

  it('keeps the new binding when a dependent definition cannot be rebuilt', () => {
    // `g` waits on `a`. The two-parameter `a` is installed, and then the
    // rebuild of the body of `g` fails, so the statement throws. The binding
    // of `a` is committed, and it counts as a binding of this statement: a
    // second run replaces it, and it is not "already declared".
    const ce = new ComputeEngine();
    ce.parse('g(t)\\coloneq 2a(t)').evaluate();
    const declareA = [
      'Declare',
      'a',
      [
        'Dictionary',
        ['KeyValuePair', { str: 'value' }, ['Function', ['Add', 'x', 'y'], 'x', 'y']],
        ['KeyValuePair', { str: 'constant' }, 'True'],
      ],
    ];
    const declareAgain = () => ce.box(declareA as never).evaluate();
    expect(declareAgain).toThrow(/Invalid function/);
    expect(ce.box(['a', 1, 2] as never).evaluate().re).toBe(3);
    expect(declareAgain).toThrow(/Invalid function/);
    expect(ce.box(['a', 1, 2] as never).evaluate().re).toBe(3);
  });

  it('does not take over an explicit binding that it cannot replace', () => {
    const ce = new ComputeEngine();
    ce.declare('x', { type: 'number', value: 1 });
    const before = ce.lookupDefinition('x');
    const declareX = () =>
      ce.box(['Declare', 'x', 'unknown', 7] as never).evaluate();
    // A second run must not delete the binding as its own and declare again.
    expect(declareX).toThrow(/already declared/);
    expect(declareX).toThrow(/already declared/);
    expect(ce.lookupDefinition('x')).toBe(before);
    expect(ce.box('x').evaluate().re).toBe(1);
  });

  it('removes the constant mark of a refused `const`', () => {
    const ce = engineWithCounter();
    const statement = [
      'Declare',
      'f',
      [
        'Dictionary',
        ['KeyValuePair', { str: 'value' }, writer],
        ['KeyValuePair', { str: 'constant' }, 'True'],
      ],
    ];
    expect(errorCode(ce, statement)).toBe(INCOMPATIBLE);
    ce.box(['Assign', 'f', 5] as never).evaluate();
    expect(ce.box('f').evaluate().re).toBe(5);
  });

  it('does not stop a later statement from declaring the name', () => {
    const ce = engineWithCounter();
    ce.box(['Declare', 'f', 'unknown', 5] as never).evaluate();
    expect(errorCode(ce, ['Declare', 'f', 'unknown', writer])).toBe(
      INCOMPATIBLE
    );
    ce.box(['Declare', 'f', 'unknown', 7] as never).evaluate();
    expect(ce.box('f').evaluate().re).toBe(7);
  });
});

describe('`ce.declare()` of a closure that a factory returns', () => {
  const closure = (ce: ComputeEngine) => {
    executeEpsil(ce, 'function mk() { let n = 0; () => do { n = n + 1; n } }');
    return ce.box(['mk'] as never).evaluate();
  };

  it('needs a stated `scope`', () => {
    const ce = new ComputeEngine();
    const value = closure(ce);
    expect(() => ce.declare('counter', { value })).toThrow(/scope/);
    ce.declare('counter', { type: '() scope -> number', value });
    expect(ce.box(['counter'] as never).evaluate().re).toBe(1);
  });
});
