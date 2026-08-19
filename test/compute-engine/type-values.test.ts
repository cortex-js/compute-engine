import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseType } from '../../src/common/type/parse';
import {
  isPolytype,
  isValueForm,
} from '../../src/compute-engine/library/type-value-utils';
import type { Expression } from '../../src/compute-engine/global-types';

// First-class type values, phase 1: the `type` primitive, the `TypeFrom`
// container (which SETTLES to its reduced canonical text at construction),
// and the `Subtype` predicate. Design and rulings R1–R9:
// `docs/TYPE-SYSTEM.md`.

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
    // INTERSECTION, not only a top-level quantified signature.
    expect(
      isPolytype(parseType('((T) -> T where T: number) & ((string) -> string)'))
    ).toBe(true);
    expect(isPolytype(parseType('((integer) -> integer) & ((string) -> string)')))
      .toBe(false);
  });

  test('an overload set settles, and a generic arm in one is rejected', () => {
    // An intersection of signatures is how an overload set is spelled, so
    // settling must keep both arms. The meet had no rule for a pair of
    // signatures and fell through to "disjoint", which reduced every overload
    // set to `nothing` and made this the one polytype shape that could not
    // reach `Subtype` at all.
    expect(
      ev([
        'TypeFrom',
        { str: '((integer) -> integer) & ((string) -> string)' },
      ]).toString()
    ).toBe('TypeFrom("((integer) -> integer) & ((string) -> string)")');
    expect(
      ev([
        'Subtype',
        { str: '((integer) -> integer) & ((string) -> string)' },
        { str: 'function' },
      ]).toString()
    ).toBe('"True"');
    expect(
      ev([
        'Subtype',
        { str: '((T) -> T where T: number) & ((string) -> string)' },
        { str: 'function' },
      ]).toString()
    ).toContain('polytype-comparison-unsupported');
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

describe('MatchesType: the R9 decision regime (phase 2)', () => {
  test('a value form is decided BOTH ways', () => {
    expect(ev(['MatchesType', ['List', 1, 2], { str: 'list<integer>' }]).toString())
      .toBe('"True"');
    // `["a"]`'s static type overlaps `list<integer>` (the empty list inhabits
    // both), but the VALUE is concrete, so the answer is a definitive False —
    // the asymmetry of the old Element arm must not return.
    expect(ev(['MatchesType', ['List', { str: 'a' }], { str: 'list<integer>' }]).toString())
      .toBe('"False"');
    expect(ev(['MatchesType', ['List'], { str: 'list<integer>' }]).toString())
      .toBe('"True"');
  });

  test('the TYPE operand is EVALUATED, like the subject', () => {
    // `lazy: true` holds both operands, so a symbol bound to a type value —
    // or to the type TEXT — arrives raw. Without evaluating it the test never
    // resolves its target and stays symbolic forever.
    const eng = new ComputeEngine();
    eng.box(['Assign', 'tSym', ['TypeFrom', { str: 'integer' }]]).evaluate();
    expect(eng.box(['MatchesType', 3, 'tSym']).evaluate().toString()).toBe(
      '"True"'
    );
    eng.box(['Assign', 'tTxt3', { str: 'integer' }]).evaluate();
    expect(eng.box(['MatchesType', 3, 'tTxt3']).evaluate().toString()).toBe(
      '"True"'
    );
  });

  test('a dictionary literal is a value form, decided both ways', () => {
    // A boxed dictionary is not a function node, so the value-container head
    // set could never reach it — dictionaries need their own branch.
    const dict = ['Dictionary', ['KeyValuePair', { str: 'a' }, 1]];
    expect(
      ev(['MatchesType', dict, { str: 'record{a: integer}' }]).toString()
    ).toBe('"True"');
    expect(
      ev(['MatchesType', dict, { str: 'dictionary<string>' }]).toString()
    ).toBe('"False"');
  });

  test('an absence marker is a value form: `[Missing]` is not a `list<integer>`', () => {
    // `["List", "Missing"]` evaluates to a one-element list of type
    // `list<missing^1>`, which merely OVERLAPS `list<integer>` (neither
    // matches nor provably disjoint) — only classifying `Missing` as a value
    // form makes the answer definitive.
    expect(
      ev(['MatchesType', ['List', 'Missing'], { str: 'list<integer>' }])
        .toString()
    ).toBe('"False"');
  });

  test('an ALIAS-named application is not a nominal value form', () => {
    // The nominal-constructor branch keys on a REGISTERED NON-ALIAS type with
    // a definition: an ordinary application whose head collides with an alias
    // name is not an exact value, so it must stay symbolic (R9), not answer a
    // wrong definitive False.
    const eng = new ComputeEngine();
    eng.declareType('nomPt', 'tuple<x: integer, y: integer>');
    eng.declareType('MyAl', 'list<T>', { alias: true, typeParams: ['T'] });
    eng.declare('zq', 'integer');
    expect(isValueForm(eng, eng.box(['nomPt', 1, 2]).evaluate())).toBe(true);
    expect(isValueForm(eng, eng.box(['MyAl', 'zq']))).toBe(false);
    expect(
      eng
        .box(['MatchesType', ['MyAl', 'zq'], { str: 'string' }])
        .evaluate()
        .toString()
    ).toContain('MatchesType');
  });

  test('an unresolved exact application stays symbolic', () => {
    // `Ln(2)` is exact and stays symbolic; its type (`finite_real`) overlaps
    // `integer` without deciding it, and the node is NOT a value form — the
    // type route cannot prove irrationality, so the test must not guess.
    expect(ev(['MatchesType', ['Ln', 2], { str: 'integer' }]).toString())
      .toContain('MatchesType');
  });

  test('a valueless symbol is three-way on its declared type', () => {
    const eng = new ComputeEngine();
    eng.declare('vx', 'integer');
    eng.declare('vs', 'string');
    eng.declare('vr', 'real');
    const evx = (e: any) => eng.box(e).evaluate().toString();
    expect(evx(['MatchesType', 'vx', { str: 'integer' }])).toBe('"True"');
    expect(evx(['MatchesType', 'vs', { str: 'integer' }])).toBe('"False"');
    // Overlapping but undecided: declared `real` asked `integer`.
    expect(evx(['MatchesType', 'vr', { str: 'integer' }])).toContain(
      'MatchesType'
    );
  });

  test('the subject is never unwrapped (the trio)', () => {
    expect(
      ev(['MatchesType', ['TypeFrom', { str: 'integer' }], { str: 'number' }]).toString()
    ).toBe('"False"');
    expect(
      ev(['MatchesType', ['TypeFrom', { str: 'integer' }], { str: 'type' }]).toString()
    ).toBe('"True"');
    expect(
      ev(['Subtype', ['TypeFrom', { str: 'integer' }], { str: 'number' }]).toString()
    ).toBe('"True"');
  });

  test('an Error subject is inspected, not propagated', () => {
    expect(
      ev(['MatchesType', ['Divide', { str: 'a' }, 0], { str: 'error' }]).toString()
    ).toBe('"True"');
    expect(
      ev(['MatchesType', ['Divide', { str: 'a' }, 0], { str: '!error' }]).toString()
    ).toBe('"False"');
  });

  test('an Error TYPE operand propagates (only the subject is inspected)', () => {
    expect(ev(['MatchesType', 3, { str: 'intger' }]).toString()).toContain(
      'invalid-value'
    );
  });

  test('a polytype target is the named error', () => {
    expect(
      ev(['MatchesType', 3, { str: '(T) -> T where T: number' }]).toString()
    ).toContain('polytype-comparison-unsupported');
  });

  test('a function literal stays symbolic (deliberate R9 narrowing)', () => {
    // An unannotated literal's signature is inference-widened, so a failed
    // `matches` does NOT refute the value — excluded from value forms in the
    // conservative direction (see `isValueForm`).
    const eng = new ComputeEngine();
    const fn = eng.box(['Function', ['Add', 'x', 1], 'x']);
    expect(
      eng.box(['MatchesType', fn.json, { str: '(integer) -> integer' }])
        .evaluate()
        .toString()
    ).toContain('MatchesType');
  });
});

describe('Conforms: the outcome matrix (phase 2)', () => {
  test('settled subjects are definitive both ways; type-value subjects ask the held type', () => {
    const eng = new ComputeEngine();
    // Epsil declarations exercise the same registry the operator reads.
    executeEpsil(eng, 'protocol Marker { }');
    executeEpsil(eng, 'type pt = tuple<x: integer, y: integer>');
    executeEpsil(eng, 'type pt is Marker');
    const evx = (e: any) => eng.box(e).evaluate().toString();
    expect(evx(['Conforms', ['pt', 1, 2], { str: 'Marker' }])).toBe('"True"');
    expect(evx(['Conforms', 3, { str: 'Marker' }])).toBe('"False"');
    expect(evx(['Conforms', ['TypeFrom', { str: 'pt' }], { str: 'Marker' }]))
      .toBe('"True"');
    // Variadic conjunction: one missing conformance decides it.
    executeEpsil(eng, 'protocol Marker2 { }');
    expect(
      evx(['Conforms', ['pt', 1, 2], { str: 'Marker' }, { str: 'Marker2' }])
    ).toBe('"False"');
  });

  test('an unknown protocol is an error, never a clean False', () => {
    expect(ev(['Conforms', 3, { str: 'Nope' }]).toString()).toContain(
      'unknown-protocol'
    );
  });

  test('a polytype type-value subject is the named error', () => {
    // The held-type branch rejects a quantified type exactly as `Subtype` and
    // `MatchesType` do — conformance of a `where`-quantified signature needs
    // the deferred existential matching machinery.
    const eng = new ComputeEngine();
    executeEpsil(eng, 'protocol Marker { }');
    expect(
      eng
        .box([
          'Conforms',
          ['TypeFrom', { str: '(T) -> T where T: number' }],
          { str: 'Marker' },
        ])
        .evaluate()
        .toString()
    ).toContain('polytype-comparison-unsupported');
  });

  test('a valueless subject stays symbolic; an Error subject answers False', () => {
    const eng = new ComputeEngine();
    executeEpsil(eng, 'protocol Marker { }');
    eng.declare('vq', 'integer');
    expect(
      eng.box(['Conforms', 'vq', { str: 'Marker' }]).evaluate().toString()
    ).toContain('Conforms');
    expect(
      eng
        .box(['Conforms', ['Divide', { str: 'a' }, 0], { str: 'Marker' }])
        .evaluate()
        .toString()
    ).toBe('"False"');
  });
});

describe('compile fail-closed: the phase-2 operators', () => {
  test('non-ground MatchesType and Conforms reject on every target', () => {
    // The shared gate lists all three comparison heads; ground calls fold.
    const eng = new ComputeEngine();
    eng.declare('gx', 'integer');
    const mt = eng.box(['MatchesType', 'gx', { str: 'integer' }]);
    for (const name of ['javascript', 'glsl', 'wgsl', 'python'])
      expect(() =>
        (eng as any)._getCompilationTarget(name).compile(mt)
      ).toThrow(/cannot compile/i);
    const r = (eng as any)._getCompilationTarget('interval-js').compile(mt);
    expect(r.success).toBe(false);
    // ...and the same for `Conforms`: a SYMBOL subject is not a ground
    // operand (the gate exempts only calls whose operands are all literal
    // type text or settled type values), so the call must fail closed too.
    executeEpsil(eng, 'protocol MarkerC { }');
    const cf = eng.box(['Conforms', 'gx', { str: 'MarkerC' }]);
    for (const name of ['javascript', 'glsl', 'wgsl', 'python'])
      expect(() =>
        (eng as any)._getCompilationTarget(name).compile(cf)
      ).toThrow(/cannot compile/i);
    const rc = (eng as any)._getCompilationTarget('interval-js').compile(cf);
    expect(rc.success).toBe(false);
  });
});


describe('the Type flip: engine routes and fail-closed (phase 3)', () => {
  test('Type is typed `-> type` and settles like any construction', () => {
    const t = ev(['Type', 3]);
    expect(t.toString()).toBe('TypeFrom("finite_integer")');
    expect(t.type.toString()).toBe('type');
    expect(t.isSame(ev(['TypeFrom', { str: 'finite_integer' }]))).toBe(true);
  });

  test('StringFrom(type) is the inverse of TypeFrom', () => {
    expect(
      ev(['StringFrom', ['TypeFrom', { str: 'integer|real' }]]).toString()
    ).toBe('"real"');
    expect(
      ce
        .box(['TypeFrom', ['StringFrom', ['TypeFrom', { str: 'list<integer>' }]]])
        .evaluate()
        .isSame(ev(['TypeFrom', { str: 'list<integer>' }]))
    ).toBe(true);
  });

  test('a ground Type call folds; its type-valued RESULT still cannot compile', () => {
    // Constant folding evaluates `Type(3)` to a settled type value; the
    // shared gate then rejects the folded node by its result type — a type
    // value has no compiled representation on any target.
    const target = (ce as any)._getCompilationTarget('javascript');
    expect(() => target.compile(ce.box(['Type', 3]))).toThrow(
      /cannot compile/i
    );
    // `StringFrom` itself has no JS lowering (pre-existing — nothing to do
    // with type values), so the through-the-value spelling also fails
    // closed, with the ordinary no-entry rejection rather than the gate's.
    expect(() =>
      target.compile(ce.box(['StringFrom', ['Type', 3]]))
    ).toThrow(/cannot compile/i);
  });
});

describe('phase-3 review fixes: route parity and throw containment', () => {
  test('the host route rejects a `type`-primitive conformance too', () => {
    const eng = new ComputeEngine();
    eng.declareProtocol('Tagged', {});
    expect(() =>
      eng.declareProtocolImplementation('type', 'Tagged', {})
    ).toThrow(/cannot conform to a protocol/);
    // An ordinary nominal target on the same engine still works.
    eng.declareType('Badge', 'record{id: string}');
    expect(() =>
      eng.declareProtocolImplementation('Badge', 'Tagged', {})
    ).not.toThrow();
  });

  test('a throwing computed type operand becomes an error VALUE, not a throw', () => {
    // The structural construction mode reaches `DeclareType`'s evaluate
    // handler without box.ts's guarded canonical dispatch, so a built-in
    // handler's throw used to escape the public `.evaluate()` API.
    const eng = new ComputeEngine();
    const node = eng.function(
      'DeclareType',
      [
        eng.symbol('boomAlias'),
        eng.function('If', [eng.number(1)], { form: 'structural' }),
      ],
      { form: 'structural' }
    );
    let result: string | undefined;
    expect(() => {
      result = node.evaluate().toString();
    }).not.toThrow();
    expect(result).toContain('invalid-type-declaration');
  });

  test('a computed type operand evaluates exactly once (canonical settles it)', () => {
    const eng = new ComputeEngine();
    let calls = 0;
    eng.declare('nextType', {
      signature: '() -> type',
      evaluate: (_ops, { engine }) => {
        calls += 1;
        return engine
          .box(['TypeFrom', { str: calls === 1 ? 'integer' : 'string' }])
          .evaluate();
      },
    });
    const node = eng.box(['DeclareType', { str: 'tOnce' }, ['nextType']]);
    // Canonicalization settles the operand into the node itself...
    expect(node.toString()).toBe('DeclareType("tOnce", TypeFrom("integer"))');
    node.evaluate();
    // ...so evaluation re-settles the literal instead of re-running the
    // impure operand.
    expect(calls).toBe(1);
  });
});
