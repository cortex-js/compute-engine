import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';

//
// SUM TYPES — a union of nominal variants (`docs/TYPE_SYSTEM_ROADMAP.md` §2).
//
// There is no sum-declaration syntax: a sum is N nominal variant declarations
// plus a union naming them, and `match` discriminates on the constructor. The
// two things this file pins are the ones that were WRONG, not the ones that
// are obvious:
//
//  1. `type X = A | B` and `type alias X = A | B` are NOT the same declaration.
//     The alias is transparent — `A <: X` — and is the sum. The plain `type`
//     declares a new OPAQUE nominal whose definition happens to be a union, and
//     NEITHER member belongs to it. The roadmap's former §2.2 ruling read the
//     two as interchangeable spellings of one type; they never were, and the
//     distinction is the whole reason sums work at all.
//
//  2. A recursive sum must survive being reached THROUGH a variant's payload.
//     Until 2026-08-11 it did not: the declarations were all accepted and the
//     first construction failed, because the alias reference captured inside a
//     variant body (a forward reference, `type expr`) was never unfolded by
//     the subtype check. Three separate defects had to line up to make that
//     work — a reference lhs short-circuiting before the rhs unfold, an
//     `alias` flag snapshotted at capture time instead of delegating to the
//     declaration record, and an unfold that did not instantiate the alias's
//     own parameters. Each direction below fails independently if one of them
//     regresses.
//

/** Run a program, asserting it produced no diagnostics, and return the value's
 * string form. A sum failure surfaces as an `incompatible-type` error VALUE,
 * not a throw, so a test that only inspects the return value can pass while
 * the program is broken — assert on both. */
function value(src: string): string {
  const ce = new ComputeEngine();
  const result = executeEpsil(ce, src);
  const diagnostics = result.diagnostics.map((d) => String(d.message));
  expect(diagnostics).toEqual([]);
  return result.value.toString();
}

/** `a <: b`, after running `decls`. */
function subtype(decls: string, a: string, b: string): boolean {
  const ce = new ComputeEngine();
  const result = executeEpsil(ce, decls);
  expect(result.diagnostics.map((d) => String(d.message))).toEqual([]);
  return ce.type(a).matches(b);
}

describe('a sum is a union of nominal variants', () => {
  const LIGHT = `
    type red = "red"
    type green = "green"
    type yellow = "yellow"
  `;

  test('the union spelled out at the use site discriminates', () => {
    expect(
      value(`${LIGHT}
        function canGo(t: red | green | yellow) -> boolean {
          match t {
            green(_) => true
            _        => false
          }
        }
        [canGo(green("green")), canGo(red("red"))]
      `)
    ).toBe('["True","False"]');
  });

  test('naming the union with `type alias` is the same sum', () => {
    // The alias indirection used to LOSE membership: `green <: TrafficLight`
    // answered false, so the call below was an `incompatible-type` error even
    // though the identical inline union above worked.
    expect(
      value(`${LIGHT}
        type alias TrafficLight = red | green | yellow
        function canGo(t: TrafficLight) -> boolean {
          match t {
            green(_) => true
            _        => false
          }
        }
        [canGo(green("green")), canGo(red("red"))]
      `)
    ).toBe('["True","False"]');
  });

  test('a variant is a member of the alias, in BOTH directions', () => {
    const decls = `${LIGHT}
      type alias TrafficLight = red | green | yellow`;
    expect(subtype(decls, 'green', 'TrafficLight')).toBe(true);
    expect(subtype(decls, 'TrafficLight', 'red | green | yellow')).toBe(true);
    // A single-member alias is the same relation with nothing to distribute —
    // this is the shape whose asymmetry exposed the bug (`solo <: lit` held
    // while `lit <: solo` did not).
    expect(subtype(`type lit = tuple<num: number>
      type alias solo = lit`, 'lit', 'solo')).toBe(true);
    expect(subtype(`type lit = tuple<num: number>
      type alias solo = lit`, 'solo', 'lit')).toBe(true);
  });
});

describe('`type X = A | B` is opaque — NOT a sum', () => {
  // The distinction the former §2.2 ruling missed. Both declarations below are
  // legal (Rule U admits the type variable under the union arm); they mean
  // different things, and only the alias one is a sum.
  const DECLS = `
    type leaf = nothing
    type kid<T> = tuple<value: T, children: list<number>>
    type opaque<T> = leaf | kid<T>
    type alias sum<T> = leaf | kid<T>
  `;

  test('a transparent alias admits its members', () => {
    expect(subtype(DECLS, 'kid<integer>', 'sum<integer>')).toBe(true);
    expect(subtype(DECLS, 'leaf', 'sum<integer>')).toBe(true);
  });

  test('a nominal union admits NEITHER member', () => {
    // Nominal opacity: `opaque<T>` is a new type whose *definition* is the
    // union. Its inhabitants are what its own constructor makes, so a `leaf`
    // is not one of them. If this ever flips to `true`, nominal opacity has
    // been lost, not sums improved.
    expect(subtype(DECLS, 'kid<integer>', 'opaque<integer>')).toBe(false);
    expect(subtype(DECLS, 'leaf', 'opaque<integer>')).toBe(false);
  });

  test('a nominal is not a member of an alias of its own definition', () => {
    // The other side of opacity, and the case the rhs unfold must NOT admit:
    // unfolding the alias reaches `tuple<num: number>`, which the nominal
    // `lit` is deliberately not a subtype of.
    expect(
      subtype(
        `type lit = tuple<num: number>
         type alias shape = tuple<num: number>`,
        'lit',
        'shape'
      )
    ).toBe(false);
  });
});

describe('a RECURSIVE sum survives its own payload', () => {
  // The variant bodies name the sum through the forward-reference marker
  // (`type expr`), which is the only way to write recursion: the sum cannot be
  // declared before the variants it lists.
  const AST = `
    type lit = tuple<num: number>
    type plus = tuple<op1: type expr, op2: type expr>
    type times = tuple<op1: type expr, op2: type expr>
    type alias expr = lit | plus | times
  `;

  test('constructing a nested value typechecks', () => {
    // Every one of these failed as `incompatible-type` while the forward
    // reference went unexpanded — the declarations above were accepted and the
    // sum was unusable from the first nested construction on.
    expect(value(`${AST} Type(plus(lit(1), lit(2)))`)).toBe('"plus"');
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

  test('a payload-free variant is constructible', () => {
    // `nothing` is the unit type and the natural spelling of a variant that
    // carries nothing. Its sole inhabitant `Nothing` ELIDES as an operand, so
    // a unary `(nothing) -> leaf` constructor could never be called: `leaf()`
    // was a missing argument and `leaf(Nothing)` collapsed to the same call.
    // The constructor is nullary, like the one an empty tuple body gets.
    expect(value(`type leaf = nothing\nType(leaf)`)).toBe('"() -> leaf"');
    expect(value(`type leaf = nothing\nType(leaf())`)).toBe('"leaf"');
  });

  test('a payload-free variant discriminates in a sum', () => {
    expect(
      value(`
        type red = nothing
        type green = nothing
        type alias light = red | green
        function canGo(t: light) -> boolean {
          match t {
            green() => true
            _       => false
          }
        }
        [canGo(green()), canGo(red())]
      `)
    ).toBe('["True","False"]');
  });

  test('a ground arm binds the variables to `never`, through an alias', () => {
    // Rule U: an actual accepted by a GROUND arm says nothing about the
    // variable, so it contributes `never` — the bottom of the family. That
    // rule lives in the solver's union case, which a parameter still spelled
    // as a forward-reference ALIAS never reached: the union was hidden behind
    // the reference, nothing was contributed, and the variable fell through to
    // the `unknown` default. `plus<unknown>` is then rejected by an
    // `expr<number>` parameter, where `plus<never>` is accepted.
    const AST = `
      type lit = tuple<num: number>
      type plus<T> = tuple<op1: type expr<T>, op2: type expr<T>>
      type alias expr<T> = lit | plus<T>
    `;
    expect(value(`${AST}\nType(plus(lit(5), lit(2)))`)).toBe('"plus<never>"');
    // The flagship bare-variable arm, for contrast — same rule, and the shape
    // that already worked because no alias stood in the way.
    expect(value(`type opt<T> = T | missing\nType(opt(Missing))`)).toBe(
      '"opt<never>"'
    );
  });

  test('the GENERIC recursive sum works through a collection payload', () => {
    // The roadmap's flagship shape (§2.1). The payload reaches the sum inside
    // a `list`, and the alias is parameterized — so the unfold has to
    // instantiate `T` from the application's arguments, not compare against
    // the open body.
    const TREE = `
      type leaf = nothing
      type node<T> = tuple<value: T, children: list<type tree<T>>>
      type alias tree<T> = leaf | node<T>
    `;
    expect(subtype(TREE, 'node<integer>', 'tree<integer>')).toBe(true);
    expect(subtype(TREE, 'leaf', 'tree<integer>')).toBe(true);
    expect(
      value(`${TREE}
        function total(t: tree<number>) -> number {
          match t {
            node(v, cs) => v + Sum(Map(total, cs))
            _           => 0
          }
        }
        total(node(1, [node(2, []), node(3, [])]))
      `)
    ).toBe('6');
  });
});
