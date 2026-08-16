import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';

/**
 * Compiled counterpart of `filter-predicate-errors.test.ts`.
 *
 * The interpreter surfaces an Error VALUE per element when a callback's
 * `Typed`-parameter annotation rejects the element it is applied to (the
 * annotation-as-contract ruling,
 * `docs/plans/2026-08-08-lambda-param-element-inference.md` ruling 2). A
 * compiled callback is a plain arrow / Python lambda — the annotation is not
 * emitted at all — so before this gate landed
 *
 *     Filter(ds, (n: finite_integer) ↦ n > 0)   over   [1.5, 2.5]
 *
 * compiled to `((_f) => (_.ds).filter((_x) => _f(_x)))(((n) => 0 < n))` and RAN
 * to `[1.5, 2.5]` where the interpreter answers two `Error`s. Same for `Map`,
 * `TakeWhile`, `DropWhile` and every sibling callback consumer, on the
 * JavaScript and Python targets alike.
 *
 * A compiled target has no Error VALUE to produce, so exact parity is out of
 * reach. The invariant is the weaker one — NO SILENTLY WRONG VALUES — and the
 * resolution is to fail closed (D6): the shape declines, `compile()` reports
 * `success: false`, and the interpreter (which does enforce) evaluates it.
 * An annotation the argument type PROVABLY satisfies is enforcement-free, so it
 * still compiles, byte-identically — the same admission rule `lowerLevel` uses
 * for the fused per-element bypass (`annotationSatisfiedBySource`).
 */

const python = new PythonTarget();

/** `["Function", <body>, ["Typed", <param>, <type>]]` — an annotated callback. */
const annotated = (param: string, type: string, body: unknown) => [
  'Function',
  body,
  ['Typed', param, `'${type}'`],
];

/** Compile on the JavaScript target, never falling back. */
const js = (expr: any, options: Record<string, unknown> = {}) =>
  compile(expr, { fallback: false, ...options });

/** The element-consuming callback consumers, with a body of the right kind. */
const PREDICATE_OPS = [
  'Filter',
  'TakeWhile',
  'DropWhile',
  'CountIf',
  'Find',
  'IndexWhere',
  'Position',
  'Any',
  'All',
] as const;

const opBody = (op: string, p: string) =>
  op === 'Map' || op === 'FlatMap' ? ['Add', p, 1] : ['Greater', p, 0];

/** `[op, …]` with the operands in the order that operator declares: `Map`
 * takes its mapping function FIRST, every other callback consumer here takes
 * the source collection first. */
const opCall = (op: string, source: any, callback: any): any =>
  op === 'Map' ? [op, callback, source] : [op, source, callback];

describe('Compiled callbacks with an unenforceable parameter annotation', () => {
  for (const op of [...PREDICATE_OPS, 'Map', 'FlatMap'] as const) {
    describe(op, () => {
      /** `ds: list<number>` — a float element does not satisfy the
       * `finite_integer` annotation, and nothing proves it does. */
      const violating = () => {
        const ce = new ComputeEngine();
        ce.declare('ds', 'list<number>');
        return ce.box(
          opCall(op, 'ds', annotated('n', 'finite_integer', opBody(op, 'n')))
        );
      };

      it('fails closed on the JavaScript target', () => {
        expect(() => js(violating())).toThrow(
          /callback parameter 'n' is annotated 'finite_integer'/
        );
        expect(() => js(violating())).toThrow(/Fail closed \(D6\)/);
      });

      it('fails closed on the Python target', () => {
        expect(() => python.compile(violating())).toThrow(
          /callback parameter 'n' is annotated 'finite_integer'/
        );
      });

      it('reports success: false (not a silent value) with fallback on', () => {
        const r = compile(violating(), { fallback: true });
        expect(r.success).toBe(false);
        expect(String(r.error)).toContain('finite_integer');
      });

      it('compiles when the element type provably satisfies the annotation', () => {
        const ce = new ComputeEngine();
        ce.declare('ds', 'list<finite_integer>');
        const expr = ce.box(
          opCall(op, 'ds', annotated('n', 'finite_integer', opBody(op, 'n')))
        );
        const r = js(expr);
        expect(r.success).toBe(true);
        expect(python.compile(expr).success).toBe(true);
      });
    });
  }
});

describe('Compiled callback run parity on valid input', () => {
  /** Interpreted value of `op` over `xs`, as a plain JS array/number. */
  const interpreted = (op: string, xs: number[]) => {
    const ce = new ComputeEngine();
    return ce
      .box(
        opCall(op, ['List', ...xs], annotated('n', 'integer', opBody(op, 'n')))
      )
      .evaluate();
  };

  const XS = [1, 2, -3, 4];

  for (const [op, expected] of [
    ['Filter', [1, 2, 4]],
    ['TakeWhile', [1, 2]],
    ['DropWhile', [-3, 4]],
    ['Map', [2, 3, -2, 5]],
    ['FlatMap', [2, 3, -2, 5]],
    ['CountIf', 3],
    ['IndexWhere', 1],
    ['Position', [1, 2, 4]],
    ['Find', 1],
  ] as const) {
    it(`${op} compiles and matches the interpreter`, () => {
      const ce = new ComputeEngine();
      // A LITERAL integer list: its element type provably satisfies the
      // annotation, so the callback compiles with the annotation dropped —
      // provably a no-op.
      const expr = ce.box(
        opCall(op, ['List', ...XS], annotated('n', 'integer', opBody(op, 'n')))
      );
      const r = js(expr);
      expect(r.success).toBe(true);
      expect(r.run!({})).toEqual(expected);
      // ...and the interpreter agrees.
      const want = interpreted(op, [...XS]);
      expect(
        Array.isArray(expected)
          ? [...(want as any).each()].map((x: any) => x.re)
          : (want as any).re
      ).toEqual(expected);
    });
  }

  it('Any/All compile and match the interpreter', () => {
    const ce = new ComputeEngine();
    for (const [op, expected] of [
      ['Any', true],
      ['All', false],
    ] as const) {
      const expr = ce.box([
        op,
        ['List', ...XS],
        annotated('n', 'integer', opBody(op, 'n')),
      ]);
      const r = js(expr);
      expect(r.success).toBe(true);
      expect(r.run!({})).toBe(expected);
      expect(expr.evaluate().symbol).toBe(expected ? 'True' : 'False');
    }
  });
});

/**
 * The exact retraction repro of `filter-predicate-errors.test.ts`: the
 * parameter is auto-annotated from the source's element type at
 * canonicalization; RETRACTING the source to floats makes that annotation
 * unsatisfiable. The interpreter emits an Error per element; the compiled
 * lowering must not answer with the elements themselves.
 */
describe('the retraction repro', () => {
  const retracted = () => {
    const ce = new ComputeEngine();
    ce.assign('ds', ce.box(['List', 1, 2, 3]));
    const expr = ce.box([
      'Filter',
      'ds',
      ['Function', ['Greater', 'n', 0], 'n'],
    ]);
    // The parameter is stamped from the (integer) element type...
    expect(expr.toMathJson()).toEqual([
      'Filter',
      'ds',
      ['Function', ['Less', 0, 'n'], ['Typed', 'n', "'finite_integer'"]],
    ]);
    // ...and compiles while the source still satisfies it.
    expect(js(expr).run!({})).toEqual([1, 2, 3]);
    ce.assign('ds', ce.box(['List', 1.5, 2.5]));
    return expr;
  };

  it('declines on the JavaScript target once the source retracts', () => {
    expect(() => js(retracted())).toThrow(/Fail closed \(D6\)/);
  });

  it('declines on the Python target once the source retracts', () => {
    expect(() => python.compile(retracted())).toThrow(/finite_integer/);
  });

  it('the interpreter answers with per-element errors', () => {
    expect(retracted().evaluate().toString()).toContain('incompatible-type');
  });
});

/**
 * A SYMBOL naming an annotated user function is the same class: the emitted
 * definition drops the annotation exactly as an inline arrow does.
 */
describe('a symbol-valued annotated callback', () => {
  const withNamed = (elementType: string) => {
    const ce = new ComputeEngine();
    ce.assign(
      'p',
      ce.box([
        'Function',
        ['Greater', 'n', 0],
        ['Typed', 'n', "'finite_integer'"],
      ])
    );
    ce.declare('ds', `list<${elementType}>`);
    return ce.box(['Filter', 'ds', 'p']);
  };

  it('fails closed when the element type does not satisfy the annotation', () => {
    expect(() => js(withNamed('number'))).toThrow(/Fail closed \(D6\)/);
    expect(() => python.compile(withNamed('number'))).toThrow(/finite_integer/);
  });

  it('compiles when it does', () => {
    expect(js(withNamed('finite_integer')).success).toBe(true);
  });
});

/**
 * Combiner- and index-shaped callbacks. `Reduce`/`Scan` pass
 * `(accumulator, element)`: the accumulator's type is the fold's own result and
 * is not provable, so an annotation THERE always declines. `Tabulate`/`Fill`
 * pass 1-based integer indexes, which an `integer` annotation provably
 * satisfies.
 */
describe('combiner and index callbacks', () => {
  const reduceExpr = (
    accType: string | null,
    elType: string,
    sourceElType = 'finite_integer'
  ) => {
    const ce = new ComputeEngine();
    ce.declare('ds', `list<${sourceElType}>`);
    const acc = accType === null ? 'a' : ['Typed', 'a', `'${accType}'`];
    return ce.box([
      'Reduce',
      'ds',
      ['Function', ['Add', 'a', 'n'], acc, ['Typed', 'n', `'${elType}'`]],
      0,
    ]);
  };

  it('Reduce declines an annotated accumulator (its type is not provable)', () => {
    expect(() => js(reduceExpr('integer', 'finite_integer'))).toThrow(
      /callback parameter 'a'/
    );
  });

  it('Reduce admits an element annotation the source satisfies', () => {
    expect(js(reduceExpr(null, 'finite_integer')).success).toBe(true);
  });

  it('Reduce declines an element annotation the source does not satisfy', () => {
    expect(() => js(reduceExpr(null, 'finite_integer', 'number'))).toThrow(
      /callback parameter 'n'/
    );
  });

  // Each operator gets a generator of the arity IT applies: `Tabulate(f, n)`
  // computes `f(i)` while `Fill(f, (rows, cols))` computes `f(i, j)`. The
  // extra `Fill` parameter is not incidental — a UNARY generator there is an
  // arity error the interpreter raises the moment an element is produced, and
  // the static callback-arity check (2026-08-15) now rejects the call before
  // it can reach the compiler at all. Passing one here tested the compiler
  // against an expression the interpreter never accepted.
  for (const op of ['Tabulate', 'Fill'] as const) {
    const dims = op === 'Tabulate' ? [3] : [['Tuple', 2, 2]];
    const params = (type: string) =>
      op === 'Tabulate'
        ? [['Typed', 'i', type]]
        : [['Typed', 'i', type], ['Typed', 'j', type]];
    it(`${op} admits an integer-annotated index parameter`, () => {
      const ce = new ComputeEngine();
      const expr = ce.box([
        op,
        ['Function', ['Multiply', 2, 'i'], ...params("'integer'")],
        ...(dims as any),
      ] as any);
      expect(js(expr).success).toBe(true);
    });

    // A BOUNDED index annotation is narrower than the `integer` the lowering
    // provides: the interpreter reports the out-of-range index as an Error
    // element (`Tabulate((i: integer<1..2>) ↦ 2i, 3)` → `[2, 4, Error(…)]`),
    // which the compiled index loop cannot reproduce.
    it(`${op} declines an index parameter annotated narrower than integer`, () => {
      const ce = new ComputeEngine();
      const expr = ce.box([
        op,
        ['Function', ['Multiply', 2, 'i'], ...params("'integer<1..2>'")],
        ...(dims as any),
      ] as any);
      expect(() => js(expr)).toThrow(/Fail closed \(D6\)/);
    });
  }
});

/**
 * The gate is invisible to everything it does not apply to: an UNANNOTATED
 * callback compiles byte-identically, on both targets.
 */
describe('unannotated callbacks are untouched', () => {
  it('emits the same JavaScript and Python as before the gate', () => {
    const ce = new ComputeEngine();
    ce.declare('ds', 'list<number>');
    const expr = ce.box([
      'Filter',
      'ds',
      ['Function', ['Greater', 'n', 0], 'n'],
    ]);
    expect(js(expr).code).toBe(
      '((_f) => (_.ds).filter((_x) => _f(_x)))(((n) => 0 < n))'
    );
    expect(python.compile(expr).code).toBe(
      '(lambda _f: [_x for _x in ds if _f(_x)])((lambda n: 0 < n))'
    );
  });
});

/**
 * The union-round hardening pin (2026-08-09).
 *
 * The element-type inference never stamps a UNION element type — that
 * exclusion is ruled PERMANENT
 * (`docs/plans/2026-08-08-lambda-param-element-inference.md`, ruling 4). But a
 * HAND-written union annotation is always spellable, and the compile admission
 * (`assertCallbackAnnotations`, an `isSubtype(union, union)` check) ADMITS it
 * when the source's element type provably satisfies it — the annotation is
 * then enforcement-free, exactly as for a scalar one.
 *
 * The obligation at that point is the standing one: fail closed OR be sound.
 * Measured: the admission passes and the BODY declines — a `string` arm reaches
 * an operator whose lowering is numeric — so `compile()` reports
 * `success: false` on both targets and the interpreter evaluates. No silent
 * wrong values. (Were a body ever to compile under a union annotation, this
 * test would have to assert `run()` parity with the interpreter instead.)
 */
describe('a HAND-annotated union callback over a satisfying source', () => {
  const UNION_CB = [
    'Function',
    ['Equal', 'x', 1],
    ['Typed', 'x', "'finite_integer | string'"],
  ];

  it('is admitted by the annotation gate, then declines on the BODY', () => {
    const ce = new ComputeEngine();
    // `list<finite_integer | string>` — the annotation is provably satisfied.
    const src = ['List', 1, { str: 'a' }, 2];
    expect(ce.box(src as any).type.toString()).toBe(
      'list<finite_integer | string>'
    );

    const expr = ce.box(['Filter', src, UNION_CB] as any);
    // The annotation survives onto the callback (hand-written unions are not
    // the excluded case — auto-STAMPING them is).
    expect(expr.ops[1].type.toString()).toBe(
      '(x: finite_integer | string) -> boolean'
    );

    // Fail-closed on both targets: the decline comes from the body's `Equal`
    // over a possibly-string operand, not from the annotation gate. Constant
    // folding is opted out of throughout: the source is a literal list, so the
    // whole `Filter` would otherwise be evaluated at compile time and emitted
    // as the literal `[1]`, never reaching the body lowering under test.
    expect(() => js(expr, { constantFold: false })).toThrow(
      /string-valued operands are not supported/
    );
    expect(() => python.compile(expr, { constantFold: false })).toThrow(
      /string-valued operands are not supported/
    );
    // With the default fallback, that is a reported failure, not a wrong value.
    expect(compile(expr, { constantFold: false }).success).toBe(false);

    // ...and the interpreter answers.
    expect(expr.evaluate().toString()).toBe('[1]');
  });
});
