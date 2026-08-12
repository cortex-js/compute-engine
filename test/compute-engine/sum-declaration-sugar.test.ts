import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { sumVariantInfo } from '../../src/compute-engine/compilation/sum-representation';

import type { MathJsonExpression } from '../../src/math-json/types';

//
// SUM-TYPE DECLARATION SUGAR — `docs/plans/2026-08-12-sum-type-sugar-and-
// compilation.md` Part A, executing `docs/TYPE_SYSTEM_ROADMAP.md` §2.3.
//
//   type node = lit(num: number) | plus(op1: node, op2: node)
//
// declares the N nominal variants PLUS the transparent union naming them. It
// adds no semantics: what it produces is exactly the manual desugaring pinned
// by `sum-types.test.ts`, and the assertions below are that file's, re-run
// against the sugar. If the two files ever disagree, the sugar has grown a
// meaning of its own — which is the bug.
//
// The three things that are the sugar's OWN and are not in the manual form:
//
//  1. The TRIGGER (A1). `type X = A | B` over known types must keep meaning
//     the opaque nominal-with-union-body it means today (pinned in
//     `sum-types.test.ts`); the sugar may only claim spellings that error
//     today. So it fires on a call-form arm, or on an all-bare union whose
//     names are all unknown — and, crucially, it must STILL fire the second
//     time the same statement runs, when those names have become known.
//  2. FORWARD REGISTRATION (A3): a payload names the sum bare, with no
//     `type node` marker.
//  3. The COLLISION GUARD (A5): a variant named `Add` would mint a
//     constructor that is silently unreachable, because a numeric head
//     bypasses definition lookup. The sugar refuses it, and declares nothing
//     at all — atomicity across N+1 declarations.
//

/** Run a program, asserting it produced no diagnostics AND no error value, and
 * return the value's string form. A sum failure surfaces as an error VALUE,
 * not a throw (`sum-types.test.ts`), so both have to be asserted. */
function value(src: string): string {
  const ce = new ComputeEngine();
  const result = executeEpsil(ce, src);
  expect(result.diagnostics.map((d) => String(d.message))).toEqual([]);
  const v = result.value.toString();
  expect(v).not.toMatch(/^Error\(/);
  return v;
}

/** Run a program and return `[value, diagnostics]` — for the cases whose point
 * IS the failure. */
function outcome(src: string): [string, string[]] {
  const ce = new ComputeEngine();
  const result = executeEpsil(ce, src);
  return [
    result.value.toString(),
    result.diagnostics.map((d) => String(d.message)),
  ];
}

/** `a <: b`, after running `decls`. */
function subtype(decls: string, a: string, b: string): boolean {
  const ce = new ComputeEngine();
  const result = executeEpsil(ce, decls);
  expect(result.diagnostics.map((d) => String(d.message))).toEqual([]);
  return ce.type(a).matches(b);
}

/** Serialize a parsed program back to Epsil. */
function roundTrip(src: string): string {
  const strip = (x: unknown): any =>
    JSON.parse(
      JSON.stringify(x, (k, v) => (k === 'sourceOffsets' ? undefined : v))
    );
  return serializeEpsil(strip(parseEpsil(src)[0]));
}

describe('the sugar reproduces the manual desugaring', () => {
  // `sum-types.test.ts`, "a payload-free variant discriminates in a sum" — the
  // same program with `type red = nothing` / `type green = nothing` /
  // `type alias light = red | green` collapsed into one statement.
  test('an enumeration of payload-free variants', () => {
    expect(
      value(`
        type TrafficLight = red | green | yellow
        function canGo(t: TrafficLight) -> boolean {
          match t {
            green() => true
            _       => false
          }
        }
        [canGo(green()), canGo(red())]
      `)
    ).toBe('["True","False"]');
  });

  test('a variant is a member of the sum, in BOTH directions', () => {
    const decls = 'type TrafficLight = red | green | yellow';
    expect(subtype(decls, 'green', 'TrafficLight')).toBe(true);
    expect(subtype(decls, 'TrafficLight', 'red | green | yellow')).toBe(true);
    // The single-variant sum: a union with nothing to distribute, the shape
    // whose asymmetry exposed the alias-unfold bug.
    expect(subtype('type solo = lit(num: number)', 'lit', 'solo')).toBe(true);
    expect(subtype('type solo = lit(num: number)', 'solo', 'lit')).toBe(true);
  });

  // `sum-types.test.ts`, "a RECURSIVE sum survives its own payload" — with the
  // `type expr` forward-reference markers dropped (A3).
  const AST =
    'type expr = lit(num: number) | plus(op1: expr, op2: expr) | times(op1: expr, op2: expr)';

  test('a recursive AST constructs, and its members belong to the sum', () => {
    expect(value(`${AST}\nType(plus(lit(1), lit(2)))`)).toBe('"plus"');
    expect(subtype(AST, 'lit', 'expr')).toBe(true);
    expect(subtype(AST, 'plus', 'expr')).toBe(true);
  });

  test('a recursive traversal evaluates', () => {
    expect(
      value(`${AST}
        function ev(n: expr) -> number {
          match n {
            lit(v)      => v
            plus(a, b)  => ev(a) + ev(b)
            times(a, b) => ev(a) * ev(b)
          }
        }
        ev(plus(lit(5), times(lit(2), lit(5))))
      `)
    ).toBe('15');
  });

  // Rule U through the sugar: a GROUND arm binds the sum's variables to
  // `never`, which only works if the alias the sugar builds is transparent and
  // the solver reaches its union.
  test('a ground arm binds the variables to `never`', () => {
    expect(
      value(
        'type expr<T> = lit(num: number) | plus(op1: expr<T>, op2: expr<T>)\nType(plus(lit(5), lit(2)))'
      )
    ).toBe('"plus<never>"');
  });

  // `sum-types.test.ts`, "the GENERIC recursive sum works through a collection
  // payload" — the roadmap's flagship shape, one statement.
  const TREE = 'type tree<T> = leaf | node(value: T, children: list<tree<T>>)';

  test('the generic recursive sum works through a collection payload', () => {
    expect(subtype(TREE, 'node<integer>', 'tree<integer>')).toBe(true);
    expect(subtype(TREE, 'leaf', 'tree<integer>')).toBe(true);
    expect(
      value(`${TREE}
        function total(t: tree<number>) -> number {
          match t {
            node(v, cs) => v + Sum(Map(cs, total))
            _           => 0
          }
        }
        total(node(1, [node(2, []), node(3, [])]))
      `)
    ).toBe('6');
  });
});

describe('A1 — what is sugar and what is not', () => {
  // The pinned reading of `type X = A | B` over KNOWN types: a new OPAQUE
  // nominal whose definition happens to be a union, of which NEITHER member is
  // a member (`sum-types.test.ts`, "`type X = A | B` is opaque — NOT a sum").
  // The sugar must not touch it.
  test('a union over KNOWN types stays the opaque nominal', () => {
    const DECLS = `
      type leaf = nothing
      type kid<T> = tuple<value: T, children: list<number>>
      type opaque<T> = leaf | kid<T>
      type alias sum<T> = leaf | kid<T>
    `;
    expect(subtype(DECLS, 'kid<integer>', 'opaque<integer>')).toBe(false);
    expect(subtype(DECLS, 'leaf', 'opaque<integer>')).toBe(false);
    expect(subtype(DECLS, 'kid<integer>', 'sum<integer>')).toBe(true);
  });

  test('a union over PRIMITIVE types is not sugar either', () => {
    // `integer` and `string` never reach the type resolver — they are grammar,
    // not registry entries — so "names a type" has to be asked of the type
    // parser, not of the known-names set. If it were not, this would declare
    // `type integer = nothing`.
    const [v, d] = outcome('type X = integer | string\nType(X)');
    expect(d).toEqual([]);
    // The nominal constructor of an opaque union body, exactly as today.
    expect(v).toBe('"(integer | string) -> X"');
  });

  test('MIXED known and unknown bare arms keep their `Unknown type` error', () => {
    // The registry never silently flips the meaning of WORKING code — only of
    // erroring code. A body half of which already names types is not the
    // sugar, so `blob` stays a typo, not a variant.
    const [, d] = outcome('type X = integer | blob');
    expect(d).toEqual(['type-annotation-error,Unknown type "blob"']);
  });

  test('a SINGLE bare arm is not a union, so a typo stays a typo', () => {
    const [, d] = outcome('type X = blob');
    expect(d).toEqual(['type-annotation-error,Unknown type "blob"']);
  });

  test('`type alias` is never the sugar', () => {
    // Even with a call-form arm: `alias` says "structural abbreviation", and
    // the sugar has no alias spelling. The arm is then a plain type error.
    const [, d] = outcome('type alias X = lit(num: number) | other');
    expect(d.length).toBeGreaterThan(0);
    expect(d.join()).not.toContain('DeclareSumType');
  });

  test('ONE call-form arm anywhere makes the whole body the sugar', () => {
    // Even when every other arm names a known type — the collision guard then
    // reports it, loudly, rather than the trigger quietly declining.
    const [v] = outcome('type X = integer | wrapped(integer)');
    expect(v).toContain('invalid-type-declaration');
    // A call-form arm alongside genuinely fresh names is the ordinary case.
    expect(value('type X = flag | wrapped(integer)\nType(wrapped(3))')).toBe(
      '"wrapped"'
    );
  });

  test('re-running an all-bare sum still reads as the sugar', () => {
    // The trap: after the first run `red` and `green` DO name types, so a
    // purely lexical trigger would decline on the second run and silently
    // redeclare `X` as an opaque nominal union. The variants are recognized as
    // X's own instead.
    const ce = new ComputeEngine();
    for (const src of ['type X = red | green', 'type X = red | green'])
      expect(executeEpsil(ce, src).diagnostics).toEqual([]);
    // Still a transparent sum, not an opaque nominal.
    expect(ce.type('red').matches('X')).toBe(true);

    // …and an EDITED re-run, adding a variant, works the same way.
    const grown = executeEpsil(ce, 'type X = red | green | blue');
    expect(grown.diagnostics).toEqual([]);
    expect(ce.type('blue').matches('X')).toBe(true);
  });
});

describe('A2 — variant forms and their lowering', () => {
  test('a bare arm is a NULLARY constructor', () => {
    // `type red = nothing`: `nothing`'s sole inhabitant elides as an operand,
    // so the constructor is nullary rather than unary.
    expect(value('type light = red | green\nType(red)')).toBe('"() -> red"');
    expect(value('type light = red | green\nType(red())')).toBe('"red"');
  });

  test('an empty argument list is the same nullary variant', () => {
    expect(value('type light = red() | green(boolean)\nType(red())')).toBe(
      '"red"'
    );
  });

  test('ONE POSITIONAL payload is the type itself', () => {
    // `type jbool = boolean` — a unary constructor over the payload type, no
    // tuple wrapper.
    const JSONISH = 'type json = jnull | jbool(boolean) | jnum(number)';
    expect(value(`${JSONISH}\nType(jbool(true))`)).toBe('"jbool"');
    expect(value(`${JSONISH}\njbool(true)`)).toBe('jbool("True")');
  });

  test('a NAMED payload is a tuple, and its fields are accessible', () => {
    expect(
      value(
        'type expr = lit(num: number) | plus(op1: expr, op2: expr)\nplus(lit(1), lit(2)).op1'
      )
    ).toBe('lit(1)');
    expect(
      value(
        'type expr = lit(num: number) | plus(op1: expr, op2: expr)\nlit(7).num'
      )
    ).toBe('7');
  });

  test('TWO OR MORE positionals are a positional tuple', () => {
    expect(value('type p = pair(integer, string)\nType(pair(1, "a"))')).toBe(
      '"pair"'
    );
  });
});

describe('A3 — the sum names itself in a payload, with no marker', () => {
  test('a self-reference needs no `type` marker', () => {
    // The manual form has to write `tuple<op1: type expr, …>`; the sugar
    // forward-registers the sum before the variants are declared.
    expect(
      value(
        'type expr = lit(num: number) | plus(op1: expr, op2: expr)\nType(plus(lit(1), lit(2)))'
      )
    ).toBe('"plus"');
  });

  test('a reference to ANOTHER not-yet-declared type still needs its marker', () => {
    // Only the sum's OWN name is promised. `later` is nobody's promise.
    const [, d] = outcome(
      'type early = wrap(v: later) | none\ntype later = tuple<integer>'
    );
    expect(d).toEqual(['type-annotation-error,Unknown type "later"']);
  });
});

describe('A4 — a generic sum distributes its parameters by usage', () => {
  const TREE = 'type tree<T> = leaf | node(value: T, children: list<tree<T>>)';

  test('only the variants that USE a parameter get it', () => {
    const ce = new ComputeEngine();
    expect(executeEpsil(ce, TREE).diagnostics).toEqual([]);
    // `leaf` mentions no variable, so it is declared unparameterized —
    // exactly the manual `type leaf = nothing`.
    expect(ce.type('leaf').matches('tree<integer>')).toBe(true);
    expect(ce.type('leaf').matches('tree<string>')).toBe(true);
    // `node` took the parameter, so its applications are distinguished.
    expect(ce.type('node<integer>').matches('tree<integer>')).toBe(true);
    expect(ce.type('node<integer>').matches('tree<string>')).toBe(false);
  });

  test('the variant list and its parameter subsets are recorded (A6)', () => {
    // The compile tier keys its representation policy on these.
    const ce = new ComputeEngine();
    executeEpsil(ce, TREE);
    expect(ce._typeResolver.resolve('tree')?._sumVariants).toEqual([
      { name: 'leaf', typeParams: [] },
      { name: 'node', typeParams: ['T'] },
    ]);
    expect(ce._typeResolver.resolve('leaf')?._sumOf).toBe('tree');
    expect(ce._typeResolver.resolve('node')?._sumOf).toBe('tree');
    // A type that is not a sugar variant carries neither field.
    executeEpsil(ce, 'type solo = tuple<integer>');
    expect(ce._typeResolver.resolve('solo')?._sumOf).toBeUndefined();
  });

  test('a variance marker on a sum is rejected', () => {
    // The sum is a transparent alias, which has no relation between two
    // applications to declare.
    const [v] = outcome('type box<out T> = full(v: T) | empty');
    expect(v).toContain('cannot declare a variance');
  });
});

describe('A5 — the variant-name collision guard, atomically', () => {
  /** Has `name` been declared as a type in `ce`? */
  const declared = (ce: ComputeEngine, name: string): boolean =>
    ce._typeResolver.resolve(name)?.def !== undefined;

  test('a variant colliding with a BUILTIN is refused, and nothing is declared', () => {
    // The `Add` hazard: `type Add = tuple<…>` succeeds today and `Add(1, 2)`
    // still evaluates the builtin to 3, so the constructor is silently
    // unreachable. The sugar refuses it — and the SECOND arm, which would have
    // been fine, is not declared either.
    const ce = new ComputeEngine();
    const result = executeEpsil(
      ce,
      'type bad = Add(op1: number, op2: number) | other'
    );
    expect(result.value.toString()).toContain('invalid-type-declaration');
    expect(result.value.toString()).toContain('built-in');
    expect(declared(ce, 'other')).toBe(false);
    expect(declared(ce, 'bad')).toBe(false);
    expect(declared(ce, 'Add')).toBe(false);
    // The builtin still works.
    expect(executeEpsil(ce, 'Add(1, 2)').value.toString()).toBe('3');
  });

  test('a variant colliding with an EXISTING type is refused', () => {
    const ce = new ComputeEngine();
    const result = executeEpsil(
      ce,
      'type foo = tuple<integer>\ntype bad = foo(integer) | other'
    );
    expect(result.value.toString()).toContain('already names a type');
    expect(declared(ce, 'other')).toBe(false);
    expect(declared(ce, 'bad')).toBe(false);
    // …and the pre-existing type is untouched.
    expect(ce.type('foo').matches('tuple<integer>')).toBe(false); // opaque nominal
    expect(declared(ce, 'foo')).toBe(true);
  });

  test('a variant named like its own sum is refused', () => {
    const [v] = outcome('type bad = bad(integer) | other');
    expect(v).toContain('same name as the sum type');
  });

  test('the same variant twice is refused', () => {
    const [v] = outcome('type dup = a(integer) | a(string)');
    expect(v).toContain('declared twice');
  });

  test('a variant colliding with ANOTHER sum’s variant is refused', () => {
    const ce = new ComputeEngine();
    expect(executeEpsil(ce, 'type X = red | green').diagnostics).toEqual([]);
    const result = executeEpsil(ce, 'type Y = red(integer) | blue');
    expect(result.value.toString()).toContain('already names a type');
    expect(declared(ce, 'blue')).toBe(false);
  });
});

describe('re-declaration — the variant list and the back-pointers agree', () => {
  test('a DROPPED variant loses its sum membership', () => {
    // `_sumOf` (on the variant) and `_sumVariants` (on the sum) are the two
    // halves of one relation, and the compile tier reads BOTH (§B1). A
    // re-declaration that drops a variant overwrites the list but leaves the
    // dropped record behind — its back-pointer has to go with the membership,
    // or the orphan's constructor compiles under the policy the NEW variant
    // set implies, flipping its representation without flipping the values
    // already built with it.
    const ce = new ComputeEngine();
    // `a`/`b` are representation-disjoint (number vs string) → ERASED.
    expect(
      executeEpsil(ce, 'type s = a(number) | b(string)').diagnostics
    ).toEqual([]);
    expect(sumVariantInfo(ce, 'b')?.policy).toBe('erased');

    // Drop `b`, add a colliding `c` → the sum is now TAGGED. `b` is still a
    // perfectly good nominal type, but it is no longer a variant of `s`.
    expect(
      executeEpsil(ce, 'type s = a(number) | c(number)').diagnostics
    ).toEqual([]);
    expect(sumVariantInfo(ce, 'b')).toBeUndefined();
    expect(sumVariantInfo(ce, 'a')?.policy).toBe('tagged');
    expect(sumVariantInfo(ce, 'c')?.policy).toBe('tagged');
    // …so `b`'s constructor keeps the plain D11 erasure it compiled under
    // before the re-declaration, rather than growing a `_tag`.
    expect(
      compile(ce.box(['b', { str: 'x' }] as MathJsonExpression), {
        fallback: false,
      }).code
    ).toBe('"x"');
  });

  test('a stale back-pointer alone is not trusted', () => {
    // Belt to the suspenders above: `sumVariantInfo` cross-checks `_sumOf`
    // against the sum's CURRENT variant list, so a back-pointer that outlived
    // its membership by any other route still reads as "not a sum variant".
    const ce = new ComputeEngine();
    executeEpsil(ce, 'type s = a(number) | b(string)');
    executeEpsil(ce, 'type s = a(number) | c(number)');
    ce._typeRegistry['b']._sumOf = 's';
    expect(sumVariantInfo(ce, 'b')).toBeUndefined();
  });

  test('re-declaring the SAME variants is idempotent', () => {
    const ce = new ComputeEngine();
    const src =
      'type t = p(op1: number, op2: number) | q(op1: number, op2: number)';
    expect(executeEpsil(ce, src).diagnostics).toEqual([]);
    expect(executeEpsil(ce, src).diagnostics).toEqual([]);
    for (const v of ['p', 'q']) {
      expect(sumVariantInfo(ce, v)?.sum).toBe('t');
      expect(sumVariantInfo(ce, v)?.policy).toBe('tagged');
    }
  });

  test('a variant kept across a re-declaration keeps its membership', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'type u = k1 | k2');
    executeEpsil(ce, 'type u = k1 | k3');
    expect(sumVariantInfo(ce, 'k1')?.sum).toBe('u');
    expect(sumVariantInfo(ce, 'k3')?.sum).toBe('u');
    expect(sumVariantInfo(ce, 'k2')).toBeUndefined();
  });
});

describe('A6 — plumbing: box route, statements, round-trip', () => {
  test('the box route declares too', () => {
    // `DeclareSumType` is lazy, so its operands arrive unbound; both the
    // canonical and the evaluate handler must register (the `DeclareType`
    // dual-route discipline).
    const ce = new ComputeEngine();
    const e = ce.box([
      'DeclareSumType',
      { sym: 'S' },
      ['Tuple', { str: 'aa' }, { str: 'nothing' }],
      ['Tuple', { str: 'bb' }, { str: 'boolean' }],
    ] as any);
    expect(e.evaluate().toString()).toBe('"Nothing"');
    expect(ce.type('aa').matches('S')).toBe(true);
    expect(ce.type('bb').matches('S')).toBe(true);
  });

  test('the box route declares on the EVALUATE pass alone', () => {
    const ce = new ComputeEngine();
    const e = ce.box(
      [
        'DeclareSumType',
        { sym: 'S2' },
        ['Tuple', { str: 'cc' }, { str: 'nothing' }],
      ] as any,
      { canonical: false }
    );
    expect(e.evaluate().toString()).toBe('"Nothing"');
    expect(ce.type('cc').matches('S2')).toBe(true);
  });

  test('a generic sum rides its clause in the attributes dictionary', () => {
    const ce = new ComputeEngine();
    ce.box([
      'DeclareSumType',
      { sym: 'G' },
      ['Dictionary', ['KeyValuePair', { sym: 'typeParams' }, { str: 'T' }]],
      ['Tuple', { str: 'gempty' }, { str: 'nothing' }],
      ['Tuple', { str: 'gfull' }, { str: 'tuple<v: T>' }],
    ] as any).evaluate();
    expect(ce.type('gfull<integer>').matches('G<integer>')).toBe(true);
    expect(ce.type('gempty').matches('G<integer>')).toBe(true);
  });

  test('a sum declaration inside a block is rejected (types are global)', () => {
    const [, d] = outcome('do { type X = a(integer) | b }');
    expect(d.join()).toContain('type-declaration-not-top-level');
  });

  test('the sugar round-trips through `serialize-epsil`', () => {
    for (const src of [
      'type TrafficLight = red | green | yellow',
      'type node = lit(num: number) | plus(op1: node, op2: node) | times(op1: node, op2: node)',
      'type tree<T> = leaf | node(value: T, children: list<tree<T>>)',
      'type json = jnull | jbool(boolean) | jnum(number) | jarr(list<json>)',
      'type p = pair(integer, string)',
      'type f = g((integer) -> real)',
    ])
      expect(roundTrip(src)).toBe(src);
  });

  test('a canonicalized sum statement round-trips too', () => {
    const ce = new ComputeEngine();
    const src = 'type node = lit(num: number) | plus(op1: node, op2: node)';
    expect(serializeEpsil(ce.box(parseEpsil(src)[0]).json as any)).toBe(src);
  });

  test('the sugar spans lines', () => {
    expect(
      value(`
        type expr =
            lit(num: number)
          | plus(op1: expr, op2: expr)

        Type(plus(lit(1), lit(2)))
      `)
    ).toBe('"plus"');
  });
});
