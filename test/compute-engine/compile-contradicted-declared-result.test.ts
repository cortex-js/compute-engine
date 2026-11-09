/**
 * A body that contradicts the declared result of a user function.
 *
 * The body contradicts the result when the type of the value it computes
 * has no value in common with the declared result, or when the result is a
 * scalar and the body constructs a collection. The assignment of such a body
 * is refused when it is made, with a `TypeCompatibilityError`:
 *
 * - `g: (x: number) -> number` and `g := t ↦ t > 0`. The compiled
 *   `g(b) + 1` gave `2` (`true + 1`) when this assignment was accepted.
 * - A generic result is read at the bound of its type variable:
 *   `g: (x: T) -> T where T: broadcastable<number>` refuses `t ↦ t > 0`.
 *
 * The compiler declines a call of such a function when the assignment cannot
 * see the contradiction:
 *
 * - The body calls a function that is assigned after it (`g := t ↦ p(t)`,
 *   then `p := t ↦ t > 0`). The type of `p(t)` is not known when `g` is
 *   assigned, so the assignment is accepted.
 * - A generic result with a point body: `g: (x: T) -> T where
 *   T: broadcastable<number>`, `g := t ↦ (t, t^2)` and `x: list<real>`. A
 *   point has values in common with `broadcastable<number>`, so the
 *   assignment is accepted. The interpreter does not check the result of a
 *   generic function against its declaration, and gives `(5, 13)` for
 *   `Sum(Rest(g([1, 2, 3])))`. The compiled code gave the string
 *   `"02,43,9"`. A generic result that is the type of a parameter is read
 *   for one application to a scalar, so the compiler sees a scalar result
 *   and a body that constructs a collection.
 *
 * A call that maps the function over the elements of a list argument applies
 * it to scalars, so it declines too.
 *
 * Witness: Tycho ledger row 491 (`~/dev/tycho/docs/COMPUTE_ENGINE.md`), with
 * the instrument
 * `~/dev/tycho/scripts/repros/2026-11-04-ce491-generic-result-type-unchecked-repro.mts`.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

const GENERIC = '(x: T) -> T where T: broadcastable<number>';
const BOOLEAN_BODY = ['Greater', 't', 0];
const POINT_BODY = ['Tuple', 't', ['Power', 't', 2]];
const REFUSED = /is not compatible with the type/;

/** `g` declared with `signature` (or as a bare `function` when `null`),
 * then assigned `t ↦ body`; `x: list<real>` and `b: real`. */
function engineWith(signature: string | null, body: unknown): ComputeEngine {
  const ce = new ComputeEngine();
  if (signature === null) ce.declare('g', 'function');
  else ce.declare('g', { signature });
  ce.declare('x', 'list<real>');
  ce.declare('b', 'real');
  ce.assign('g', ce.box(['Function', body, 't'] as any));
  return ce;
}

/** `g` declared with `signature` and assigned `t ↦ p(t)`, then `p`
 * assigned `t ↦ body`; `x: list<real>` and `b: real`. The type of
 * `p(t)` is not known when `g` is assigned, so the assignment is
 * accepted whatever `body` is. */
function engineWithLater(signature: string, body: unknown): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('g', { signature });
  ce.declare('x', 'list<real>');
  ce.declare('b', 'real');
  ce.assign('g', ce.box(['Function', ['p', 't'], 't'] as any));
  ce.assign('p', ce.box(['Function', body, 't'] as any));
  return ce;
}

function compiled(ce: ComputeEngine, expr: unknown): any {
  return compile(ce.box(expr as any), {
    to: 'javascript',
    fallback: true,
  } as any);
}

const SUM_REST = ['Sum', ['Rest', ['g', 'x']]];
const SCALAR_CALL = ['Add', ['g', 'b'], 1];
const BOOLEAN_VALUE = /but its body computes a value of type 'boolean'/;

describe('a body that contradicts the declared result is refused when it is assigned', () => {
  test.each([
    '(x: number) -> number',
    '(x: real) -> real',
    '(x: broadcastable<number>) -> broadcastable<number>',
    '(x: T) -> T where T: number',
    GENERIC,
  ])('a boolean body under `g: %s`', (signature) => {
    expect(() => engineWith(signature, BOOLEAN_BODY)).toThrow(REFUSED);
  });

  test.each(['(x: number) -> number', '(x: T) -> T where T: number', GENERIC])(
    'a point body under `g: %s`',
    (signature) => {
      expect(() => engineWith(signature, POINT_BODY)).toThrow(REFUSED);
    }
  );

  test('a list bound whole: a boolean body under `-> number`', () => {
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '(xs: list<real>) -> number' });
    expect(() =>
      ce.assign(
        'g',
        ce.box(['Function', ['Greater', ['Length', 'xs'], 0], 'xs'] as any)
      )
    ).toThrow(REFUSED);
  });

  test('a function with no parameter: a boolean body under `-> number`', () => {
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '() -> number' });
    ce.declare('c', 'real');
    expect(() =>
      ce.assign('g', ce.box(['Function', ['Greater', 'c', 0]] as any))
    ).toThrow(REFUSED);
  });

  // A type variable with no bound that occurs only in a parameter does not
  // stop the test of the result: `1` has no value in common with
  // `boolean`. The control `x ↦ True` is accepted.
  test('an unbounded type variable in a parameter: a number body under `-> boolean`', () => {
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '(x: T) -> boolean where T' });
    expect(() => ce.assign('g', ce.box(['Function', 1, 'x'] as any))).toThrow(
      /has no value in common with the declared result "boolean"/
    );
    ce.assign('g', ce.box(['Function', 'True', 'x'] as any));
    expect(ce.box(['g', 3] as any).evaluate().json).toBe('True');
  });
});

describe('a body that contradicts the declared result declines', () => {
  test.each([
    '(x: number) -> number',
    '(x: real) -> real',
    '(x: broadcastable<number>) -> broadcastable<number>',
    '(x: T) -> T where T: number',
    GENERIC,
  ])(
    '`g(b) + 1` with `g: %s` and a boolean value from a function assigned later',
    (signature) => {
      const ce = engineWithLater(signature, BOOLEAN_BODY);
      // The interpreter refuses the value of the call.
      expect(ce.box(['Add', ['g', 3], 1] as any).evaluate().operator).toBe(
        'Error'
      );
      const r = compiled(ce, SCALAR_CALL);
      expect(r.success).toBe(false);
      expect(r.error).toMatch(BOOLEAN_VALUE);
    }
  );

  test('`Sum(Rest(g(x)))` with the generic signature and a point value from a function assigned later maps the body over a list', () => {
    const r = compiled(engineWithLater(GENERIC, POINT_BODY), SUM_REST);
    expect(r.success).toBe(false);
  });

  test.each(['(x: number) -> number', GENERIC])(
    '`Sum(Rest(g(x)))` with `g: %s` and a boolean value from a function assigned later maps the body over a list',
    (signature) => {
      const r = compiled(engineWithLater(signature, BOOLEAN_BODY), SUM_REST);
      expect(r.success).toBe(false);
    }
  );

  test('a generic point value from a function assigned later: the interpreter value that the compiled code missed', () => {
    const ce = engineWithLater(GENERIC, POINT_BODY);
    const value = ce
      .box(['Sum', ['Rest', ['g', ['List', 1, 2, 3]]]] as any)
      .evaluate();
    expect(value.json).toEqual(['Tuple', 5, 13]);
    expect(compiled(ce, ['g', 'x']).success).toBe(false);
  });

  test.each(['glsl', 'interval-js'])(
    'a boolean value from a function assigned later under `-> number` declines on %s',
    (to) => {
      const ce = engineWithLater('(x: number) -> number', BOOLEAN_BODY);
      const r: any = compile(ce.box(SCALAR_CALL as any), {
        to,
        fallback: true,
      } as any);
      expect(r.success).toBe(false);
      expect(r.error).toMatch(
        /Could not compile `g`: .* but its body computes a value of type 'boolean'/
      );
    }
  );

  test('a list bound whole: a boolean value from a function assigned later under `-> number` declines', () => {
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '(xs: list<real>) -> number' });
    ce.declare('x', 'list<real>');
    ce.assign('g', ce.box(['Function', ['p', 'xs'], 'xs'] as any));
    ce.assign(
      'p',
      ce.box(['Function', ['Greater', ['Length', 'xs'], 0], 'xs'] as any)
    );
    const r = compiled(ce, ['Add', ['g', 'x'], 1]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(BOOLEAN_VALUE);
  });

  test('a call with no argument: a boolean value from a function assigned later under `-> number` declines', () => {
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '() -> number' });
    ce.declare('c', 'real');
    ce.assign('g', ce.box(['Function', ['p']] as any));
    ce.assign('p', ce.box(['Function', ['Greater', 'c', 0]] as any));
    const r = compiled(ce, ['Add', ['g'], 1]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(BOOLEAN_VALUE);
  });

  test('a function value: `Map(x, g)` with a boolean value from a function assigned later declines', () => {
    const ce = engineWithLater('(x: number) -> number', BOOLEAN_BODY);
    const r = compiled(ce, ['Sum', ['Map', 'g', 'x']]);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(
      /Could not compile the function value `g`: .* but its body computes a value of type 'boolean'/
    );
  });
});

describe('controls: a body that meets the declared result still compiles', () => {
  test('a generic scalar body maps over a list', () => {
    const ce = engineWith(GENERIC, ['Multiply', 2, 't']);
    const r = compiled(ce, SUM_REST);
    expect(r.success).toBe(true);
    expect(r.run({ x: [1, 2, 3] })).toBe(10);
  });

  test('a ground scalar body in a scalar call', () => {
    const ce = engineWith('(x: number) -> number', ['Multiply', 2, 't']);
    const r = compiled(ce, SCALAR_CALL);
    expect(r.success).toBe(true);
    expect(r.run({ b: 3 })).toBe(7);
  });

  test('a ground boolean result with a boolean body', () => {
    const ce = engineWith('(x: number) -> boolean', BOOLEAN_BODY);
    const r = compiled(ce, ['g', 'b']);
    expect(r.success).toBe(true);
    expect(r.run({ b: 3 })).toBe(true);
  });

  test('a bare `function` declaration types the call from the body', () => {
    const ce = engineWith(null, POINT_BODY);
    const r = compiled(ce, SUM_REST);
    expect(r.success).toBe(true);
    expect(r.run({ x: [1, 2, 3] })).toEqual([5, 13]);
  });

  test('a `Return` before the last statement: the last statement is not read', () => {
    const ce = engineWith('(x: number) -> number', [
      'Block',
      ['Return', 0],
      ['Greater', 't', 0],
    ]);
    const r = compiled(ce, SCALAR_CALL);
    expect(r.success).toBe(true);
    expect(r.run({ b: 3 })).toBe(1);
  });

  // A character is a string of one cluster, so a `character` body meets
  // the declared result `string`.
  test('a character body under a string result is accepted', () => {
    const ce = new ComputeEngine();
    ce.declare('first', { signature: '(string) -> string' });
    ce.assign('first', ce.parse('(s: string) \\mapsto s[1]'));
    expect(
      ce
        .box(['first', { str: 'ab' }] as any)
        .evaluate()
        .toString()
    ).toBe('"a"');
  });

  // The same body meets the declared result `character`.
  test('a character body under a character result is accepted', () => {
    const ce = new ComputeEngine();
    ce.declare('first', { signature: '(string) -> character' });
    ce.assign('first', ce.parse('(s: string) \\mapsto s[1]'));
    expect(
      ce
        .box(['first', { str: 'ab' }] as any)
        .evaluate()
        .toString()
    ).toBe('"a"');
  });

  // A call accepts a character where a string is declared at any depth, so
  // a tuple of characters meets the declared result `tuple<string, string>`.
  test('a tuple of characters under a tuple of strings is accepted', () => {
    const ce = new ComputeEngine();
    ce.declare('g', { signature: '(number) -> tuple<string, string>' });
    ce.assign(
      'g',
      ce.box([
        'Function',
        ['Tuple', ['At', { str: 'abc' }, 1], ['At', { str: 'abc' }, 2]],
        'x',
      ] as any)
    );
    expect(
      ce
        .box(['g', 1] as any)
        .evaluate()
        .toString()
    ).toBe('("a", "b")');
  });

  // A character behind a type alias is read as a character: the body of
  // `g` gives a `Glyph`, an alias of `character`, under a string result.
  test('a character alias under a string result is accepted', () => {
    const ce = new ComputeEngine();
    ce.declareType('Glyph', 'character', { alias: true } as any);
    ce.declare('g', '(Glyph) -> string');
    expect(() =>
      ce.assign(
        'g',
        ce.box(['Function', 'c', ['Typed', 'c', "'Glyph'"]] as any)
      )
    ).not.toThrow();
  });
});
