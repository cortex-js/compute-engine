import { ComputeEngine } from '../../src/compute-engine';
import { isSubtype } from '../../src/common/type/subtype';
import { parseType } from '../../src/common/type/parse';
import { collectionElementType } from '../../src/common/type/utils';
import { typeToString } from '../../src/common/type/serialize';

/**
 * Phase 3b of the type-variables design
 * (`docs/plans/2026-08-01-type-variables-design.md` §7.3): the `collections.ts`
 * conversions from a weak signature + imperative `type:` handler to a `forall`
 * signature.
 *
 * CONVERTED (17):
 *   KeyValuePair  `forall T. (key: string, value: T) -> tuple<string, T>`
 *   Single        `forall T. (value: T) -> tuple<T>`
 *   Pair          `forall T, U. (first: T, second: U) -> tuple<T, U>`
 *   Triple        `forall T, U, V. (first: T, second: U, third: V) -> tuple<T, U, V>`
 *   Reverse       `forall T: indexed_collection. (T) -> T`  (the ONLY
 *                 identity-preserving echo in the file)
 *   Take, Drop, Slice, DeleteAt, Insert, ReplaceAt, Sort, Unique,
 *   RandomShuffle, Tally, Partition, ChunkBy — the `collection<T>` /
 *   `indexed_collection<T>` constructor-pattern family.
 *
 * The twelve constructor-pattern conversions were once blocked by a
 * dimensioned-actual sub-rule: the solver's element extraction follows
 * `collectionElementType` (which PEELS one dimension — a matrix's element is
 * its ROW) while `isSubtype` read a dimensioned list as a collection of its
 * SCALAR dtype only, so instantiating `indexed_collection<T>` at a `matrix`
 * actual produced a parameter the actual did not satisfy. `isSubtype` now
 * admits BOTH readings (`subtype.ts`, `peeledRowMatches`); the last `describe`
 * block below pins the agreement.
 *
 * Every converted operator is probed on all three routes (`ce.function`,
 * `ce.box`, `ce.parse`) — the standing route-parity pin.
 */

function engine(): ComputeEngine {
  return new ComputeEngine();
}

const sig = (ce: ComputeEngine, op: string) =>
  ce.box(op).operatorDefinition!.signature.toString();

describe('TYPE VARIABLES / collections — declared signatures', () => {
  test('the five converted operators carry `forall` signatures', () => {
    const ce = engine();
    expect(sig(ce, 'KeyValuePair')).toBe(
      'forall T. (key: string, value: T) -> tuple<string, T>'
    );
    expect(sig(ce, 'Single')).toBe('forall T. (value: T) -> tuple<T>');
    expect(sig(ce, 'Pair')).toBe(
      'forall T, U. (first: T, second: U) -> tuple<T, U>'
    );
    expect(sig(ce, 'Triple')).toBe(
      'forall T, U, V. (first: T, second: U, third: V) -> tuple<T, U, V>'
    );
    expect(sig(ce, 'Reverse')).toBe('forall T: indexed_collection. (T) -> T');
  });

  test('the twelve constructor-pattern operators carry `forall` signatures', () => {
    const ce = engine();
    expect(sig(ce, 'Take')).toBe(
      'forall T. (xs: indexed_collection<T>, count: number) -> list<T>'
    );
    expect(sig(ce, 'Drop')).toBe(
      'forall T. (xs: indexed_collection<T>, count: number) -> list<T>'
    );
    expect(sig(ce, 'Slice')).toBe(
      'forall T. (value: indexed_collection<T>, start: number, end: number) -> list<T>'
    );
    expect(sig(ce, 'DeleteAt')).toBe(
      'forall T. (indexed_collection<T>, integer) -> list<T>'
    );
    // UNBOUNDED (the D4 audit's spelling). A bound on `T` would also
    // constrain the SOURCE collection's elements, since the same variable
    // stands for both — see the `list<function>` source pin below.
    expect(sig(ce, 'Insert')).toBe(
      'forall T. (indexed_collection<T>, integer, T) -> list<T>'
    );
    expect(sig(ce, 'ReplaceAt')).toBe(
      'forall T. (indexed_collection<T>, integer, T) -> list<T>'
    );
    // The `order`/`key` slots stay the PRIMITIVE `function`, not an arrow: a
    // function-typed SYMBOL operand must still be admitted there.
    expect(sig(ce, 'Sort')).toBe(
      'forall T. (indexed_collection<T>, order: function?) -> list<T>'
    );
    expect(sig(ce, 'Unique')).toBe('forall T. (collection<T>) -> list<T>');
    expect(sig(ce, 'RandomShuffle')).toBe(
      'forall T. (indexed_collection<T>) random -> list<T>'
    );
    expect(sig(ce, 'Tally')).toBe(
      'forall T. (collection<T>) -> tuple<list<T>, list<integer>>'
    );
    // The second parameter is still ONE union — but its function arm became a
    // Design D contextual callback in phase 2 (Rule U admits it: exactly one
    // arm of the union is open). This reads the DEFINITION's own signature,
    // which by contract clause 5 keeps `callback<S>`; what a user SEES is the
    // ground projection, and that is byte-identical to the line below it was
    // before (`design-d-callback-contract.test.ts`, R-D5).
    expect(sig(ce, 'Partition')).toBe(
      'forall T. (collection<T>, callback<(T) -> boolean> | integer, integer?) -> list<list<T>>'
    );
    expect(ce.box('Partition').type.toString()).toBe(
      'forall T. (collection<T>, function | integer, integer?) -> list<list<T>>'
    );
    expect(sig(ce, 'ChunkBy')).toBe(
      'forall T. (collection<T>, key: function) -> list<list<T>>'
    );
  });
});

//
// The tuple family. All four canonicalize to `Tuple` (`engine.tuple(…)` /
// `_fn('Tuple', …)`), so the STRUCTURAL route is the one where the operator's
// own signature is observable — it is probed alongside the canonical routes.
//

describe('TYPE VARIABLES / KeyValuePair — `forall T. (key: string, value: T) -> tuple<string, T>`', () => {
  test('the value position echoes verbatim on every route', () => {
    const ce = engine();
    const t = (v: any) =>
      ce.function('KeyValuePair', [ce.string('k'), v], { structural: true })
        .type.type;
    expect(typeToString(t(ce.number(2)))).toBe('tuple<string, finite_integer>');
    expect(typeToString(t(ce.number(2.5)))).toBe('tuple<string, finite_real>');
    expect(typeToString(t(ce.box(['List', 1, 2, 3])))).toBe(
      'tuple<string, vector<finite_integer^3>>'
    );
    // Canonical + box + parse routes all collapse to `Tuple`, but the result
    // type is the same one the deleted handler produced.
    expect(
      ce
        .function('KeyValuePair', [ce.string('k'), ce.number(2)])
        .type.toString()
    ).toBe('tuple<string, finite_integer>');
    expect(ce.box(['KeyValuePair', { str: 'k' }, 2]).type.toString()).toBe(
      'tuple<string, finite_integer>'
    );
    expect(
      ce
        .parse('\\operatorname{KeyValuePair}(\\text{k}, 2)')
        .type.toString()
    ).toBe('tuple<string, finite_integer>');
  });

  test('`T` is unbounded — a function-typed value is still admitted', () => {
    const ce = engine();
    ce.declare('kvF', 'function');
    expect(
      ce
        .function('KeyValuePair', [ce.string('k'), ce.box('kvF')], {
          structural: true,
        })
        .type.toString()
    ).toBe('tuple<string, function>');
  });

  test('the ground `key` position still rejects a non-string', () => {
    const ce = engine();
    const e = ce.box(['KeyValuePair', 2, 2]);
    expect(e.type.toString()).toBe('error');
    expect(e.toString()).toContain('incompatible-type');
  });

  test('evaluation is unchanged', () => {
    const ce = engine();
    expect(ce.box(['KeyValuePair', { str: 'k' }, 2]).evaluate().json).toEqual([
      'Tuple',
      "'k'",
      2,
    ]);
  });
});

describe('TYPE VARIABLES / Single, Pair, Triple — per-position echo', () => {
  test('Single echoes its one operand', () => {
    const ce = engine();
    const t = (v: any) =>
      ce.function('Single', [v], { structural: true }).type.toString();
    expect(t(ce.number(2))).toBe('tuple<finite_integer>');
    expect(t(ce.box(['List', 1, 2, 3]))).toBe(
      'tuple<vector<finite_integer^3>>'
    );
    ce.declare('sgU', 'unknown');
    expect(t(ce.box('sgU'))).toBe('tuple<unknown>');
    // Canonical + box + parse.
    expect(ce.function('Single', [ce.number(2)]).type.toString()).toBe(
      'tuple<finite_integer>'
    );
    expect(ce.box(['Single', 2]).type.toString()).toBe('tuple<finite_integer>');
    expect(ce.parse('\\operatorname{Single}(2)').type.toString()).toBe(
      'tuple<finite_integer>'
    );
  });

  test('Pair keeps its two positions independent (two variables)', () => {
    const ce = engine();
    expect(
      ce
        .function('Pair', [ce.number(2), ce.string('a')], { structural: true })
        .type.toString()
    ).toBe('tuple<finite_integer, string>');
    expect(ce.box(['Pair', 2, { str: 'a' }]).type.toString()).toBe(
      'tuple<finite_integer, string>'
    );
    expect(
      ce.parse('\\operatorname{Pair}(2, 3.5)').type.toString()
    ).toBe('tuple<finite_integer, finite_real>');
  });

  test('Triple keeps its three positions independent (three variables)', () => {
    const ce = engine();
    expect(
      ce
        .function('Triple', [ce.number(2), ce.string('a'), ce.True], {
          structural: true,
        })
        .type.toString()
    ).toBe('tuple<finite_integer, string, boolean>');
    expect(ce.box(['Triple', 2, { str: 'a' }, 'True']).type.toString()).toBe(
      'tuple<finite_integer, string, boolean>'
    );
    expect(
      ce.parse('\\operatorname{Triple}(2, 3.5, 4)').type.toString()
    ).toBe('tuple<finite_integer, finite_real, finite_integer>');
  });

  test('a dimensioned operand echoes verbatim in a BARE-variable position', () => {
    // A `matrix` actual is fine at a bare variable — only the
    // `indexed_collection<T>` CONSTRUCTOR pattern trips the dimensioned-actual
    // sub-rule (pinned at the bottom of this file).
    const ce = engine();
    ce.declare('tmM', 'matrix<integer^(2x3)>');
    expect(
      ce.function('Single', [ce.box('tmM')], { structural: true }).type.toString()
    ).toBe('tuple<matrix<integer^(2x3)>>');
  });

  test('arity is unchanged', () => {
    const ce = engine();
    expect(ce.box(['Pair', 2]).isValid).toBe(false);
    expect(ce.box(['Triple', 2, 3]).isValid).toBe(false);
  });

  test('evaluation is unchanged', () => {
    const ce = engine();
    expect(ce.box(['Pair', 2, 3]).evaluate().json).toEqual(['Tuple', 2, 3]);
    expect(ce.box(['Triple', 2, 3, 4]).evaluate().json).toEqual([
      'Tuple',
      2,
      3,
      4,
    ]);
  });
});

//
// Reverse — the one identity-preserving echo.
//

describe('TYPE VARIABLES / Reverse — `forall T: indexed_collection. (T) -> T`', () => {
  test('the operand type is echoed VERBATIM — kind and dimensions', () => {
    const ce = engine();
    ce.declare('rvM', 'matrix<integer^(2x3)>');
    ce.declare('rvT', 'tuple<integer, string>');
    // Dimensions survive: this is what makes it an identity echo rather than
    // the plain `list<T>` of `Sort`/`Unique`.
    expect(ce.function('Reverse', [ce.box('rvM')]).type.toString()).toBe(
      'matrix<integer^(2x3)>'
    );
    expect(ce.function('Reverse', [ce.box('rvT')]).type.toString()).toBe(
      'tuple<integer, string>'
    );
    expect(
      ce.function('Reverse', [ce.box(['List', 1, 2, 3])]).type.toString()
    ).toBe('vector<finite_integer^3>');
    expect(
      ce
        .function('Reverse', [
          ce.box(['List', { str: 'a' }, { str: 'b' }]),
        ])
        .type.toString()
    ).toBe('list<string^2>');
    // A Range keeps its (unmaterialized) indexed-collection kind.
    expect(
      ce.function('Reverse', [ce.box(['Range', 1, 10])]).type.toString()
    ).toBe('indexed_collection<integer>');
    // An empty list keeps `never`.
    expect(ce.function('Reverse', [ce.box(['List'])]).type.toString()).toBe(
      'list<never>'
    );
  });

  test('route parity — function / box / parse agree', () => {
    const ce = engine();
    expect(
      ce.function('Reverse', [ce.box(['List', 1, 2, 3])]).type.toString()
    ).toBe('vector<finite_integer^3>');
    expect(ce.box(['Reverse', ['List', 1, 2, 3]]).type.toString()).toBe(
      'vector<finite_integer^3>'
    );
    expect(
      ce
        .parse('\\operatorname{Reverse}(\\lbrack 1,2,3\\rbrack)')
        .type.toString()
    ).toBe('vector<finite_integer^3>');
  });

  test('the echo is idempotent (a reversed reverse keeps the type)', () => {
    const ce = engine();
    const xs = ce.box(['List', 1, 2, 3]);
    expect(
      ce
        .function('Reverse', [ce.function('Reverse', [xs])])
        .type.toString()
    ).toBe('vector<finite_integer^3>');
  });

  test('the declared bound still rejects a non-indexed operand', () => {
    const ce = engine();
    ce.declare('rvS', 'set<integer>');
    for (const e of [
      ce.function('Reverse', [ce.box('rvS')]),
      ce.function('Reverse', [ce.string('hello')]),
    ]) {
      expect(e.type.toString()).toBe('error');
      expect(e.toString()).toContain('incompatible-type');
    }
  });

  test('evaluation is unchanged', () => {
    const ce = engine();
    // `Reverse` is a LAZY collection: `.json` keeps the unmaterialized form,
    // so the value pin reads through `.toString()`.
    expect(ce.box(['Reverse', ['List', 1, 2, 3]]).evaluate().toString()).toBe(
      '[3,2,1]'
    );
    expect(
      ce
        .parse('\\operatorname{Reverse}(\\lbrack 1,2,3\\rbrack)')
        .evaluate()
        .toString()
    ).toBe('[3,2,1]');
  });

  test('ACCEPTED deltas on the unknown/any edge (§4.3 bound-join table)', () => {
    // Was `indexed_collection` (the handler echoed the post-narrowing type);
    // the absorbing-`unknown` rule now makes the result `unknown`.
    const ce = engine();
    ce.declare('rvU', 'unknown');
    expect(ce.function('Reverse', [ce.box('rvU')]).type.toString()).toBe(
      'unknown'
    );
    // An `any`-typed operand is ADMITTED (result `any`): §4.5 parity requires
    // it, because the ground `(indexed_collection) -> indexed_collection`
    // admits `any` unconditionally through the unknown/any gate. `any` is
    // therefore absorbed exactly as `unknown` is (D8). Same for the
    // already-migrated `Inverse: forall T: matrix. (T) -> T`.
    const ce2 = engine();
    ce2.declare('rvA', 'any');
    expect(ce2.function('Reverse', [ce2.box('rvA')]).isValid).toBe(true);
    expect(ce2.function('Reverse', [ce2.box('rvA')]).type.toString()).toBe(
      'any'
    );
    const ce3 = engine();
    ce3.declare('ivA', 'any');
    expect(ce3.function('Inverse', [ce3.box('ivA')]).isValid).toBe(true);
  });
});

//
// The dimensioned-actual rule that once blocked the twelve.
//

describe('TYPE VARIABLES / collections — the dimensioned-actual rule', () => {
  test('`collectionElementType` PEELS a dimension; `isSubtype` accepts that reading', () => {
    // The audit's §4.3 sub-rule, measured. These two are the element-extraction
    // rule the solver mirrors and the admission rule it re-checks against; they
    // now agree at rank >= 2, which is what lets `indexed_collection<T>`
    // instantiate at a matrix actual.
    const m = parseType('matrix<integer^(2x3)>');
    expect(typeToString(collectionElementType(m)!)).toBe('vector<integer^3>');
    expect(
      isSubtype(m, parseType('indexed_collection<vector<integer^3>>'))
    ).toBe(true);
    // The SCALAR-dtype reading is additive, not replaced.
    expect(isSubtype(m, parseType('indexed_collection<integer>'))).toBe(true);
    // Rank 1 is unchanged (there is no dimension to peel).
    const v = parseType('list<string^2>');
    expect(typeToString(collectionElementType(v)!)).toBe('string');
    expect(isSubtype(v, parseType('indexed_collection<string>'))).toBe(true);
    expect(isSubtype(v, parseType('indexed_collection<list<string>>'))).toBe(
      false
    );
  });

  test('the converted operators still accept a matrix operand', () => {
    const ce = engine();
    const m = ['List', ['List', 1, 2, 3], ['List', 4, 5, 6]] as any;
    // `Take` of a matrix returns its first ROW — the behavior the conversion
    // regressed to `incompatible-type`.
    expect(ce.box(['Take', m, 1]).evaluate().toString()).toBe('[[1,2,3]]');
    expect(ce.box(['Take', m, 1]).type.toString()).toBe(
      'list<vector<finite_integer^3>>'
    );
    expect(ce.box(['Sort', m]).type.toString()).toBe(
      'list<vector<finite_integer^3>>'
    );
    expect(ce.box(['Unique', m]).type.toString()).toBe(
      'list<vector<finite_integer^3>>'
    );
    expect(ce.box(['Tally', m]).type.toString()).toBe(
      'tuple<list<vector<finite_integer^3>>, list<integer>>'
    );
    expect(ce.box(['ChunkBy', m, ['Function', 'x', 'x']]).type.toString()).toBe(
      'list<list<vector<finite_integer^3>>>'
    );
  });

  test('`Insert`/`ReplaceAt` still widen the element type with the value', () => {
    // The repeated variable reproduces this via the solver's §4.3 join of the
    // two lower bounds (the collection's element and the value).
    const ce = engine();
    const xs = ['List', 1, 2, 3] as any;
    expect(ce.box(['Insert', xs, 1, { str: 'a' }]).type.toString()).toBe(
      'list<finite_integer | string>'
    );
    expect(ce.box(['ReplaceAt', xs, 1, { str: 'a' }]).type.toString()).toBe(
      'list<finite_integer | string>'
    );
    expect(ce.box(['Insert', xs, 1, 4]).type.toString()).toBe(
      'list<finite_integer>'
    );
  });

  test('`Sort`/`Unique`/`RandomShuffle` are plain, NOT identity echoes', () => {
    // A tuple/Range/set source still comes out as a `list<…>`: the result
    // always rebuilds as a `List`. (Pinned so a retry does not "fix" these
    // into bounded echoes.)
    const ce = engine();
    ce.declare('pnT', 'tuple<integer, string>');
    ce.declare('pnS', 'set<integer>');
    expect(ce.function('Sort', [ce.box('pnT')]).type.toString()).toBe(
      'list<integer | string>'
    );
    expect(ce.function('Unique', [ce.box('pnS')]).type.toString()).toBe(
      'list<integer>'
    );
    expect(
      ce.function('RandomShuffle', [ce.box(['Range', 1, 10])]).type.toString()
    ).toBe('list<integer>');
    // `RandomShuffle` keeps the `random` effect (hence impure).
    expect(sig(ce, 'RandomShuffle')).toContain('random');
    expect(ce.box(['RandomShuffle', ['List', 1, 2, 3]]).isPure).toBe(false);
  });

  test('`Tally`s string branch was unreachable — dropped with the conversion', () => {
    // The audit asked whether the deleted handler's `t === 'string'` arm was
    // live: it was not — a string is not a `collection`, so the operand is
    // refused before any element type is computed.
    const ce = engine();
    const e = ce.box(['Tally', { str: 'hello' }]);
    expect(e.isValid).toBe(false);
    expect(e.toString()).toContain('incompatible-type');
  });

  test('§8 DISPLAY — an unconstrained variable shows its ground skeleton', () => {
    // `T` gets no bound at all when the source operand is refused, so S3 falls
    // back to `unknown` and the instantiated parameter would read
    // `indexed_collection<unknown>` — an impossible-looking requirement for
    // what is really "any indexed collection". The message shows the bare
    // constructor; the SOLVED bindings that type the call are untouched.
    const ce = engine();
    for (const op of ['Take', 'Drop']) {
      const e = ce.box([op, 5, 2] as any);
      expect(e.isValid).toBe(false);
      expect(e.toString()).toContain(
        'incompatible-type", "indexed_collection", "finite_integer"'
      );
      expect(e.toString()).not.toContain('indexed_collection<unknown>');
    }
    const s = ce.box(['Slice', 5, 2, 3] as any);
    expect(s.toString()).toContain('"indexed_collection"');
  });

  test('§8 DISPLAY — a bound violated at a CONSTRUCTOR position shows the instantiated pattern', () => {
    // The blamed position may be a constructor pattern (`list<T>` at a
    // `T: integer` bound). Displaying the bare bound would read
    // "expected `integer`, got `vector<finite_real^2>`" — incoherent for a
    // parameter whose true expected type is `list<integer>`. The bound is
    // substituted INTO the pattern for display, like the §8 callback case.
    const ce = engine();
    ce.declare('hh57', { signature: 'forall T: integer. (T, list<T>) -> T' });
    const e = ce.box(['hh57', 1, ['List', 1.5, 2.5]]);
    expect(e.isValid).toBe(false);
    // Blame lands on the offending operand (position 1), with the
    // instantiated `list<integer>` as the expected type — not the bare bound.
    expect(e.op2.toString()).toContain('incompatible-type');
    expect(e.op2.toString()).toContain('list<integer>');
    expect(e.op1.toString()).toBe('1');
  });

  test('`Sort`/`ChunkBy`/`Partition` still admit a function-typed SYMBOL', () => {
    // The callback slots are the PRIMITIVE `function`, not an arrow: an arrow
    // parameter would reject a bare `function`-typed symbol operand
    // (`collection-callback-signatures.test.ts`).
    const ce = engine();
    ce.declare('cbF', 'function');
    const xs = ['List', 3, 1, 2] as any;
    expect(ce.box(['Sort', xs, 'cbF']).isValid).toBe(true);
    expect(ce.box(['ChunkBy', xs, 'cbF']).isValid).toBe(true);
    expect(ce.box(['Partition', xs, 'cbF']).isValid).toBe(true);
  });

  test('`Insert`/`ReplaceAt` are UNBOUNDED — the source is not constrained', () => {
    // `T` stands for the source's element type AND the inserted value's type,
    // so any bound on it constrains BOTH. A `T: value` bound rejected
    // `Insert(fs, 1, 2)` on a `list<function>` source, which the ground
    // `(indexed_collection, integer, value) -> list` accepted — a §4.5 parity
    // regression. Unbounded restores it.
    const ce = engine();
    ce.declare('fs', 'list<function>');
    expect(ce.box(['Insert', 'fs', 1, 2]).isValid).toBe(true);
    expect(ce.box(['Insert', 'fs', 1, 2]).type.toString()).toBe(
      'list<finite_integer | function>'
    );
    expect(ce.box(['ReplaceAt', 'fs', 1, 2]).isValid).toBe(true);
    expect(ce.box(['ReplaceAt', 'fs', 1, 2]).type.toString()).toBe(
      'list<finite_integer | function>'
    );
    // The other side of the same coin, and a DELIBERATE loosening vs the old
    // ground `value` third parameter: a function VALUE is admitted too. It
    // matches what `evaluate` does — it splices whatever it is handed.
    ce.declare('cbF2', 'function');
    const xs = ['List', 1, 2, 3] as any;
    expect(ce.box(['Insert', xs, 1, 'cbF2']).isValid).toBe(true);
    expect(ce.box(['Insert', xs, 1, 'cbF2']).type.toString()).toBe(
      'list<finite_integer | function>'
    );
    expect(ce.box(['ReplaceAt', xs, 1, 'cbF2']).isValid).toBe(true);
    expect(ce.box(['ReplaceAt', xs, 1, 'cbF2']).type.toString()).toBe(
      'list<finite_integer | function>'
    );
  });

  test('the converted operators evaluate unchanged', () => {
    const ce = engine();
    const xs = ['List', 3, 1, 2] as any;
    expect(ce.box(['Take', xs, 2]).evaluate().toString()).toBe('[3,1]');
    expect(ce.box(['Drop', xs, 1]).evaluate().toString()).toBe('[1,2]');
    expect(ce.box(['Slice', xs, 1, 2]).evaluate().toString()).toBe('[3,1]');
    expect(ce.box(['DeleteAt', xs, 1]).evaluate().toString()).toBe('[1,2]');
    expect(ce.box(['Insert', xs, 1, 9]).evaluate().toString()).toBe(
      '[9,3,1,2]'
    );
    expect(ce.box(['ReplaceAt', xs, 1, 9]).evaluate().toString()).toBe(
      '[9,1,2]'
    );
    expect(ce.box(['Sort', xs]).evaluate().toString()).toBe('[1,2,3]');
    expect(
      ce
        .box(['Unique', ['List', 1, 1, 2]])
        .evaluate()
        .toString()
    ).toBe('[1,2]');
    expect(
      ce
        .box(['Tally', ['List', 1, 1, 2]])
        .evaluate()
        .toString()
    ).toBe('([1,2], [2,1])');
    expect(ce.box(['Partition', xs, 2]).evaluate().toString()).toBe(
      '[[3,1],[2]]'
    );
  });
});
