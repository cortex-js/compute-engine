import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { JavaScriptTarget } from '../../src/compute-engine/compilation/javascript-target';
import { broadcastFrames } from '../../src/compute-engine/boxed-expression/error-value';
import { foldSeed, frameDraw } from '../../src/compute-engine/numerics/random';

/**
 * `broadcastable<T>` AS A PARAMETER DECLARATION — the elementwise contract
 * (Option A, ratified 2026-08-08;
 * `docs/plans/2026-08-08-broadcastable-param-semantics.md`, responding to Tycho
 * item 157).
 *
 * A parameter DECLARED `broadcastable<T>`:
 *   1. broadcast-wins — an indexed-collection argument is MAPPED even when `T`
 *      would admit the collection whole;
 *   2. maps exactly ONE rank down — each element binds WHOLE, even a nested
 *      collection (deliberately unlike the unannotated default, which
 *      re-fires per element and descends to the scalar leaves);
 *   3. checks `T` per element after that one rank;
 *   4. binds a SCALAR argument directly (no list wrapper);
 *   5. types like the inferred path — definite collection → `list<R>`,
 *      possibly-collection → `broadcastable<R>`, scalar → `R`.
 *
 * Both declaration routes are covered, because they dispatch differently:
 * a `Typed` parameter on a bare-assigned literal registers an OPERATOR
 * definition (the `_computeValue` arms), while declare-then-assign registers a
 * VALUE definition (`applyFunctionLiteral`).
 */

/** A `Typed` parameter annotation, in the `{ str: … }` spelling. */
const T = (t: string) => ({ str: t });

/** `name(x) = ⟨body⟩` with `x` declared `broadcastable<T>` — the OPERATOR
 * definition route (a bare assign of an annotated function literal). */
function assignTyped(
  ce: ComputeEngine,
  name: string,
  body: unknown,
  paramType: string,
  param = 'x'
): void {
  ce.assign(
    name,
    ce.box(['Function', body, ['Typed', param, T(paramType)]] as any)
  );
}

//
// 1/ Tycho item 157(1) — the defect-1 minimal pair, verbatim.
//

describe('DECLARED broadcastable<T> — application-site typing (Tycho 157(1))', () => {
  test('`(broadcastable<number>) -> unknown` applied to a `list<number>` types `list<unknown>`', () => {
    const ce = new ComputeEngine();
    ce.declare('fb', '(broadcastable<number>) -> unknown');
    ce.declare('L', 'list<number>');
    expect(ce.box(['fb', 'L']).type.toString()).toBe('list<unknown>');
  });

  test('the `(number) -> unknown` twin types `list<unknown>` too — the declared path is never weaker', () => {
    const ce = new ComputeEngine();
    ce.declare('fn', '(number) -> unknown');
    ce.declare('L', 'list<number>');
    expect(ce.box(['fn', 'L']).type.toString()).toBe('list<unknown>');
  });

  test('a POSSIBLY-collection argument types `broadcastable<R>`, not a definite list', () => {
    const ce = new ComputeEngine();
    ce.declare('pf', '(broadcastable<number>) -> integer');
    ce.declare('u', 'unknown');
    expect(ce.box(['pf', 'u']).type.toString()).toBe('broadcastable<integer>');
  });

  test('a SCALAR argument types the bare result `R`', () => {
    const ce = new ComputeEngine();
    ce.declare('pf', '(broadcastable<number>) -> integer');
    expect(ce.box(['pf', 5]).type.toString()).toBe('integer');
  });

  test('the same lift on the VALUE-definition route (declare then assign)', () => {
    const ce = new ComputeEngine();
    ce.declare('vf', '(broadcastable<number>) -> unknown');
    ce.assign('vf', ce.box(['Function', ['Tuple', 'x', 'x'], 'x']));
    ce.declare('L', 'list<number>');
    // Guards against silently drifting onto the operator-definition route.
    expect(ce.lookupDefinition('vf')).toHaveProperty('value');
    expect(ce.box(['vf', 'L']).type.toString()).toBe('list<unknown>');
    expect(ce.box(['vf', 7]).type.toString()).toBe('unknown');
  });
});

//
// 2/ The pair-body witness and one-rank descent.
//

describe('DECLARED broadcastable<T> — the elementwise map (rules 1 and 2)', () => {
  test('a pair body MAPS instead of binding the list whole (rule 1, broadcast-wins)', () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'pairUp', ['Tuple', 'x', 'x'], 'broadcastable<value>');
    expect(
      ce
        .box(['pairUp', ['List', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('[(1, 1),(2, 2)]');
  });

  test('the map descends exactly ONE rank — a nested element binds WHOLE (rule 2)', () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'pairUp', ['Tuple', 'x', 'x'], 'broadcastable<value>');
    expect(
      ce
        .box(['pairUp', ['List', ['List', 1, 2], ['List', 3, 4, 5]]])
        .evaluate()
        .toString()
    ).toBe('[([1,2], [1,2]),([3,4,5], [3,4,5])]');
  });

  test('the one-rank arrest survives LAZIFICATION (past the eager threshold)', () => {
    // Above `MAX_SIZE_EAGER_COLLECTION` the broadcast becomes a lazy `Map`.
    // Its body must still bind each element whole, or the SIZE of the source
    // would decide the semantics.
    const ce = new ComputeEngine();
    assignTyped(ce, 'pairUp', ['Tuple', 'x', 'x'], 'broadcastable<value>');
    const rows = Array.from({ length: 150 }, (_, i) => ['List', i, i + 1]);
    const value = ce.box(['pairUp', ['List', ...rows] as any]).evaluate();
    expect(value.at(3)?.toString()).toBe('([2,3], [2,3])');
  });

  test('a lazy source of unknown length maps rather than zipping to one element', () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'pairUp', ['Tuple', 'x', 'x'], 'broadcastable<value>');
    expect(
      ce
        .box(['pairUp', ['Range', 1, 5]])
        .evaluate()
        .toString()
    ).toBe('[(1, 1),(2, 2),(3, 3),(4, 4),(5, 5)]');
  });

  test('the async path agrees with the sync one, one rank and all', async () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'pairUp', ['Tuple', 'x', 'x'], 'broadcastable<value>');
    const value = await ce
      .box(['pairUp', ['List', ['List', 1, 2], ['List', 3, 4, 5]]])
      .evaluateAsync();
    expect(value.toString()).toBe('[([1,2], [1,2]),([3,4,5], [3,4,5])]');
  });

  test('the VALUE-definition route maps the same way', () => {
    const ce = new ComputeEngine();
    ce.declare('vf', '(broadcastable<value>) -> unknown');
    ce.assign('vf', ce.box(['Function', ['Tuple', 'x', 'x'], 'x']));
    expect(
      ce
        .box(['vf', ['List', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('[(1, 1),(2, 2)]');
    expect(
      ce
        .box(['vf', ['List', ['List', 1, 2], ['List', 3, 4, 5]]])
        .evaluate()
        .toString()
    ).toBe('[([1,2], [1,2]),([3,4,5], [3,4,5])]');
  });

  test('an operand that only BECOMES a collection at evaluation maps too', () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'pairUp', ['Tuple', 'x', 'x'], 'broadcastable<value>');
    ce.assign('lst', ce.box(['Function', ['List', 1, 2], 'n']));
    expect(
      ce
        .box(['pairUp', ['lst', 0]])
        .evaluate()
        .toString()
    ).toBe('[(1, 1),(2, 2)]');
  });
});

//
// 3/ `T` is checked per element, loudly.
//

describe('DECLARED broadcastable<T> — the per-element `T` check (rule 3)', () => {
  test('`broadcastable<number>` over `[[1,2],3]` errors on the offending ELEMENT', () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'bump', ['Add', 'x', 1], 'broadcastable<number>');
    const value = ce.box(['bump', ['List', ['List', 1, 2], 3]]).evaluate();
    expect(value.operator).toBe('List');
    expect(value.nops).toBe(2);
    // Loud: an `incompatible-type` against the ELEMENT type, never a silent
    // further descent (`broadcastable<number>` would itself admit `[1,2]`).
    expect(value.op1.isValid).toBe(false);
    expect(value.op1.toString()).toContain('incompatible-type');
    expect(value.op1.toString()).toContain('"number"');
    // The sibling element is unaffected.
    expect(value.ops![1].toString()).toBe('4');
  });

  test('the failing element carries the `ErrorBroadcast` breadcrumb (test 7)', () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'bump', ['Add', 'x', 1], 'broadcastable<number>');
    const value = ce.box(['bump', ['List', ['List', 1, 2], 3]]).evaluate();
    expect(broadcastFrames(value.op1)).toEqual([
      { operator: 'bump', index: 1, length: 2 },
    ]);
  });

  test('a scalar argument of the wrong type is still rejected whole', () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'bump', ['Add', 'x', 1], 'broadcastable<number>');
    expect(ce.box(['bump', { str: 'abc' }]).isValid).toBe(false);
  });

  test('`broadcastable<value>` rejects a FUNCTION-typed argument (pre-existing pin)', () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'pairUp', ['Tuple', 'x', 'x'], 'broadcastable<value>');
    const expr = ce.box(['pairUp', ['Function', 'y', 'y']]);
    expect(expr.isValid).toBe(false);
    expect(expr.evaluate().toString()).toContain('incompatible-type');
  });
});

//
// 4/ Scalar-direct, empty collection, atomic tuple.
//

describe('DECLARED broadcastable<T> — scalars, empties and tuples (rule 4)', () => {
  test('a scalar argument binds directly — no list wrapper', () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'pairUp', ['Tuple', 'x', 'x'], 'broadcastable<value>');
    expect(ce.box(['pairUp', 5]).evaluate().toString()).toBe('(5, 5)');
  });

  test('an empty collection maps to `[]`', () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'pairUp', ['Tuple', 'x', 'x'], 'broadcastable<value>');
    expect(
      ce
        .box(['pairUp', ['List']])
        .evaluate()
        .toString()
    ).toBe('[]');
  });

  test('a tuple is ATOMIC — bound whole, never mapped', () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'pairUp', ['Tuple', 'x', 'x'], 'broadcastable<value>');
    expect(
      ce
        .box(['pairUp', ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('((1, 2), (1, 2))');
  });
});

//
// 5/ Mixed slots: per-slot gating and the strict length policy.
//

describe('DECLARED broadcastable<T> — mixed parameter slots', () => {
  /** `f(x: broadcastable<number>, y: ⟨t⟩) = ⟨body⟩`. */
  function assignPair(
    ce: ComputeEngine,
    name: string,
    body: unknown,
    secondType: string
  ): void {
    ce.assign(
      name,
      ce.box([
        'Function',
        body,
        ['Typed', 'x', T('broadcastable<number>')],
        ['Typed', 'y', T(secondType)],
      ] as any)
    );
  }

  test('a scalar slot LIFTS into every cell', () => {
    const ce = new ComputeEngine();
    assignPair(ce, 'shift', ['Add', 'x', 'y'], 'number');
    expect(
      ce
        .box(['shift', ['List', 1, 2], 10])
        .evaluate()
        .toString()
    ).toBe('[11,12]');
  });

  test('a COLLECTION-declared slot binds its argument WHOLE while the broadcastable slot maps', () => {
    const ce = new ComputeEngine();
    assignPair(ce, 'withAll', ['Tuple', 'x', 'y'], 'list<number>');
    expect(
      ce
        .box(['withAll', ['List', 1, 2], ['List', 3, 4]])
        .evaluate()
        .toString()
    ).toBe('[(1, [3,4]),(2, [3,4])]');
  });

  test('two mapped slots ZIP', () => {
    const ce = new ComputeEngine();
    assignPair(ce, 'plus', ['Add', 'x', 'y'], 'broadcastable<number>');
    expect(
      ce
        .box(['plus', ['List', 1, 2], ['List', 10, 20]])
        .evaluate()
        .toString()
    ).toBe('[11,22]');
  });

  test('two mapped slots of different lengths are `incompatible-dimensions`, never truncated', () => {
    const ce = new ComputeEngine();
    assignPair(ce, 'plus', ['Add', 'x', 'y'], 'broadcastable<number>');
    expect(
      ce
        .box(['plus', ['List', 1, 2, 3], ['List', 10, 20]])
        .evaluate()
        .toString()
    ).toBe('Error("incompatible-dimensions", "3 vs 2")');
  });

  test('a collection bound WHOLE at a non-mapped slot never mismatches the mapped one', () => {
    const ce = new ComputeEngine();
    assignPair(ce, 'withAll', ['Tuple', 'x', 'y'], 'list<number>');
    expect(
      ce
        .box(['withAll', ['List', 1, 2, 3], ['List', 7, 8]])
        .evaluate()
        .toString()
    ).toBe('[(1, [7,8]),(2, [7,8]),(3, [7,8])]');
  });
});

//
// 6/ A non-arithmetic (control-flow) body maps under the declaration.
//

describe('DECLARED broadcastable<T> — non-arithmetic bodies', () => {
  test('an `If` body maps element-wise', () => {
    const ce = new ComputeEngine();
    assignTyped(
      ce,
      'sign3',
      ['If', ['Greater', 'x', 0], 1, -1],
      'broadcastable<number>'
    );
    expect(
      ce
        .box(['sign3', ['List', -3, 0, 5]])
        .evaluate()
        .toString()
    ).toBe('[-1,-1,1]');
  });

  test('a THROWN element failure is enriched with the element-wise context', () => {
    const ce = new ComputeEngine();
    // `If` on a non-boolean throws rather than returning an error value.
    assignTyped(ce, 'pick', ['If', 'x', 1, 2], 'broadcastable<value>');
    expect(() => ce.box(['pick', ['List', 1, 2, 3, 4]]).evaluate()).toThrow(
      /while applying 'pick' element-wise over 4 elements/
    );
  });
});

//
// 7/ The Epsil surface route.
//

describe('DECLARED broadcastable<T> — Epsil `Typed` parameters', () => {
  test('the `x: broadcastable<T>` parameter spelling parses and maps', () => {
    const ce = new ComputeEngine();
    const result = executeEpsil(
      ce,
      `function pairUp(x: broadcastable<value>) { (x, x) }\npairUp([1, 2])`
    );
    expect(result.value?.toString()).toBe('[(1, 1),(2, 2)]');
  });

  test('one rank down through the Epsil route too', () => {
    const ce = new ComputeEngine();
    const result = executeEpsil(
      ce,
      `function pairUp(x: broadcastable<value>) { (x, x) }\npairUp([[1, 2], [3, 4, 5]])`
    );
    expect(result.value?.toString()).toBe(
      '[([1,2], [1,2]),([3,4,5], [3,4,5])]'
    );
  });
});

//
// 8/ NEGATIVE CONTROLS — the inferred default is untouched.
//

describe('DECLARED broadcastable<T> — the inferred default is unchanged', () => {
  test('an UNANNOTATED pair body still descends to the scalar leaves', () => {
    const ce = new ComputeEngine();
    ce.assign('pairUp', ce.box(['Function', ['Tuple', 'x', 'x'], 'x']));
    expect(
      ce
        .box(['pairUp', ['List', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('[(1, 1),(2, 2)]');
    // The DEFINING contrast with rule 2: no declaration, so the map re-fires
    // per element and reaches the leaves.
    expect(
      ce
        .box(['pairUp', ['List', ['List', 1, 2], ['List', 3, 4, 5]]])
        .evaluate()
        .toString()
    ).toBe('[[(1, 1),(2, 2)],[(3, 3),(4, 4),(5, 5)]]');
  });

  test('a scalar-DECLARED parameter still leaf-descends', () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'bump', ['Add', 'x', 1], 'number');
    expect(
      ce
        .box(['bump', ['List', ['List', 1, 2], ['List', 3, 4]]])
        .evaluate()
        .toString()
    ).toBe('[[2,3],[4,5]]');
  });

  test('a COLLECTION-declared parameter still binds its argument whole', () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'howMany', ['Length', 'x'], 'list<number>');
    expect(
      ce
        .box(['howMany', ['List', 1, 2, 3]])
        .evaluate()
        .toString()
    ).toBe('3');
  });
});

//
// 9/ Assignment enforcement — a consuming body cannot fill a broadcastable slot.
//

describe('DECLARED broadcastable<T> — assignment enforcement', () => {
  test('assigning a CONSUMING body to a broadcastable-declared slot throws', () => {
    const ce = new ComputeEngine();
    ce.declare('consume', '(broadcastable<number>) -> number');
    expect(() =>
      ce.assign('consume', ce.box(['Function', ['Length', 'v'], 'v']))
    ).toThrow(
      /not compatible with the type "\(broadcastable<number>\) -> number"/
    );
  });
});

//
// D/ The compile route fails closed rather than emitting scalar code.
//

describe('DECLARED broadcastable<T> — compile fails closed (D6)', () => {
  test('a possibly-collection argument declines to compile', () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'bump', ['Add', 'x', 1], 'broadcastable<number>');
    const js = new JavaScriptTarget();
    // `constantFold: false`: the argument is a literal list and `bump` is
    // pure, so the call would otherwise be evaluated at compile time and
    // emitted as `[2, 3, 4]`, bypassing the decline under test.
    expect(() =>
      js.compile(ce.box(['bump', ['List', 1, 2, 3]]), { constantFold: false })
    ).toThrow(/declared `broadcastable<T>` parameter/);
    // …and the interpreter still answers.
    expect(
      ce
        .box(['bump', ['List', 1, 2, 3]])
        .evaluate()
        .toString()
    ).toBe('[2,3,4]');
  });

  test('a provably-scalar argument still compiles', () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'bump', ['Add', 'x', 1], 'broadcastable<number>');
    const js = new JavaScriptTarget();
    const compiled = js.compile(ce.box(['bump', 4]));
    expect(compiled?.success).toBe(true);
    expect((compiled?.run as unknown as () => unknown)()).toBe(5);
  });
});

//
// E/ Review round (2026-08-08) — the seven findings against the first
// implementation. Each block names the finding it pins.
//

/** `f(x: ⟨t1⟩, y: ⟨t2⟩) = ⟨body⟩`, the operator-definition route. */
function assignTypedPair(
  ce: ComputeEngine,
  name: string,
  body: unknown,
  t1: string,
  t2: string
): void {
  ce.assign(
    name,
    ce.box([
      'Function',
      body,
      ['Typed', 'x', T(t1)],
      ['Typed', 'y', T(t2)],
    ] as any)
  );
}

describe('DECLARED broadcastable<T> — threadability is PER SLOT (finding 1)', () => {
  test('a WHOLE-bound sibling still rejects a mismatched collection', () => {
    // The declaration makes slot 1 threadable; slot 2 is declared
    // `list<string>` and binds its argument whole, so a `list<number>` there
    // is an ordinary type error — not something the elementwise contract
    // waves through.
    const ce = new ComputeEngine();
    assignTypedPair(
      ce,
      'withAll',
      ['Tuple', 'x', 'y'],
      'broadcastable<number>',
      'list<string>'
    );
    const expr = ce.box(['withAll', ['List', 1, 2], ['List', 3, 4]]);
    expect(expr.isValid).toBe(false);
    expect(expr.toString()).toContain('incompatible-type');
    expect(expr.toString()).toContain('"list<string>"');
  });

  test('a WHOLE-bound sibling still accepts a CONFORMING collection', () => {
    const ce = new ComputeEngine();
    assignTypedPair(
      ce,
      'withAll',
      ['Tuple', 'x', 'y'],
      'broadcastable<number>',
      'list<number>'
    );
    const expr = ce.box(['withAll', ['List', 1, 2], ['List', 7, 8]]);
    expect(expr.isValid).toBe(true);
    expect(expr.evaluate().toString()).toBe('[(1, [7,8]),(2, [7,8])]');
  });

  test('a callback slot binds whole and never lifts the result type', () => {
    const ce = new ComputeEngine();
    assignTypedPair(
      ce,
      'viaFn',
      ['Apply', 'y', 'x'],
      'broadcastable<number>',
      '(number) -> number'
    );
    expect(
      ce
        .box(['viaFn', ['List', 1, 2], ['Function', ['Add', 'z', 1], 'z']])
        .evaluate()
        .toString()
    ).toBe('[2,3]');
  });
});

describe('DECLARED broadcastable<T> — mapped SCALAR siblings check `T` too (finding 2)', () => {
  test('the VALUE-definition route (bare literal params) checks the sibling', () => {
    // The sharpest witness: a declare-then-assign literal has UNANNOTATED
    // parameters, so the per-element `Apply` has nothing of its own to check
    // against — the slot plan is the only contract there is. Without it the
    // `list<string>` was mapped through the `number` slot into an untyped
    // body and produced `[(1, "a"), (2, "b")]`.
    const ce = new ComputeEngine();
    ce.declare('vf', '(broadcastable<number>, number) -> unknown');
    ce.assign('vf', ce.box(['Function', ['Tuple', 'x', 'y'], 'x', 'y']));
    expect(ce.lookupDefinition('vf')).toHaveProperty('value');
    const value = ce
      .box(['vf', ['List', 1, 2], ['List', { str: 'a' }, { str: 'b' }]])
      .evaluate();
    expect(value.op1.operator).toBe('Error');
    expect(value.op1.toString()).toContain('incompatible-type');
    expect(value.op1.toString()).toContain('"number"');
    // A conforming call is unaffected.
    expect(
      ce
        .box(['vf', ['List', 1, 2], ['List', 10, 20]])
        .evaluate()
        .toString()
    ).toBe('[(1, 10),(2, 20)]');
  });

  test('`(broadcastable<number>, number)` errors per element on a `list<string>` sibling', () => {
    const ce = new ComputeEngine();
    assignTypedPair(
      ce,
      'h',
      ['Tuple', 'x', 'y'],
      'broadcastable<number>',
      'number'
    );
    const value = ce
      .box(['h', ['List', 1, 2], ['List', { str: 'a' }, { str: 'b' }]])
      .evaluate();
    expect(value.operator).toBe('List');
    expect(value.nops).toBe(2);
    // The error is the CELL's value, not an unreduced `Apply` carrying one:
    // rule 3 rejects the element before the application is built.
    expect(value.op1.operator).toBe('Error');
    expect(value.op1.isValid).toBe(false);
    expect(value.op1.toString()).toContain('incompatible-type');
    expect(value.op1.toString()).toContain('"number"');
    expect(broadcastFrames(value.op1)).toEqual([
      { operator: 'h', index: 1, length: 2 },
    ]);
  });

  test('`(broadcastable<number>, string)` errors per element on a `list<number>` sibling', () => {
    const ce = new ComputeEngine();
    assignTypedPair(
      ce,
      'g',
      ['Tuple', 'x', 'y'],
      'broadcastable<number>',
      'string'
    );
    const value = ce.box(['g', 5, ['List', 3, 4]]).evaluate();
    expect(value.nops).toBe(2);
    expect(value.op1.operator).toBe('Error');
    expect(value.op1.toString()).toContain('incompatible-type');
    expect(value.op1.toString()).toContain('"string"');
  });

  test('a CONFORMING mapped scalar sibling zips as before', () => {
    const ce = new ComputeEngine();
    assignTypedPair(
      ce,
      'g',
      ['Tuple', 'x', 'y'],
      'broadcastable<number>',
      'string'
    );
    expect(
      ce
        .box(['g', 5, ['List', { str: 'a' }, { str: 'b' }]])
        .evaluate()
        .toString()
    ).toBe('[(5, "a"),(5, "b")]');
  });
});

describe('DECLARED broadcastable<T> — overload sets (finding 3)', () => {
  /** Two clauses, one of them declaring a `broadcastable<T>` slot. The
   * definition's signature is then an INTERSECTION, which has no single slot
   * plan. */
  function declareOverload(ce: ComputeEngine, body: string): void {
    executeEpsil(
      ce,
      `function m(x: broadcastable<value>) { ${body} }\nfunction m(s: string) { s }`
    );
  }

  test('the COMPILE gate fails closed for a possibly-collection argument', () => {
    const ce = new ComputeEngine();
    declareOverload(ce, '(x, x)');
    const js = new JavaScriptTarget();
    // Conservative: one broadcastable arm speaks for the whole set. The
    // message must be the SPECIFIC one — a generic "no lowering" would hide
    // the reason and would stop protecting if emission support changed.
    expect(() => js.compile(ce.box(['m', ['List', 1, 2]]))).toThrow(
      /declared `broadcastable<T>` parameter/
    );
  });

  test('an unrelated multi-clause function still compiles', () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      `function g(x: number) { x + 1 }\nfunction g(x: number, y: number) { x + y }`
    );
    const js = new JavaScriptTarget();
    const compiled = js.compile(ce.box(['g', 4]));
    expect(compiled?.success).toBe(true);
    expect((compiled?.run as unknown as () => unknown)()).toBe(5);
  });

  test('KNOWN GAP: overload EVALUATION and TYPING stay on the pre-declaration path', () => {
    // Recorded in the plan doc's open rulings. `broadcastableParamSlots`
    // declines an intersection, so the broadcastable arm binds its list WHOLE
    // instead of mapping (rule 1 not applied). Type and value AGREE, which is
    // why the gap is tolerable — and why the compile gate above must stay
    // conservative. Change both together, or not at all.
    const ce = new ComputeEngine();
    declareOverload(ce, '(x, x)');
    expect(
      ce
        .box(['m', ['List', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('([1,2], [1,2])');
    expect(ce.box(['m', ['List', 1, 2]]).type.toString()).toBe(
      'tuple<broadcastable<value>, broadcastable<value>>'
    );
  });
});

describe('DECLARED broadcastable<T> — broadcast operands are evaluated ONCE (finding 4)', () => {
  test('`f(Random(), L)` draws exactly once when only a WHOLE-bound slot holds the list', () => {
    // The arm must not be entered at all here: no MAPPABLE slot holds a
    // collection, so the map would decline — after having evaluated the
    // scalar lifts, which the tail then evaluates a second time.
    // `WithRandomSeed` makes the draw COUNT observable: the trailing draw is
    // index 1 iff the application consumed exactly one.
    const ce = new ComputeEngine();
    assignTypedPair(
      ce,
      'f',
      ['Tuple', 'x', ['Length', 'y']],
      'broadcastable<number>',
      'list<number>'
    );
    const value = ce
      .box([
        'WithRandomSeed',
        42,
        ['List', ['f', ['Random'], ['List', 1, 2, 3]], ['Random']],
      ])
      .evaluate();
    const [seedLo, seedHi] = foldSeed(42);
    expect(value.op2.re).toBe(frameDraw(seedLo, seedHi, 1));
    // …and the value the application kept is the FIRST draw, not a discarded
    // one (the pre-fix path returned draw #1 and threw draw #0 away).
    expect(value.op1.op1.re).toBe(frameDraw(seedLo, seedHi, 0));
  });

  test('the map still fires when the MAPPABLE slot holds the list', () => {
    const ce = new ComputeEngine();
    assignTypedPair(
      ce,
      'f',
      ['Tuple', 'x', ['Length', 'y']],
      'broadcastable<number>',
      'list<number>'
    );
    expect(
      ce
        .box(['f', ['List', 1, 2], ['List', 7, 8, 9]])
        .evaluate()
        .toString()
    ).toBe('[(1, 3),(2, 3)]');
  });
});

describe('DECLARED broadcastable<T> — the lazy route checks `T` too (finding 5)', () => {
  /** A source past `MAX_SIZE_EAGER_COLLECTION` whose FIRST element violates
   * `number` (it is itself a list); every other element conforms. */
  const violatingSource = (): unknown[] => [
    'List',
    ...Array.from({ length: 150 }, (_, i) => (i === 0 ? ['List', 1, 2] : i)),
  ];

  test('a violating element is LOUD past the eager threshold, not silently descended', () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'bump', ['Add', 'x', 1], 'broadcastable<number>');
    const value = ce.box(['bump', violatingSource() as any]).evaluate();
    // Still lazy — the check must not cost the laziness.
    expect(value.operator).toBe('Map');
    const first = value.at(1)!;
    expect(first.isValid).toBe(false);
    expect(first.toString()).toContain('incompatible-type');
    expect(first.toString()).toContain('"number"');
    // The conforming siblings are unaffected.
    expect(value.at(2)?.toString()).toBe('2');
  });

  test('the eager twin of the same shape agrees (semantics do not depend on SIZE)', () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'bump', ['Add', 'x', 1], 'broadcastable<number>');
    const value = ce.box(['bump', ['List', ['List', 1, 2], 3]]).evaluate();
    expect(value.op1.isValid).toBe(false);
    expect(value.op1.toString()).toContain('incompatible-type');
    expect(value.ops![1].toString()).toBe('4');
  });

  test('a CONFORMING lazy source is untouched — no spurious element errors', () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'bump', ['Add', 'x', 1], 'broadcastable<number>');
    const value = ce
      .box([
        'bump',
        ['List', ...Array.from({ length: 150 }, (_, i) => i)] as any,
      ])
      .evaluate();
    expect(value.operator).toBe('Map');
    expect(value.at(1)?.toString()).toBe('1');
    expect(value.at(150)?.toString()).toBe('150');
  });
});

describe('DECLARED broadcastable<T> — the compile gate is PER SLOT (finding 6)', () => {
  test('a collection at a WHOLE-bound sibling still compiles', () => {
    const ce = new ComputeEngine();
    assignTypedPair(
      ce,
      'withAll',
      ['At', 'y', 'x'],
      'broadcastable<number>',
      'list<number>'
    );
    const js = new JavaScriptTarget();
    const compiled = js.compile(ce.box(['withAll', 2, ['List', 7, 8, 9]]));
    expect(compiled?.success).toBe(true);
    expect((compiled?.run as unknown as () => unknown)()).toBe(8);
    // …and it agrees with the interpreter.
    expect(
      ce
        .box(['withAll', 2, ['List', 7, 8, 9]])
        .evaluate()
        .toString()
    ).toBe('8');
  });

  test('an atomic TUPLE the element type ADMITS compiles (tuples are never mapped)', () => {
    const ce = new ComputeEngine();
    assignTyped(ce, 'pairUp', ['Tuple', 'x', 'x'], 'broadcastable<value>');
    const js = new JavaScriptTarget();
    const compiled = js.compile(ce.box(['pairUp', ['Tuple', 1, 2]]));
    expect(compiled?.success).toBe(true);
    expect((compiled?.run as unknown as () => unknown)()).toEqual([
      [1, 2],
      [1, 2],
    ]);
    expect(
      ce
        .box(['pairUp', ['Tuple', 1, 2]])
        .evaluate()
        .toString()
    ).toBe('((1, 2), (1, 2))');
  });

  test('a TUPLE the element type REFUTES still fails closed', () => {
    // The interpreter answers `incompatible-type` for this one; no emitted
    // form says that, so the compile must decline rather than compute.
    const ce = new ComputeEngine();
    assignTyped(ce, 'bump', ['Add', 'x', 1], 'broadcastable<number>');
    const js = new JavaScriptTarget();
    expect(() => js.compile(ce.box(['bump', ['Tuple', 1, 2]]))).toThrow(
      /declared `broadcastable<T>` parameter/
    );
  });
});

describe('DECLARED broadcastable<T> — `Nothing` rows (finding 7)', () => {
  test('the eager and lazy routes agree on a `Nothing`-valued element', () => {
    // `ce._fn` bypasses the operator canonical handler, so the eager
    // `Apply(⟨literal⟩, …row)` never runs `Apply`'s `Nothing` erasure — it
    // answers exactly what the lazy body answers. Pinned because the two
    // constructions differ (`canonical: false` on the lazy side) and a future
    // switch to `ce.function('Apply', …)` would silently drop the row.
    const ce = new ComputeEngine();
    assignTyped(ce, 'pairUp', ['Tuple', 'x', 'x'], 'broadcastable<any>');
    const nothings = (n: unknown) => ['Map', ['Function', 'Nothing', 'k'], n];
    const eager = ce
      .box(['pairUp', nothings(['List', 1, 2, 3]) as any])
      .evaluate();
    const lazy = ce
      .box(['pairUp', nothings(['Range', 1, 200]) as any])
      .evaluate();
    expect(eager.nops).toBe(3);
    expect(eager.op1.toString()).toBe('()');
    expect(lazy.at(1)?.toString()).toBe('()');
  });
});
