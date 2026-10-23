import { ComputeEngine, compile } from '../../src/compute-engine';

// The type of a list literal reads a free symbol of type `unknown` as a
// number cell: `[x]` is a `vector<1>`. The signature of a function literal
// must not read a parameter of type `unknown` that way, since the parameter
// can receive any value: with `g := x ↦ [x]`, `g(Set(1, 2))` is
// `[Set(1, 2)]`, which a `vector<1>` does not hold. So the signature says
// only that the result is a list (user decision 2026-10-22). A call whose
// argument is a free symbol is typed as its value is, and keeps the reading
// of the list literal: `g(z)` is `[z]`, a `vector<1>`.

function signatureOf(ce: ComputeEngine, name: string, fn: any): string {
  ce.assign(name, ce.box(fn));
  return ce.box(name).type.toString();
}

describe('THE SIGNATURE OF A FUNCTION LITERAL THAT RETURNS A LIST', () => {
  test('a parameter of type unknown is not a number cell', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['List', 'x'], 'x']));
    expect(ce.box('g').type.toString()).toBe('(unknown) -> list<unknown>');
  });

  test('the parse route gives the same signature', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('x \\mapsto [x]'));
    expect(ce.box('g').type.toString()).toBe('(unknown) -> list<unknown>');
  });

  test('a function defined with `:=` gives the same signature', () => {
    const ce = new ComputeEngine();
    ce.parse('f(x) := [x]').evaluate();
    expect(ce.box('f').type.toString()).toBe('(unknown) -> list<unknown>');
  });

  test.each([
    // A parameter that a use narrowed is a number: `x + 1` types `x`.
    [
      'x ↦ [x + 1]',
      ['Function', ['List', ['Add', 'x', 1]], 'x'],
      '(unknown) -> vector<1>',
    ],
    [
      '(x: real) ↦ [x]',
      ['Function', ['List', 'x'], ['Typed', 'x', "'real'"]],
      '(x: real) -> vector<real^1>',
    ],
    [
      '(x, y) ↦ [x, y]',
      ['Function', ['List', 'x', 'y'], 'x', 'y'],
      '(unknown, unknown) -> list<unknown>',
    ],
    [
      'x ↦ [[x]]',
      ['Function', ['List', ['List', 'x']], 'x'],
      '(unknown) -> list<list<unknown>>',
    ],
    [
      'x ↦ [x, 1]',
      ['Function', ['List', 'x', 1], 'x'],
      '(unknown) -> list<unknown>',
    ],
    [
      'x ↦ ([x], 1)',
      ['Function', ['Tuple', ['List', 'x'], 1], 'x'],
      '(unknown) -> tuple<list<unknown>, integer>',
    ],
    [
      'x ↦ If(C, [x], [1])',
      ['Function', ['If', 'C', ['List', 'x'], ['List', 1]], 'x'],
      '(unknown) -> list<unknown>',
    ],
    [
      '((p, q)) ↦ [p, q]',
      ['Function', ['List', 'p', 'q'], ['Tuple', 'p', 'q']],
      '(unknown) -> list<unknown>',
    ],
    // An ascribed result is the author's contract and is kept.
    [
      'x ↦ [x] ascribed list<real>',
      ['Function', ['Typed', ['List', 'x'], "'list<real>'"], 'x'],
      '(unknown) -> list<real>',
    ],
  ])('%s', (_, fn, expected) => {
    expect(signatureOf(new ComputeEngine(), 'h', fn)).toBe(expected);
  });
});

describe('A CALL HOLDS ITS VALUE', () => {
  function engine(): ComputeEngine {
    const ce = new ComputeEngine();
    ce.assign('g', ce.box(['Function', ['List', 'x'], 'x']));
    ce.declare('s', 'set<integer>');
    ce.assign('s', ce.box(['Set', 1, 2]));
    return ce;
  }

  test.each([
    ['a set', 's', '[Set(1, 2)]'],
    ['a string', { str: 'hello' }, '["hello"]'],
    ['a list', ['List', 1, 2], '[[1],[2]]'],
    ['a number', 3, '[3]'],
  ])('the argument is %s', (_, arg, value) => {
    const ce = engine();
    const call = ce.box(['g', arg as any]);
    const result = call.evaluate();
    expect(result.toString()).toBe(value);
    expect(result.type.matches(call.type)).toBe(true);
  });

  test('the call over a set is not typed as a list of numbers', () => {
    const ce = engine();
    expect(ce.box(['g', 's']).type.toString()).toBe('list<unknown>');
  });

  // A free symbol is not evidence of a number (reading it as one is option
  // (b) of ROADMAP CE-25, rejected by the user on 2026-10-22): the call is
  // typed by the signature. The value `[z]` is a list literal with a free
  // symbol as its cell, which the literal typing reads as a number cell.
  test('a call with a free symbol is typed by the signature', () => {
    const ce = engine();
    const call = ce.box(['g', 'z']);
    expect(call.type.toString()).toBe('list<unknown>');
    expect(call.evaluate().type.toString()).toBe('vector<1>');
  });

  test('a call keeps the shape of a nested list literal', () => {
    const ce = new ComputeEngine();
    ce.assign('m', ce.parse('t \\mapsto [[t, 1], [2, 3]]'));
    ce.declare('r', 'real');
    expect(ce.box('m').type.toString()).toBe(
      '(unknown) -> list<list<unknown>>'
    );
    expect(ce.box(['m', 2]).type.toString()).toBe('matrix<integer^(2x2)>');
    expect(ce.box(['m', 'r']).type.toString()).toBe('matrix<real^(2x2)>');
    expect(ce.box(['m', 'z']).type.toString()).toBe('list<list<unknown>>');
  });
});

describe('AN OPERAND THAT MAY BE ABSENT OR OF UNKNOWN TYPE AT A DATA PARAMETER', () => {
  // `g(x)[1]` is typed `missing | unknown`. Validation admits it at a
  // parameter typed `string`, as it admits an operand typed `unknown` (both
  // are assumed to be valid); the evaluation checks the value, and refuses
  // a number, a list and an absent value with `incompatible-type`.
  test('boxes, and the evaluation checks the value', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('t \\mapsto [t, 2t]'));
    ce.declare('x', 'any');
    const expr = ce.box(['LatexString', ['At', ['g', 'x'], 1]]);
    expect(expr.isValid).toBe(true);
    expect(expr.type.toString()).toBe('string');
    for (const [value, expected] of [
      [3, '"string", "3"'],
      [['List', 1, 2], '"string", "vector<integer^2>"'],
      [['List'], '"string", "missing"'],
    ] as const) {
      ce.assign('x', ce.box(value as any));
      expect(expr.evaluate().toString()).toContain(
        `ErrorCode("incompatible-type", ${expected})`
      );
    }
    ce.assign('x', ce.string('ab'));
    expect(expr.evaluate().toString()).toBe('"ab"');
  });
});

describe('A USE DOES NOT REWRITE A SIGNATURE DERIVED FROM A BODY', () => {
  // A use of a call at a typed parameter refines a result that the body
  // leaves `unknown`, and nothing else. With `g := t ↦ [[t, 1], [2, 3]]`,
  // the use `Trace(g(2))` (the parameter of `Trace` is `number | tensor`)
  // widened the result of `g` to `list<list<unknown>> | number | tensor`,
  // and `Determinant(g(x))` then declined to compile ("operand is not an
  // indexed collection").
  test('a stated result that may fit the parameter is kept', () => {
    const ce = new ComputeEngine();
    ce.assign('g', ce.parse('t \\mapsto [[t, 1], [2, 3]]'));
    const before = ce.box('g').type.toString();
    expect(before).toBe('(unknown) -> list<list<unknown>>');
    ce.box(['Trace', ['g', 2]]);
    ce.box(['Add', ['Trace', ['g', 'x']], 1])
      .subs({ x: 2 })
      .N();
    expect(ce.box('g').type.toString()).toBe(before);
    const det = ce.parse('\\operatorname{Determinant}(g(x)) + 1');
    const result = compile(det, { to: 'javascript', fallback: false } as any);
    expect(result.run({ x: 2 })).toBe(5);
  });

  test('a result the body leaves unknown is refined by a use', () => {
    const ce = new ComputeEngine();
    ce.assign('k', ce.parse('x \\mapsto x'));
    expect(ce.box('k').type.toString()).toBe('(unknown) -> unknown');
    ce.box(['Add', ['k', 1], 2]);
    expect(ce.box('k').type.toString()).toBe('(unknown) -> real');
  });
});

describe('COMPILED FOLDS OVER ELEMENTS OF UNKNOWN TYPE', () => {
  // The elements of `L: list<unknown>` may be numbers or lists. The scalar
  // fold read two lists as numbers: the compiled `Sum(L)` was the string
  // `"01,23,4"` and the compiled `Product(L)` was `null` for a list of
  // rows. The fold now dispatches on each element, and checks the shapes
  // of two lists when it runs, as the interpreter does: a row beside a
  // matrix is an `incompatible-dimensions` error there, and the compiled
  // code throws.
  const toJson = (v: unknown): unknown =>
    Array.isArray(v) ? ['List', ...v.map(toJson)] : v;
  function both(
    json: unknown,
    L: unknown[]
  ): { interpreted: string; compiled: string } {
    const ce = new ComputeEngine();
    ce.declare('L', 'list<unknown>');
    const expr = ce.box(json as any);
    const run = compile(expr, {
      to: 'javascript',
      fallback: false,
    } as any).run!;
    let compiled: string;
    try {
      compiled = JSON.stringify(run({ L } as never));
    } catch {
      compiled = 'throws';
    }
    ce.assign('L', ce.box(['List', ...L.map(toJson)] as any));
    return { interpreted: expr.evaluate().toString(), compiled };
  }

  test.each([
    ['Sum', ['Sum', 'L']],
    ['Reduce(L, Add, 0)', ['Reduce', 'L', 'Add', 0]],
  ])('%s over numbers, rows and a mismatch', (_name, json) => {
    expect(both(json, [1, 2, 3])).toEqual({ interpreted: '6', compiled: '6' });
    expect(
      both(json, [
        [0, 1],
        [2, 3],
        [4, 5],
      ])
    ).toEqual({
      interpreted: '[6,9]',
      compiled: '[6,9]',
    });
    const mismatch = both(json, [
      [
        [1, 2],
        [3, 4],
      ],
      [5, 6],
    ]);
    expect(mismatch.interpreted).toMatch(/incompatible-dimensions/);
    expect(mismatch.compiled).toBe('throws');
  });

  // A product of two lists is the matrix product, which combines a matrix
  // and a row, and pairs the elements of ragged lists (ROADMAP CE-98,
  // CE-98.1): the compiled fold leaves the shapes to the run-time product.
  test.each([
    ['Product', ['Product', 'L']],
    ['Reduce(L, Multiply, 1)', ['Reduce', 'L', 'Multiply', 1]],
  ])(
    '%s over numbers, rows, a matrix and a row, and ragged rows',
    (_name, json) => {
      expect(both(json, [2, 3, 4])).toEqual({
        interpreted: '24',
        compiled: '24',
      });
      expect(
        both(json, [
          [1, 2],
          [3, 4],
        ])
      ).toEqual({
        interpreted: '[3,8]',
        compiled: '[3,8]',
      });
      expect(
        both(json, [
          [
            [1, 2],
            [3, 4],
          ],
          [5, 6],
        ])
      ).toEqual({
        interpreted: '[17,39]',
        compiled: '[17,39]',
      });
      expect(
        both(json, [
          [[1], [2, 3]],
          [[4], [5, 6]],
        ])
      ).toEqual({
        interpreted: '[[4],[10,18]]',
        compiled: '[[4],[10,18]]',
      });
    }
  );
});

describe('A COMPILED CALL OF A FUNCTION THAT RETURNS A LIST', () => {
  const MODES = ['strict', 'auto', 'complex'] as const;
  for (const mode of MODES) {
    test(`${mode}: g(x)[1] + g(x)[2], g := t ↦ [t, 2]`, () => {
      const ce = new ComputeEngine();
      ce.assign('g', ce.box(['Function', ['List', 't', 2], 't']));
      const expr = ce.box([
        'Add',
        ['At', ['g', 'x'], 1],
        ['At', ['g', 'x'], 2],
      ]);
      const run = () =>
        compile(expr, { to: 'javascript', mode, fallback: false } as any);
      // The signature of `g` says `list<unknown>`, so `g(x)[1]` is of
      // unknown type when `x` is a free input. The complex lane cannot
      // read an operand of unknown type as a scalar and declines (ROADMAP
      // CE-377: the compiler could commit a free input to the number
      // lane, as it does for `x + 1`).
      if (mode === 'complex') {
        expect(run).toThrow(/scalar arithmetic over a list-valued operand/);
        return;
      }
      expect(run().run({ x: 3 })).toBe(5);
    });

    test(`${mode}: Determinant(m(x)) + 1, m := t ↦ [[t, 1], [2, 3]]`, () => {
      const ce = new ComputeEngine();
      ce.assign('m', ce.parse('t \\mapsto [[t, 1], [2, 3]]'));
      const expr = ce.box(['Add', ['Determinant', ['m', 'x']], 1]);
      const result = compile(expr, {
        to: 'javascript',
        mode,
        fallback: false,
      } as any);
      expect(result.run({ x: 3 })).toBe(8);
    });
  }
});
