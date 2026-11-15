import { ComputeEngine } from '../../src/compute-engine';
import { snapshotMemoDeps } from '../../src/compute-engine/boxed-expression/collection-element-memo';

// A call head or a callback that had no definition when it was boxed is
// free: it resolves from the scope it was boxed in, and the current scope
// plays no part (bound-once spec, section 2, rule 1).

describe('A FREE CALLBACK READS ITS HOME CHAIN', () => {
  test('a callback boxed before its definition calls the definition of its home chain', () => {
    const ce = new ComputeEngine();
    const M = ce.box(['ListFrom', ['Map', 'h', ['List', 1, 2]]]);
    ce.parse('h(t) \\coloneq t').evaluate();
    expect(M.evaluate().json).toEqual(['List', 1, 2]);
    ce.pushScope();
    ce.declare('h', 'function');
    ce.assign('h', ce.expr(['Function', 100, 't']));
    expect(M.evaluate().json).toEqual(['List', 1, 2]);
    ce.popScope();
  });

  test('an unresolved callback stays unevaluated under a scope that declares its name, as the call does', () => {
    const ce = new ComputeEngine();
    const e = ce.box(['ListFrom', ['Map', 'hh', ['List', 1, 2]]]);
    const c = ce.box(['hh', 1]);
    ce.pushScope();
    ce.declare('hh', 'function');
    ce.assign('hh', ce.box(['Function', ['Multiply', 100, 'x'], 'x']));
    expect(e.evaluate().json).toEqual(['List', ['hh', 1], ['hh', 2]]);
    expect(c.evaluate().json).toEqual(['hh', 1]);
    ce.popScope();
    ce.assign('hh', ce.box(['Function', ['Add', 'x', 1], 'x']));
    expect(e.evaluate().json).toEqual(['List', 2, 3]);
    expect(c.evaluate().json).toEqual(2);
  });
});

describe('THE MEMO DEPENDENCIES OF A FREE CALL HEAD', () => {
  test('are read from the home chain, not from a shadow of the current scope', () => {
    const ce = new ComputeEngine();
    const lit = ce.box(['Function', ['g', 'x'], 'x']);
    ce.parse('g(t) \\coloneq t + a').evaluate();
    ce.assign('a', 10);
    ce.pushScope();
    ce.declare('g', 'integer');
    ce.assign('g', 5);
    const e = ce.box(['ListFrom', ['Map', lit, ['List', 1, 2]]]);
    expect(e.evaluate().json).toEqual(['List', 11, 12]);
    const deps = snapshotMemoDeps(e) as unknown as { name: string }[];
    expect(deps.map((d) => d.name)).toContain('a');
    ce.assign('a', 20);
    expect(e.evaluate().json).toEqual(['List', 21, 22]);
    ce.popScope();
  });

  test('two calls of one name boxed in two scopes record two dependencies', () => {
    const ce = new ComputeEngine();
    ce.pushScope();
    const c1 = ce.box(['h', 1]);
    ce.assign('h', ce.box(['Function', ['Add', 'x', 1], 'x']));
    ce.popScope();
    ce.pushScope();
    const c2 = ce.box(['h', 2]);
    ce.assign('h', ce.box(['Function', ['Add', 'x', 10], 'x']));
    const y = ce.symbol('y');
    const map = ce.function('Map', [
      ce.function('Function', [ce.function('Add', [c1, c2, y]), y]),
      ce.function('List', [ce.number(0), ce.number(100)]),
    ]);
    expect(ce.function('ListFrom', [map]).evaluate().json).toEqual([
      'List',
      14,
      114,
    ]);
    const deps = snapshotMemoDeps(map) as unknown as { name: string }[];
    expect(deps.filter((d) => d.name === 'h')).toHaveLength(2);
    ce.assign('h', 5);
    expect(c2.evaluate().json).toEqual(['h', 2]);
    ce.popScope();
  });
});

describe('THE TYPE OF A CALL BOXED BEFORE ITS FUNCTION IS DECLARED', () => {
  test('reads the declared signature in either order', () => {
    for (const order of ['before', 'after']) {
      const ce = new ComputeEngine();
      let call = order === 'before' ? ce.box(['h', 1]) : undefined;
      ce.box([
        'Declare',
        'h',
        { str: '(number) -> number' },
        ['Function', ['Multiply', 2, 'x'], 'x'],
      ]).evaluate();
      call ??= ce.box(['h', 1]);
      expect(call.type.toString()).toBe('number');
      expect(call.evaluate().json).toBe(2);
    }
  });
});

describe('THE TYPE OF A FUNCTION THAT CALLS A FUNCTION DEFINED LATER', () => {
  test('is the type it has when the callee is defined first', () => {
    const G = 'M \\mapsto \\bigl\\lbrack M[1], M[2], M[3]\\bigr\\rbrack';
    const R = 'M \\mapsto G(M-\\bigl\\lbrack0, 0, Y\\bigr\\rbrack)';
    const later = new ComputeEngine();
    later.assign('R', later.parse(R, { strict: false }));
    later.assign('G', later.parse(G, { strict: false }));
    const first = new ComputeEngine();
    first.assign('G', first.parse(G, { strict: false }));
    first.assign('R', first.parse(R, { strict: false }));
    expect(later.box('R').type.toString()).toBe(first.box('R').type.toString());
  });
});

describe('THE EFFECTS OF A FUNCTION THAT CALLS A FUNCTION DEFINED LATER', () => {
  const effects = (ce: ComputeEngine, name: string): unknown =>
    (ce.lookupDefinition(name) as { operator: { effects: unknown } }).operator
      .effects;

  test('inferred effects are derived again when the callee is defined, and redefined', () => {
    const ce = new ComputeEngine();
    ce.box(['Assign', 'R1', ['Function', ['G1', 'x'], 'x']]).evaluate();
    expect(effects(ce, 'R1')).toBe('any');
    ce.box(['Assign', 'G1', ['Function', 'x', 'x']]).evaluate();
    expect(effects(ce, 'R1')).toBeUndefined();
    ce.box([
      'Assign',
      'G1',
      ['Function', ['Add', 'x', ['Random']], 'x'],
    ]).evaluate();
    expect(effects(ce, 'R1')).toEqual(['random']);
  });

  test('a declared contract over a head with no definition stays trusted (MathJSON)', () => {
    const ce = new ComputeEngine();
    ce.declare('T2', {
      signature: '() -> number',
      effects: [],
      evaluate: ce.box(['Function', ['U2']]),
    } as never);
    const assigned = ce
      .box(['Assign', 'U2', ['Function', ['Random']]])
      .evaluate();
    expect(assigned.operator).toBe('Function');
    expect(effects(ce, 'T2')).toEqual([]);
    const again = ce
      .box(['Assign', 'U2', ['Function', ['Add', 1, ['Random']]]])
      .evaluate();
    expect(again.operator).toBe('Function');
  });

  test('a declared contract installed over a defined head is checked again when the head changes', () => {
    // The literal is boxed before `g` exists, and installed under the
    // contract after `g` is defined: the contract was checked, and is
    // checked again when `g` draws.
    const ce = new ComputeEngine();
    const literal = ce.box(['Function', ['g', 'x'], 'x']);
    ce.box(['Assign', 'g', ['Function', ['Multiply', 2, 'x'], 'x']]).evaluate();
    ce.declare('T', {
      signature: '(number) -> number',
      effects: [],
      evaluate: literal,
    } as never);
    const assigned = ce
      .box(['Assign', 'g', ['Function', ['Add', 'x', ['Random']], 'x']])
      .evaluate();
    expect(assigned.operator).toBe('Error');
    expect(effects(ce, 'T')).toEqual([]);
  });

  test('a declared contract over a head with no definition stays trusted (LaTeX)', () => {
    const ce = new ComputeEngine();
    ce.declare('T2', {
      signature: '() -> number',
      effects: [],
      evaluate: ce.parse('() \\mapsto U_2()', { strict: false }),
    } as never);
    const assigned = ce
      .parse('U_2() \\coloneq \\operatorname{Random}()', { strict: false })
      .evaluate();
    expect(assigned.operator).toBe('Function');
    expect(effects(ce, 'T2')).toEqual([]);
  });
});
