/**
 * The compile-target matrix for strings-as-collections and the `character`
 * type — `docs/STRING_ROADMAP.md`, decision D13.
 *
 * The compiled pipeline (`compilation/ir/`) has no text values: every string
 * or character operation declines and falls back to the interpreter. These
 * tests pin the declines.
 */

import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';
import { compile } from '../../src/compute-engine/compilation/compile-expression';

let ce: ComputeEngine;
beforeEach(() => {
  ce = new ComputeEngine();
});

// ── Helpers ─────────────────────────────────────────────────────────────────

/** `CharacterFrom("x")` — canonicalizes to the character value itself (D7). */
function char(s: string): Expression {
  return ce.box(['CharacterFrom', { str: s }]);
}

/** Assert `expr` declines to compile — the engine reports `success: false` and
 * falls back to the interpreter, which answers correctly. */
function failsClosed(expr: Expression): void {
  expect(compile(expr, { constantFold: false }).success).toBe(false);
}

// ── Fail-closed cells ───────────────────────────────────────────────────────

describe('D13: the JavaScript fail-closed cells', () => {
  const S = { str: 'abc' };

  test('`CharacterFrom` of a NON-literal declines', () => {
    // A runtime cluster-count check is not in v1: the canonical handler keeps
    // the call, and there is no lowering for it.
    failsClosed(ce.box(['CharacterFrom', ['String', char('a')]]));
    ce.declare('sv', 'string');
    failsClosed(ce.box(['CharacterFrom', 'sv']));
  });

  test('a MULTI-cluster literal at a `character` parameter is a type error', () => {
    ce.declare('fc', '(character) -> character');
    ce.assign('fc', ce.parse('c \\mapsto c'));
    const call = ce.function('fc', [ce.string('ab')]);
    expect(call.isValid).toBe(false);
    expect(compile(call, { constantFold: false }).success).toBe(false);
  });

  test('an arithmetic `Reduce` fold over a string declines', () => {
    // The interpreter answers an `incompatible-type` error; the emitted
    // `(_a, _b) => _a + _b` over one-cluster strings would CONCATENATE and run
    // to `"abc"` behind `success: true`.
    expect(ce.box(['Reduce', S, 'Add']).evaluate().toString()).toContain(
      'incompatible-type'
    );
    failsClosed(ce.box(['Reduce', S, 'Add']));
    failsClosed(ce.box(['Reduce', S, 'Multiply']));
  });

  test('`Sum` / `Product` over a string declines', () => {
    for (const head of ['Sum', 'Product'])
      failsClosed(ce.box([head, S] as never));
  });

  test('an ordering that MIXES a character with anything else declines', () => {
    failsClosed(ce.box(['Less', char('a'), 1]));
    // A character vs a one-cluster STRING does compare in the interpreter (the
    // D5 bridge), but admitting it is a separate widening; it stays closed.
    failsClosed(ce.box(['Less', char('a'), { str: 'b' }]));
  });

  test('a CHAINED character ordering declines', () => {
    // The chained form would need the evaluate-each-operand-once temporaries
    // the infix chain path binds; only the binary form compiles.
    failsClosed(ce.box(['Less', char('a'), char('b'), char('c')]));
  });

  test('`String` of a non-text operand declines', () => {
    // Rendering a number reproduces the engine's number-formatting options.
    failsClosed(ce.box(['String', 5]));
    // The single-collection JOIN carve-out evaluates to the string, but its
    // declared result type is still `list<character>`, so it stays closed.
    failsClosed(ce.box(['String', ['Characters', S]]));
  });

  test('the linear-algebra operators keep refusing a string source', () => {
    // A string is a rank-0 LEAF for these (spec constraint 5 / D12), not a
    // vector of characters — segmenting it would be a semantic lie.
    for (const src of [
      ['Transpose', S],
      ['Flatten', S],
      ['Reshape', S, ['Tuple', 1, 3]],
    ])
      failsClosed(ce.box(src as never));
  });

  test('`Zip` and `Join` keep refusing a string operand', () => {
    failsClosed(ce.box(['Zip', S, ['List', 1, 2, 3]]));
    failsClosed(ce.box(['Join', S, ['List', 1]]));
  });

  test('a custom `Sort` comparator over a string declines', () => {
    failsClosed(ce.box(['Sort', S, ['Function', 'True', '_']]));
  });

  test('a union with a text arm declines on the list lowerings', () => {
    // `string | list<number>` is not PROVABLY a string, so nothing segments it
    // — and it IS a subtype of `indexed_collection` (a string is one), so the
    // list lowerings used to admit it and run `.slice()`, `.reverse()` and
    // `.length` over the JS string it may hold at run time, i.e. over UTF-16
    // code units, behind a reported `success: true`.
    ce.declare('u', 'string | list<number>');
    for (const src of [
      ['Take', 'u', 2],
      ['Reverse', 'u'],
      ['Length', 'u'],
      ['Drop', 'u', 1],
      ['Unique', 'u'],
    ])
      failsClosed(ce.box(src as never));
  });

});

// ── GLSL ────────────────────────────────────────────────────────────────────

describe('D13: GLSL rejects strings and characters, as before', () => {
  // The shader targets have no text at all — no string type, no grapheme
  // segmentation, no dynamic arrays. The lattice change (a string became an
  // indexed collection, and `character` a new scalar) must not have moved any
  // of these from "rejected" to "compiles": these pin the existing
  // diagnostics, each of which names a shader-target limitation rather than
  // anything about the string lattice.
  const S = { str: 'abc' };

  test.each(['glsl'] as const)(
    '%s rejects every string-collection operation',
    (to) => {
      for (const src of [
        ['Length', S],
        ['At', S, 2],
        ['Map', ['Function', 'c', 'c'], S],
        ['Reverse', S],
        ['Characters', S],
        ['Comprehension', ['Equal', 'c', { str: 'a' }], ['Element', 'c', S]],
      ])
        expect(
          compile(ce.box(src as never), { to, constantFold: false }).success
        ).toBe(false);
    }
  );

  test.each(['glsl'] as const)(
    '%s rejects a text-typed symbol reached only through a user-function BODY',
    (to) => {
      // The text-symbol gate collects names once per compiled ROOT, but a
      // user-defined function's body is compiled against that same root target
      // while being nowhere inside the root expression. `g` below referenced
      // two `string`-typed globals and emitted
      // `float _fn_g(float x) { return ((sv < tv) ? (x) : (0.0)); }` — a float
      // comparison where the interpreter compares text, behind
      // `success: true`.
      ce.declare('sv', 'string');
      ce.declare('tv', 'string');
      ce.assign(
        'g',
        ce.box(['Function', ['If', ['Less', 'sv', 'tv'], 'x', 0], 'x'])
      );
      const r = compile(ce.box(['g', 'u']), { to, constantFold: false });
      expect(r.success).toBe(false);
      expect(r.error ?? '').toMatch(/reads the input sv of type string/);
    }
  );

  test.each(['glsl'] as const)(
    '%s rejects a string-typed free symbol in the same shapes',
    (to) => {
      ce.declare('sv', 'string');
      for (const src of [
        ['Length', 'sv'],
        ['At', 'sv', 2],
        ['Reverse', 'sv'],
      ])
        expect(
          compile(ce.box(src as never), { to, constantFold: false }).success
        ).toBe(false);
    }
  );

  test.each(['glsl'] as const)('%s rejects a character operand', (to) => {
    for (const src of [
      ['CharacterFrom', { str: 'a' }],
      ['Equal', char('a'), char('a')],
      ['Less', char('a'), char('b')],
      ['List', char('a'), char('b')],
      ['Add', char('a'), 1],
    ])
      expect(
        compile(ce.box(src as never), { to, constantFold: false }).success
      ).toBe(false);
  });

  test.each(['glsl'] as const)('%s rejects a bare string literal', (to) => {
    // Before this gate the target's `string` hook emitted
    // `JSON.stringify(str)`, so a bare string literal compiled to `"a"` —
    // source no shader driver accepts, behind `success: true`.
    const r = compile(ce.box({ str: 'a' }), { to, constantFold: false });
    expect(r.success).toBe(false);
    expect(r.error ?? '').toMatch(/"a": a string: text compiles on javascript only/);
  });

  test.each(['glsl'] as const)(
    '%s rejects a string literal as an operand of a supported op',
    (to) => {
      // `List` and the comparison operators DO lower on these targets, so the
      // string operand rode their lowering into the emitted source:
      // `vec2("a", "b")` and `"a" == "b"`.
      for (const src of [
        ['List', { str: 'a' }, { str: 'b' }],
        ['Equal', { str: 'a' }, { str: 'b' }],
        ['Less', { str: 'a' }, { str: 'b' }],
        ['If', ['Equal', { str: 'a' }, { str: 'a' }], 1, 2],
      ]) {
        const r = compile(ce.box(src as never), { to, constantFold: false });
        expect(r.success).toBe(false);
        expect(r.error ?? '').toMatch(/"a": a string: text compiles on javascript only/);
      }
    }
  );

  test.each(['glsl'] as const)(
    '%s rejects a string-TYPED symbol as an operand',
    (to) => {
      // A text-typed free symbol emitted a bare identifier, which the caller
      // then declares as a numeric uniform: `Less(sv, tv)` came out as
      // `sv < tv`, a float comparison where the interpreter compares text.
      ce.declare('sv', 'string');
      ce.declare('tv', 'string');
      for (const src of [
        'sv',
        ['Less', 'sv', 'tv'],
        ['Equal', 'sv', 'tv'],
        ['List', 'sv', 'tv'],
      ]) {
        const r = compile(ce.box(src as never), { to, constantFold: false });
        expect(r.success).toBe(false);
        expect(r.error ?? '').toMatch(/"sv": a string: text compiles on javascript only/);
      }
    }
  );

});
