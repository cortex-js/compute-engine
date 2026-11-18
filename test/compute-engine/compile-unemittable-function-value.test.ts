import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import type { MathJsonExpression } from '../../src/math-json/types';

//
// A user function referenced as a VALUE — the callback of `Map`/`Filter`, a
// `Reduce` combiner, an argument to a higher-order user function — whose
// definition the target declined to emit must FAIL CLOSED (D6), not fall
// through to the free-symbol read `_.<name>`.
//
// Before the refusal, `Map(w, [1, 2, 3])` over a clause set with a nominal
// parameter type compiled to
// `((_f) => ([1, 2, 3]).map((_x) => _f(_x)))(_.w)`: the artifact reported
// `success: true` and threw `TypeError: _f is not a function` at run time,
// because nothing binds that vars-object key. This is the same defect a bare
// BUILT-IN operator name in value position had (`Map(Sin, xs)` reading
// `_.Sin`), and it takes the same answer.
//
// The refusal is scoped to a symbol that names a USER-DEFINED function (a
// definition holding a function literal, or a multi-clause set). Every other
// symbol in that position — a caller `vars` key, a declared value symbol, an
// unknown name — keeps the free-symbol read it had.
//

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
  // A NOMINAL type: `jsClauseParamGuard` has no faithful JavaScript test for
  // it, so a clause set using it declines as a whole (§8 whole-function
  // decline) and its emitted name never exists.
  ce.box(['DeclareType', 'meters', { str: 'number' }]).evaluate();
});

function clause(name: string, fn: MathJsonExpression): void {
  ce.box(['DefineFunction', name, fn]).evaluate();
}

function p(name: string, type: string): MathJsonExpression {
  return ['Typed', name, { str: type }];
}

describe('UNEMITTABLE USER FUNCTION IN VALUE POSITION — fail closed', () => {
  it('refuses the ROADMAP reproducer', () => {
    clause('w', ['Function', 2, p('d', 'meters')]);
    clause('w', [
      'Function',
      ['Add', 'x', 'y'],
      p('x', 'number'),
      p('y', 'number'),
    ]);
    const expr = ce.box(['Map', 'w', ['List', 1, 2, 3]]);

    // The low-level contract: `fallback: false` surfaces the refusal.
    expect(() => compile(expr, { fallback: false })).toThrow(
      /^Could not compile/
    );
  });

  it('answers the interpreter value through the interpreted fallback', () => {
    // Same decline, over a clause set whose dispatch for a ONE-argument call
    // reaches an emittable clause, so the interpreter has an ordinary value
    // to answer with. The source is a declared symbol rather than a literal,
    // so constant folding cannot answer before the lowering runs.
    clause('g', ['Function', ['Multiply', 2, 'x'], p('x', 'number')]);
    clause('g', ['Function', 0, p('a', 'meters'), p('b', 'meters')]);
    ce.declare('ys', 'list<number>');

    expect(
      ce
        .box(['Map', 'g', ['List', 1, 2, 3]])
        .evaluate()
        .toString()
    ).toBe('[2,4,6]');

    const r = compile(ce.box(['Map', 'g', 'ys']));
    expect(r?.success).toBe(false);
    expect(r?.run?.({ ys: [1, 2, 3] })).toEqual([2, 4, 6]);
  });

  it('leaves a declared VALUE symbol alone', () => {
    // Not a function: the refusal must not reach it.
    ce.declare('k', 'number');
    ce.assign('k', 7);
    const r = compile(ce.box(['Add', 'k', 1]), { fallback: false });
    expect(r?.success).toBe(true);
    expect(r?.run?.({})).toBe(8);
  });

});

//
// An operator the HOST declared with a JavaScript `evaluate` handler has no
// function value the compiled code can call, and neither has a definition
// that shadows a built-in name. Used as a callback, it fell through to the
// free-symbol read `_.MySqrt`: `Map(MySqrt, rs)` compiled with
// `success: true` and threw `TypeError: _f is not a function` at run time.
// It now fails closed at compile time, and the interpreted fallback answers.
//
describe('HOST-DECLARED OPERATOR IN VALUE POSITION — fail closed', () => {
  const TARGETS = ['javascript', 'glsl', 'interval-js'];

  function silent<T>(f: () => T): T {
    const warn = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      return f();
    } finally {
      warn.mockRestore();
    }
  }

  function declareMySqrt(): void {
    ce.declare('MySqrt', {
      signature: '(real) -> real',
      evaluate: () => ce.number(100),
    });
    ce.declare('rs', 'list<real>');
  }

  it('refuses `Map(MySqrt, rs)`', () => {
    declareMySqrt();
    const expr = ce.box(['Map', 'MySqrt', 'rs']);
    expect(() => compile(expr, { fallback: false })).toThrow(
      /^Could not compile/
    );
  });

  it.each(TARGETS)('%s: `Map(MySqrt, rs)` falls back', (to) => {
    declareMySqrt();
    const r = silent(() => compile(ce.box(['Map', 'MySqrt', 'rs']), { to }));
    expect(r?.success).toBe(false);
    const v = r?.run?.({ rs: [2, 3] });
    if (to === 'interval-js')
      expect(v).toEqual([
        { kind: 'interval', value: { lo: 100, hi: 100 } },
        { kind: 'interval', value: { lo: 100, hi: 100 } },
      ]);
    else expect(v).toEqual([100, 100]);
  });

  it('refuses a library name redeclared with its own `evaluate`', () => {
    ce.declare('Sin', {
      ...(ce.lookupDefinition('Sin') as any).operator,
      evaluate: () => ce.number(100),
    });
    ce.declare('rs', 'list<real>');
    for (const to of ['javascript']) {
      const r = silent(() => compile(ce.box(['Map', 'Sin', 'rs']), { to }));
      expect(r?.success).toBe(false);
      expect(r?.run?.({ rs: [2, 3] })).toEqual([100, 100]);
    }
  });

  it('refuses a host-declared `Reduce` combiner', () => {
    ce.declare('Comb', {
      signature: '(real, real) -> real',
      evaluate: () => ce.number(7),
    });
    ce.declare('rs', 'list<real>');
    for (const to of ['javascript']) {
      const r = silent(() =>
        compile(ce.box(['Reduce', 'rs', 'Comb', 0]), { to })
      );
      expect(r?.success).toBe(false);
      expect(r?.run?.({ rs: [2, 3] })).toBe(7);
    }
  });

  it('still compiles a built-in callback', () => {
    ce.declare('rs', 'list<real>');
    const r = compile(ce.box(['Map', 'Sqrt', 'rs']), { fallback: false });
    expect(r?.success).toBe(true);
    expect(r?.run?.({ rs: [4, 9] })).toEqual([2, 3]);
  });
});
