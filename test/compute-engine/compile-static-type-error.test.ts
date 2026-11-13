import { ComputeEngine, compile } from '../../src/compute-engine';
import type { MathJsonExpression } from '../../src/math-json/types';

// The contract of compiled code (`docs/COMPILATION-MODEL.md`, "Fail closed",
// "What is guaranteed"): a compilation declines when a sub-expression is
// invalid or has the static type `error`. A valid expression whose static
// type is `error` compiled to a value before: with `u: real` and
// `ADD = (x, y) ↦ x + y`, `ADD("ab", u)` gave `"ab2"` at `u = 2` on
// `javascript`, where the interpreter gives an error.

const TARGETS = ['javascript', 'interval-js', 'glsl', 'python'];

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.declare('u', 'real');
  ce.declare('p', 'boolean');
  ce.declare('q', 'string');
  ce.declare('L', 'list<real>');
  ce.box([
    'Assign',
    'ADD',
    ['Function', ['Add', 'x', 'y'], 'x', 'y'],
  ]).evaluate();
  ce.box([
    'Assign',
    'ADDR',
    ['Function', ['Add', 'x', 'y', ['Multiply', 0, ['Random']]], 'x', 'y'],
  ]).evaluate();
  // A user function whose own body has the type `error`: the compiled code
  // emits or inlines the body, so the walk follows the call into it.
  ce.box(['Assign', 'G', ['Function', ['ADD', "'ab'", 'u']]]).evaluate();
  return ce;
}

const LIT: MathJsonExpression = ['Function', ['Add', 'x', 'y'], 'x', 'y'];

const ERROR_TYPED: [string, MathJsonExpression][] = [
  ['ADD("ab", u)', ['ADD', "'ab'", 'u']],
  ['Apply((x, y) ↦ x + y, "ab", u)', ['Apply', LIT, "'ab'", 'u']],
  ['ADD(p, u)', ['ADD', 'p', 'u']],
  ['ADD(q, u)', ['ADD', 'q', 'u']],
  ['ADDR("ab", u) (body x + y + 0·Random())', ['ADDR', "'ab'", 'u']],
  ['G() (the body of G has the type error)', ['G']],
  // The interpreter takes the branch only when its condition holds. The
  // decline does not depend on the condition: it is the simple, sound
  // version of the rule.
  [
    'If(u > 1, ADD("ab", u), 1)',
    ['If', ['Greater', 'u', 1], ['ADD', "'ab'", 'u'], 1],
  ],
];

describe('A valid expression with a sub-expression of type error declines', () => {
  const silence = jest.spyOn(console, 'warn').mockImplementation(() => {});
  afterAll(() => silence.mockRestore());

  describe.each(ERROR_TYPED)('%s', (_label, json) => {
    test.each(TARGETS)('on %s', (to) => {
      const ce = engine();
      const expr = ce.box(json);
      expect(expr.isValid).toBe(true);
      expect(expr.type.toString()).toBe('error');

      // With the interpreter fallback: a decline whose `unsupported` holds
      // `ErrorCode`, as for an invalid expression. A host reads this token
      // to give its warning for an error in the expression.
      const r = compile(expr, { to });
      expect(r.success).toBe(false);
      if (to === 'glsl') {
        // The shader fragment refuses the form before any code is written.
        expect(r.diagnostic?.code).toBe('outside-fragment');
        expect(() => compile(expr, { to, fallback: false })).toThrow(
          /GLSL fragment/
        );
        return;
      }
      expect(r.diagnostic?.code).toBe('static-type-error');
      expect(r.diagnostic?.kind).toBe('correctness');
      expect(r.unsupported).toContain('ErrorCode');
      expect(r.error).toMatch(/type 'error'/);

      // Without the fallback: the decline throws, except on `interval-js`,
      // which returns its decline as a `success: false` result.
      if (to === 'interval-js') {
        const strict = compile(expr, { to, fallback: false });
        expect(strict.success).toBe(false);
        expect(strict.error).toMatch(/type 'error'/);
      } else
        expect(() => compile(expr, { to, fallback: false })).toThrow(
          /type 'error'/
        );
    });
  });

  test.each(TARGETS)(
    'an invalid expression also reports ErrorCode on %s',
    (to) => {
      const ce = engine();
      const expr = ce.box(['Add', "'ab'", 'u']);
      expect(expr.isValid).toBe(false);
      const r = compile(expr, { to });
      expect(r.success).toBe(false);
      expect(r.unsupported).toContain('ErrorCode');
      expect(r.error).toMatch(
        to === 'glsl' ? /outside the GLSL fragment/ : /invalid expression/
      );
    }
  );

  // The body of a function literal that the compiled code runs. The
  // `Map` has the type `list<error>`, not `error`.
  test.each(TARGETS)('Map((x) ↦ ADD("ab", x), L) on %s', (to) => {
    const ce = engine();
    const expr = ce.box(['Map', ['Function', ['ADD', "'ab'", 'x'], 'x'], 'L']);
    expect(expr.isValid).toBe(true);
    const r = compile(expr, { to });
    expect(r.success).toBe(false);
    if (to === 'glsl') {
      // `Map` over a list input is outside the GLSL fragment, which is
      // checked first.
      expect(r.diagnostic?.code).toBe('outside-fragment');
      expect(r.diagnostic?.operator).toBe('Map');
      return;
    }
    expect(r.diagnostic?.code).toBe('static-type-error');
    expect(r.diagnostic?.value).toBe('ADD("ab", x)');
    expect(r.unsupported).toContain('ErrorCode');
  });

  test.each(TARGETS)(
    'an Error in a dictionary value reports ErrorCode on %s',
    (to) => {
      const ce = engine();
      const expr = ce.box([
        'Add',
        'u',
        ['At', ['Dictionary', ['Tuple', "'a'", ['Error', "'x'"]]], "'a'"],
      ]);
      expect(expr.isValid).toBe(false);
      const r = compile(expr, { to });
      expect(r.success).toBe(false);
      expect(r.unsupported).toContain('ErrorCode');
    }
  );

  test('a dictionary value of type error declines', () => {
    const ce = engine();
    const expr = ce.box(['Dictionary', ['Tuple', "'a'", ['ADD', "'ab'", 'u']]]);
    expect(expr.isValid).toBe(true);
    const r = compile(expr);
    expect(r.success).toBe(false);
    expect(r.diagnostic?.code).toBe('static-type-error');
    expect(r.diagnostic?.value).toBe('ADD("ab", u)');
    expect(r.unsupported).toContain('ErrorCode');
  });

  test('the diagnostic names the sub-expression', () => {
    const ce = engine();
    const r = compile(ce.box(['Add', ['ADD', "'ab'", 'u'], 1]));
    expect(r.success).toBe(false);
    expect(r.diagnostic?.value).toBe('ADD("ab", u)');
  });
});

// Not asserted: the contract leaves these unspecified, because no
// sub-expression has the static type `error` (`docs/COMPILATION-MODEL.md`,
// "What is guaranteed"). The compiled code can give any value, `NaN`, or
// throw, and it can also decline.
// - `Apply(Apply((x, y) ↦ x + y, "ab"), u)`: type `unknown`.
// - `If(u > 1, "ab", 1) + 1`: type `integer`.
// - `Sum(p, k = 1..u)` with `p: boolean`: type `number`.

// A name bound where it occurs is not the global definition: the walk does
// not follow it, and does not use the static type of a call of it. The
// global `G` has a body of type `error` (see `engine()`).
describe('A bound name that shadows a global with an error body compiles', () => {
  test('a parameter: Apply((G) ↦ G + 1, u)', () => {
    const ce = engine();
    const expr = ce.box(['Apply', ['Function', ['Add', 'G', 1], 'G'], 'u']);
    expect(expr.type.toString()).toBe('number');
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ u: 2 })).toBe(3);
  });

  test('a typed parameter: (G: real) ↦ G + 1', () => {
    const ce = engine();
    const expr = ce.box([
      'Function',
      ['Add', 'G', 1],
      ['Typed', 'G', "'real'"],
    ]);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect((r.run as (x: number) => number)(2)).toBe(3);
  });

  test('the index of a Sum: Sum(k, k = 1..5) with a global function k', () => {
    const ce = engine();
    ce.box(['Assign', 'k', ['Function', ['ADD', "'ab'", 'u']]]).evaluate();
    const expr = ce.box(['Sum', 'k', ['Limits', 'k', 1, 5]]);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({})).toBe(15);
  });

  // The static type of the call `G()` is read from the global `G`, so it is
  // `error`, but the interpreter calls the block's `G` and gives 3. The
  // local is declared with `Declare`: an `Assign` of a name that the engine
  // knows writes the engine's binding, and compiled code declines it.
  test("a block local: Block(Declare(G, 'unknown', () ↦ 1), G() + u)", () => {
    const ce = engine();
    const declareG = ['Declare', 'G', "'unknown'", ['Function', 1]];
    const expr = ce.box(['Block', declareG, ['Add', ['G'], 'u']]);
    expect(
      ce.box(['Block', declareG, ['Add', ['G'], 2]]).evaluate().re
    ).toBe(3);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ u: 2 })).toBe(3);
  });

  // A documented over-decline of the simple version: the call `G()` of the
  // replaced function is not checked, but type inference gives its parent
  // `G() + u` the type `error` from the engine's `G`, and the check cannot
  // tell that from an error of the parent itself (see the next describe).
  test('a function the caller replaces: G() + u declines (over-decline)', () => {
    const ce = engine();
    const expr = ce.box(['Add', ['G'], 'u']);
    expect(() =>
      compile(expr, { fallback: false, functions: { G: () => 1 } })
    ).toThrow(/type 'error'/);
  });
});

describe('An error next to a bound name still declines', () => {
  test('a call before the Block assignment reads the outer G', () => {
    // The first statement calls the engine's `G`, whose body has the type
    // `error`; the assignment comes after it.
    const ce = engine();
    const expr = ce.box([
      'Block',
      ['Declare', 'y', "'unknown'", ['G']],
      ['Assign', 'G', ['Function', 1]],
      ['Add', 'y', 'u'],
    ]);
    expect(() => compile(expr, { fallback: false })).toThrow(/type 'error'/);
  });

  test('ADD("ab", G()) with a replaced G declines', () => {
    const ce = engine();
    const expr = ce.box(['ADD', "'ab'", ['G']]);
    expect(() =>
      compile(expr, { fallback: false, functions: { G: () => 1 } })
    ).toThrow(/type 'error'/);
  });

  test('ADD("ab", G()) after a Block assignment of G declines', () => {
    const ce = engine();
    const expr = ce.box([
      'Block',
      ['Assign', 'G', ['Function', 1]],
      ['ADD', "'ab'", ['G']],
    ]);
    expect(() => compile(expr, { fallback: false })).toThrow(/type 'error'/);
  });

  test('the value of an assignment reads the outer G', () => {
    // `Equal` has the type `boolean`, so only the walk into the global `G`,
    // which the value calls before the write, finds the error.
    const ce = engine();
    const expr = ce.box(['Block', ['Assign', 'G', ['Equal', ['G'], 1]], 'G']);
    expect(() => compile(expr, { fallback: false })).toThrow(/type 'error'/);
  });

  test('an input mapped through vars and declared error declines', () => {
    const ce = engine();
    ce.declare('bad', 'error');
    const expr = ce.box(['Add', 'bad', 1]);
    expect(() =>
      compile(expr, { fallback: false, vars: { bad: '_.bad' } })
    ).toThrow(/type 'error'|invalid/);
  });

  test('a replaced operator is not followed, in the record and the callback form', () => {
    // The call `H()` has a type that is not `error`, but the body of the
    // engine's `H` holds `ADD("ab", u)`. Without a replacement the walk
    // follows `H` into that body and declines. A replacement through
    // `operators`, in either form, is not followed, so the error in the
    // engine's body does not make the compilation decline.
    const ce = engine();
    ce.box([
      'Assign',
      'H',
      [
        'Function',
        ['Block', ['Declare', 't', "'unknown'", ['ADD', "'ab'", 'u']], 1],
      ],
    ]).evaluate();
    const expr = ce.box(['Multiply', 2, ['H']]);
    expect(expr.type.toString()).not.toBe('error');
    const message = (options: object): string => {
      try {
        compile(expr, { fallback: false, ...options });
        return 'compiled';
      } catch (e) {
        return String((e as Error).message);
      }
    };
    expect(message({})).toMatch(/type 'error'/);
    expect(message({ operators: { H: ['myH', 20] } })).not.toMatch(
      /type 'error'/
    );
    expect(
      message({
        operators: (op: string) => (op === 'H' ? ['myH', 20] : undefined),
      })
    ).not.toMatch(/type 'error'/);
  });

  test('a call of a bound name with an error type declines', () => {
    // The local `ADD` has the same body as the global one, and `List` does
    // not have the type `error`: the call itself must decline.
    const ce = engine();
    const expr = ce.box([
      'Block',
      ['Assign', 'ADD', ['Function', ['Add', 'x', 'y'], 'x', 'y']],
      ['List', ['ADD', "'ab'", 'u']],
    ]);
    expect(() => compile(expr, { fallback: false })).toThrow(/type 'error'/);
  });

  // A documented over-decline of the simple version, as for a replaced
  // function: type inference gives the rebound `v` the type of its stored
  // value, `error`.
  test('a symbol rebound by a Block declines (over-decline)', () => {
    const ce = engine();
    ce.assign('v', ce.box(['ADD', "'ab'", 'u']));
    const expr = ce.box(['Block', ['Assign', 'v', 1], ['Add', 'v', 1]]);
    expect(() => compile(expr, { fallback: false })).toThrow(/type 'error'/);
  });

  test('two stored values that read each other do not loop', () => {
    const ce = engine();
    ce.assign('a1', ce.box(['Add', 'b1', 1], { canonical: false }));
    ce.assign('b1', ce.box(['Add', 'a1', 1], { canonical: false }));
    expect(() => {
      try {
        compile(ce.box('a1'), { fallback: false });
      } catch (e) {
        // Another decline (the self-reference refusal) is fine; a hang or a
        // stack overflow is not.
        if (e instanceof RangeError) throw e;
      }
    }).not.toThrow();
  });

  test('the stored value of a symbol is checked', () => {
    // The compiler inlines the value of `s` where `s` is read.
    const ce = engine();
    ce.assign('s', ce.box(['List', ['ADD', "'ab'", 'u']]));
    const expr = ce.box('s');
    for (const to of TARGETS) {
      const r = compile(expr, { to, fallback: true });
      expect(r.success).toBe(false);
      // The GLSL fragment, checked first, names the head that it refuses.
      expect(r.unsupported).toContain(to === 'glsl' ? 'ADD' : 'ErrorCode');
    }
  });
});

describe('Well-typed controls still compile', () => {
  test('ADD(1, u) compiles and gives the interpreter value', () => {
    const ce = engine();
    const expr = ce.box(['ADD', 1, 'u']);
    for (const to of ['javascript', 'glsl']) {
      const r = compile(expr, { to, fallback: false });
      expect(r.success).toBe(true);
    }
    const r = compile(expr, { fallback: false });
    expect(r.run!({ u: 2 })).toBe(ce.box(['ADD', 1, 2]).N().re);
  });

  test('Apply((x, y) ↦ x + y, 1, u) compiles', () => {
    const ce = engine();
    const expr = ce.box(['Apply', LIT, 1, 'u']);
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ u: 2 })).toBe(3);
  });

  test('string code that is well typed compiles', () => {
    const ce = engine();
    const expr = ce.box(['Add', ['Length', 'q'], 'u']);
    expect(expr.type.toString()).not.toBe('error');
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({ q: 'abc', u: 2 })).toBe(5);
  });

  test('u + 1 compiles on every target', () => {
    const ce = engine();
    const expr = ce.box(['Add', 'u', 1]);
    for (const to of TARGETS) {
      const r = compile(expr, { to, fallback: false });
      expect(r.success).toBe(true);
    }
  });
});
