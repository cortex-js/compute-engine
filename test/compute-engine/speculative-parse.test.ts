import { ComputeEngine } from '../../src/compute-engine';

/**
 * `ce.parse(latex, { speculative: true })` — a parse that leaves NO trace in
 * the engine's type state (Tycho item 179: a consumer's derive-style parse
 * must not side-effect-declare into, or narrow, the parent scope).
 *
 * Two leaks are closed:
 * - auto-declares are confined to a transient scope, discarded on the way
 *   out;
 * - a narrowing use (e.g. `Fibonacci(u)` on an inferred `u: number`) refines
 *   a SHADOW declared in the transient scope, not the ambient definition —
 *   a child scope alone does not confine narrowing, since the write lands on
 *   the resolved definition wherever it lives.
 *
 * Every "does not move" assertion here has a control showing the same probe
 * DOES move without `speculative` — a no-move result proves nothing without
 * one.
 */

describe('speculative parse', () => {
  test('auto-declares do not leak into the ambient scope', () => {
    const ce = new ComputeEngine();
    ce.parse('q_{spec} + 1', { speculative: true });
    expect(ce.lookupDefinition('q_spec')).toBeUndefined();
    // Control: the same parse without `speculative` declares the symbol.
    ce.parse('q_{spec} + 1');
    expect(ce.lookupDefinition('q_spec')).toBeDefined();
  });

  test('a narrowing use does not move an inferred ambient type', () => {
    const ce = new ComputeEngine();
    ce.parse('u + 0.5'); // `u` auto-declared, inferred `number`
    expect(ce.box('u').type.toString()).toBe('number');

    ce.parse('\\operatorname{Fibonacci}(u)', { speculative: true });
    expect(ce.box('u').type.toString()).toBe('number');

    // Control: the same parse without `speculative` narrows `u`.
    ce.parse('\\operatorname{Fibonacci}(u)');
    expect(ce.box('u').type.toString()).toBe('integer');
  });

  test('the derived type matches a normal parse of the same string', () => {
    const a = new ComputeEngine();
    a.parse('u + 0.5');
    const speculative = a.parse('\\operatorname{Fibonacci}(u)', {
      speculative: true,
    });

    const b = new ComputeEngine();
    b.parse('u + 0.5');
    const normal = b.parse('\\operatorname{Fibonacci}(u)');

    expect(speculative.type.toString()).toBe(normal.type.toString());
    expect(JSON.stringify(speculative.json)).toBe(JSON.stringify(normal.json));
  });

  test('declared (non-inferred) symbols still steer the parse', () => {
    const ce = new ComputeEngine();
    ce.declare('f_s', '(number) -> number');
    // `f_s(2)` must parse as an application, exactly as without the option:
    // declared symbols are not shadowed, so the parser's oracle sees them.
    const e = ce.parse('f_{s}(2)', { speculative: true });
    expect(e.operator).toBe('f_s');
    // And constants are untouched.
    expect(ce.parse('\\pi', { speculative: true }).symbol).toBe('Pi');
  });

  test('speculative and scope are mutually exclusive', () => {
    const ce = new ComputeEngine();
    const scope = ce.createScope();
    expect(() =>
      ce.parse('x + 1', { speculative: true, scope })
    ).toThrow(/mutually exclusive/);
  });
});
