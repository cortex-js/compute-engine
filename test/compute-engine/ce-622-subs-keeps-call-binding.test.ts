import { ComputeEngine } from '../../src/compute-engine';

// ROADMAP CE-622: `subs()` rebuilds each call with the function the call was
// written with, not with the function that its name has in the current scope
// (`docs/SCOPING-MODEL.md`, "Callable resolution"). With `h := a ↦ a·x`, the
// expression `h(a) + 1` substituted at `a := k` in a scope that declares
// another `h := a ↦ 100` gave `h(k) + 1` bound to the inner `h`, which
// evaluated to 101. An integral and a derivative that inline a user function
// through `subs()` (`betaReduceLambda()`, `boxed-expression/utils.ts`) read
// the inner function too.

/** Declare `name` as a function held as a value, and assign `fn` to it. */
function define(ce: ComputeEngine, name: string, fn: unknown): void {
  ce.declare(name, 'function');
  ce.assign(name, ce.expr(fn as any));
}

describe('CE-622: subs() keeps the function of each call it rebuilds', () => {
  test('a substitution in the operands of a call', () => {
    const ce = new ComputeEngine();
    define(ce, 'h', ['Function', ['Multiply', 'a', 'x'], 'a']);
    const e = ce.function('Add', [
      ce.function('h', [ce.symbol('a')]),
      ce.number(1),
    ]);
    ce.pushScope();
    define(ce, 'h', ['Function', 100, 'a']);
    expect(e.evaluate().json).toEqual(['Add', ['Multiply', 'a', 'x'], 1]);
    expect(e.subs({ a: 'k' }).evaluate().json).toEqual([
      'Add',
      ['Multiply', 'k', 'x'],
      1,
    ]);
    // A call made in the inner scope reads the inner `h`.
    expect(ce.parse('h(3)').evaluate().json).toEqual(100);
    ce.popScope();
  });

  test('an integral of a call whose body calls another function', () => {
    const ce = new ComputeEngine();
    define(ce, 'n', ['Function', ['Power', 't', 2], 't']);
    define(ce, 'c', ['Function', ['Add', ['n', 't'], 1], 't']);
    const I = ce.parse('\\int_0^1 c(x)\\,dx');
    ce.pushScope();
    define(ce, 'n', ['Function', 100, 't']);
    define(ce, 'c', ['Function', 200, 't']);
    expect(I.evaluate().json).toEqual(['Rational', 4, 3]);
    expect(I.N().re).toBeCloseTo(4 / 3, 12);
    ce.popScope();
  });

  test('a derivative of a call whose body calls another function', () => {
    const ce = new ComputeEngine();
    define(ce, 'h', ['Function', ['Multiply', 'a', 'x'], 'a']);
    define(ce, 'g', ['Function', ['Add', ['h', 'a'], 1], 'a']);
    const D = ce.box(['D', ['g', 'k'], 'x']);
    ce.pushScope();
    define(ce, 'h', ['Function', 100, 'a']);
    expect(D.evaluate().json).toEqual('k');
    ce.popScope();
  });

  test('a call that the inlining keeps is rebuilt with its function', () => {
    // `p` is not inlined: its body binds `k`, and the argument holds a `k`
    // (`betaReduceLambda()`). The inlining of `g(k)` in its argument rebuilds
    // the call of `p` (`inlineLambdaApplications()`,
    // `boxed-expression/utils.ts`), which must keep the outer `p`. The
    // integral stays symbolic; with the inner `p`, it was 100.
    const ce = new ComputeEngine();
    define(ce, 'p', [
      'Function',
      ['Sum', ['Multiply', 't', 'k'], ['Limits', 'k', 1, 2]],
      't',
    ]);
    define(ce, 'g', ['Function', 't', 't']);
    const I = ce.box([
      'Integrate',
      ['p', ['Multiply', ['g', 'k'], 'x']],
      ['Limits', 'x', 0, 1],
    ]);
    const before = I.evaluate().json;
    ce.pushScope();
    define(ce, 'p', ['Function', 100, 't']);
    expect(I.evaluate().json).toEqual(before);
    ce.popScope();
    expect(JSON.stringify(before)).not.toContain('100');
  });

  test('map() and replace() keep the function of each call they rebuild', () => {
    const ce = new ComputeEngine();
    define(ce, 'h', ['Function', ['Multiply', 'a', 'x'], 'a']);
    const e = ce.function('Add', [
      ce.function('h', [ce.symbol('a')]),
      ce.number(1),
    ]);
    ce.pushScope();
    define(ce, 'h', ['Function', 100, 'a']);
    const expected = ['Add', ['Multiply', 'k', 'x'], 1];
    const mapped = e.map((x) => (x.symbol === 'a' ? ce.symbol('k') : x));
    expect(mapped.evaluate().json).toEqual(expected);
    // The rule is given boxed symbols, so the result is canonical. With the
    // LaTeX strings `'a'` and `'k'`, the result is structural, and its
    // canonical form binds `h` by name again (`get canonical()`,
    // `boxed-function.ts`): that case is not covered here.
    const replaced = e.replace(
      { match: ce.symbol('a'), replace: ce.symbol('k') },
      { recursive: true }
    );
    expect(replaced?.evaluate().json).toEqual(expected);
    ce.popScope();
  });

  test('a name declared during the rebuild of a call stays declared', () => {
    // The rebuild of `h(…)` runs in a temporary scope that binds `h` to the
    // outer function (`withCallableBinding()`, `boxed-expression/binders.ts`).
    // A new name in an operand of a raw form is declared when the call is
    // boxed: the declaration goes to the enclosing scope, not to the
    // temporary scope, which is removed after the rebuild.
    const ce = new ComputeEngine();
    define(ce, 'h', ['Function', ['Multiply', 'a', 'x'], 'a']);
    const e = ce.function('Add', [
      ce.function('h', [ce.symbol('a')]),
      ce.number(1),
    ]);
    ce.pushScope();
    define(ce, 'h', ['Function', 100, 'a']);
    const mapped = e.map((x) =>
      x.symbol === 'a' ? ce.symbol('yy', { canonical: false }) : x
    );
    expect(ce.lookupDefinition('yy')).toBeDefined();
    expect(mapped.evaluate().json).toEqual(['Add', ['Multiply', 'x', 'yy'], 1]);
    const raw = ce.box(['Add', 'ww', 1], { canonical: false });
    const replaced = e.map((x) => (x.symbol === 'a' ? raw : x));
    expect(ce.lookupDefinition('ww')).toBeDefined();
    expect(replaced.evaluate().json).toEqual([
      'Add',
      ['Multiply', 'x', ['Add', 'ww', 1]],
      1,
    ]);
    ce.popScope();
  });

  test('a raw result of subs() binds its calls by name when it is made canonical', () => {
    // A documented limit (`docs/SCOPING-MODEL.md`, "Callable resolution"): a
    // raw node has no binding, so its canonical form looks the name `h` up
    // in the current scope and reads the inner `h`.
    const ce = new ComputeEngine();
    define(ce, 'h', ['Function', ['Multiply', 'a', 'x'], 'a']);
    const e = ce.function('Add', [
      ce.function('h', [ce.symbol('a')]),
      ce.number(1),
    ]);
    ce.pushScope();
    define(ce, 'h', ['Function', 100, 'a']);
    const raw = e.subs({ a: 'k' }, { canonical: false });
    expect(raw.canonical.evaluate().json).toEqual(101);
    ce.popScope();
  });

  test('a call that a replace rule writes uses the function of the rule', () => {
    // The rule rewrites `h(_x)` into a NEW call `q(_x)`: that call is not a
    // rebuild of `h(…)`, and it reads `q`.
    const ce = new ComputeEngine();
    define(ce, 'h', ['Function', ['Multiply', 'a', 'x'], 'a']);
    define(ce, 'q', ['Function', ['Multiply', 3, 'a'], 'a']);
    const e = ce.function('Add', [
      ce.function('h', [ce.symbol('a')]),
      ce.number(1),
    ]);
    ce.pushScope();
    define(ce, 'h', ['Function', 100, 'a']);
    const r = e.replace(
      { match: ['h', '_x'], replace: ['q', '_x'] },
      { recursive: true }
    );
    expect(r?.json).toEqual(['Add', ['q', 'a'], 1]);
    expect(r?.evaluate().json).toEqual(['Add', ['Multiply', 3, 'a'], 1]);
    ce.popScope();
  });

  test('with no scope that declares the name again, nothing changes', () => {
    const ce = new ComputeEngine();
    define(ce, 'h', ['Function', ['Multiply', 'a', 'x'], 'a']);
    const e = ce.function('Add', [
      ce.function('h', [ce.symbol('a')]),
      ce.number(1),
    ]);
    const s = e.subs({ a: 'k' });
    expect(s.json).toEqual(['Add', ['h', 'k'], 1]);
    expect(s.evaluate().json).toEqual(['Add', ['Multiply', 'k', 'x'], 1]);
    // An operand that does not change returns the same node.
    expect(e.subs({ b: 'k' })).toBe(e);
  });

  test('a function substituted as an argument is the substituted value', () => {
    // `subs()` replaces the symbol operand `h` of `Map`, and the result
    // applies the function that the substitution gave (`other`).
    const ce = new ComputeEngine();
    define(ce, 'h', ['Function', ['Multiply', 'a', 'x'], 'a']);
    const m = ce.box(['Map', 'h', ['List', 1, 2]]);
    ce.pushScope();
    define(ce, 'h', ['Function', 100, 'a']);
    define(ce, 'other', ['Function', ['Multiply', 7, 'a'], 'a']);
    const s = m.subs({ h: 'other' });
    expect(s.json).toEqual(['Map', 'other', ['List', 1, 2]]);
    expect(ce.function('At', [s, ce.number(2)]).evaluate().json).toEqual(14);
    ce.popScope();
  });

  test('a call that the substitution value contains keeps its own binding', () => {
    // The value `h(2)` is made in the inner scope, so it calls the inner `h`
    // (100); the call `h(…)` of the expression keeps the outer `h`.
    const ce = new ComputeEngine();
    define(ce, 'h', ['Function', ['Multiply', 'a', 'x'], 'a']);
    const e = ce.function('Add', [
      ce.function('h', [ce.symbol('a')]),
      ce.number(1),
    ]);
    ce.pushScope();
    define(ce, 'h', ['Function', 100, 'a']);
    const s = e.subs({ a: ce.function('h', [ce.number(2)]) });
    expect(s.evaluate().json).toEqual(['Add', ['Multiply', 100, 'x'], 1]);
    // A raw replacement is boxed in the current scope: its `h` is the inner
    // `h`.
    expect(e.subs({ a: ['h', 2] }).evaluate().json).toEqual([
      'Add',
      ['Multiply', 100, 'x'],
      1,
    ]);
    ce.popScope();
  });
});
