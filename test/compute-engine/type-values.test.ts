import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import { isPolytype } from '../../src/compute-engine/library/type-value-utils';
import type { Expression } from '../../src/compute-engine/global-types';

// First-class type values, phase 1: the `type` primitive, the `TypeFrom`
// container (which SETTLES to its reduced canonical text at construction),
// and the `Subtype` predicate. Design and rulings R1–R9:
// `docs/plans/2026-08-18-first-class-types.md`.

const ce = new ComputeEngine();

function ev(expr: any): Expression {
  return ce.box(expr).evaluate();
}

describe('the `type` primitive and the type-string grammar (R7)', () => {
  test('bare `type` parses as the primitive', () => {
    expect(parseType('type')).toBe('type');
  });

  test('`type X` keeps parsing as a forward reference, not the primitive', () => {
    // The one-token lookahead of `parsePrimitiveType`: `type` followed by an
    // identifier must reach `parseTypeReference` (which owns the
    // forward-reference spelling), not parse as the primitive and strand the
    // identifier as a syntax error.
    const t = parseType('type node', ce._typeResolver);
    expect(typeof t === 'object' && t.kind === 'reference').toBe(true);
  });

  test('`type` composes in parameterized and union positions', () => {
    expect(ce.type('list<type>').toString()).toBe('list<type>');
    expect(ce.type('type | nothing').toString()).toContain('type');
  });

  test('lattice placement: an opaque value, not text or a collection', () => {
    expect(ce.type('type').matches('value')).toBe(true);
    expect(ce.type('type').matches('any')).toBe(true);
    expect(ce.type('type').matches('string')).toBe(false);
    expect(ce.type('type').matches('scalar')).toBe(false);
    expect(ce.type('type').matches('collection<any>')).toBe(false);
  });
});

describe('TypeFrom settles at construction', () => {
  test('a literal settles at canonicalization and reports type `type`', () => {
    const t = ce.box(['TypeFrom', { str: 'list<integer>' }]);
    expect(t.toString()).toBe('TypeFrom("list<integer>")');
    expect(t.type.toString()).toBe('type');
  });

  test('settling stores the REDUCED canonical text', () => {
    // `integer|real` genuinely reduces (integer ⊂ real), so both spellings
    // settle to the same stored text — the R8 identity is a plain text
    // comparison because canonicalization already happened here.
    expect(ev(['TypeFrom', { str: 'integer|real' }]).toString()).toBe(
      'TypeFrom("real")'
    );
    expect(ev(['TypeFrom', { str: 'real|integer' }]).toString()).toBe(
      'TypeFrom("real")'
    );
  });

  test('a COMPUTED operand settles at evaluation to the same value', () => {
    const eng = new ComputeEngine();
    eng.box(['Assign', 'sTxt', { str: 'integer' }]).evaluate();
    const computed = eng.box(['TypeFrom', 'sTxt']).evaluate();
    const literal = eng.box(['TypeFrom', { str: 'integer' }]).evaluate();
    expect(computed.isSame(literal)).toBe(true);
    // Reassigning the source string must not touch the already-settled value.
    eng.box(['Assign', 'sTxt', { str: 'string' }]).evaluate();
    expect(computed.isSame(literal)).toBe(true);
  });

  test('a typo, an unknown name, and a forward reference are errors', () => {
    expect(ev(['TypeFrom', { str: 'intger' }]).toString()).toContain(
      'invalid-value'
    );
    // `type X` registers a forward-reference placeholder on the ordinary
    // resolver — a REGISTRY MUTATION construction must never perform.
    const fwd = ev(['TypeFrom', { str: 'type Later' }]);
    expect(fwd.toString()).toContain('invalid-value');
    // ...and the rejected name must NOT have been registered: using it as a
    // plain (non-forward) type is still an unknown-name error.
    expect(ev(['TypeFrom', { str: 'Later' }]).toString()).toContain(
      'invalid-value'
    );
  });

  test('an arity failure survives the literal fast path', () => {
    // A literal operand settles at canonicalization and the node is REBUILT
    // from that first operand alone — the surplus operand's
    // `unexpected-argument` report must not be dropped on the way.
    expect(
      ce.box(['TypeFrom', { str: 'integer' }, { str: 'extra' }]).toString()
    ).toContain('unexpected-argument');
    // ...and no operand at all is an error, not a settled value.
    const none = ce.box(['TypeFrom']).toString();
    expect(none).toContain('missing');
    expect(none).not.toContain('TypeFrom(');
  });

  test('a polytype VALUE is admissible (only comparison rejects it)', () => {
    const p = ev(['TypeFrom', { str: '(T) -> T where T: number' }]);
    expect(p.type.toString()).toBe('type');
    expect(p.toString()).toContain('TypeFrom');
  });
});

describe('identity and equality tiers (R8)', () => {
  test('isSame/hash: same canonical text, registry-independent', () => {
    const a = ev(['TypeFrom', { str: 'integer|real' }]);
    const b = ev(['TypeFrom', { str: 'real|integer' }]);
    expect(a.isSame(b)).toBe(true);
    expect(a.hash).toBe(b.hash);
    expect(a.isSame(ev(['TypeFrom', { str: 'integer' }]))).toBe(false);
  });

  test('== is mutual subtyping: an alias equals its body', () => {
    const eng = new ComputeEngine();
    eng.declareType('myNum', 'integer|string', { alias: true });
    const alias = eng.box(['TypeFrom', { str: 'myNum' }]).evaluate();
    const body = eng.box(['TypeFrom', { str: 'integer|string' }]).evaluate();
    // Identity keeps them apart (the alias NAME is the stored text)...
    expect(alias.isSame(body)).toBe(false);
    // ...while the Equal tier equates them (mutually subtype).
    expect(
      eng
        .box([
          'Equal',
          ['TypeFrom', { str: 'myNum' }],
          ['TypeFrom', { str: 'integer|string' }],
        ])
        .evaluate()
        .toString()
    ).toBe('"True"');
  });

  test('== respects nominal opacity (R4): a nominal is not its body', () => {
    const eng = new ComputeEngine();
    eng.declareType('pt', 'tuple<x: integer, y: integer>');
    expect(
      eng
        .box([
          'Equal',
          ['TypeFrom', { str: 'pt' }],
          ['TypeFrom', { str: 'tuple<x: integer, y: integer>' }],
        ])
        .evaluate()
        .toString()
    ).toBe('"False"');
  });

  test('a type value never equals a string or a number', () => {
    expect(
      ev(['Equal', ['TypeFrom', { str: 'integer' }], { str: 'integer' }])
        .toString()
    ).toBe('"False"');
    expect(
      ev(['Equal', ['TypeFrom', { str: 'integer' }], 5]).toString()
    ).toBe('"False"');
  });

  test('== is False against ANY operand that cannot be a type value', () => {
    // The decision is on the operand's STATIC type, not on a hand-listed set
    // of literal kinds: a boolean can never hold a type value, so the
    // comparison is decided (False), not left undecided.
    expect(
      ev(['Equal', ['TypeFrom', { str: 'integer' }], 'True']).toString()
    ).toBe('"False"');
    // ...while an operand that COULD still be a type value stays undecided: a
    // valueless symbol declared `type` has nothing to compare yet.
    const eng = new ComputeEngine();
    eng.declare('tv', 'type');
    expect(
      eng
        .box(['Equal', ['TypeFrom', { str: 'integer' }], 'tv'])
        .evaluate()
        .toString()
    ).not.toBe('"False"');
  });

  test('MathJSON round-trip preserves identity', () => {
    const t = ev(['TypeFrom', { str: 'list<integer>' }]);
    expect(ce.box(t.json).evaluate().isSame(t)).toBe(true);
  });
});

describe('Subtype: `Subtype(t, u)` is true iff t <: u', () => {
  test('direction, reflexivity', () => {
    expect(ev(['Subtype', { str: 'integer' }, { str: 'number' }]).toString())
      .toBe('"True"');
    expect(ev(['Subtype', { str: 'number' }, { str: 'integer' }]).toString())
      .toBe('"False"');
    expect(ev(['Subtype', { str: 'integer' }, { str: 'integer' }]).toString())
      .toBe('"True"');
  });

  test('the relation is the one annotations use (2026-08-17 rulings)', () => {
    // `any <: unknown` is FALSE, and bare `list` ≡ `list<unknown>` is
    // narrower than `list<any>` — exposing `matches()` exposes these.
    expect(ev(['Subtype', { str: 'any' }, { str: 'unknown' }]).toString())
      .toBe('"False"');
    expect(ev(['Subtype', { str: 'list' }, { str: 'list<any>' }]).toString())
      .toBe('"True"');
    expect(ev(['Subtype', { str: 'list<any>' }, { str: 'list' }]).toString())
      .toBe('"False"');
    expect(ev(['Subtype', { str: 'never' }, { str: 'integer' }]).toString())
      .toBe('"True"');
  });

  test('type-value operands and mixed string/value operands', () => {
    expect(
      ev([
        'Subtype',
        ['TypeFrom', { str: 'integer' }],
        { str: 'number' },
      ]).toString()
    ).toBe('"True"');
  });

  test('a nominal type is a subtype of nothing structural (R4)', () => {
    const eng = new ComputeEngine();
    eng.declareType('pt2', 'tuple<x: integer, y: integer>');
    expect(
      eng
        .box(['Subtype', { str: 'pt2' }, { str: 'tuple<x: integer, y: integer>' }])
        .evaluate()
        .toString()
    ).toBe('"False"');
  });

  test('a malformed operand errors at the author’s line (canonicalization)', () => {
    expect(
      ce.box(['Subtype', { str: 'intger' }, { str: 'number' }]).toString()
    ).toContain('invalid-value');
  });

  test('a polytype operand is a named error, not a comparison', () => {
    const r = ev([
      'Subtype',
      { str: '(T) -> T where T: number' },
      { str: 'function' },
    ]).toString();
    expect(r).toContain('polytype-comparison-unsupported');
    expect(r).toContain('quantified');
  });

  test('an overload set with a generic arm counts as a polytype', () => {
    // The rejection predicate must see a `where` arm nested in an
    // INTERSECTION, not only a top-level quantified signature. Pinned at the
    // predicate: such a text cannot reach `Subtype` today, because settling
    // reduces an intersection of two unrelated signatures away
    // (`((T) -> T where T: number) & ((string) -> string)` reduces to
    // `nothing`), so only the unit-level assertion can witness the arm.
    expect(
      isPolytype(parseType('((T) -> T where T: number) & ((string) -> string)'))
    ).toBe(true);
    expect(isPolytype(parseType('((integer) -> integer) & ((string) -> string)')))
      .toBe(false);
  });

  test('a computed string operand settles at evaluation', () => {
    const eng = new ComputeEngine();
    eng.box(['Assign', 'tA', { str: 'integer' }]).evaluate();
    expect(
      eng.box(['Subtype', 'tA', { str: 'number' }]).evaluate().toString()
    ).toBe('"True"');
  });
});

describe('compile fail-closed (plan §3.3)', () => {
  // The shared gate lives in `BaseCompiler.compile`, so ALL FIVE built-in
  // targets fail closed through one check. The FAILURE SHAPE differs by each
  // target's documented contract: `javascript`/`glsl`/`wgsl`/`python` throw
  // from `compile()`, while `interval-js` converts the throw into its
  // `success: false` result shape, carrying the same diagnostic in `.error`
  // (`.code` is empty in that shape — a consumer must check `.success`).
  const THROWING_TARGETS = ['javascript', 'glsl', 'wgsl', 'python'] as const;

  // A subject the constant folder cannot evaluate away: a Subtype call with
  // a valueless string-typed symbol operand.
  function nonConstantSubtype(eng: ComputeEngine) {
    eng.declare('tTxt', 'string');
    return eng.box(['Subtype', 'tTxt', { str: 'number' }]);
  }

  test.each(THROWING_TARGETS)('%s rejects a type value', (name) => {
    const target = (ce as any)._getCompilationTarget(name);
    const value = ce.box(['TypeFrom', { str: 'integer' }]).evaluate();
    expect(() => target.compile(value)).toThrow(/cannot compile/i);
  });

  test.each(THROWING_TARGETS)('%s rejects a non-constant Subtype', (name) => {
    const eng = new ComputeEngine();
    const target = (eng as any)._getCompilationTarget(name);
    expect(() => target.compile(nonConstantSubtype(eng))).toThrow(
      /cannot compile/i
    );
  });

  test('interval-js fails closed through its success-flag contract', () => {
    const target = (ce as any)._getCompilationTarget('interval-js');
    const value = ce.box(['TypeFrom', { str: 'integer' }]).evaluate();
    const r1 = target.compile(value);
    expect(r1.success).toBe(false);
    expect(String(r1.error)).toMatch(/cannot compile/i);
    const eng = new ComputeEngine();
    const t2 = (eng as any)._getCompilationTarget('interval-js');
    const r2 = t2.compile(nonConstantSubtype(eng));
    expect(r2.success).toBe(false);
    expect(String(r2.error)).toMatch(/cannot compile/i);
  });

  test('constant folding may legally fold a CONSTANT Subtype call', () => {
    // The JavaScript target constant-folds through the interpreter, so a
    // ground `Subtype` call compiles to its correct boolean — right code,
    // not wrong code. The shared gate exempts ground calls on purpose; the
    // fail-closed requirement is about the non-constant path, covered above.
    const target = (ce as any)._getCompilationTarget('javascript');
    const r = target.compile(
      ce.box(['Subtype', { str: 'integer' }, { str: 'number' }])
    );
    expect(String(r.code ?? r)).toContain('true');
  });
});
