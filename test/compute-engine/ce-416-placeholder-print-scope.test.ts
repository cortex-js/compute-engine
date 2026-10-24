import { ComputeEngine } from '../../src/compute-engine';

/**
 * ROADMAP CE-416: printing a function literal whose single parameter is the
 * placeholder `_1` spells it `_` (`(_) => _ * 1 / n`). The printer used to
 * make that rename with `subs({ _1: '_' })`, which boxed the symbol `_` in
 * the current scope: `toString()` of a lazy `Map` declared `_` in the
 * engine's scope. A later print of a literal `(_1) => l(_1)` whose parameter
 * `l` is a point then showed `l(Error(incompatible-type …))`, because `_`
 * was typed as a number. The rename is now a spelling of the printer only.
 */
describe('CE-416: PRINTING A PLACEHOLDER LITERAL DECLARES NOTHING', () => {
  test('toString() of a lazy Map does not define `_`', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    const v = ce.parse('\\frac{1}{n}\\cdot[0...n]').evaluate();
    expect(v.toString()).toBe('Map((_) => _ * 1 / n, Range(0, n))');
    expect(ce.lookupDefinition('_')).toBeUndefined();
  });

  test('toString() of a function literal does not define `_`', () => {
    const ce = new ComputeEngine();
    const f = ce.box(['Function', ['Multiply', '_1', 2], '_1']);
    expect(f.toString()).toBe('(_) => 2 * _');
    expect(ce.lookupDefinition('_')).toBeUndefined();
  });

  test('a later print of a literal over a point parameter shows no error', () => {
    const ce = new ComputeEngine();
    ce.declare('n', 'integer');
    ce.declare('l', { signature: '(tuple<number, number>) -> unknown' });
    ce.assign('l', ce.parse('A \\mapsto A.x'));
    ce.declare('Q', 'list<tuple<number, number>>');
    const w = ce.box(['Map', ['Function', ['l', '_1'], '_1'], 'Q']);
    ce.parse('\\frac{1}{n}\\cdot[0...n]').evaluate().toString();
    expect(ce.lookupDefinition('_')).toBeUndefined();
    expect(w.toString()).not.toMatch(/Error/);
  });
});
