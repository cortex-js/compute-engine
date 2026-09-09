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

describe('UNEMITTABLE USER FUNCTION IN VALUE POSITION — fail closed (D6)', () => {
  it('refuses the ROADMAP reproducer, naming the function and the reason', () => {
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
      /^w: cannot compile[\s\S]*referenced as a value[\s\S]*Fail closed \(D6\)/
    );

    // The permissive entry reports the decline and carries the diagnostic.
    const r = compile(expr);
    expect(r?.success).toBe(false);
    expect(r?.diagnostic?.message).toMatch(/^w: cannot compile/);
    // The reason the emission declined is threaded through, so the author is
    // told WHICH property of the definition the target could not express.
    expect(r?.diagnostic?.message).toContain("typed 'meters'");
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
    expect(r?.diagnostic?.message).toMatch(/^g: cannot compile/);
    expect(r?.run?.({ ys: [1, 2, 3] })).toEqual([2, 4, 6]);
  });

  it('leaves a caller-supplied `vars` function in that position alone', () => {
    // A `vars` key is the caller's external-input contract and always wins:
    // the symbol never reaches the user-function route, and the emitted code
    // splices the caller's own source.
    const r = compile(ce.box(['Map', 'f', ['List', 1, 2, 3]]), {
      vars: { f: '((x) => x + 1)' },
      fallback: false,
    });
    expect(r?.success).toBe(true);
    expect(r?.run?.({})).toEqual([2, 3, 4]);
  });

  it('leaves a declared VALUE symbol alone', () => {
    // Not a function: the refusal must not reach it.
    ce.declare('k', 'number');
    ce.assign('k', 7);
    const r = compile(ce.box(['Add', 'k', 1]), { fallback: false });
    expect(r?.success).toBe(true);
    expect(r?.run?.({})).toBe(8);
  });

  it('still compiles and runs a Map over an EMITTABLE single-clause function', () => {
    clause('h', ['Function', ['Multiply', 3, 'x'], 'x']);
    ce.declare('ys', 'list<number>');
    const r = compile(ce.box(['Map', 'h', 'ys']), { fallback: false });
    expect(r?.success).toBe(true);
    expect(r?.run?.({ ys: [1, 2, 3] })).toEqual([3, 6, 9]);
  });

  it('still compiles and runs a Map over an EMITTABLE multi-clause function', () => {
    // The multi-clause value reference broadcasts a collection element, the
    // way the interpreter does: a row of a matrix reaches the one-argument
    // clause element by element.
    clause('h', ['Function', ['Multiply', 3, 'x'], 'x']);
    clause('mc', ['Function', ['Add', ['h', 'x'], 1], 'x']);
    clause('mc', ['Function', ['Add', ['h', 'x'], ['h', 'y']], 'x', 'y']);
    ce.declare('ys', 'list<list<number>>');

    expect(
      ce
        .box(['Map', 'mc', ['List', ['List', 1, 2], ['List', 3]]])
        .evaluate()
        .toString()
    ).toBe('[[4,7],[10]]');

    const r = compile(ce.box(['Map', 'mc', 'ys']), { fallback: false });
    expect(r?.success).toBe(true);
    expect(r?.run?.({ ys: [[1, 2], [3]] })).toEqual([[4, 7], [10]]);
  });
});
