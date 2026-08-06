import { ComputeEngine } from '../../src/compute-engine';

/**
 * Regression tests for the nested-`Block` scope-capture defect
 * (docs/plans/2026-07-07-block-scope-capture-investigation.md).
 *
 * A nested `Block` resolved symbols against the scope chain captured at
 * canonicalization time: a reference to an enclosing block's local — whose
 * `Declare`/`Assign` only register at *evaluation* time — auto-declared a
 * valueless shadow binding in the nested scope, permanently hiding the
 * enclosing block's runtime value. Fixed by hoisting `Declare`/`Assign`
 * targets into the block scope during canonicalization (`canonicalBlock`),
 * evaluating Element-loop bodies in the loop's own lexical scope
 * (`runNestedElements`), and letting a `Declare` statement reset the binding
 * it created on a previous evaluation of the same scope (re-entered Block).
 */

describe('nested Block reads enclosing Block locals', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('R1: nested Block reads an outer block-local', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 'k', { str: 'integer' }],
        ['Assign', 'k', 7],
        ['Block', 'k'],
      ])
      .evaluate();
    expect(result.toString()).toEqual('7');
  });

  test('R2: expression over an outer block-local in a nested Block', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 'g', { str: 'integer' }],
        ['Assign', 'g', 7],
        ['Block', ['Add', 'g', 1]],
      ])
      .evaluate();
    expect(result.toString()).toEqual('8');
  });

  test('R3: If condition inside a nested Block in a Loop resolves', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 'a', { str: 'integer' }],
        ['Assign', 'a', 0],
        [
          'Loop',
          [
            'Block',
            [
              'If',
              ['Less', 'a', 5],
              ['Assign', 'a', ['Add', 'a', 1]],
              ['Break'],
            ],
          ],
        ],
        'a',
      ])
      .evaluate();
    expect(result.toString()).toEqual('5');
  });

  test('R4: while-style loop with write-then-read Block body', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 'm', { str: 'integer' }],
        ['Assign', 'm', 0],
        [
          'Loop',
          [
            'Block',
            ['If', ['Not', ['Less', 'm', 5]], ['Break']],
            ['Assign', 'm', ['Add', 'm', 1]],
          ],
        ],
        'm',
      ])
      .evaluate();
    expect(result.toString()).toEqual('5');
  });

  test('R5: Element-form Loop with a Block body reading the loop variable', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 's', { str: 'integer' }],
        ['Assign', 's', 0],
        [
          'Loop',
          ['Block', ['Assign', 's', ['Add', 's', 'n']]],
          ['Element', 'n', ['Range', 1, 5]],
        ],
        's',
      ])
      .evaluate();
    expect(result.toString()).toEqual('15');
  });
});

describe('re-entered scopes (warm engine / repeated evaluation)', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('the same Block object with a Declare can be evaluated twice', () => {
    const expr = ce.expr([
      'Block',
      ['Declare', 'm', { str: 'integer' }],
      ['Assign', 'm', 0],
      [
        'Loop',
        [
          'Block',
          ['If', ['Not', ['Less', 'm', 5]], ['Break']],
          ['Assign', 'm', ['Add', 'm', 1]],
        ],
      ],
      'm',
    ]);
    expect(expr.evaluate().toString()).toEqual('5');
    expect(expr.evaluate().toString()).toEqual('5');
  });

  test('a Declare inside a Loop body Block re-executes on each iteration', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 'acc', { str: 'integer' }],
        ['Assign', 'acc', 0],
        [
          'Loop',
          [
            'Block',
            ['Declare', 't', { str: 'integer' }],
            ['Assign', 't', 'n'],
            ['Assign', 'acc', ['Add', 'acc', 't']],
          ],
          ['Element', 'n', ['Range', 1, 3]],
        ],
        'acc',
      ])
      .evaluate();
    expect(result.toString()).toEqual('6');
  });
});

describe('nested Blocks inside function bodies', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('a nested Block reads a body-local of an n-ary function', () => {
    ce.declare('gg', '(integer) -> integer');
    ce.assign(
      'gg',
      ce.expr([
        'Function',
        [
          'Block',
          ['Declare', 'q', { str: 'integer' }],
          ['Assign', 'q', ['Add', 'x', 5]],
          ['Block', 'q'],
        ],
        'x',
      ])
    );
    expect(ce.expr(['gg', 2]).evaluate().toString()).toEqual('7');
  });

  test('a while-style Loop body inside a function reads the parameter', () => {
    // The Cortex `fn f(n) { while … }` lowering shape: the parameter is
    // referenced from a Block nested two levels below the function body.
    ce.declare('sumto', '(integer) -> integer');
    ce.assign(
      'sumto',
      ce.expr([
        'Function',
        [
          'Block',
          ['Declare', 'acc', { str: 'integer' }],
          ['Assign', 'acc', 0],
          ['Declare', 'i2', { str: 'integer' }],
          ['Assign', 'i2', 1],
          [
            'Loop',
            [
              'Block',
              ['If', ['Greater', 'i2', 'nn'], ['Break']],
              ['Assign', 'acc', ['Add', 'acc', 'i2']],
              ['Assign', 'i2', ['Add', 'i2', 1]],
            ],
          ],
          'acc',
        ],
        'nn',
      ])
    );
    expect(ce.expr(['sumto', 4]).evaluate().toString()).toEqual('10');
    // Repeated calls must not see state from the previous call.
    expect(ce.expr(['sumto', 5]).evaluate().toString()).toEqual('15');
  });

  test('closure capture still works (curried adder)', () => {
    ce.declare('adder', '(integer) -> ((integer) -> integer)');
    ce.assign(
      'adder',
      ce.expr(['Function', ['Function', ['Add', 'a', 'b'], 'b'], 'a'])
    );
    expect(ce.expr([['adder', 3], 4]).evaluate().toString()).toEqual('7');
  });
});

describe('block-local semantics preserved', () => {
  let ce: ComputeEngine;
  beforeEach(() => {
    ce = new ComputeEngine();
  });

  test('an inner Declare shadows the outer block-local', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 'k', { str: 'integer' }],
        ['Assign', 'k', 7],
        ['Block', ['Declare', 'k', { str: 'integer' }], ['Assign', 'k', 2], 'k'],
        'k',
      ])
      .evaluate();
    // The inner block's k=2 must not overwrite the outer k=7.
    expect(result.toString()).toEqual('7');
  });

  test('a nested Block assignment updates the outer block-local', () => {
    const result = ce
      .expr([
        'Block',
        ['Declare', 'k', { str: 'integer' }],
        ['Assign', 'k', 0],
        ['Block', ['Assign', 'k', 5]],
        'k',
      ])
      .evaluate();
    expect(result.toString()).toEqual('5');
  });

  test('Assign without a Declare stays block-local (no leak)', () => {
    ce.expr(['Block', ['Assign', 'zzlocal', 5]]).evaluate();
    // zzlocal must not be visible (with a value) outside the block:
    // it evaluates to itself, not to 5.
    expect(ce.symbol('zzlocal').evaluate().symbol).toEqual('zzlocal');
  });

  test('assignment to a declared enclosing variable is visible after', () => {
    ce.declare('zzouter', { type: 'integer', value: 1 });
    ce.expr(['Block', ['Assign', 'zzouter', 42]]).evaluate();
    expect(ce.symbol('zzouter').evaluate().toString()).toEqual('42');
  });
});

//
// ANNOTATED PARAMETER read from a nested Block (2026-08-06).
//
// `evaluateBlock` sweeps stale canonicalization bookkeeping from the block's
// scope, and the keep-test used to be "is its type inferred". An auto-declared
// shadow inherits the DECLARED type of the outer binding it shadows, so an
// annotated parameter produced an explicitly-typed valueless shadow that
// survived the sweep and hid the call value in the lambda's fresh scope. The
// keep-test is now "was this created by a `Declare` STATEMENT".
//
// Surfaced through Cortex, which wraps each `if` branch in a `Block`:
//   function s(k: number) { if 1 > 0 { k } else { 0 } };  s(100)   ⇒ `k`
// The same function with a bare `k` returned `100`.
//
describe('annotated parameter read from a nested Block', () => {
  const ifBody = [
    'Block',
    ['If', ['Greater', 1, 0], ['Block', 'k'], ['Block', 0]],
  ];

  const call = (param: any, declarator: 'Assign' | 'DefineFunction'): string => {
    const ce = new ComputeEngine();
    ce.box([declarator, 's', ['Function', ifBody, param]] as any).evaluate();
    return ce.box(['s', 100]).evaluate().toString();
  };

  const TYPED = ['Typed', 'k', { str: 'number' }];

  test('a Typed parameter resolves through an If-branch Block', () => {
    expect(call(TYPED, 'Assign')).toBe('100');
  });

  test('the same on the DefineFunction route', () => {
    expect(call(TYPED, 'DefineFunction')).toBe('100');
  });

  test('a bare parameter still resolves (unchanged)', () => {
    expect(call('k', 'Assign')).toBe('100');
    expect(call('k', 'DefineFunction')).toBe('100');
  });

  test('the else branch too', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      's',
      [
        'Function',
        ['Block', ['If', ['Less', 1, 0], ['Block', 0], ['Block', 'k']]],
        TYPED,
      ],
    ] as any).evaluate();
    expect(ce.box(['s', 100]).evaluate().toString()).toBe('100');
  });

  // The sweep must still KEEP a genuine block-local: a `Declare` statement
  // marks its binding, and re-entering the block resets rather than sweeps it.
  test('a block-local declared with an explicit type survives', () => {
    const ce = new ComputeEngine();
    ce.box([
      'Assign',
      's',
      [
        'Function',
        [
          'Block',
          ['Declare', 'local', { str: 'number' }, ['Dictionary', ['KeyValuePair', 'value', 7]]],
          ['Add', 'local', 'k'],
        ],
        TYPED,
      ],
    ] as any).evaluate();
    expect(ce.box(['s', 100]).evaluate().toString()).toBe('107');
    // Re-entering the same block (second call) must not accumulate or stale.
    expect(ce.box(['s', 1]).evaluate().toString()).toBe('8');
  });
});

//
// NESTED SCOPED BLOCK inside an escaping closure (2026-08-06).
//
// `captureClosures` rebinds a returned `Function` literal so its body Block
// closes over the call's fresh scope — but it reused the body's ops verbatim,
// so a scoped `Block` NESTED in that body (an `If` branch, a loop body) kept
// its canonicalization-time parent chain and reached the stale copies of the
// same lexical levels instead of the captured ones.
//
// Invisible for an arithmetic body, whose symbols live directly in the body
// Block that IS rebuilt; visible the moment a held operand introduces a scope.
// `If`'s branches are the common case, and Cortex compiles every `if` branch
// to a Block, so `(x) |-> if x > 1 { k } else { 0 }` lost `k`.
//
describe('nested scoped Block in an escaping closure', () => {
  /** `s = k |-> (x |-> body)`; returns `s(100)(2)`. */
  const nested = (body: any): string => {
    const ce = new ComputeEngine();
    ce.assign(
      's',
      ce.box(['Function', ['Block', ['Function', body, 'x']], 'k']) as any
    );
    const inner = ce.box(['s', 100]).evaluate();
    return ce.box(['Apply', inner, 2]).evaluate().toString();
  };

  test('an If branch Block resolves the captured variable', () => {
    expect(
      nested(['If', ['Greater', 'x', 1], ['Block', 'k'], ['Block', 0]])
    ).toBe('100');
  });

  test('the else branch too', () => {
    expect(
      nested(['If', ['Less', 'x', 1], ['Block', 0], ['Block', 'k']])
    ).toBe('100');
  });

  test('an expression inside the branch Block', () => {
    expect(
      nested([
        'If',
        ['Greater', 'x', 1],
        ['Block', ['Add', 'k', 1]],
        ['Block', 0],
      ])
    ).toBe('101');
  });

  test('the branch sees the inner parameter as well as the captured one', () => {
    expect(
      nested([
        'If',
        ['Greater', 'x', 1],
        ['Block', ['Add', 'x', 'k']],
        ['Block', 0],
      ])
    ).toBe('102');
  });

  // Shapes that already worked — they must keep working.
  test('bare If branches (no nested scope)', () => {
    expect(nested(['If', ['Greater', 'x', 1], 'k', 0])).toBe('100');
  });

  test('a plain nested Block', () => {
    expect(nested(['Block', 'k'])).toBe('100');
  });

  test('an arithmetic body', () => {
    expect(nested(['Add', 'x', 'k'])).toBe('102');
  });

  // The drain case this started from: the lazy Map holds the lambda, so the
  // branch Block is evaluated well after the defining call returned.
  test('through a lazy Map drained by the caller', () => {
    const ce = new ComputeEngine();
    ce.assign(
      's',
      ce.box([
        'Function',
        [
          'Map',
          ['List', 1, 2],
          [
            'Function',
            ['If', ['Greater', 'x', 1], ['Block', 'k'], ['Block', 0]],
            'x',
          ],
        ],
        'k',
      ]) as any
    );
    expect(ce.box(['s', 100]).evaluate().toString()).toBe('[0,100]');
  });
});

//
// REVIEW FINDINGS (2026-08-06 dual review of the closure-capture change).
//
// The scoped-expression branch of `captureClosures` has to do BOTH things:
// re-root the scope onto the captured chain, and COPY its bindings. Each half
// was got wrong once and each has its own failure mode.
//
describe('captureClosures: scoped-expression re-rooting', () => {
  // COPY: `expr` is the canonicalization template shared by every closure made
  // from this literal, and the scope is mutated at evaluation. Aliasing the
  // Map gave overlapping activations one frame, so a nested call clobbered an
  // outer call's local before it was read back.
  test('recursion through an escaping closure keeps each frame’s locals', () => {
    const ce = new ComputeEngine();
    // make = k ↦ (n ↦ if n > 0 { let y = k; y + make(k+1)(n-1) } else { k })
    ce.box([
      'Assign',
      'make',
      [
        'Function',
        [
          'Block',
          [
            'Function',
            [
              'Block',
              [
                'If',
                ['Greater', 'n', 0],
                [
                  'Block',
                  ['Declare', 'y', ['Dictionary', ['KeyValuePair', 'value', 'k']]],
                  ['Add', 'y', ['Apply', ['make', ['Add', 'k', 1]], ['Subtract', 'n', 1]]],
                ],
                ['Block', 'k'],
              ],
            ],
            'n',
          ],
        ],
        'k',
      ],
    ] as any).evaluate();
    // 0 + (1 + (2 + 3)) = 6; the aliased-Map bug produced 9.
    expect(
      ce.box(['Apply', ['make', 0], 3]).evaluate().toString()
    ).toBe('6');
  });

  // RE-ROOT: a binder owns the scope declaring its index. Dropping that scope
  // resolved the index against the enclosing chain (`i` → the imaginary unit,
  // a hard throw); preserving it verbatim kept the stale parent chain, so the
  // captured variable read as unbound and a loop body silently produced 0.
  const binder = (body: any): string => {
    const ce = new ComputeEngine();
    ce.assign(
      'make',
      ce.box(['Function', ['Block', ['Function', ['Block', body], 'n']], 'k']) as any
    );
    const inner = ce.box(['make', 2]).evaluate();
    return ce.box(['Apply', inner, 3]).evaluate().toString();
  };

  test('a Sum binder inside an escaping closure resolves the capture', () => {
    expect(binder(['Sum', ['Multiply', 'i', 'k'], ['Limits', 'i', 1, 'n']])).toBe(
      '12'
    );
  });

  test('the same when the binder body holds a nested scoped Block', () => {
    expect(
      binder([
        'Sum',
        [
          'If',
          ['Greater', 'i', 0],
          ['Block', ['Multiply', 'i', 'k']],
          ['Block', 0],
        ],
        ['Limits', 'i', 1, 'n'],
      ])
    ).toBe('12');
  });
});
