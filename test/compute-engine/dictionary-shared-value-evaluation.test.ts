/**
 * Evaluating a dictionary that holds the same dictionary under two keys,
 * level after level, took a time exponential in the depth (CE-372): 30
 * levels of `{p: d, q: d}` did not finish in 25 s. Within one evaluation,
 * the value of each pure dictionary node is now computed once.
 */
import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine';

function pair(ce: ComputeEngine, a: Expression, b: Expression): Expression {
  return ce.function('Dictionary', [
    ce.function('KeyValuePair', [ce.string('p'), a]),
    ce.function('KeyValuePair', [ce.string('q'), b]),
  ]);
}

describe('EVALUATE a dictionary that shares its values', () => {
  it('30 levels of `{p: d, q: d}` evaluate in linear time', () => {
    const ce = new ComputeEngine();
    let d: Expression = ce.box(['Add', 'x', 1]);
    for (let i = 0; i < 30; i++) d = pair(ce, d, d);
    ce.assign('x', 1);
    const start = Date.now();
    let r = ce.function('ReleaseHold', [ce.function('Hold', [d])]).evaluate();
    expect(Date.now() - start).toBeLessThan(5000);
    for (let i = 0; i < 30; i++) {
      expect(r.operator).toBe('Dictionary');
      r = (r as unknown as { get(k: string): Expression }).get('q');
    }
    expect(r.toString()).toBe('2');
  });

  it('a pure shared value gives the same result as before', () => {
    const ce = new ComputeEngine();
    const e = ce.function('Dictionary', [
      ce.function('KeyValuePair', [ce.string('v'), ce.box(['Add', 'x', 1])]),
    ]);
    const d = pair(ce, e, e);
    ce.assign('x', 1);
    expect(d.evaluate().toString()).toBe(
      '{"p" -> {"v" -> 2}, "q" -> {"v" -> 2}}'
    );
    // A later evaluation reads the new value of `x`.
    ce.assign('x', 5);
    expect(d.evaluate().toString()).toBe(
      '{"p" -> {"v" -> 6}, "q" -> {"v" -> 6}}'
    );
  });

  it('a shared value evaluated inside a transient precision window has the digits of the window', () => {
    // An entry of the memo of the shared values records the precision and the
    // angular unit it was computed at (`_withTransientPrecision()` changes
    // them with no engine event), so a value computed in the window has the
    // digits of the window, and the sharing stays within the window: 30
    // levels of `{p: d, q: d}` evaluate in linear time there too.
    const ce = new ComputeEngine();
    let deep: Expression = ce.box(['N', ['Rational', 1, 3]]);
    for (let i = 0; i < 30; i++) deep = pair(ce, deep, deep);
    const start = Date.now();
    let r = ce._withTransientPrecision(5, () => deep.evaluate());
    expect(Date.now() - start).toBeLessThan(5000);
    // The result has 2^30 leaves, so it is read along one path, as the
    // linear-time test above does.
    for (let i = 0; i < 30; i++) {
      expect(r.operator).toBe('Dictionary');
      r = (r as unknown as { get(k: string): Expression }).get('q');
    }
    expect(r.toString()).toBe('0.33333');

    const e = ce.function('Dictionary', [
      ce.function('KeyValuePair', [
        ce.string('v'),
        ce.box(['N', ['Rational', 1, 3]]),
      ]),
    ]);
    const d = pair(ce, e, e);
    const outside =
      '{"p" -> {"v" -> 0.333333333333333333333}, "q" -> {"v" -> 0.333333333333333333333}}';
    expect(d.evaluate().toString()).toBe(outside);
    expect(ce._withTransientPrecision(5, () => d.evaluate().toString())).toBe(
      '{"p" -> {"v" -> 0.33333}, "q" -> {"v" -> 0.33333}}'
    );
    expect(d.evaluate().toString()).toBe(outside);
  });

  it('a shared value read inside and outside a window at each level is computed once per context', () => {
    // `{a: d, b: W(d), c: d}` at each of 30 levels, where `W` evaluates its
    // operand inside a window of 5 digits. A node keeps one memo entry per
    // context, so the read of `c` finds the entry that `a` stored although
    // `b` stored one for the window in between: the evaluation is linear in
    // the depth. With one entry per node, `c` would compute `d` again at each
    // level, and the time would double at each level.
    const ce = new ComputeEngine();
    ce.declare('W', {
      signature: '(any) -> any',
      lazy: true,
      pure: true,
      evaluate: ([x], { engine }) =>
        engine._withTransientPrecision(5, () => x.evaluate()),
    });
    let d: Expression = ce.box(['N', ['Rational', 1, 3]]);
    for (let i = 0; i < 30; i++)
      d = ce.function('Dictionary', [
        ce.function('KeyValuePair', [ce.string('a'), d]),
        ce.function('KeyValuePair', [ce.string('b'), ce.function('W', [d])]),
        ce.function('KeyValuePair', [ce.string('c'), d]),
      ]);
    const start = Date.now();
    let r = d.evaluate();
    expect(Date.now() - start).toBeLessThan(5000);
    const get = (x: Expression, k: string) =>
      (x as unknown as { get(k: string): Expression }).get(k);
    // The result has 3^30 leaves, so it is read along two paths: through
    // `b` (inside the window) and along `c` (outside it).
    let inside = get(r, 'b');
    for (let i = 1; i < 30; i++) inside = get(inside, 'c');
    expect(inside.toString()).toBe('0.33333');
    for (let i = 0; i < 30; i++) r = get(r, 'c');
    expect(r.toString()).toBe('0.333333333333333333333');
  });

  it('a shared value read inside and outside a window in one evaluation has the digits of each context', () => {
    // `W` evaluates its operand inside a window of 5 digits. In `{p: D, q:
    // W(D)}` the shared `D` is first stored at the precision of the engine,
    // then read inside the window; in `{p: W(D), q: D}` it is first stored
    // inside the window, then read outside. Before the entry recorded the
    // precision, the first read served the entry: 21 digits inside the window
    // and 5 digits outside it.
    const ce = new ComputeEngine();
    ce.declare('W', {
      signature: '(any) -> any',
      lazy: true,
      pure: true,
      evaluate: ([x], { engine }) =>
        engine._withTransientPrecision(5, () => x.evaluate()),
    });
    const D = ce.function('Dictionary', [
      ce.function('KeyValuePair', [
        ce.string('v'),
        ce.box(['N', ['Rational', 1, 3]]),
      ]),
    ]);
    expect(
      pair(ce, D, ce.function('W', [D]))
        .evaluate()
        .toString()
    ).toBe(
      '{"p" -> {"v" -> 0.333333333333333333333}, "q" -> {"v" -> 0.33333}}'
    );
    expect(
      pair(ce, ce.function('W', [D]), D)
        .evaluate()
        .toString()
    ).toBe(
      '{"p" -> {"v" -> 0.33333}, "q" -> {"v" -> 0.333333333333333333333}}'
    );
  });

  it('a shared value read through N at each level is computed once', () => {
    // `N(d)` evaluates `d` with a new options object at each call. The memo
    // compares the options by value, so the second `N(d)` of each level finds
    // the entry of the first; with an identity test each read was a miss, and
    // the evaluation was exponential in the depth.
    const ce = new ComputeEngine();
    let d: Expression = ce.box(['Add', ['Sqrt', 2], 1]);
    for (let i = 0; i < 30; i++)
      d = pair(ce, ce.function('N', [d]), ce.function('N', [d]));
    const start = Date.now();
    let r = d.evaluate();
    expect(Date.now() - start).toBeLessThan(5000);
    for (let i = 0; i < 30; i++)
      r = (r as unknown as { get(k: string): Expression }).get('q');
    expect(r.toString()).toBe('2.4142135623730950488');
  });

  it('a shared value that draws a random number draws at each key', () => {
    const ce = new ComputeEngine();
    const e = ce.function('Dictionary', [
      ce.function('KeyValuePair', [ce.string('v'), ce.box(['Random'])]),
    ]);
    const r = pair(ce, e, e).evaluate() as unknown as {
      get(k: string): Expression & { get(k: string): Expression };
    };
    expect(r.get('p').get('v').re).not.toBe(r.get('q').get('v').re);
  });
});
