import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

import type { MathJsonExpression } from '../../src/math-json/types';

//
// COMPILING SUM TYPES — `docs/plans/2026-08-12-sum-type-sugar-and-
// compilation.md` Part B, amending D11 of
// `docs/plans/2026-08-01-nominal-types-design.md` §4.6.
//
// **The tag is erased iff it is statically discharged.** A product discharges
// its tag at type-check time and erases (D11, unchanged — pinned by
// `type-constructors-compile.test.ts`). A SUM's tag is runtime data as soon as
// `match` branches on it, so the policy is decided per sum, at compile time,
// from its variants' erased JS representations (§B1):
//
//   - all pairwise DISJOINT → ERASED: the JS value IS the tag, constructors
//     keep the D11 erasure, and `match` lowers to representation tests
//     (`s === null`, `typeof s === 'number'`, `Array.isArray(s)`);
//   - otherwise → TAGGED: constructors emit `{ _tag: 'plus', _ops: [a, b] }`
//     and `match` tests `_tag`, reading captures out of `_ops`.
//
// Scope is SUGAR-declared sums (the ones carrying `_sumOf`/`_sumVariants`).
// A hand-assembled union of nominals has no sum identity to key a policy on
// and keeps today's behavior exactly: erased constructors, constructor-pattern
// `match` failing closed.
//

/** An engine with `src` executed, asserting it declared cleanly. */
function engine(src: string): ComputeEngine {
  const ce = new ComputeEngine();
  const result = executeEpsil(ce, src);
  expect(result.diagnostics.map((d) => String(d.message))).toEqual([]);
  return ce;
}

/** The AST sum of the roadmap's `ev` example: three variants, two of which
 * (`plus`/`times`) share a two-element tuple representation — so the sum is
 * TAGGED. */
const AST =
  'type node = lit(num: number) | plus(op1: node, op2: node) | times(op1: node, op2: node)';

const EV = `${AST}
  function ev(n: node) -> number {
    match n {
      lit(v)      => v
      plus(a, b)  => ev(a) + ev(b)
      times(a, b) => ev(a) * ev(b)
    }
  }
`;

describe('TAGGED policy — the roadmap `ev` AST example', () => {
  test('a compiled recursive traversal agrees with the interpreter', () => {
    const ce = engine(EV);
    const expr = ce.box([
      'ev',
      ['plus', ['lit', 5], ['times', ['lit', 2], ['lit', 5]]],
    ] as MathJsonExpression);

    // The value is built and consumed inside ONE compiled unit, so the tagged
    // representation never crosses the boundary (§B2).
    const r = compile(expr, { fallback: false });
    expect(r.success).toBe(true);
    expect(r.run!({})).toBe(15);
    // …and the compiled answer is the interpreted one.
    expect(r.run!({})).toBe(expr.evaluate().re);
  });

  test('the constructors reify the tag, the match tests it', () => {
    const ce = engine(EV);
    const r = compile(
      ce.box(['ev', ['plus', ['lit', 1], ['lit', 2]]] as MathJsonExpression),
      { fallback: false, constantFold: false }
    );
    // Construction: `{ _tag, _ops }` object literals.
    expect(r.code).toContain('_tag: "plus"');
    expect(r.code).toContain('_ops: [');
  });

  test('the emitted `match` tests `_tag` and reads captures from `_ops`', () => {
    const ce = engine(AST);
    ce.declare('n', 'node');
    const r = compile(
      ce.box([
        'Match',
        'n',
        ['MatchCase', ['lit', '_v'], 'v'],
        ['MatchCase', '_', -1],
      ] as MathJsonExpression),
      { fallback: false }
    );
    expect(r.code).toContain(`_tag === "lit"`);
    expect(r.code).toContain('_ops[0]');
    // The tag test is TOTAL: optional chaining, so a scrutinee that is `null`
    // or a primitive (a value of some OTHER sum) falls through instead of
    // throwing.
    expect(r.code).toContain('?._tag');
    expect(r.run!({ n: { _tag: 'lit', _ops: [7] } })).toBe(7);
    expect(r.run!({ n: { _tag: 'plus', _ops: [1, 2] } })).toBe(-1);
    expect(r.run!({ n: null })).toBe(-1);
    expect(r.run!({ n: 5 })).toBe(-1);
  });

  test('nested constructor patterns, literal payloads, guards, alternatives', () => {
    const ce = engine(AST);
    ce.declare('n', 'node');
    const r = compile(
      ce.box([
        'Match',
        'n',
        // Nested: falls out of the recursion.
        ['MatchCase', ['plus', ['lit', 0], '_b'], 111],
        // A guard over a payload capture.
        ['MatchCase', ['lit', '_v'], ['Greater', 'v', 3], 222],
        ['MatchCase', ['lit', '_v'], 'v'],
        // Capture-free alternatives OR their tag tests.
        [
          'MatchCase',
          ['Alternatives', ['plus', '_', '_'], ['times', '_', '_']],
          555,
        ],
        ['MatchCase', '_', -1],
      ] as MathJsonExpression),
      { fallback: false }
    );
    const lit = (x: number) => ({ _tag: 'lit', _ops: [x] });
    const plus = (a: unknown, b: unknown) => ({ _tag: 'plus', _ops: [a, b] });
    const times = (a: unknown, b: unknown) => ({ _tag: 'times', _ops: [a, b] });
    expect(r.run!({ n: plus(lit(0), lit(9)) })).toBe(111);
    expect(r.run!({ n: lit(5) })).toBe(222); // guard passes
    expect(r.run!({ n: lit(2) })).toBe(2); // guard fails, next case
    expect(r.run!({ n: times(lit(1), lit(1)) })).toBe(555);
    expect(r.run!({ n: plus(lit(3), lit(1)) })).toBe(555);
  });

  test('two NULLARY variants collide, so an enumeration is tagged too', () => {
    // `type red = nothing` and `type green = nothing` erase to the same JS
    // value, so the tag has to be reified even though no variant has a payload.
    const ce = engine(`type TrafficLight = red | green | yellow
      function canGo(t: TrafficLight) -> boolean {
        match t {
          green() => true
          _       => false
        }
      }
    `);
    const go = (v: string) =>
      compile(
        ce.box([v === 'canGo' ? v : 'canGo', [v]] as MathJsonExpression),
        {
          fallback: false,
          constantFold: false,
        }
      );
    expect(go('green').code).toContain('_tag: "green"');
    // A nullary tagged constructor carries no `_ops` at all.
    expect(go('green').code).not.toContain('_ops');
    expect(go('green').run!({})).toBe(true);
    expect(go('red').run!({})).toBe(false);
    expect(go('yellow').run!({})).toBe(false);
  });
});

describe('ERASED policy — a representation-disjoint sum keeps D11 erasure', () => {
  const JSONISH =
    'type json = jnull | jbool(boolean) | jnum(number) | jstr(string) | jarr(list<json>)';

  test('constructors emit NO tag — the JS value IS the tag', () => {
    const ce = engine(JSONISH);
    ce.declare('b', 'boolean');
    ce.declare('x', 'number');
    const code = (e: MathJsonExpression) =>
      compile(ce.box(e), { fallback: false }).code;
    // A nullary variant of an erased sum is the one JS value its bucket names.
    expect(code(['jnull'])).toBe('null');
    // Every other variant is exactly its compiled operand (D11, verbatim).
    expect(code(['jbool', 'b'])).toBe(code('b'));
    expect(code(['jnum', ['Add', 'x', 1]])).toBe(code(['Add', 'x', 1]));
    for (const e of [['jnull'], ['jbool', 'b'], ['jnum', 'x']])
      expect(code(e as MathJsonExpression)).not.toContain('_tag');
  });

  test('`match` dispatches on the representation, and captures the value', () => {
    const ce = engine(JSONISH);
    ce.declare('v', 'json');
    const r = compile(
      ce.box([
        'Match',
        'v',
        ['MatchCase', ['jnull'], 0],
        ['MatchCase', ['jbool', '_b'], 1],
        ['MatchCase', ['jnum', '_n'], 2],
        ['MatchCase', ['jstr', '_s'], 3],
        ['MatchCase', ['jarr', '_xs'], 4],
        ['MatchCase', '_', -1],
      ] as MathJsonExpression),
      { fallback: false }
    );
    expect(r.code).not.toContain('_tag');
    expect(r.code).toContain('=== null');
    expect(r.code).toContain(`typeof`);
    expect(r.code).toContain('Array.isArray');
    // Each variant's erased value selects its own arm.
    expect(r.run!({ v: null })).toBe(0);
    expect(r.run!({ v: true })).toBe(1);
    expect(r.run!({ v: 7 })).toBe(2);
    expect(r.run!({ v: 'a' })).toBe(3);
    expect(r.run!({ v: [1, 2] })).toBe(4);
  });

  test('a payload capture binds the erased value itself', () => {
    const ce = engine(JSONISH);
    ce.declare('v', 'json');
    const r = compile(
      ce.box([
        'Match',
        'v',
        ['MatchCase', ['jnum', '_n'], ['Multiply', 'n', 10]],
        ['MatchCase', '_', -1],
      ] as MathJsonExpression),
      { fallback: false }
    );
    expect(r.run!({ v: 4 })).toBe(40);
    expect(r.run!({ v: 'x' })).toBe(-1);
  });

  test('a NAMED single payload is a tuple, so it erases to an array', () => {
    // `jnum(number)` (positional) is the number itself; `lit(num: number)`
    // (named) lowers to `tuple<num: number>` and erases to a one-element JS
    // array — the A2 distinction, visible in the compiled representation.
    const ce = engine('type box = empty | one(num: number)');
    ce.declare('x', 'number');
    expect(
      compile(ce.box(['one', 'x'] as MathJsonExpression), {
        fallback: false,
      }).code
    ).toBe('[_.x]');
    ce.declare('v', 'box');
    const r = compile(
      ce.box([
        'Match',
        'v',
        ['MatchCase', ['one', '_a'], 'a'],
        ['MatchCase', ['empty'], -1],
      ] as MathJsonExpression),
      { fallback: false }
    );
    expect(r.code).toContain('Array.isArray');
    expect(r.code).toContain('.length === 1');
    expect(r.run!({ v: [9] })).toBe(9);
    expect(r.run!({ v: null })).toBe(-1);
  });

  test('an erased tuple payload keeps its D11 lowering on the GPU target', () => {
    // Erasure is target-independent: only the TAGGED emission is JS-only.
    const ce = engine('type shape = dot | seg(a: number, b: number)');
    ce.declare('u', 'number');
    ce.declare('w', 'number');
    const e = ce.box(['seg', 'u', 'w'] as MathJsonExpression);
    expect(compile(e, { fallback: false }).code).toBe('[_.u, _.w]');
    expect(compile(e, { to: 'glsl', fallback: false }).code).toBe('vec2(u, w)');
  });
});

describe('§B2 — the engine⇄compiled boundary', () => {
  test('a unit whose RESULT is a tagged sum value declines', () => {
    const ce = engine(AST);
    const expr = ce.box(['plus', ['lit', 1], ['lit', 2]] as MathJsonExpression);
    expect(() => compile(expr, { fallback: false })).toThrow(
      /tagged sum variant/
    );
    const r = compile(expr);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/does not cross the boundary/);
  });

  test('a tagged sum inside a compound result declines too', () => {
    const ce = engine(AST);
    expect(() =>
      compile(ce.box(['List', ['lit', 1], ['lit', 2]] as MathJsonExpression), {
        fallback: false,
      })
    ).toThrow(/tagged sum variant/);
  });

  test('a tagged sum inside a `set` result declines too', () => {
    // The boundary walk enumerates every CONTAINER kind: a kind it fails to
    // enumerate falls to the default and lets a `{_tag}` value escape.
    const ce = engine(AST);
    const e = ce.box(['Set', ['lit', 1], ['lit', 2]] as MathJsonExpression);
    expect(e.type.toString()).toBe('set<lit>');
    expect(() => compile(e, { fallback: false })).toThrow(
      /tagged sum variant 'lit'/
    );
  });

  test('a sum-typed PARAMETER is allowed — `ev` needs one', () => {
    // The boundary rule is about the RESULT: the tagged representation is the
    // caller's contract, and every caller is inside the same compiled unit.
    const ce = engine(EV);
    const r = compile(ce.box(['ev', ['lit', 4]] as MathJsonExpression), {
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.run!({})).toBe(4);
  });

  test('an ERASED sum result flows as today (no boundary)', () => {
    const ce = engine('type shape = dot | seg(a: number, b: number)');
    ce.declare('u', 'number');
    const r = compile(ce.box(['seg', 'u', 1] as MathJsonExpression), {
      fallback: false,
    });
    expect(r.success).toBe(true);
    expect(r.run!({ u: 3 })).toEqual([3, 1]);
  });
});

describe('§B2 — field access on a variant value', () => {
  test('a TAGGED variant routes its field through `_ops`', () => {
    // `lit(num: number)` lowers to `tuple<num: number>`, whose D11 erasure is
    // a one-element array — but a TAGGED variant is `{_tag, _ops}`, and the
    // payload lives one level down. Reading `[0]` off the tagged object is
    // `undefined`, silently.
    const ce = engine(AST);
    const r = compile(
      ce.box(['Field', ['lit', 7], { str: 'num' }] as MathJsonExpression),
      { fallback: false, constantFold: false }
    );
    expect(r.code).toContain('._ops[0]');
    expect(r.run!({})).toBe(7);
    // …and the compiled answer is the interpreted one — never `undefined`.
    expect(r.run!({})).toBe(
      ce
        .box(['Field', ['lit', 7], { str: 'num' }] as MathJsonExpression)
        .evaluate().re
    );
  });

  test('an ERASED variant keeps the positional D11 indexing', () => {
    const ce = engine('type box = empty | one(num: number)');
    const r = compile(
      ce.box(['Field', ['one', 7], { str: 'num' }] as MathJsonExpression),
      { fallback: false }
    );
    expect(r.code).not.toContain('_ops');
    expect(r.run!({})).toBe(7);
  });

  test('a TAGGED variant field declines on every non-JS target', () => {
    const ce = engine(AST);
    const e = ce.box([
      'Field',
      ['lit', 7],
      { str: 'num' },
    ] as MathJsonExpression);
    for (const to of ['python', 'glsl', 'wgsl'] as const)
      expect(() =>
        compile(e, { to, fallback: false, constantFold: false })
      ).toThrow(/cannot compile/);
  });
});

describe('fail closed — out-of-scope targets and non-sugar nominals', () => {
  test('a NON-LINEAR constructor pattern fails closed', () => {
    // `plus(a, a)` binds `a` twice: the interpreter's generic matcher UNIFIES
    // the two occurrences, so the arm is taken only when the payloads are
    // equal. There is no representation-independent equality the lowering
    // could emit (a payload may be a number, a string, an array, a `{re, im}`
    // or a `{_tag, _ops}`), so the compiler fails closed rather than dropping
    // the condition and matching `plus(1, 2)` — the same posture tier 2 takes
    // on a repeated binding (`hasRepeatedKeys`).
    const ce = engine(AST);
    ce.declare('n', 'node');
    expect(() =>
      compile(
        ce.box([
          'Match',
          'n',
          ['MatchCase', ['plus', '_a', '_a'], 1],
          ['MatchCase', '_', 0],
        ] as MathJsonExpression),
        { fallback: false }
      )
    ).toThrow(/not compilable/);

    // The interpreter's answers — which a compiled unit must never contradict.
    const interp = (a: number, b: number) =>
      ce
        .box([
          'Match',
          ['plus', ['lit', a], ['lit', b]],
          ['MatchCase', ['plus', '_x', '_x'], 1],
          ['MatchCase', '_', 0],
        ] as MathJsonExpression)
        .evaluate().re;
    expect(interp(1, 2)).toBe(0);
    expect(interp(2, 2)).toBe(1);
  });

  test('a capture-binding ALTERNATIVE is rejected before the sum tier', () => {
    // Why the alternation loop can share one `accessors` map across arms
    // without an arm overwriting another's slot: a name-binding alternative
    // never reaches the sum tier at all — the match plan rejects it upstream.
    // Only capture-FREE alternatives (`plus(_, _) | times(_, _)`) get here.
    const ce = engine(AST);
    ce.declare('n', 'node');
    expect(() =>
      compile(
        ce.box([
          'Match',
          'n',
          [
            'MatchCase',
            ['Alternatives', ['plus', '_a', '_'], ['times', '_a', '_']],
            'a',
          ],
          ['MatchCase', '_', -1],
        ] as MathJsonExpression),
        { fallback: false }
      )
    ).toThrow(/or-alternative binds the name/);
  });

  test('a NON-SUGAR nominal constructor pattern still fails closed', () => {
    // No `_sumOf` record → no sum identity → the tier-3 fail-closed throw,
    // exactly as before Part B (`match-compile.test.ts`'s operator-pattern pin
    // is the same shape).
    const ce = new ComputeEngine();
    ce.declareType('meters', 'number');
    ce.declare('x', 'number');
    expect(() =>
      compile(
        ce.box([
          'Match',
          'x',
          ['MatchCase', ['meters', '_a'], 'a'],
          ['MatchCase', '_', 0],
        ] as MathJsonExpression),
        { fallback: false }
      )
    ).toThrow(/not compilable/);
  });

  test('a HAND-ASSEMBLED union of nominals has no sum identity', () => {
    // The manual desugaring, minus the sugar: `declareSumType` is the sole
    // writer of `_sumOf`, so the policy never applies and `match` fails closed.
    const ce = engine(`
      type a = nothing
      type b = nothing
      type alias u = a | b
    `);
    ce.declare('v', 'u');
    expect(() =>
      compile(
        ce.box([
          'Match',
          'v',
          ['MatchCase', ['a'], 1],
          ['MatchCase', '_', 0],
        ] as MathJsonExpression),
        { fallback: false }
      )
    ).toThrow(/not compilable/);
  });

  test('Python fails closed on a constructor-pattern match', () => {
    const ce = engine(AST);
    ce.declare('n', 'node');
    expect(() =>
      compile(
        ce.box([
          'Match',
          'n',
          ['MatchCase', ['lit', '_v'], 'v'],
          ['MatchCase', '_', 0],
        ] as MathJsonExpression),
        { to: 'python', fallback: false }
      )
    ).toThrow(/not supported by the Python/);
  });

  test('the GPU targets decline a constructor-pattern match', () => {
    const ce = engine(AST);
    ce.declare('n', 'node');
    const m = ce.box([
      'Match',
      'n',
      ['MatchCase', ['lit', '_v'], 'v'],
      ['MatchCase', '_', 0],
    ] as MathJsonExpression);
    for (const to of ['glsl', 'wgsl'] as const)
      expect(() => compile(m, { to, fallback: false })).toThrow(
        /not compilable/
      );
  });

  test('a TAGGED constructor emission declines on every non-JS target', () => {
    const ce = engine(AST);
    ce.declare('u', 'number');
    // Wrapped in a `match` so the boundary rule is not what declines it.
    const e = ce.box([
      'Match',
      ['plus', ['lit', 'u'], ['lit', 1]],
      ['MatchCase', ['plus', '_a', '_b'], 1],
      ['MatchCase', '_', 0],
    ] as MathJsonExpression);
    expect(compile(e, { fallback: false }).run!({ u: 2 })).toBe(1);
    expect(() => compile(e, { to: 'glsl', fallback: false })).toThrow(
      /cannot compile/
    );
  });
});

describe('generic sums', () => {
  const TREE = 'type tree<T> = leaf | node(value: T, children: list<tree<T>>)';

  test('a generic sum classifies from its variants, arities differing', () => {
    // `leaf` is `nothing` (nullary, `null`); `node<T>` is a tuple (an array).
    // Disjoint → ERASED, and the type parameter never enters the decision.
    const ce = engine(TREE);
    ce.declare('x', 'number');
    expect(
      compile(ce.box(['leaf'] as MathJsonExpression), { fallback: false }).code
    ).toBe('null');
    expect(
      compile(ce.box(['node', 'x', ['List']] as MathJsonExpression), {
        fallback: false,
      }).code
    ).toBe('[_.x, []]');
  });

  test('a generic sum `match` dispatches on the erased representation', () => {
    const ce = engine(TREE);
    ce.declare('t', 'tree<number>');
    const r = compile(
      ce.box([
        'Match',
        't',
        ['MatchCase', ['node', '_v', '_cs'], 'v'],
        ['MatchCase', '_', 0],
      ] as MathJsonExpression),
      { fallback: false }
    );
    expect(r.code).toContain('Array.isArray');
    expect(r.run!({ t: [7, []] })).toBe(7);
    expect(r.run!({ t: null })).toBe(0);
  });

  test('FAIL-CLOSED (v1): the roadmap `total` example does not compile', () => {
    // Not a sum-tier limitation: the payload capture `cs` reaches `Map` as an
    // accessor STRING with no static type attached (the same thing tier-2
    // captures do), so `Map`'s compile-time collection gate declines. The sum
    // half is fine — `node(v, cs)` lowers — and this pin is here to catch the
    // day the capture-typing gap closes.
    const ce = engine(`${TREE}
      function total(t: tree<number>) -> number {
        match t {
          node(v, cs) => v + Sum(Map(total, cs))
          _           => 0
        }
      }
    `);
    const expr = ce.box([
      'total',
      ['node', 1, ['List', ['node', 2, ['List']], ['node', 3, ['List']]]],
    ] as MathJsonExpression);
    // The interpreter answers it.
    expect(expr.evaluate().re).toBe(6);
    const r = compile(expr);
    expect(r.success).toBe(false);
    expect(r.error).toMatch(/not an indexed collection/);
  });
});
