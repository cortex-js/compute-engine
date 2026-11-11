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
    // Control: `ce.infer()` over the same parse without `speculative`
    // declares the symbol.
    ce.infer([ce.parse('q_{spec} + 1')]);
    expect(ce.lookupDefinition('q_spec')).toBeDefined();
  });

  test('a narrowing use does not move an inferred ambient type', () => {
    const ce = new ComputeEngine();
    ce.infer([ce.parse('u + 0.5')]); // `u` declared, inferred `number`
    expect(ce.box('u').type.toString()).toBe('number');

    ce.parse('\\operatorname{Fibonacci}(u)', { speculative: true });
    expect(ce.box('u').type.toString()).toBe('number');

    // Control: `ce.infer()` over the same parse without `speculative`
    // narrows `u`.
    ce.infer([ce.parse('\\operatorname{Fibonacci}(u)')]);
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

  test('a declared CONCRETE type is unmoved with or without the option', () => {
    // This is why the shadow is limited to the narrowable cases rather than
    // applied to every symbol. Shadowing a declared concrete type would be
    // inert here, and shadowing a constant or an operator would change how
    // the string parses.
    const ce = new ComputeEngine();
    ce.declare('n_d', 'number');
    ce.parse('\\operatorname{Fibonacci}(n_{d})', { speculative: true });
    expect(ce.lookupDefinition('n_d')!['value'].type.toString()).toBe('number');
    ce.parse('\\operatorname{Fibonacci}(n_{d})');
    expect(ce.lookupDefinition('n_d')!['value'].type.toString()).toBe('number');
  });

  test('shadowing an `unknown` symbol does not hide its VALUE', () => {
    // A symbol declared `unknown` can still hold a value — the declaration
    // pins no contract, so `assign` neither rejects the value nor refuses to
    // type from it. The shadow is declared type-only, so what must hold is
    // that the ambient value survives and the speculative parse derives
    // exactly what a normal parse of the same string derives.
    //
    // Deliberately no "does not move" control here, unlike its siblings: the
    // assignment has already settled the type (`integer`, inferred), and a
    // use can only narrow, so no probe on this symbol moves the ambient type
    // with or without the option. That is the point rather than a gap — for
    // a symbol whose value is known there is no narrowing left to leak.
    const ce = new ComputeEngine();
    ce.declare('v_d', 'unknown');
    ce.assign('v_d', 5);
    expect(ce.lookupDefinition('v_d')!['value'].type.toString()).toBe(
      'integer'
    );
    const speculative = ce.parse('v_{d} + 1', { speculative: true });
    const normal = ce.parse('v_{d} + 1');
    expect(speculative.type.toString()).toBe(normal.type.toString());
    expect(JSON.stringify(speculative.json)).toBe(JSON.stringify(normal.json));
    const def = ce.lookupDefinition('v_d')!['value'];
    expect(def.type.toString()).toBe('integer');
    expect(def.value?.re).toBe(5);
  });

  test('an operator-valued symbol is never shadowed', () => {
    // The shadow applies to VALUE definitions only. An assigned function
    // literal installs an operator definition, which must keep steering the
    // parse (`g(2)` is an application, not a multiplication).
    const ce = new ComputeEngine();
    ce.declare('g_d', 'unknown');
    ce.assign('g_d', ce.parse('x \\mapsto x + 1'));
    expect(ce.parse('g_{d}(2)', { speculative: true }).toString()).toBe(
      ce.parse('g_{d}(2)').toString()
    );
  });

  test('speculative and scope are mutually exclusive', () => {
    const ce = new ComputeEngine();
    const scope = ce.createScope();
    expect(() =>
      ce.parse('x + 1', { speculative: true, scope })
    ).toThrow(/mutually exclusive/);
  });
});
