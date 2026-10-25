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
