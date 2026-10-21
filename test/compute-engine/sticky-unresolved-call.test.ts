import { ComputeEngine } from '../../src/compute-engine';

// The result of evaluating a call whose head has no value stays symbolic for
// the rest of the top-level evaluation that produced it, even when the name
// is assigned later in that evaluation (a later statement of a nested block,
// a later term of a `Sum`). A later top-level evaluation (a host call of
// `evaluate()`, the next statement of an Epsil program or of a block that
// the host evaluates) resolves it again. The original, unevaluated call is
// never sticky. Decided in
// `docs/plans/2026-10-21-function-declaration-hoisting.md`, rule 1.

/** `z ↦ z²` */
const SQUARE = ['Function', ['Power', 'z', 2], 'z'];

/** A nested block (the operand of a `List`, so not a program block) that
 * stores `g(3)`, then assigns `g`, then reads the stored value. */
const STORED_THEN_ASSIGNED = [
  'List',
  ['Block', ['Assign', 'r', ['g', 3]], ['Assign', 'g', SQUARE], 'r'],
];

/** The `Sum` of `test/compute-engine/batch9-evaluation.test.ts`: the term
 * `h(1)` is evaluated while `h` has no value, `h` is assigned at `k = 2`,
 * and the final fold evaluates `h(1)` again. */
const SUM_THAT_ASSIGNS = [
  'Sum',
  [
    'Block',
    [
      'If',
      ['Equal', 'k', 2],
      ['Assign', 'h', ['Function', ['Multiply', 2, 'z'], 'z']],
    ],
    ['h', 'k'],
  ],
  'k',
  1,
  3,
];

describe('inside one top-level evaluation, the result stays symbolic', () => {
  test('a stored result read after the assignment in a nested block', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(STORED_THEN_ASSIGNED as never)
        .evaluate()
        .toString()
    ).toBe('[g(3)]');
  });

  test('a term of a sum keeps the value it had before the assignment', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(SUM_THAT_ASSIGNS as never)
        .evaluate()
        .toString()
    ).toBe('10 + h(1)');
  });

  test('the other terms of a stored sum still evaluate', () => {
    const ce = new ComputeEngine();
    const value = ce
      .box([
        'List',
        [
          'Block',
          ['Assign', 'r', ['Add', ['g', 3], 'x']],
          ['Assign', 'x', 1],
          ['Assign', 'g', SQUARE],
          'r',
        ],
      ] as never)
      .evaluate();
    expect(value.toString()).toBe('[1 + g(3)]');
  });

  test('the operands of a sticky result still evaluate', () => {
    // `k` is assigned after `r ≔ h(k + 1)`, and the read of `r` evaluates
    // the operand `k + 1` to `3`, but does not resolve `h`.
    const ce = new ComputeEngine();
    const value = ce
      .box([
        'List',
        [
          'Block',
          ['Assign', 'r', ['h', ['Add', 'k', 1]]],
          ['Assign', 'k', 2],
          ['Assign', 'h', SQUARE],
          'r',
        ],
      ] as never)
      .evaluate();
    expect(value.toString()).toBe('[h(3)]');
  });

  test('a sticky result is not checked against a later definition', () => {
    // `g` is declared as a function with no definition. The function
    // assigned after the result was stored takes a string, and the stored
    // `g(3)` is not boxed again against it: it stays `g(3)`, with no
    // `incompatible-type` error.
    const ce = new ComputeEngine();
    ce.declare('g', 'function');
    const value = ce
      .box([
        'List',
        [
          'Block',
          ['Assign', 'r', ['g', 3]],
          ['Assign', 'g', ['Function', 'x', ['Typed', 'x', { str: 'string' }]]],
          'r',
        ],
      ] as never)
      .evaluate();
    expect(value.toString()).toBe('[g(3)]');
  });
});

describe('a later top-level evaluation resolves the result again', () => {
  test('a stored host result and the original call', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('g(3)');
    const r = e.evaluate();
    expect(r.toString()).toBe('g(3)');
    ce.assign('g', ce.parse('k \\mapsto k^2'));
    expect(r.evaluate().toString()).toBe('9');
    expect(e.evaluate().toString()).toBe('9');
  });

  test('the box route agrees', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['g', 3]);
    const r = e.evaluate();
    ce.assign('g', ce.parse('k \\mapsto k^2'));
    expect(r.evaluate().toString()).toBe('9');
    expect(e.evaluate().toString()).toBe('9');
  });

  test('a stored result that holds other terms', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('g(3) + x').evaluate();
    ce.assign('x', 1);
    ce.assign('g', ce.parse('k \\mapsto k^2'));
    expect(r.evaluate().toString()).toBe('10');
  });

  test('a result whose head still has no value stays symbolic', () => {
    const ce = new ComputeEngine();
    const e = ce.parse('h(k + 1)');
    const r = e.evaluate();
    ce.assign('k', 2);
    expect(r.evaluate().toString()).toBe('h(3)');
    expect(r.evaluate().evaluate().toString()).toBe('h(3)');
  });
});

describe('the asynchronous route agrees', () => {
  test('inside one top-level evaluation', async () => {
    const ce = new ComputeEngine();
    expect(
      (await ce.box(STORED_THEN_ASSIGNED as never).evaluateAsync()).toString()
    ).toBe('[g(3)]');
    expect(
      (await ce.box(SUM_THAT_ASSIGNS as never).evaluateAsync()).toString()
    ).toBe('10 + h(1)');
  });

  test('across top-level evaluations', async () => {
    const ce = new ComputeEngine();
    const e = ce.parse('g(3)');
    const r = await e.evaluateAsync();
    expect(r.toString()).toBe('g(3)');
    ce.assign('g', ce.parse('k \\mapsto k^2'));
    expect((await r.evaluateAsync()).toString()).toBe('9');
    expect((await e.evaluateAsync()).toString()).toBe('9');
  });
});

describe('a rebuilt expression', () => {
  test('a rebuilt expression resolves its head', () => {
    const ce = new ComputeEngine();
    const r = ce.parse('h(k + 1)').evaluate();
    ce.assign('h', ce.parse('k \\mapsto k^2'));
    expect(r.subs({ k: 2 }).evaluate().toString()).toBe('9');
  });
});

describe('a program block that is not canonical', () => {
  // A `Block` that the host evaluates directly is a program: each of its
  // statements is its own top-level evaluation, so the stored `fn(3)`
  // resolves when the last statement reads it. A block that is not
  // canonical is evaluated by its canonical form, one evaluation deeper;
  // it is still a program (`runsAsProgram()`, `library/control-structures.ts`).
  const PROGRAM = [
    'Block',
    ['Assign', 'r', ['fn', 3]],
    ['Assign', 'fn', ['Function', ['Multiply', 2, 'z'], 'z']],
    ['Tuple', 'r', ['fn', 3]],
  ];
  const routes: [
    string,
    (ce: ComputeEngine) => ReturnType<ComputeEngine['box']>,
  ][] = [
    ['canonical', (ce) => ce.box(PROGRAM as never)],
    ['raw', (ce) => ce.box(PROGRAM as never, { form: 'raw' })],
    ['structural', (ce) => ce.box(PROGRAM as never, { form: 'structural' })],
    [
      'structural ce.function',
      (ce) =>
        ce.function(
          'Block',
          PROGRAM.slice(1).map((s) => ce.box(s as never, { form: 'raw' })),
          { form: 'structural' }
        ),
    ],
  ];

  test.each(routes)('the %s route, synchronous', (_, make) => {
    const ce = new ComputeEngine();
    expect(make(ce).evaluate().toString()).toBe('(6, 6)');
  });

  test.each(routes)('the %s route, asynchronous', async (_, make) => {
    const ce = new ComputeEngine();
    expect((await make(ce).evaluateAsync()).toString()).toBe('(6, 6)');
  });

  test('a block that is not canonical, nested in a list, is not a program', async () => {
    const ce = new ComputeEngine();
    const raw = ce.box(STORED_THEN_ASSIGNED as never, { form: 'raw' });
    expect(raw.evaluate().toString()).toBe('[g(3)]');
    const ce2 = new ComputeEngine();
    const raw2 = ce2.box(STORED_THEN_ASSIGNED as never, { form: 'raw' });
    expect((await raw2.evaluateAsync()).toString()).toBe('[g(3)]');
  });
});

describe('the result of an unresolved call over the same operands', () => {
  test('keeps the source offsets of the call', () => {
    // A call whose head is not defined yet (a forward reference in a
    // block), with source offsets from a MathJSON object. Its evaluation
    // over the same operands is a copy of the call (the original is never
    // marked as a sticky result), and the copy keeps the metadata of the
    // call. A `ce.parse()` call (`f(x)`) carries no source offsets, and its
    // evaluation rebuilds the call through `ce.function()` instead of
    // copying it.
    const ce = new ComputeEngine();
    const call = { fn: ['h', 'y'], sourceOffsets: [5, 9] };
    const expr = ce.box([
      'List',
      ['Block', ['Assign', 'r', call], 'r'],
    ] as never);
    const original = expr.ops![0].ops![0].ops![1];
    expect(original.toString()).toBe('h(y)');
    expect(original.sourceOffsets).toEqual([5, 9]);
    const result = expr.evaluate().ops![0];
    expect(result.toString()).toBe('h(y)');
    expect(result).not.toBe(original);
    expect(result.sourceOffsets).toEqual([5, 9]);
  });
});

/** A block that stores `h(k)`, then assigns `h`, then reads the stored
 * value. As a program, the last statement resolves the stored call
 * (`2k`); as a nested block, it stays `h(k)`. */
function storeThenAssign(h: string): unknown[] {
  return [
    'Block',
    ['Assign', 'r', [h, 'k']],
    ['Assign', h, ['Function', ['Multiply', 2, 'z'], 'z']],
    'r',
  ];
}

describe('a block that is a value of a dictionary is not a program', () => {
  // The values of a dictionary are evaluated one level deeper, as the
  // operands of a `List` or a `Tuple` are, so the block is a nested block.
  // Before: the dictionary evaluated its values at the depth of the host
  // call, and `{"a" -> B}` was `{"a" -> 2k}` where `(B, 1)` is `(h(k), 1)`.
  const DICTIONARY = [
    'Dictionary',
    ['KeyValuePair', "'a'", storeThenAssign('h')],
  ];

  test('synchronous', () => {
    const ce = new ComputeEngine();
    expect(
      ce
        .box(DICTIONARY as never)
        .evaluate()
        .toString()
    ).toBe('{"a" -> h(k)}');
    expect(
      ce
        .box(['Tuple', storeThenAssign('h'), 1] as never)
        .evaluate()
        .toString()
    ).toBe('(h(k), 1)');
  });

  test('asynchronous', async () => {
    const ce = new ComputeEngine();
    expect((await ce.box(DICTIONARY as never).evaluateAsync()).toString()).toBe(
      '{"a" -> h(k)}'
    );
  });
});

describe('two host asynchronous evaluations of blocks at the same time', () => {
  // A known limitation. The asynchronous route takes a new top-level
  // evaluation number for a statement of a program block only while that
  // block is the only asynchronous evaluation that is pending on the engine
  // (`evaluateStatementsAsync`, `function-utils.ts`): asynchronous
  // evaluations that run at the same time share one number
  // (`evaluation-epoch.ts`). So two blocks that the host evaluates at the
  // same time run as nested blocks, and the stored call stays unresolved,
  // where the same two blocks awaited one after the other are programs.
  // Giving each asynchronous evaluation its own number is a redesign of
  // `evaluation-epoch.ts`, recorded in ROADMAP.md. This test pins the
  // current answers.
  test('at the same time, the stored calls stay unresolved', async () => {
    const ce = new ComputeEngine();
    const [a, b] = await Promise.all([
      ce.box(storeThenAssign('h') as never).evaluateAsync(),
      ce.box(storeThenAssign('q') as never).evaluateAsync(),
    ]);
    expect([a.toString(), b.toString()]).toEqual(['h(k)', 'q(k)']);
  });

  test('one after the other, each block is a program', async () => {
    const ce = new ComputeEngine();
    const a = await ce.box(storeThenAssign('h') as never).evaluateAsync();
    const b = await ce.box(storeThenAssign('q') as never).evaluateAsync();
    expect([a.toString(), b.toString()]).toEqual(['2k', '2k']);
  });
});
