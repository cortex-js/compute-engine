import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

/**
 * Compiled counterpart of `filter-predicate-errors.test.ts`.
 *
 * The interpreter surfaces an Error VALUE per element when a callback's
 * `Typed`-parameter annotation rejects the element it is applied to (the
 * annotation-as-contract ruling,
 * `docs/TYPE-SYSTEM.md` ruling 2).
 *
 * An error that depends on the value of an input, and that the static type
 * does not show, is unspecified in compiled code
 * (`docs/COMPILATION-MODEL.md`), so a compiled callback whose annotation the
 * source does not provably satisfy may give the elements themselves.
 */

/** `["Function", <body>, ["Typed", <param>, <type>]]` — an annotated callback. */
const annotated = (param: string, type: string, body: unknown) => [
  'Function',
  body,
  ['Typed', param, `'${type}'`],
];

/** Compile on the JavaScript target, never falling back. */
const js = (expr: any, options: Record<string, unknown> = {}) =>
  compile(expr, { fallback: false, ...options });

const opBody = (op: string, p: string) =>
  op === 'Map' || op === 'FlatMap' ? ['Add', p, 1] : ['Greater', p, 0];

/** `[op, …]` with the operands in the order that operator declares: `Map`
 * takes its mapping function FIRST, every other callback consumer here takes
 * the source collection first. */
const opCall = (op: string, source: any, callback: any): any =>
  op === 'Map' ? [op, callback, source] : [op, source, callback];

describe('Compiled callbacks with a parameter annotation the source satisfies', () => {
  for (const op of ['Filter', 'Map'] as const) {
    it(`${op} compiles when the element type provably satisfies the annotation`, () => {
      const ce = new ComputeEngine();
      ce.declare('ds', 'list<integer>');
      const expr = ce.box(
        opCall(op, 'ds', annotated('n', 'integer', opBody(op, 'n')))
      );
      const r = js(expr);
      expect(r.success).toBe(true);
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
    ['Map', [2, 3, -2, 5]],
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
});

/**
 * The retraction repro of `filter-predicate-errors.test.ts`. The parameter
 * is annotated from the source's element type when the call is boxed. When
 * the source is reassigned to floats, the annotation that was derived from
 * the old value is retired: the call is typed and evaluated again from the
 * operands as written, so the interpreter and both compiled targets give
 * the new elements.
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
    // The inferred annotation is observed on request; it is not in the default serialization.
    expect(expr.toMathJson({ inferredAnnotations: true })).toEqual([
      'Filter',
      'ds',
      ['Function', ['Less', 0, 'n'], ['Typed', 'n', "'integer'"]],
    ]);
    // ...and compiles while the source still satisfies it.
    expect(js(expr).run!({})).toEqual([1, 2, 3]);
    ce.assign('ds', ce.box(['List', 1.5, 2.5]));
    return expr;
  };

  it('the JavaScript target follows the reassigned source', () => {
    expect(js(retracted()).run!({})).toEqual([1.5, 2.5]);
  });

  it('the interpreter follows the reassigned source', () => {
    expect(retracted().evaluate().toString()).toBe('[1.5,2.5]');
  });
});

/**
 * An annotation that the author writes is a contract, not a value-derived
 * stamp: it stays when the source is reassigned. When the new elements do
 * not satisfy it, the compiled lowering must not answer with the elements
 * themselves.
 */
describe('a written annotation and a reassigned source', () => {
  const retracted = () => {
    const ce = new ComputeEngine();
    ce.assign('ds', ce.box(['List', 1, 2, 3]));
    const expr = ce.box([
      'Filter',
      'ds',
      ['Function', ['Greater', 'n', 0], ['Typed', 'n', "'integer'"]],
    ]);
    ce.assign('ds', ce.box(['List', 1.5, 2.5]));
    return expr;
  };

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
      ce.box(['Function', ['Greater', 'n', 0], ['Typed', 'n', "'integer'"]])
    );
    ce.declare('ds', `list<${elementType}>`);
    return ce.box(['Filter', 'ds', 'p']);
  };

  it('fails closed when the element type does not satisfy the annotation', () => {
    expect(() => js(withNamed('number'))).toThrow(/Could not compile/);
  });
});

/**
 * Index-shaped callbacks. `Tabulate` passes 1-based integer indexes.
 */
describe('index callbacks', () => {
  // Each form gets a generator of the arity IT applies: `Tabulate(f, n)`
  // computes `f(i)` while `Tabulate(f, m, n)` computes `f(i, j)`. The extra
  // parameter of the 2-D form is not incidental: a UNARY generator there is
  // an arity error, and the static callback-arity check rejects the call
  // before it can reach the compiler at all. Passing one here would test the
  // compiler against an expression the interpreter never accepts.
  for (const [name, dims] of [
    ['Tabulate', [3]],
    ['Tabulate 2-D', [2, 2]],
  ] as const) {
    const params = (type: string) =>
      dims.length === 1
        ? [['Typed', 'i', type]]
        : [
            ['Typed', 'i', type],
            ['Typed', 'j', type],
          ];
    // A BOUNDED index annotation is narrower than the `integer` the lowering
    // provides: the interpreter reports the out-of-range index as an Error
    // element (`Tabulate((i: integer<1..2>) ↦ 2i, 3)` → `[2, 4, Error(…)]`),
    // which the compiled index loop cannot reproduce.
    it(`${name} declines an index parameter annotated narrower than integer`, () => {
      const ce = new ComputeEngine();
      const expr = ce.box([
        'Tabulate',
        ['Function', ['Multiply', 2, 'i'], ...params("'integer<1..2>'")],
        ...dims,
      ] as any);
      expect(() => js(expr)).toThrow(/Could not compile/);
    });
  }
});
