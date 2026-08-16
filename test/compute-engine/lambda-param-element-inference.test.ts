import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { applicable } from '../../src/compute-engine/function-utils';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { PythonTarget } from '../../src/compute-engine/compilation/python-target';
import { lowerLevel } from '../../src/compute-engine/library/map-broadcast-shape';
import { lowerMapSpine } from '../../src/compute-engine/library/map-lowering';
import {
  _mapAutoCompileStats as stats,
  _resetMapAutoCompileStats,
} from '../../src/compute-engine/library/map-auto-compile';

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
//  2. CONTEXTUAL — a `callback<S>` slot in the callee's own polytype
//     signature, on the higher-order collection operators: a callback
//     parameter takes the ELEMENT type of its paired source operand, when that
//     type is provable. HISTORICAL NOTE: this trigger began as the
//     `callbackElementOf` METADATA (ruling 3's `{ 1: 0 }`, generalized by
//     follow-ups (4) and (5) to a `'last'` key, per-parameter sources and
//     `null` for "no source"). Design D moved the element-of link into the
//     signature and the metadata was deleted outright with its last consumer
//     (`Map`, phase 3, 2026-08-09) — so the pins below describe the
//     signature-driven behavior, and the two spellings agree everywhere except
//     the deliberately-flipped multi-collection `Map` form (§6 revision 4).
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

describe('builtin contextual trigger: Filter/Map over a typed collection', () => {
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
      ['Function', ['Equal', 'p', ['Tuple', 0, 0]], 'p'],
      'points',
    ]);
    expect(expr.ops[0].type.toString()).toBe(
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
    const inner = ['Map', ['Function', ['Reverse', 'r'], 'r'], 'rows'];
    expect(
      ce
        .box(['Filter', inner, ['Function', ['Equal', ['First', 'q'], 2], 'q']])
        .evaluate()
        .toString()
    ).toBe('[[2,1]]');
  });

  test('the multi-collection Map(f, xs, ys) form is NOT annotated', () => {
    // FLIPPED by Design D §6 REVISION 4 (2026-08-09): `Map`'s variadic clause
    // declares no contextual callback slot and never stamps. Follow-up (5) had
    // flipped this pin the other way with the interim `{ last: 'preceding' }`
    // metadata; the re-ruling gives that annotation up deliberately — the
    // acceptance bar for the multi-collection form is EVALUATION AND
    // DIAGNOSTIC parity, not annotation parity — and the parameters go back to
    // their pre-inference bare form.
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Map',
      ['Function', ['Add', 'a', 'b'], 'a', 'b'],
      ['List', 1, 2],
      ['List', 3, 4],
    ]);
    expect(expr.toMathJson()).toEqual([
      'Map',
      ['Function', ['Add', 'a', 'b'], 'a', 'b'],
      ['List', 1, 2],
      ['List', 3, 4],
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
      const [ast] = parseEpsil('Filter(points, p => p == (0, 0))');
      return ce.box(ast);
    });
    const viaParse = canonicalJson((ce) =>
      ce.parse('\\operatorname{Filter}(\\mathrm{points}, p \\mapsto p = (0,0))')
    );
    expect(viaEpsil).toBe(viaBox);
    expect(viaParse).toBe(viaBox);
  });
});

//
// Follow-ups (4) and (5) of the plan: the element-of link beyond
// `Map`/`Filter`.
//
// These pins were written against the `callbackElementOf` METADATA, whose
// shape was `{ <callback operand index> | 'last': <sources> }` — a bare
// operand index, an array of one index (or `null`, "no source") per parameter,
// or `'preceding'`. That spelling is GONE (Design D phase 3): the link now
// lives in each operator's `callback<S>` signature, and the historical
// spellings are quoted below only to say what a pin used to encode.
//

/** The single-collection, single-parameter predicate/mapping operators.
 * `CountIf`/`Find`/`IndexWhere`/`Position` are NOT lazy, so their rewrite runs
 * on the strict canonicalization path — before the operands canonicalize and
 * the literal's raw structure is gone.
 *
 * Every operator below was converted to a Design D contextual signature
 * (phases 0/1) before the `callbackElementOf` metadata was deleted — these
 * pins are trigger-INDEPENDENT by design and passed unchanged across the
 * move. */
const PREDICATE_OPERATORS: ReadonlyArray<
  [op: string, body: unknown, canonicalBody: unknown, result: string]
> = [
  ['CountIf', ['Greater', 'n', 1], ['Less', 1, 'n'], '2'],
  ['Find', ['Greater', 'n', 1], ['Less', 1, 'n'], '2'],
  ['IndexWhere', ['Greater', 'n', 1], ['Less', 1, 'n'], '2'],
  ['Position', ['Greater', 'n', 1], ['Less', 1, 'n'], '[2,3]'],
  ['Any', ['Greater', 'n', 1], ['Less', 1, 'n'], '"True"'],
  ['All', ['Greater', 'n', 0], ['Less', 0, 'n'], '"True"'],
  ['FlatMap', ['List', 'n', 'n'], ['List', 'n', 'n'], '[1,1,2,2,3,3]'],
];

describe('follow-up (4): the single-collection predicate/mapping operators', () => {
  test.each(PREDICATE_OPERATORS)(
    '%s annotates its callback parameter and evaluates',
    (op, body, canonicalBody, result) => {
      const ce = new ComputeEngine();
      executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
      const expr = ce.box([op, 'cs', ['Function', body, 'n']] as any);
      expect(expr.toMathJson()).toEqual([
        op,
        'cs',
        ['Function', canonicalBody, ['Typed', 'n', "'integer'"]],
      ]);
      expect(expr.evaluate().toString()).toBe(result);
    }
  );

  test.each(PREDICATE_OPERATORS)(
    '%s over an unprovable source leaves the parameter bare',
    (op, body, canonicalBody) => {
      const ce = new ComputeEngine();
      ce.declare('us', 'list');
      const expr = ce.box([op, 'us', ['Function', body, 'n']] as any);
      expect(expr.toMathJson()).toEqual([
        op,
        'us',
        ['Function', canonicalBody, 'n'],
      ]);
    }
  );

  test.each(PREDICATE_OPERATORS)(
    '%s: the sharing pin holds — a NAMED callback is never rebuilt',
    (op) => {
      const ce = new ComputeEngine();
      executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
      executeEpsil(ce, 'let pred = n => n > 1');
      expect(ce.box([op, 'cs', 'pred'] as any).toMathJson()).toEqual([
        op,
        'cs',
        'pred',
      ]);
    }
  );

  test('a composite element type reaches a non-lazy operator too', () => {
    // `CountIf` canonicalizes its operands on the STRICT path; the rewrite has
    // to run before that, or the raw literal is already gone.
    const ce = new ComputeEngine();
    executeEpsil(ce, POINTS);
    const expr = ce.box([
      'CountIf',
      'points',
      ['Function', ['Equal', 'p', ['Tuple', 0, 0]], 'p'],
    ]);
    expect(expr.ops[1].type.toString()).toBe(
      '(p: tuple<number, number>) -> boolean'
    );
    expect(expr.evaluate().toString()).toBe('1');
  });

  test('a stamped CountIf still compiles on JS and on Python', () => {
    // The stamp is provably satisfied by the source's element type, so
    // `assertCallbackAnnotations` admits it and the codegen is unchanged (the
    // annotation is not emitted).
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    const expr = ce.box([
      'CountIf',
      'cs',
      ['Function', ['Greater', 'n', 1], 'n'],
    ]);
    // `constantFold: false`: the expression has no free variables, so
    // compile-time constant folding would emit the literal `2` and the
    // codegen under test would never run.
    const r = compile(expr, { fallback: false, constantFold: false });
    expect(r.success).toBe(true);
    expect(r.code).toBe(
      '((_f) => ([1, 2, 3]).filter((_x) => _f(_x)).length)(((n) => 1 < n))'
    );
    expect((r.run as () => unknown)()).toBe(2);
    expect(
      new PythonTarget().compile(expr, { constantFold: false })?.code
    ).toBe(
      '(lambda _f: sum(1 for _x in [1, 2, 3] if _f(_x)))((lambda n: 1 < n))'
    );
    expect(expr.evaluate().toString()).toBe('2');
  });

  test('a NARROWING annotation still declines to compile, both targets', () => {
    // The fail-closed gate is untouched: an annotation the source's element
    // type does not provably satisfy cannot be enforced by the emitted code.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let ds: list<real> = [1.5,2.5]');
    const expr = ce.box([
      'CountIf',
      'ds',
      [
        'Function',
        ['Greater', ['Typed', 'n', { str: 'integer' }], 1],
        ['Typed', 'n', { str: 'integer' }],
      ],
    ]);
    expect(() => compile(expr, { fallback: false })).toThrow(/Fail closed/);
    expect(() => new PythonTarget().compile(expr)).toThrow(/Fail closed/);
  });
});

// FLIPPED WHOLESALE by Design D §6 REVISION 4 (2026-08-09). Follow-up (5) was
// the interim `{ last: 'preceding' }` metadata spelling — parameter k stamped
// from operand k, over every operand before the callback. The re-ruling gives
// that up: `Map`'s multi-collection clause declares no contextual callback
// slot, so nothing in this form is stamped, and the pins below now assert the
// pre-inference bare shape WITH evaluation parity — which is the whole
// acceptance bar for the variadic form (§10, phase 3).
// Under the callback-first signature (2026-08-14 flip) the declared slot is
// the unary `(T) -> U`, so the zip form's SUCCESS path — an n-ary callback
// matching the source count — mismatches S's arity and stays unstamped under
// R-D6; only a unary literal (which errors at application anyway) stamps.
// This preserves the observable §6-rev-4 behavior for every working program.
describe('the multi-collection (zip) form does not stamp its n-ary callback', () => {
  test('no parameter takes a source’s element type — evaluation unchanged', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    executeEpsil(ce, 'let ss: list<string> = ["a","bb","ccc"]');
    const expr = ce.box([
      'Map',
      ['Function', ['Tuple', 'n', 's'], 'n', 's'],
      'cs',
      'ss',
    ]);
    expect(expr.toMathJson()).toEqual([
      'Map',
      ['Function', ['Pair', 'n', 's'], 'n', 's'],
      'cs',
      'ss',
    ]);
    expect(expr.ops[0].type.toString()).toBe(
      '(unknown, unknown) -> tuple<unknown, unknown>'
    );
    expect(expr.evaluate().toString()).toBe('[(1, "a"),(2, "bb"),(3, "ccc")]');
  });

  test('a partially-provable zip is bare too, and still evaluates', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    ce.declare('us', 'list');
    ce.assign('us', ce.box(['List', { str: 'a' }, { str: 'b' }, { str: 'c' }]));
    const expr = ce.box([
      'Map',
      ['Function', ['Tuple', 'n', 's'], 'n', 's'],
      'cs',
      'us',
    ]);
    // Parameter 0's source was provable under the metadata and stamped; the
    // variadic clause stamps neither.
    expect(expr.toMathJson()).toEqual([
      'Map',
      ['Function', ['Pair', 'n', 's'], 'n', 's'],
      'cs',
      'us',
    ]);
    expect(expr.evaluate().toString()).toBe('[(1, "a"),(2, "b"),(3, "c")]');
  });

  test('an arity-mismatched callback is rejected at canonicalization', () => {
    // The §6/§10 diagnostic-parity pin, restated for the static
    // callback-arity check (2026-08-15). A UNARY callback over TWO sources
    // cannot be applied — `Map(f, xs, ys)` passes one element of each — so
    // the slot now carries the diagnostic instead of a stamped literal that
    // would only fail later, at application, with a thrown
    // `Too many arguments`. The declared slot `(T) -> U` is still unary and
    // would still have accepted the stamp; the arity check runs first and the
    // whole operand is replaced, so no stamp survives into the canonical form.
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Map',
      ['Function', ['Add', 'a', 1], 'a'],
      ['List', 1, 2],
      ['List', 3, 4],
    ]);
    expect(expr.toMathJson()).toEqual([
      'Map',
      [
        'Error',
        [
          'ErrorCode',
          'callback-arity',
          'Map calls its callback with 2 arguments (one element from each of the 2 collections); `(a) => a + 1` declares 1 parameter',
        ],
      ],
      ['List', 1, 2],
      ['List', 3, 4],
    ]);
    expect(expr.type.toString()).toBe('error');
  });

  test('the multi-collection form has no compiled lowering (unchanged)', () => {
    // Neither target lowers `Map(f, xs, ys)`; the annotation does not change
    // that, and none is added here.
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Map',
      ['Function', ['Add', 'a', 'b'], 'a', 'b'],
      ['List', 1, 2],
      ['List', 3, 4],
    ]);
    // `constantFold: false`: both sources are literal lists, so the whole
    // `Map` would otherwise be evaluated at compile time and emitted as a
    // literal list, never reaching the multi-collection lowering under test.
    expect(() => compile(expr, { fallback: false, constantFold: false })).toThrow(
      /multi-collection form is not compiled/
    );
    expect(() =>
      new PythonTarget().compile(expr, { constantFold: false })
    ).toThrow(/multi-collection form is not compiled/);
  });

  test('the sharing pin holds for the multi-collection form too', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    executeEpsil(ce, 'let ss: list<string> = ["a","bb","ccc"]');
    executeEpsil(ce, 'let pair = (n, s) => (n, s)');
    expect(ce.box(['Map', 'pair', 'cs', 'ss']).toMathJson()).toEqual([
      'Map',
      'pair',
      'cs',
      'ss',
    ]);
  });
});

describe('follow-up (4): a parameter with NO source stays bare', () => {
  test('Scan stamps the element and leaves the accumulator alone', () => {
    // Historically `{ 1: [null, 0] }`, now `callback<(unknown, T) -> unknown>`:
    // the reducer is `(accumulator, element)`. The accumulator's type is the
    // fold's own result — a second channel neither spelling expresses, and
    // deliberately so (§12.1: a fold never stamps its accumulator).
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    const expr = ce.box([
      'Scan',
      'cs',
      ['Function', ['Add', 'a', 'x'], 'a', 'x'],
      0,
    ]);
    expect(expr.toMathJson()).toEqual([
      'Scan',
      'cs',
      ['Function', ['Add', 'a', 'x'], 'a', ['Typed', 'x', "'integer'"]],
      0,
    ]);
    expect(expr.ops[1].type.toString()).toBe('(unknown, x: integer) -> number');
    expect(expr.evaluate().toString()).toBe('[1,3,6]');
  });

  test('the seedless Scan folds too', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    const expr = ce.box([
      'Scan',
      'cs',
      ['Function', ['Add', 'a', 'x'], 'a', 'x'],
    ]);
    expect(expr.evaluate().toString()).toBe('[1,3,6]');
  });

  test('an unprovable source leaves BOTH parameters bare', () => {
    const ce = new ComputeEngine();
    ce.declare('us', 'list');
    const expr = ce.box([
      'Scan',
      'us',
      ['Function', ['Add', 'a', 'x'], 'a', 'x'],
      0,
    ]);
    expect(expr.toMathJson()).toEqual([
      'Scan',
      'us',
      ['Function', ['Add', 'a', 'x'], 'a', 'x'],
      0,
    ]);
  });

  test('Reduce stamps the element and leaves the accumulator alone', () => {
    // Unblocked 2026-08-09 by the two Reduce rulings (see the `follow-up (6)`
    // block below): a BARE parameter no longer constrains apply-time
    // validation, and the seedless fold seeds with the FIRST element instead
    // of the `Nothing` sentinel.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    const expr = ce.box([
      'Reduce',
      'cs',
      ['Function', ['Add', 'a', 'x'], 'a', 'x'],
    ]);
    expect(expr.toMathJson()).toEqual([
      'Reduce',
      'cs',
      ['Function', ['Add', 'a', 'x'], 'a', ['Typed', 'x', "'integer'"]],
    ]);
    expect(expr.ops[1].type.toString()).toBe('(unknown, x: integer) -> number');
    // Seedless (the shape that used to error) and seeded both fold.
    expect(expr.evaluate().toString()).toBe('6');
    expect(
      ce
        .box(['Reduce', 'cs', ['Function', ['Add', 'a', 'x'], 'a', 'x'], 10])
        .evaluate()
        .toString()
    ).toBe('16');

    // The hand-annotated control — what stamping produces — agrees.
    expect(
      ce
        .box([
          'Reduce',
          'cs',
          [
            'Function',
            ['Add', 'a', 'x'],
            'a',
            ['Typed', 'x', { str: 'integer' }],
          ],
        ])
        .evaluate()
        .toString()
    ).toBe('6');
  });

  test('Reduce over an unprovable source leaves BOTH parameters bare', () => {
    const ce = new ComputeEngine();
    ce.declare('us', 'list');
    expect(
      ce
        .box(['Reduce', 'us', ['Function', ['Add', 'a', 'x'], 'a', 'x']])
        .toMathJson()
    ).toEqual(['Reduce', 'us', ['Function', ['Add', 'a', 'x'], 'a', 'x']]);
  });
});

describe('follow-up (6): Fold / TakeWhile / DropWhile / Partition', () => {
  test('Fold links its callback (operand 0) to the collection (operand 2)', () => {
    // The callback-FIRST, collection-last spelling (historically
    // `{ 0: [null, 2] }`). The rewrite runs before `Fold`'s canonical handler
    // rebuilds the call as a `Reduce`, so the stamp survives the rewrite.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    const expr = ce.box([
      'Fold',
      ['Function', ['Add', 'a', 'x'], 'a', 'x'],
      10,
      'cs',
    ]);
    expect(expr.toMathJson()).toEqual([
      'Reduce',
      'cs',
      ['Function', ['Add', 'a', 'x'], 'a', ['Typed', 'x', "'integer'"]],
      10,
    ]);
    expect(expr.evaluate().toString()).toBe('16');
  });

  test('Fold over an unprovable source leaves the parameter bare', () => {
    const ce = new ComputeEngine();
    ce.declare('us', 'list');
    expect(
      ce
        .box(['Fold', ['Function', ['Add', 'a', 'x'], 'a', 'x'], 10, 'us'])
        .toMathJson()
    ).toEqual(['Reduce', 'us', ['Function', ['Add', 'a', 'x'], 'a', 'x'], 10]);
  });

  // `TakeWhile`/`DropWhile` moved to a Design D contextual signature in phase
  // 1; the stamp and its evaluation are unchanged.
  test.each([
    ['TakeWhile', '[1,2]'],
    ['DropWhile', '[3,1]'],
  ])('%s stamps its predicate parameter and evaluates', (op, result) => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3,1]');
    const expr = ce.box([op, 'cs', ['Function', ['Less', 'n', 3], 'n']] as any);
    expect(expr.toMathJson()).toEqual([
      op,
      'cs',
      ['Function', ['Less', 'n', 3], ['Typed', 'n', "'integer'"]],
    ]);
    expect(expr.evaluate().toString()).toBe(result);
  });

  test.each(['TakeWhile', 'DropWhile'])(
    '%s over an unprovable source leaves the parameter bare',
    (op) => {
      const ce = new ComputeEngine();
      ce.declare('us', 'list');
      expect(
        ce
          .box([op, 'us', ['Function', ['Less', 'n', 3], 'n']] as any)
          .toMathJson()
      ).toEqual([op, 'us', ['Function', ['Less', 'n', 3], 'n']]);
    }
  );

  test('Partition stamps its PREDICATE arm (strict path) …', () => {
    // `Partition` is not `lazy`, so the rewrite runs on the strict
    // canonicalization path, before the operands lose their raw structure.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3,1]');
    const expr = ce.box([
      'Partition',
      'cs',
      ['Function', ['Less', 'n', 3], 'n'],
    ]);
    expect(expr.toMathJson()).toEqual([
      'Partition',
      'cs',
      ['Function', ['Less', 'n', 3], ['Typed', 'n', "'integer'"]],
    ]);
    expect(expr.evaluate().toString()).toBe('[[1,2,1],[3]]');
  });

  test('… and leaves the SIZE arm untouched', () => {
    // An integer operand is not an inline `Function` literal, so the
    // discriminator declines it before any sibling is read.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3,1]');
    const expr = ce.box(['Partition', 'cs', 2]);
    expect(expr.toMathJson()).toEqual(['Partition', 'cs', 2]);
    expect(expr.evaluate().toString()).toBe('[[1,2],[3,1]]');
  });

  test('Partition over an unprovable source leaves the parameter bare', () => {
    const ce = new ComputeEngine();
    ce.declare('us', 'list');
    expect(
      ce
        .box(['Partition', 'us', ['Function', ['Less', 'n', 3], 'n']])
        .toMathJson()
    ).toEqual(['Partition', 'us', ['Function', ['Less', 'n', 3], 'n']]);
  });

  // Each operator gets a callback of the arity IT applies: `Reduce` folds
  // with `(accumulator, element)`, the three predicate operators test one
  // element. A unary callback at `Reduce` was never applicable — it threw
  // `Too many arguments` at evaluation — and since the static callback-arity
  // check (2026-08-15) it is rejected at canonicalization, which would test
  // the rejection rather than the sharing pin this case is about.
  test.each([
    ['Reduce', '(acc, n) => acc + n'],
    ['TakeWhile', 'n => n > 1'],
    ['DropWhile', 'n => n > 1'],
    ['Partition', 'n => n > 1'],
  ])(
    '%s: the sharing pin holds — a NAMED callback is never rebuilt',
    (op, callback) => {
      const ce = new ComputeEngine();
      executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
      executeEpsil(ce, `let pred = ${callback}`);
      expect(ce.box([op, 'cs', 'pred'] as any).toMathJson()).toEqual([
        op,
        'cs',
        'pred',
      ]);
    }
  );
});

describe('§6.4: a BARE parameter imposes no constraint (ruled 2026-08-09)', () => {
  // Apply-time validation is gated on the literal carrying at least ONE
  // annotation and then checks EVERY parameter. A bare sibling's signature
  // slot is only what inference left there (`unknown`), which is not a
  // contract its author wrote — and `nothing` is deliberately not a subtype of
  // `unknown`, so validating against it rejected legitimate values. A bare
  // parameter is now validated against `any`.

  test('a partially annotated reducer binds `Nothing` in its bare slot', () => {
    // Driven through `applicable`, the seam the collection operators use: a
    // literal `Nothing` OPERAND would be elided (it is the erasure marker), so
    // an `["Apply", f, "Nothing", 2]` probe never reaches the validation.
    const ce = new ComputeEngine();
    const f = ce.box([
      'Function',
      ['If', ['Equal', 'a', 'Nothing'], 'x', ['Add', 'a', 'x']],
      'a',
      ['Typed', 'x', { str: 'integer' }],
    ]);
    expect(f.type.toString()).toBe('(unknown, x: integer) -> number');
    const fn = applicable(f)!;
    // `nothing` in the BARE slot: admitted (it was rejected against `unknown`).
    expect(fn([ce.Nothing, ce.box(2)])?.toString()).toBe('2');
    // …and the ANNOTATED slot keeps its exact enforcement.
    expect(fn([ce.Nothing, ce.string('oops')])?.toString()).toContain(
      'incompatible-type'
    );
    expect(fn([ce.box(1), ce.box(2)])?.toString()).toBe('3');
  });

  test('a stamped Scan callback with a bare sibling validates nothing on it', () => {
    // One parameter short of a source: `Scan`'s element parameter is stamped
    // from `cs`, its accumulator parameter has no source and stays bare — and
    // a `Nothing` element binds to it without a validation error.
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
    const expr = ce.box([
      'Scan',
      'cs',
      ['Function', ['Add', 'a', 'x'], 'a', 'x'],
    ]);
    // (the seedless `Scan` seeds `a` with the first element, not `Nothing`)
    expect(expr.evaluate().toString()).toBe('[1,3,6]');

    // The direct probe: the bare slot takes a `nothing` argument.
    const lit = expr.ops[1];
    expect(ce.box(['Apply', lit, 'Nothing', 2]).evaluate().isValid).toBe(true);
  });

  test('a GENERIC literal is not relaxed: the polytype is the contract', () => {
    // Erasure leaves a generic literal with NO annotated parameter operand, so
    // every position looks "bare" — but the polytype marker IS the contract
    // (§2.5), and relaxing it would silently disable the check. The relaxation
    // is therefore skipped whenever the literal carries a whole-signature
    // marker.
    const ce = new ComputeEngine();
    const h = ce.box([
      'Function',
      [
        'Typed',
        ['Add', 'x', 'n'],
        { str: '(x: T, n: integer) -> T where T: number' },
      ],
      'x',
      'n',
    ]);
    expect(h.type.toString()).toBe('(x: T, n: integer) -> T where T: number');
    const hn = applicable(h)!;
    expect(hn([ce.Nothing, ce.box(2)])?.toString()).toContain(
      'incompatible-type'
    );
    expect(hn([ce.box(1), ce.string('oops')])?.toString()).toContain(
      'incompatible-type'
    );
    expect(hn([ce.box(1), ce.box(2)])?.toString()).toBe('3');
  });
});

describe('the sharing pin: a symbol-valued callback is never rebuilt', () => {
  test('one literal used over two differently-typed collections', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let f = p => p == (0,0)');
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

describe('admissible element types (ruling 4, widened 2026-08-09)', () => {
  // The contextual stamp fires on a CONCRETE element type — a numeric
  // primitive, `boolean`, `string`, or a parameterized structured kind.
  // Excluded: a UNION, the union-like ABSTRACT supertypes (`scalar`, `value`,
  // `expression`, …), a BARE composite name (`tuple`, `collection`, …) and the
  // no-information `unknown`/`any`/`never`. Concrete-scalar admission was
  // blocked until the fusion/exact-compile gate learned to accept a satisfied
  // annotation (follow-up 1, `annotationSatisfiedBySource`).

  test.each([
    ['Filter', ['Function', ['Greater', 'n', 1], 'n'], ['Less', 1, 'n']],
    ['Map', ['Function', ['Multiply', 'n', 2], 'n'], ['Multiply', 2, 'n']],
  ])(
    '%s over a list<integer> annotates the parameter',
    (op, literal, canonicalBody) => {
      const ce = new ComputeEngine();
      executeEpsil(ce, 'let cs: list<integer> = [1,2,3]');
      const expr = ce.box(
        (op === 'Map'
          ? [op, literal, 'cs']
          : [op, 'cs', literal]) as any
      );
      expect(expr.toMathJson()).toEqual(
        op === 'Map'
          ? [op, ['Function', canonicalBody, ['Typed', 'n', "'integer'"]], 'cs']
          : [op, 'cs', ['Function', canonicalBody, ['Typed', 'n', "'integer'"]]]
      );
    }
  );

  test('a string element type annotates too', () => {
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Filter',
      ['Characters', { str: 'abc' }],
      ['Function', ['Equal', 'c', { str: 'a' }], 'c'],
    ]);
    expect(expr.ops[1].type.toString()).toBe('(c: string) -> boolean');
    expect(expr.evaluate().toString()).toBe('["a"]');
  });

  test('a scalar Map is annotated AND still fuses (follow-up 1)', () => {
    // The whole point of sequencing follow-up (1) before this widening: the
    // annotation is present, and the fusion / exact-compile fast paths accept
    // it because the source's element type provably satisfies it.
    const ce = new ComputeEngine();
    const m = ce.box([
      'Map',
      ['Function', ['Mod', '_1', 7], '_1'],
      ['Range', 1, 200],
    ]);
    expect(m.toMathJson()).toEqual([
      'Map',
      ['Function', ['Mod', '_1', 7], ['Typed', '_1', "'integer'"]],
      ['Range', 1, 200],
    ]);
    const level = lowerLevel(m);
    expect(level).toBeDefined();
    // Admitted on the evidence of the source's element TYPE, so the level is
    // type-sensitive rather than purely structural.
    expect(level!.typeSensitive).toBe(true);
    expect(lowerMapSpine(m)).toBeDefined();

    // The exact tier still hits, and the values are unchanged.
    _resetMapAutoCompileStats();
    const els = [...m.each()].map((x) => x.re);
    expect(stats.compiledHits).toBe(200);
    expect(els.slice(0, 8)).toEqual([1, 2, 3, 4, 5, 6, 0, 1]);
  });

  test('an EMPTY collection (element type `never`) is not evidence', () => {
    // `never` is the bottom: stamping it would make every element a violation
    // and turn `Filter([], …)` into a type error.
    const ce = new ComputeEngine();
    const expr = ce.box([
      'Filter',
      ['List'],
      ['Function', ['Greater', 'x', 1], 'x'],
    ]);
    expect(expr.toMathJson()).toEqual([
      'Filter',
      ['List'],
      ['Function', ['Less', 1, 'x'], 'x'],
    ]);
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().toString()).toBe('[]');
  });

  test('a UNION element type is not evidence: errors stay values', () => {
    // A union poisons the whole application with a static type error at
    // canonicalization rather than erroring at the mismatching element, so it
    // is excluded — the published "errors are values" behavior survives.
    const ce = new ComputeEngine();
    const { value, diagnostics } = executeEpsil(
      ce,
      'let inputs = [16, -4, "banana", 81]\nMap(x => Sqrt(x), inputs)'
    );
    expect(diagnostics).toEqual([]);
    expect(value?.toString()).toBe('[4,2i,NaN,9]');
  });

  test('an ABSTRACT supertype (`scalar`) is not evidence', () => {
    // `scalar` is union-like (number | boolean | string), so stamping it
    // poisons the whole application at canonicalization exactly as a
    // written-out union does — even when every element is fine.
    const ce = new ComputeEngine();
    const { value, diagnostics } = executeEpsil(
      ce,
      'let vs: list<scalar> = [1, 2, 3]\nMap(x => x + 1, vs)'
    );
    expect(diagnostics).toEqual([]);
    expect(value?.toString()).toBe('[2,3,4]');
  });

  test('`expression` elements are not evidence: the body stays symbolic', () => {
    const ce = new ComputeEngine();
    ce.declare('es', 'list<expression>');
    ce.assign(
      'es',
      ce.box(['List', ['Add', 'q', 2], ['Add', ['Multiply', 2, 'q'], 1]])
    );
    const expr = ce.box(['Map', ['Function', ['Multiply', 'x', 2], 'x'], 'es']);
    expect(expr.toMathJson()).toEqual([
      'Map',
      ['Function', ['Multiply', 2, 'x'], 'x'],
      'es',
    ]);
    expect(expr.evaluate().toString()).toBe('[2q + 4,4q + 2]');
  });

  test('`value` elements are not evidence either', () => {
    const ce = new ComputeEngine();
    ce.declare('vs', 'list<value>');
    const expr = ce.box(['Map', ['Function', ['Add', 'x', 1], 'x'], 'vs']);
    expect(expr.toMathJson()).toEqual([
      'Map',
      ['Function', ['Add', 'x', 1], 'x'],
      'vs',
    ]);
  });

  test('a BARE composite name is not evidence: `list<tuple>` declines', () => {
    // Positive structural evidence requires a parameterized node: `tuple`
    // says only "some tuple, of some arity, of some element types".
    const ce = new ComputeEngine();
    ce.declare('ts', 'list<tuple>');
    const expr = ce.box(['Map', ['Function', ['Length', 't'], 't'], 'ts']);
    expect(expr.toMathJson()).toEqual([
      'Map',
      ['Function', ['Length', 't'], 't'],
      'ts',
    ]);
  });

  test('a nested collection element type IS composite', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let rows: list<list<number>> = [[1,2],[3,4]]');
    const expr = ce.box(['Map', ['Function', ['Length', 'r'], 'r'], 'rows']);
    expect(expr.ops[0].type.toString()).toBe('(r: list<number>) -> integer');
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
    expect(executeEpsil(ce, 'apply2(n => n + 1, 3)').value?.toString()).toBe(
      '4'
    );
    // Observed directly: a callee that RETURNS its callback hands back the
    // annotated literal.
    expect(
      executeEpsil(
        ce,
        'function keep(f: (number) -> number) { f }\nkeep(n => n + 1)'
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
    // The inner parameter type `T` is bound by the callee's own `where`
    // clause: stamping it on the literal would leave it unresolved outside
    // that scope (or capture an unrelated nominal type named `T`).
    // Instantiating it is design (D).
    const ce = new ComputeEngine();
    ce.declare('gen', '((T) -> boolean, T) -> T where T: number');
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
    const expr = ce.box(['Map', ['Function', ['Add', 'p', 1], 'p'], 'points']);
    expect(expr.isValid).toBe(false);
    expect(expr.toString()).toContain('incompatible-type');

    // The control: with no provable element type, the same body is accepted
    // and stays symbolic — the error comes from the annotation, nothing else.
    ce.declare('anysrc', 'list');
    expect(
      ce.box(['Map', ['Function', ['Add', 'p', 1], 'p'], 'anysrc']).isValid
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

/**
 * # The signature-driven trigger's ARITY guard
 *
 * ROADMAP cleanup (2026-08-09). The contextual-solve route gained an arity
 * guard when it shipped; this route — a MONOMORPHIC user signature declaring a
 * plain arrow, or a ground `callback<S>` — did not. The stamp pairs the
 * literal's parameters with the declared ones POSITIONALLY, so a literal of
 * the wrong arity took a PARTIAL stamp: the first parameter annotated, the
 * rest left bare, a half-written contract on an application that the arity
 * error dominates anyway.
 */
describe('a wrong-arity literal takes no partial stamp', () => {
  /** The `Typed` wrappers a stamp leaves on the literal at operand 0. */
  function stampedParams(e: Expression): string {
    return JSON.stringify((e.toMathJson() as any[])[1]);
  }

  test('a matching arity still stamps', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(cb: (integer) -> boolean) -> boolean');
    expect(
      stampedParams(ce.box(['g', ['Function', ['Greater', 'a', 2], 'a']]))
    ).toBe('["Function",["Less",2,"a"],["Typed","a","\'integer\'"]]');
  });

  test('a WIDER literal declines the whole stamp', () => {
    const ce = new ComputeEngine();
    ce.declare('g', '(cb: (integer) -> boolean) -> boolean');
    const e = ce.box(['g', ['Function', ['Greater', 'a', 'b'], 'a', 'b']]);
    expect(stampedParams(e)).toBe('["Function",["Less","b","a"],"a","b"]');
  });

  test('an OPTIONAL parameter widens the admissible arity', () => {
    const ce = new ComputeEngine();
    ce.declare('h', '(cb: (integer, string?) -> boolean) -> boolean');
    // Two parameters pair with `integer` then the optional `string`: in range.
    expect(
      stampedParams(
        ce.box(['h', ['Function', ['Greater', 'a', 2], 'a', 'b']])
      )
    ).toBe('["Function",["Less",2,"a"],["Typed","a","\'integer\'"],"b"]');
    // Three is past the optional one: out of range, no stamp at all.
    expect(
      stampedParams(
        ce.box(['h', ['Function', ['Greater', 'a', 2], 'a', 'b', 'c']])
      )
    ).toBe('["Function",["Less",2,"a"],"a","b","c"]');
  });

  test('a VARIADIC declared tail admits any arity above the required one', () => {
    const ce = new ComputeEngine();
    ce.declare('k', '(cb: (integer, string*) -> boolean) -> boolean');
    expect(
      stampedParams(
        ce.box(['k', ['Function', ['Greater', 'a', 2], 'a', 'b', 'c']])
      )
    ).toBe('["Function",["Less",2,"a"],["Typed","a","\'integer\'"],"b","c"]');
    // `*` admits ZERO occurrences, so the bare required arity is in range.
    expect(
      stampedParams(ce.box(['k', ['Function', ['Greater', 'a', 2], 'a']]))
    ).toBe('["Function",["Less",2,"a"],["Typed","a","\'integer\'"]]');
  });

  test('a `+` tail raises the MINIMUM arity, not just the maximum', () => {
    // `variadicMin === 1`: the tail demands at least one occurrence, so a
    // literal supplying only the fixed parameters is out of range and takes
    // no stamp — the spelling `validateArguments` and the arity diagnostic
    // both use.
    const ce = new ComputeEngine();
    ce.declare('v', '(cb: (integer, string+) -> boolean) -> boolean');
    // Under-arity: the declared slot rejects the operand outright, so what
    // survives is the diagnostic — never a half-annotated literal.
    expect(
      stampedParams(ce.box(['v', ['Function', ['Greater', 'a', 2], 'a']]))
    ).not.toContain('Typed');
    // Two parameters satisfy `integer` plus one `string`: in range, stamped.
    expect(
      stampedParams(ce.box(['v', ['Function', ['Greater', 'a', 2], 'a', 'b']]))
    ).toBe('["Function",["Less",2,"a"],["Typed","a","\'integer\'"],"b"]');
  });

  test('a NARROWER literal declines too', () => {
    // Here the declared slot rejects the operand outright, so the literal is
    // replaced by the diagnostic — which is the point: whatever the
    // application reports, it is never a half-annotated literal.
    const ce = new ComputeEngine();
    ce.declare('m', '(cb: (integer, integer) -> boolean) -> boolean');
    expect(
      stampedParams(ce.box(['m', ['Function', ['Greater', 'a', 2], 'a']]))
    ).not.toContain('Typed');
  });
});
