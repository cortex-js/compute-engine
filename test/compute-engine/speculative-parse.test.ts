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

  test('a narrowing use does not move a DECLARED `unknown` either', () => {
    // `unknown` is a placeholder that refines per use, not a contract, so a
    // symbol declared `unknown` is exactly as narrowable as an inferred one
    // and needs the shadow just as much. The shadow condition originally
    // tested `inferredType` alone, so `ce.declare('u', 'unknown')` followed
    // by a speculative parse of `u + 1` persistently narrowed `u` to
    // `number` — a trace, which is the one thing `speculative` promises not
    // to leave. (A DECLARED concrete type needs no shadow: a use cannot move
    // it. See the control below.)
    const ce = new ComputeEngine();
    ce.declare('u_d', 'unknown');
    const e = ce.parse('u_{d} + 1', { speculative: true });
    expect(ce.lookupDefinition('u_d')!['value'].type.toString()).toBe(
      'unknown'
    );
    // The result still reports the narrowed type — the shadow is what moved,
    // and reading the derived type is the whole point of the option.
    expect(e.type.toString()).toBe('number');
    // Control: the same parse without `speculative` DOES move it.
    ce.parse('u_{d} + 1');
    expect(ce.lookupDefinition('u_d')!['value'].type.toString()).toBe('number');
  });

  test('a declared CONCRETE type is unmoved with or without the option', () => {
    // The control for the test above: this is why the shadow is limited to
    // the narrowable cases rather than applied to every symbol. Shadowing a
    // declared concrete type would be inert here, and shadowing a constant or
    // an operator would change how the string parses.
    const ce = new ComputeEngine();
    ce.declare('n_d', 'number');
    ce.parse('\\operatorname{Fibonacci}(n_{d})', { speculative: true });
    expect(ce.lookupDefinition('n_d')!['value'].type.toString()).toBe('number');
    ce.parse('\\operatorname{Fibonacci}(n_{d})');
    expect(ce.lookupDefinition('n_d')!['value'].type.toString()).toBe('number');
  });

  test('shadowing an `unknown` symbol does not hide its VALUE', () => {
    // A symbol declared `unknown` can still hold a value — the declaration
    // pins no contract, so `assign` neither rejects the value nor replaces
    // the type. The shadow is declared type-only, so the check that matters
    // is that the ambient value survives the parse and the derived type is
    // still the one a normal parse produces.
    const ce = new ComputeEngine();
    ce.declare('v_d', 'unknown');
    ce.assign('v_d', 5);
    const e = ce.parse('v_{d} + 1', { speculative: true });
    expect(e.type.toString()).toBe('number');
    const def = ce.lookupDefinition('v_d')!['value'];
    expect(def.type.toString()).toBe('unknown');
    expect(def.value?.re).toBe(5);
    // Control: the plain parse derives the same type and DOES narrow.
    expect(ce.parse('v_{d} + 1').type.toString()).toBe('number');
    expect(ce.lookupDefinition('v_d')!['value'].type.toString()).toBe('number');
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

  test('a type RESTORED to `unknown` is not narrowed', () => {
    // The path a consumer hit: narrow a symbol by use, put it back with the
    // `type` setter, then parse speculatively. This one was already confined
    // — the restore leaves `inferredType` set, so the shadow applied — while
    // the freshly-declared `unknown` above was not. The two differ only in
    // history, never in whether a use can narrow them, so they must agree.
    const ce = new ComputeEngine();
    ce.declare('r_d', 'unknown');
    ce.parse('r_{d} + 1');
    expect(ce.lookupDefinition('r_d')!['value'].type.toString()).toBe('number');
    ce.box('r_d').type = 'unknown';
    ce.parse('r_{d} + 1', { speculative: true });
    expect(ce.lookupDefinition('r_d')!['value'].type.toString()).toBe(
      'unknown'
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
