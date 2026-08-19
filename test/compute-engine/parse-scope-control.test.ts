import { ComputeEngine } from '../../src/compute-engine';
import { canonicalForm } from '../../src/compute-engine/boxed-expression/canonical';
import type { CanonicalOptions } from '../../src/compute-engine/global-types';

/**
 * A parse or box under a PARTIAL canonical form (`canonical: ['Number']`, …)
 * must not write to the caller's scope: its output is not fully canonical, so
 * it follows the structural symbol contract — free symbols resolve against the
 * scope chain but are never auto-declared.
 * See `docs/SCOPING-MODEL.md` A1.
 */

const PARTIAL_FORMS: CanonicalOptions[] = [
  ['Number'],
  ['Add'],
  ['InvisibleOperator'],
  'Number',
  ['Number', 'Order', 'Add', 'Multiply', 'Power', 'Divide', 'Flatten'],
];

describe('PARTIAL FORMS do not auto-declare', () => {
  test.each(PARTIAL_FORMS)('parse route: %p', (canonical) => {
    const ce = new ComputeEngine();
    const expr = ce.parse('w + 1', { canonical });
    expect(expr.symbols).toContain('w');
    expect(ce.lookupDefinition('w')).toBeUndefined();
  });

  test.each(PARTIAL_FORMS)('box route: %p', (canonical) => {
    const ce = new ComputeEngine();
    ce.box(['Add', 'w', 1], { canonical });
    expect(ce.lookupDefinition('w')).toBeUndefined();
  });

  it('does not declare a bare symbol', () => {
    const ce = new ComputeEngine();
    ce.box('w', { canonical: ['Number'] });
    expect(ce.lookupDefinition('w')).toBeUndefined();
  });

  it('does not declare through nested subexpressions', () => {
    const ce = new ComputeEngine();
    ce.parse('\\frac{w}{q} + \\sin(v)', { canonical: ['Number'] });
    for (const name of ['w', 'q', 'v'])
      expect(ce.lookupDefinition(name)).toBeUndefined();
  });

  it('leaves the unresolved symbol unbound (structural contract)', () => {
    const ce = new ComputeEngine();
    const expr = ce.parse('w + 1', { canonical: ['Number'] });
    const w = expr.ops![0];
    expect(w.symbol).toBe('w');
    expect(w.valueDefinition).toBeUndefined();
  });
});

describe('PARTIAL FORMS still resolve', () => {
  it('binds a symbol that is already declared', () => {
    const ce = new ComputeEngine();
    ce.declare('w', 'integer');
    const w = ce.parse('w + 1', { canonical: ['Number'] }).ops![0];
    expect(w.symbol).toBe('w');
    expect(w.valueDefinition).toBeDefined();
    expect(w.type.toString()).toBe('integer');
    // The declaration is the one the caller made: no shadowing copy.
    expect(w.valueDefinition).toBe(ce.lookupDefinition('w')?.value);
  });

  it('substitutes a `holdUntil: "never"` constant', () => {
    const ce = new ComputeEngine();
    ce.declare('c9', {
      type: 'number',
      value: ce.number(42),
      holdUntil: 'never',
      isConstant: true,
    });
    expect(
      ce.box(['Add', 'c9', 1], { canonical: ['Number'] }).toString()
    ).toBe('42 + 1');
  });
});

describe('PARTIAL FORMS: unchanged routes (pins)', () => {
  it('a fully canonical parse still declares', () => {
    const ce = new ComputeEngine();
    ce.parse('w + 1');
    expect(ce.lookupDefinition('w')).toBeDefined();
  });

  it('a fully canonical box still declares', () => {
    const ce = new ComputeEngine();
    ce.box(['Add', 'w', 1]);
    expect(ce.lookupDefinition('w')).toBeDefined();
  });

  it('`canonical: false` remains inert', () => {
    const ce = new ComputeEngine();
    ce.parse('w + 1', { canonical: false });
    ce.box(['Add', 'w', 1], { canonical: false });
    expect(ce.lookupDefinition('w')).toBeUndefined();
  });

  it('`structural: true` remains inert', () => {
    const ce = new ComputeEngine();
    ce.parse('w + 1', { structural: true });
    ce.box(['Add', 'w', 1], { structural: true });
    expect(ce.lookupDefinition('w')).toBeUndefined();
  });
});

/**
 * Stage 1 (B1/B2/B3): a per-call `scope` that RECEIVES the parse's writes,
 * `ce.createScope()` as a declarations-as-data initializer, and the harvest
 * read surface.
 * See `docs/SCOPING-MODEL.md` B1–B3.
 */

describe('SCOPE OPTION contains the writes', () => {
  it('parse route: declares into the supplied scope, not the engine scope', () => {
    const ce = new ComputeEngine();
    const scope = ce.createScope();
    ce.parse('g(s_2)', { scope });

    expect(ce.lookupDefinition('g')).toBeUndefined();
    expect(ce.lookupDefinition('s_2')).toBeUndefined();
    expect(scope.declarations().map((x) => x.name)).toEqual(['g', 's_2']);
  });

  it('expr route: declares into the supplied scope, not the engine scope', () => {
    const ce = new ComputeEngine();
    const scope = ce.createScope();
    ce.expr(['g2', 'y2'], { scope });

    expect(ce.lookupDefinition('g2')).toBeUndefined();
    expect(ce.lookupDefinition('y2')).toBeUndefined();
    expect(scope.declarations().map((x) => x.name)).toEqual(['g2', 'y2']);
  });

  it('the engine scope is untouched by a contained parse of a definition', () => {
    const ce = new ComputeEngine();
    const scope = ce.createScope({ f: 'function' });
    ce.parse('f(p, q, r) = p + q + r', { scope });

    for (const name of ['f', 'p', 'q', 'r'])
      expect(ce.lookupDefinition(name)).toBeUndefined();
  });

  it('a supplied scope also steers lookup under a PARTIAL form', () => {
    const ce = new ComputeEngine();
    const scope = ce.createScope({ w2: 'integer' });
    const w = ce.expr(['Add', 'w2', 1], { canonical: ['Number'], scope })
      .ops![0];
    expect(w.symbol).toBe('w2');
    expect(w.type.toString()).toBe('integer');
    // …and still declares nothing, anywhere.
    expect(ce.lookupDefinition('w2')).toBeUndefined();
  });

  it('canonicalForm honors its `scope` argument on the partial-form path', () => {
    // Only the `forms === true` branch used to consult `scope`; every partial
    // form ignored it. Called directly — with no enclosing `_inScope` — the
    // argument is the only thing that can steer the lookup.
    const ce = new ComputeEngine();
    const scope = ce.createScope({ w3: 'integer' });
    const expr = canonicalForm(
      ce.expr('w3', { canonical: false }),
      ['Number'],
      scope
    );
    expect(expr.symbol).toBe('w3');
    expect(expr.type.toString()).toBe('integer');
  });
});

describe('createScope: declarations as data', () => {
  it('makes a definition head valid against a predeclared 2-arg function', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(number, number) -> number');

    // Without the scope, the 1-arg definition head collides with the
    // predeclared 2-arg `h`.
    expect(ce.parse('h(u) = u^2').isValid).toBe(false);

    const scope = ce.createScope({ h: 'function' });
    expect(ce.parse('h(u) = u^2', { scope }).isValid).toBe(true);
  });

  it('makes a definition head valid against a builtin', () => {
    const ce = new ComputeEngine();
    const scope = ce.createScope({ N: 'function' });
    expect(ce.parse('N(x, m, s) = x + m + s', { scope }).isValid).toBe(true);
  });

  it('defaults its parent to the engine’s current lexical scope', () => {
    const ce = new ComputeEngine();
    ce.declare('o_1', 'integer');
    const scope = ce.createScope();
    const x = ce
      .parse('o_1 + 1', { scope })
      .ops!.find((op) => op.symbol === 'o_1')!;
    expect(x.type.toString()).toBe('integer');
    // The name resolved through the parent chain: nothing was declared here.
    expect(scope.declarations()).toEqual([]);
  });

  it('honors an explicitly supplied parent', () => {
    const ce = new ComputeEngine();
    const document = ce.createScope({ d_1: 'integer' });
    const row = ce.createScope(undefined, document);
    const x = ce
      .parse('d_1 + 1', { scope: row })
      .ops!.find((op) => op.symbol === 'd_1')!;
    expect(x.type.toString()).toBe('integer');
    expect(row.declarations()).toEqual([]);
  });
});

describe('InspectableScope.declarations(): the harvest', () => {
  it('reports post-inference types and the inferred flag', () => {
    const ce = new ComputeEngine();
    const scope = ce.createScope({ h: 'function' });
    ce.parse('h(u) = u^2', { scope });

    const byName = Object.fromEntries(
      scope.declarations().map((d) => [d.name, d])
    );
    // An initializer entry is EXPLICITLY declared, even once inference has
    // narrowed it.
    expect(byName['h'].inferred).toBe(false);
    // An auto-declared name is flagged inferred, with its post-inference type.
    expect(byName['u'].inferred).toBe(true);
    expect(byName['u'].type.toString()).toBe('number');
  });

  it('narrows an initializer entry in place', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(integer) -> integer');
    const scope = ce.createScope({ v_1: 'unknown' });
    ce.parse('g(v_1)', { scope });

    const [entry] = scope.declarations();
    expect(entry.name).toBe('v_1');
    expect(entry.type.toString()).toBe('integer');
  });

  it('is sorted lexicographically, independent of declare order', () => {
    const ce = new ComputeEngine();
    const scope = ce.createScope();
    ce.parse('z_1 + a_1 + k_1', { scope });

    const names = scope.declarations().map((d) => d.name);
    expect(names).toEqual([...names].sort());
    expect(names).toEqual(expect.arrayContaining(['a_1', 'k_1', 'z_1']));
  });

  it('accumulates across several calls against the same scope', () => {
    const ce = new ComputeEngine();
    const scope = ce.createScope();
    ce.parse('a_1 + 1', { scope });
    ce.parse('b_1 + 1', { scope });
    expect(scope.declarations().map((d) => d.name)).toEqual(['a_1', 'b_1']);
  });
});

describe('createScope: re-installing a harvested definition', () => {
  it('installs the SAME definition object, with no write-version bump', () => {
    const ce = new ComputeEngine();
    const a = ce.createScope();
    ce.parse('w + 1', { scope: a });
    const harvested = a.declarations()[0];
    expect(harvested.name).toBe('w');
    const writeVersion = harvested.def.value!._writeVersion;

    const b = ce.createScope({ w: harvested.def });
    expect(b.declarations()[0].def).toBe(harvested.def);
    expect(b.declarations()[0].def.value!._writeVersion).toBe(writeVersion);
  });

  it('is shared mutable state: a narrowing through B is visible in A', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(integer) -> integer');
    const a = ce.createScope();
    ce.parse('w + 1', { scope: a });
    expect(a.declarations()[0].type.toString()).toBe('number');

    const b = ce.createScope({ w: a.declarations()[0].def });
    ce.parse('g(w)', { scope: b });

    expect(b.declarations()[0].type.toString()).toBe('integer');
    expect(a.declarations()[0].type.toString()).toBe('integer');
  });
});

describe('InspectableScope.narrowings(): the phase-1 residual', () => {
  it('reports an OUTER definition narrowed by a contained parse', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'unknown');
    const scope = ce.createScope();
    ce.parse('p + 1', { scope });

    expect(scope.narrowings().map((n) => [n.name, n.from.toString(), n.to.toString()])).toEqual([
      ['p', 'unknown', 'number'],
    ]);
    expect(scope.narrowings()[0].def).toBe(ce.lookupDefinition('p'));
    // The narrowed name is NOT one of the scope's own declarations.
    expect(scope.declarations()).toEqual([]);
  });

  it('never reports the scope’s own bindings', () => {
    const ce = new ComputeEngine();
    const scope = ce.createScope({ q: 'unknown' });
    ce.parse('q + 1', { scope });

    expect(scope.narrowings()).toEqual([]);
    expect(scope.declarations()[0].type.toString()).toBe('number');
  });

  it('never reports an auto-declared name (containment worked)', () => {
    const ce = new ComputeEngine();
    const scope = ce.createScope();
    ce.parse('g(u_1) + u_1^2', { scope });
    expect(scope.narrowings()).toEqual([]);
  });

  it('is sorted lexicographically', () => {
    const ce = new ComputeEngine();
    ce.declare('z_9', 'unknown');
    ce.declare('a_9', 'unknown');
    const scope = ce.createScope();
    ce.parse('z_9 + a_9 + 1', { scope });

    expect(scope.narrowings().map((n) => n.name)).toEqual(['a_9', 'z_9']);
  });

  it('reports an OUTER inferred FUNCTION signature narrowed by a contained parse', () => {
    const ce = new ComputeEngine();
    ce.declare('q', { signature: '(unknown) -> unknown', inferredSignature: true });
    const scope = ce.createScope();
    ce.parse('q(1) + 1', { scope });

    expect(
      scope.narrowings().map((n) => [n.name, n.from.toString(), n.to.toString()])
    ).toEqual([['q', '(unknown) -> unknown', '(unknown) -> number']]);
    expect(scope.narrowings()[0].def).toBe(ce.lookupDefinition('q'));
    expect(scope.declarations()).toEqual([]);
  });

  it('does not capture when no inspectable scope is supplied', () => {
    const ce = new ComputeEngine();
    ce.declare('p', 'unknown');
    ce.parse('p + 1');
    // Nothing to observe — the point of the pin is that the capture is OFF.
    expect(ce.lookupDefinition('p')!.value!.type.toString()).toBe('number');
  });
});

describe('InspectableScope.dispose()', () => {
  it('is idempotent and leaves the harvest readable', () => {
    const ce = new ComputeEngine();
    const scope = ce.createScope({ k: 'number' });
    const def = scope.declarations()[0].def;
    const before = def.value!._writeVersion;

    scope.dispose();
    const afterFirst = def.value!._writeVersion;
    expect(afterFirst).toBe(before + 1);

    scope.dispose();
    expect(def.value!._writeVersion).toBe(afterFirst);

    // Definitions stay data-readable after disposal.
    expect(scope.declarations().map((d) => [d.name, d.type.toString()])).toEqual([
      ['k', 'number'],
    ]);
  });

  it('does not dispose a RE-INSTALLED harvested definition (it is borrowed)', () => {
    const ce = new ComputeEngine();
    const origin = ce.createScope();
    ce.parse('w + 1', { scope: origin });
    const borrowed = origin.declarations()[0].def;
    const borrowedWriteVersion = borrowed.value!._writeVersion;

    // The receiving scope borrows `w` and OWNS `k`.
    const receiving = ce.createScope({ w: borrowed, k: 'number' });
    const owned = receiving.declarations().find((d) => d.name === 'k')!.def;
    const ownedWriteVersion = owned.value!._writeVersion;

    receiving.dispose();

    // The borrowed definition is untouched...
    expect(borrowed.value!._writeVersion).toBe(borrowedWriteVersion);
    expect(borrowed.value!.type.toString()).toBe('number');
    // ...and still binds, by identity, through its ORIGIN scope.
    const w = ce.parse('w + 2', { scope: origin }).ops![0];
    expect(w.valueDefinition).toBe(borrowed.value);
    expect(origin.declarations()[0].def).toBe(borrowed);

    // The receiving scope's OWN definition was disposed.
    expect(owned.value!._writeVersion).toBe(ownedWriteVersion + 1);
  });
});

describe('the scope option NEVER disposes the scope’s definitions', () => {
  // The whole lifetime contract rests on `inScope` popping its temporary eval
  // context WITHOUT the disposal loop (only `popScope`/`removeEvalContext`
  // route through `discardEvalContext`). `dispose()` bumps `_writeVersion`, so
  // an unchanged write version across the call is the observable pin.
  it('a harvested definition survives the call, identity and all', () => {
    const ce = new ComputeEngine();
    const scope = ce.createScope({ k: 'number' });
    const def = scope.declarations()[0].def;
    const writeVersion = def.value!._writeVersion;

    ce.parse('k + 1', { scope });
    expect(def.value!._writeVersion).toBe(writeVersion);

    // A second call against the same scope resolves to the SAME definition.
    const k = ce.parse('k + 2', { scope }).ops![0];
    expect(k.valueDefinition).toBe(def.value);
    expect(scope.declarations()[0].def).toBe(def);
    expect(def.value!.type.toString()).toBe('number');
  });
});

/**
 * Serialization is a READ. The prettifier re-canonicalizes structural rebuilds
 * (`_Product.asRationalExpression()` → `flatten` → `.canonical`), which used
 * to auto-declare an undeclared function head into whatever scope was ambient
 * at serialization time. Witness from Tycho (2026-08-05): serializing a
 * sub-operand of a canonical parse made against a per-call scope declared
 * `Q_z` as a function in the surrounding document scope, changing how later
 * parses read.
 */
describe('SERIALIZATION does not write to the ambient scope', () => {
  const LATEX = 'y=aQ_{z}\\left(x,y\\right)';

  it('toLatex() on a per-call-scope parse leaks nothing (Tycho witness)', () => {
    const ce = new ComputeEngine();
    const documentScope = ce.createScope();
    ce.pushScope(documentScope);

    const scope1 = ce.createScope(undefined, documentScope);
    const before = ce.parse(LATEX, {
      strict: false,
      canonical: false,
      scope: scope1,
    }).json;

    const expression = ce.parse(LATEX, { strict: false, scope: scope1 });

    // The RHS is `Multiply(a, Q_z(x,y))`: its serialization routes through
    // the Product decomposition that used to re-canonicalize in the ambient
    // scope and declare `Q_z` there.
    expect(expression.ops![1].toLatex()).toBe('aQ_{z}(x, y)');
    expect(documentScope.declarations().map((d) => d.name)).toEqual([]);

    // A later non-canonical parse against a sibling scope is unchanged.
    const scope2 = ce.createScope(undefined, documentScope);
    const after = ce.parse(LATEX, {
      strict: false,
      canonical: false,
      scope: scope2,
    }).json;
    expect(after).toEqual(before);

    ce.popScope();
  });

  it('toMathJson() leaks nothing either', () => {
    const ce = new ComputeEngine();
    const documentScope = ce.createScope();
    ce.pushScope(documentScope);

    const scope1 = ce.createScope(undefined, documentScope);
    const expression = ce.parse(LATEX, { strict: false, scope: scope1 });
    expression.ops![1].toMathJson();

    expect(documentScope.declarations().map((d) => d.name)).toEqual([]);
    ce.popScope();
  });

  it('serialization does not write inference onto ambient declarations', () => {
    const ce = new ComputeEngine();
    // `k` is ambient and undeclared-typed; serializing an expression that
    // mentions it must not narrow it.
    ce.declare('k', 'unknown');
    const expr = ce.parse('k x^2');
    const before = ce.lookupDefinition('k')!.value!.type.toString();
    expr.toLatex();
    expr.toMathJson();
    expect(ce.lookupDefinition('k')!.value!.type.toString()).toBe(before);
  });
});

describe('trigger-spelled names resolve through the supplied scope', () => {
  it('a binding makes the Subscript fold RESOLVE instead of declare', () => {
    const ce = new ComputeEngine();
    const scope = ce.createScope({ theta_z: 'number' });
    const expr = ce.parse('\\theta_z + 1', { scope });

    expect(expr.json).toEqual(['Add', 'theta_z', 1]);
    expect(ce.lookupDefinition('theta_z')).toBeUndefined();
    const entry = scope.declarations().find((d) => d.name === 'theta_z')!;
    expect(entry.inferred).toBe(false);
    expect(entry.type.toString()).toBe('number');
  });

  it('a `function` binding makes a trigger-spelled head an APPLICATION (B4)', () => {
    const ce = new ComputeEngine();
    const scope = ce.createScope({ alpha_1: 'function' });
    expect(ce.parse('\\alpha_1(x)', { scope }).json).toEqual(['alpha_1', 'x']);

    // Without the binding it stays an implicit multiplication.
    const bare = new ComputeEngine();
    expect(bare.parse('\\alpha_1(x)').json).toEqual([
      'Multiply',
      'alpha_1',
      'x',
    ]);
  });
});
