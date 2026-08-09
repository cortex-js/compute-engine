import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { lowerLevel } from '../../src/compute-engine/library/map-broadcast-shape';

//
// Per-application element-type inference for callback lambda parameters
// (`docs/plans/2026-08-08-lambda-param-element-inference.md`, ratified
// 2026-08-08 as option C).
//
// At canonicalization of a CALL, an INLINE `Function` literal argument whose
// parameter is unannotated is rebuilt from its RAW structure with the
// parameter wrapped in `["Typed", param, <type>]` and then canonicalized
// normally — so it behaves exactly like the hand-annotated spelling, loud type
// errors included (ruling 2, "annotation-as-contract").
//
// Two triggers into the same rewrite:
//
//  1. SIGNATURE-driven — the callee's signature declares a concrete
//     arrow-typed parameter. This is what the mechanism offers USER-DEFINED
//     functions; no library signature qualifies (their callback slots are the
//     primitive `function`, a generics-v1 pinned ruling — see
//     `collection-callback-signatures.test.ts`).
//  2. Builtin METADATA — `callbackElementOf: { 1: 0 }` on `Map` and `Filter`
//     (v1 scope, ruling 3): the callback's parameter takes the ELEMENT type of
//     the sibling collection operand, when that type is provable.
//
// The motivating gain is the compiled fast path: `pt == (0,0)` is a
// tuple-vs-not-provably-tuple comparison the aggregate gate must decline, so
// the whole `Filter` fell back to the interpreter until the parameter carried
// the point type.
//
// See `lambda-param-collection-inference.test.ts` for the sibling mechanism
// (evidence accumulated on a parameter's own binding from its BODY).
//

/** The list-of-points fixture, as an Epsil declaration. */
const POINTS = 'let points: list<tuple<number, number>> = [(0,0),(1,2),(3,4)]';

/** `Filter(points, p ↦ p = t)` as raw MathJSON, with `t` the compared point. */
const filterPoints = (t: unknown) => [
  'Filter',
  'points',
  ['Function', ['Equal', 'p', t], 'p'],
];

describe('builtin metadata trigger: Filter/Map over a typed collection', () => {
  test('the predicate parameter types as the collection element', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, POINTS);
    const expr = ce.box(filterPoints(['Tuple', 0, 0]) as any);
    expect(expr.ops[1].type.toString()).toBe(
      '(p: tuple<number, number>) -> boolean'
    );
    expect(expr.toMathJson()).toEqual([
      'Filter',
      'points',
      [
        'Function',
        ['Equal', 'p', ['Pair', 0, 0]],
        ['Typed', 'p', 'tuple<number, number>'],
      ],
    ]);
  });

  test('it compiles on JS, with run parity on a hit and on a miss', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, POINTS);
    // A matching element...
    const hit = ce.box(filterPoints(['Tuple', 0, 0]) as any);
    const hitCompiled = compile(hit, { fallback: false });
    expect(hitCompiled.success).toBe(true);
    expect(hitCompiled.code).toContain('_SYS.eq');
    expect((hitCompiled.run as () => unknown)()).toEqual([[0, 0]]);
    expect(hit.evaluate().toString()).toBe('[(0, 0)]');

    // ...and one that matches nothing.
    const miss = ce.box(filterPoints(['Tuple', 9, 9]) as any);
    const missCompiled = compile(miss, { fallback: false });
    expect(missCompiled.success).toBe(true);
    expect((missCompiled.run as () => unknown)()).toEqual([]);
    expect(miss.evaluate().toString()).toBe('[]');
  });

  test('a capturing body keeps its capture', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, POINTS);
    executeEpsil(ce, 'let k = 2');
    const expr = ce.box([
      'Filter',
      'points',
      ['Function', ['Equal', 'p', ['Tuple', 1, 'k']], 'p'],
    ]);
    expect(expr.ops[1].type.toString()).toBe(
      '(p: tuple<number, number>) -> boolean'
    );
    // The rebuild derives the body from RAW structure, so `k` still resolves
    // to the outer binding.
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect((r.run as () => unknown)()).toEqual([[1, 2]]);
    expect(expr.evaluate().toString()).toBe('[(1, 2)]');
  });

  test('Map annotates the same way', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, POINTS);
    const expr = ce.box([
      'Map',
      'points',
      ['Function', ['Equal', 'p', ['Tuple', 0, 0]], 'p'],
    ]);
    expect(expr.ops[1].type.toString()).toBe(
      '(p: tuple<number, number>) -> boolean'
    );
    expect(expr.evaluate().toString()).toBe('["True","False","False"]');
  });

  test('a nested Map/Filter pipeline still evaluates', () => {
    // The sibling has to be canonicalized to read its element type, and the
    // CANONICAL form is what is handed onward (the handler would otherwise
    // canonicalize the raw operand a second time). A canonical sibling is what
    // the inner level itself produces, so the two levels must agree.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let rows: list<list<number>> = [[1,2],[3,4]]');
    const inner = ['Map', 'rows', ['Function', ['Reverse', 'r'], 'r']];
    expect(
      ce
        .box(['Filter', inner, ['Function', ['Equal', ['First', 'q'], 2], 'q']])
        .evaluate()
        .toString()
    ).toBe('[[2,1]]');
  });

  test('the multi-collection Map(xs, ys, f) form is unchanged', () => {
    // `{1: 0}` cannot express "the LAST operand is the callback": operand 1 is
    // a collection there, and the discriminator declines it.
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Map',
      ['List', 1, 2],
      ['List', 3, 4],
      ['Function', ['Add', 'a', 'b'], 'a', 'b'],
    ]);
    expect(expr.toMathJson()).toEqual([
      'Map',
      ['List', 1, 2],
      ['List', 3, 4],
      ['Function', ['Add', 'a', 'b'], 'a', 'b'],
    ]);
    expect(expr.evaluate().toString()).toBe('[4,6]');
  });

  test('route parity: Epsil, ce.box and ce.parse agree', () => {
    const canonicalJson = (build: (ce: ComputeEngine) => any) => {
      const ce = new ComputeEngine();
      executeEpsil(ce, POINTS);
      return JSON.stringify(build(ce).toMathJson());
    };
    const viaBox = canonicalJson((ce) =>
      ce.box(filterPoints(['Tuple', 0, 0]) as any)
    );
    const viaEpsil = canonicalJson((ce) => {
      const [ast] = parseEpsil('Filter(points, p |-> p == (0, 0))');
      return ce.box(ast);
    });
    const viaParse = canonicalJson((ce) =>
      ce.parse('\\operatorname{Filter}(\\mathrm{points}, p \\mapsto p = (0,0))')
    );
    expect(viaEpsil).toBe(viaBox);
    expect(viaParse).toBe(viaBox);
  });
});

describe('the sharing pin: a symbol-valued callback is never rebuilt', () => {
  test('one literal used over two differently-typed collections', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let f = p |-> p == (0,0)');
    const before = ce.lookupDefinition('f')!;
    const literalBefore = JSON.stringify(
      (before as any).value.value.toMathJson()
    );

    executeEpsil(ce, POINTS);
    executeEpsil(ce, 'let codes: list<integer> = [1,2,3]');
    expect(executeEpsil(ce, 'Filter(points, f)').value?.toString()).toBe(
      '[(0, 0)]'
    );
    expect(executeEpsil(ce, 'Filter(codes, f)').value?.toString()).toBe('[]');

    // `f`'s literal is byte-identical: one application site must not retype
    // the literal for every other.
    expect(
      JSON.stringify((ce.lookupDefinition('f') as any).value.value.toMathJson())
    ).toBe(literalBefore);
  });
});

describe('composite element types only (ruling 4)', () => {
  // The builtin metadata trigger fires only when the provable element type is
  // STRUCTURED — a tuple or a collection kind. A scalar or a union element
  // type leaves the literal alone, byte-identically to the pre-mechanism
  // canonical form. (The signature-driven trigger is NOT narrowed this way.)

  test.each([
    ['Filter', ['Function', ['Greater', 'n', 1], 'n'], ['Less', 1, 'n']],
    ['Map', ['Function', ['Multiply', 'n', 2], 'n'], ['Multiply', 2, 'n']],
  ])(
    '%s over a list<integer> leaves the parameter unannotated',
    (op, literal, canonicalBody) => {
      // The fusion-preservation guard: an annotated parameter falls out of the
      // Map fusion / exact-compile fast paths (`map-broadcast-shape.ts` gates
      // on BARE symbols), so the most common `Map`/`Filter` spelling must keep
      // its bare parameter.
      const ce = new ComputeEngine();
      executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
      const expr = ce.box([op, 'cs', literal] as any);
      expect(expr.toMathJson()).toEqual([
        op,
        'cs',
        ['Function', canonicalBody, 'n'],
      ]);
    }
  );

  test('a Map over a scalar Range still lowers to a fusion spine', () => {
    const ce = new ComputeEngine();
    const m = ce.box([
      'Map',
      ['Range', 1, 200],
      ['Function', ['Mod', '_1', 7], '_1'],
    ]);
    expect(lowerLevel(m)).toBeDefined();
  });

  test('a UNION element type is not evidence: errors stay values', () => {
    // A union poisons the whole application with a static type error at
    // canonicalization rather than erroring at the mismatching element, so it
    // is excluded — the published "errors are values" behavior survives.
    const ce = new ComputeEngine();
    const { value, diagnostics } = executeEpsil(
      ce,
      'let inputs = [16, -4, "banana", 81]\nMap(inputs, x |-> Sqrt(x))'
    );
    expect(diagnostics).toEqual([]);
    expect(value?.toString()).toBe('[4,2i,NaN,9]');
  });

  test('a nested collection element type IS composite', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let rows: list<list<number>> = [[1,2],[3,4]]');
    const expr = ce.box(['Map', 'rows', ['Function', ['Length', 'r'], 'r']]);
    expect(expr.ops[1].type.toString()).toBe('(r: list<number>) -> integer');
    expect(expr.evaluate().toString()).toBe('[2,2]');
  });
});

describe('positive evidence only', () => {
  // An `undefined`/`unknown`/`any` element type annotates nothing: the
  // canonical form and the codegen are byte-identical to what they were
  // before the mechanism landed.
  test.each([
    ['list', 'list'],
    ['collection', 'collection'],
    ['unknown', 'unknown'],
  ])('a %s-typed source leaves the literal alone', (_label, type) => {
    const ce = new ComputeEngine();
    ce.declare('us', type as any);
    const expr = ce.box([
      'Filter',
      'us',
      ['Function', ['Greater', 'x', 1], 'x'],
    ]);
    expect(expr.toMathJson()).toEqual([
      'Filter',
      'us',
      ['Function', ['Less', 1, 'x'], 'x'],
    ]);
  });

  test('the codegen of an unknown-element Filter is unchanged', () => {
    const ce = new ComputeEngine();
    ce.declare('us', 'list');
    const r = compile(
      ce.box(['Filter', 'us', ['Function', ['Greater', 'x', 1], 'x']]),
      { fallback: false }
    );
    expect(r.success).toBe(true);
    expect(r.code).toBe(
      '((_f) => (_.us).filter((_x) => _f(_x)))(((x) => 1 < x))'
    );
    expect((r.run as (s: unknown) => unknown)({ us: [1, 2, 3] })).toEqual([
      2, 3,
    ]);
  });

  test('the vectorization default holds: an evidence-free lambda broadcasts', () => {
    const ce = new ComputeEngine();
    expect(
      executeEpsil(ce, 'f(x) = x * 2\nf([1, 2, 3])').value?.toString()
    ).toBe('[2,4,6]');
  });
});

describe('signature-driven trigger: a user-defined callee', () => {
  test('Epsil route: a declared arrow parameter annotates the literal', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function apply2(f: (number) -> number, x) { f(x) }');
    expect(executeEpsil(ce, 'apply2(n |-> n + 1, 3)').value?.toString()).toBe(
      '4'
    );
    // Observed directly: a callee that RETURNS its callback hands back the
    // annotated literal.
    expect(
      executeEpsil(
        ce,
        'function keep(f: (number) -> number) { f }\nkeep(n |-> n + 1)'
      ).value?.type.toString()
    ).toBe('(n: number) -> number');
  });

  test('box route against an Epsil-defined callee (operator definition)', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function apply2(f: (number) -> number, x) { f(x) }');
    const expr = ce.box(['apply2', ['Function', ['Add', 'n', 1], 'n'], 3]);
    expect(expr.ops[0].type.toString()).toBe('(n: number) -> number');
    expect(expr.evaluate().toString()).toBe('4');
  });

  test('box route against a declared signature (value definition)', () => {
    const ce = new ComputeEngine();
    ce.declare('apply2', '((number) -> number, number) -> number');
    const expr = ce.box(['apply2', ['Function', ['Add', 'n', 1], 'n'], 3]);
    expect(expr.ops[0].type.toString()).toBe('(n: number) -> number');
  });

  test('a wildcard-declared callee reads the ASSIGNED value signature', () => {
    const ce = new ComputeEngine();
    ce.declare('g', 'function');
    ce.assign(
      'g',
      ce.box([
        'Function',
        ['Apply', 'f', 'x'],
        ['Typed', 'f', { str: '(number) -> number' }],
        'x',
      ])
    );
    const expr = ce.box(['g', ['Function', ['Add', 'n', 1], 'n'], 3]);
    expect(expr.ops[0].type.toString()).toBe('(n: number) -> number');
  });

  test('an OPTIONAL arrow parameter annotates too', () => {
    // The trigger resolves the parameter each SUPPLIED operand binds to
    // (required, then optional, then variadic), not just the required ones.
    const ce = new ComputeEngine();
    ce.declare('optCb', '(number, ((number) -> number)?) -> number');
    const expr = ce.box(['optCb', 3, ['Function', ['Add', 'n', 1], 'n']]);
    expect(expr.ops[1].type.toString()).toBe('(n: number) -> number');
  });

  test('a VARIADIC arrow parameter annotates every operand it absorbs', () => {
    const ce = new ComputeEngine();
    ce.declare('varCb', '(number, ((number) -> number)+) -> number');
    const expr = ce.box([
      'varCb',
      3,
      ['Function', ['Add', 'n', 1], 'n'],
      ['Function', ['Multiply', 'm', 2], 'm'],
    ]);
    expect(expr.ops[1].type.toString()).toBe('(n: number) -> number');
    expect(expr.ops[2].type.toString()).toBe('(m: number) -> number');
  });

  test('a POLYMORPHIC callee is skipped', () => {
    // The inner parameter type `T` is bound by the callee's own `forall`
    // clause: stamping it on the literal would leave it unresolved outside
    // that scope (or capture an unrelated nominal type named `T`).
    // Instantiating it is design (D).
    const ce = new ComputeEngine();
    ce.declare('gen', 'forall T: number. ((T) -> boolean, T) -> T');
    const expr = ce.box(['gen', ['Function', ['Greater', 'n', 1], 'n'], 3]);
    expect(expr.toMathJson()).toEqual([
      'gen',
      ['Function', ['Less', 1, 'n'], 'n'],
      3,
    ]);
  });

  test('an OVERLOAD-set callee is skipped', () => {
    // Resolution happens after the hook site, and the annotation would itself
    // feed the resolution — circular.
    const ce = new ComputeEngine();
    ce.declare(
      'ov',
      '(((number) -> number, number) -> number) & (((string) -> string, string) -> string)'
    );
    const expr = ce.box(['ov', ['Function', ['Add', 'n', 1], 'n'], 3]);
    expect(expr.toMathJson()).toEqual([
      'ov',
      ['Function', ['Add', 'n', 1], 'n'],
      3,
    ]);
  });
});

describe('annotation-as-contract', () => {
  test('a body that misuses the composite element errors loudly', () => {
    // The rebuilt literal behaves exactly like the hand-annotated spelling
    // (ruling 2): `p` is a point, so `p + 1` is a provable type error at
    // canonicalization rather than a symbolic application evaluated per
    // element.
    const ce = new ComputeEngine();
    executeEpsil(ce, POINTS);
    const expr = ce.box(['Map', 'points', ['Function', ['Add', 'p', 1], 'p']]);
    expect(expr.isValid).toBe(false);
    expect(expr.toString()).toContain('incompatible-type');

    // The control: with no provable element type, the same body is accepted
    // and stays symbolic — the error comes from the annotation, nothing else.
    ce.declare('anysrc', 'list');
    expect(
      ce.box(['Map', 'anysrc', ['Function', ['Add', 'p', 1], 'p']]).isValid
    ).toBe(true);
  });

  test('the signature-driven trigger enforces a declared parameter type', () => {
    // Not narrowed by ruling 4: a user-declared arrow parameter is an explicit
    // contract, whatever its types — including a scalar one.
    const ce = new ComputeEngine();
    ce.declare('applyStr', '((string) -> string, string) -> string');
    const expr = ce.box([
      'applyStr',
      ['Function', ['Add', 's', 1], 's'],
      { str: 'a' },
    ]);
    expect(expr.isValid).toBe(false);
    expect(expr.toString()).toContain('incompatible-type');
  });
});
