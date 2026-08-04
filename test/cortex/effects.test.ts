import { ComputeEngine } from '../../src/compute-engine';
import { parseCortex } from '../../src/cortex/parse-cortex';
import { serializeCortex } from '../../src/cortex/serialize-cortex';
import { executeCortex } from '../../src/cortex/execute-cortex';
import { validCortex } from '../utils';
import type { MathJsonExpression } from '../../src/math-json/types';

//
// Cortex effect annotations (Effects model, Stage 3 — `docs/EFFECTS-MODEL.md`,
// "Cortex surface").
//
// Effects ride the type literal in the three surface positions:
//
//   1. Declarations           `let f: (real) random -> real`
//   2. Parameter annotations  `g(f: (real) random -> real) = f(1)`
//   3. Definitions            `function roll(n) random -> integer { … }`
//
// (1) and (2) are existing full-type positions — the engine's type subparser
// already accepts an effect set, so nothing in the Cortex grammar changes; they
// are pinned here so a regression is caught in the Cortex surface too.
//
// (3) is the only new grammar: a Swift-style **effect specifier slot** of bare
// effect words between the parameter list and `->`. Its normative encoding is
// the FULL SIGNATURE — the parser assembles `(p: T, …) ‹effects› -> ‹result›`
// and ascribes it onto the body as `["Typed", body, {str: signature}]`. The
// argument list of that marker is a mirror (the literal's parameter operands
// stay the parameters of record); a `result` of `unknown` is the wide-result
// convention: effects declared, return type still inferred.
//

/** Parse, serialize, and assert the source is reproduced byte for byte (and
 * that neither pass reported a diagnostic). */
function expectRoundTrip(src: string): void {
  const [expr, diagnostics] = parseCortex(src);
  expect(diagnostics ?? []).toEqual([]);
  expect(serializeCortex(expr)).toBe(src);
}

/** The diagnostic codes reported for a source. */
function diagnosticCodes(src: string): string[] {
  const [, diagnostics] = parseCortex(src);
  return (diagnostics ?? []).map((d) => d.message[0] as string);
}

describe('CORTEX EFFECTS — declaration form', () => {
  test('a `random` arrow in a `let` declaration', () => {
    expect(validCortex('let f: (real) random -> real')).toStrictEqual([
      'Declare',
      'f',
      { str: '(real) random -> real' },
    ]);
    expectRoundTrip('let f: (real) random -> real');
  });

  test('a `pure` arrow in a `let` declaration', () => {
    expect(validCortex('let f: (real) pure -> real')).toStrictEqual([
      'Declare',
      'f',
      { str: '(real) pure -> real' },
    ]);
    expectRoundTrip('let f: (real) pure -> real');
  });

  test('a multi-label arrow in a `let` declaration', () => {
    expect(
      validCortex('let f: (integer) random scope -> integer')
    ).toStrictEqual([
      'Declare',
      'f',
      { str: '(integer) random scope -> integer' },
    ]);
    expectRoundTrip('let f: (integer) random scope -> integer');
  });

  test('a `const` declaration carries the effect set too', () => {
    expectRoundTrip('const f: (real) random -> real');
  });
});

describe('CORTEX EFFECTS — parameter annotation', () => {
  test('an effectful callback parameter', () => {
    expect(validCortex('g(f: (real) random -> real) = f(1)')).toStrictEqual([
      'DefineFunction',
      'g',
      ['Function', ['f', 1], ['Typed', 'f', { str: '(real) random -> real' }]],
    ]);
    expectRoundTrip('g(f: (real) random -> real) = f(1)');
  });

  test('a pure-callback bound (the `integrate` example of the spec)', () => {
    expectRoundTrip('integrate(f: (real) pure -> real, a, b) = f(a) + f(b)');
  });
});

describe('CORTEX EFFECTS — definition form (block)', () => {
  test('the marker carries the FULL signature, not the return type', () => {
    expect(
      validCortex('function roll(n) random -> integer { Random(Range(1, n)) }')
    ).toStrictEqual([
      'DefineFunction',
      'roll',
      [
        'Function',
        [
          'Typed',
          ['Block', ['Random', ['Range', 1, 'n']]],
          { str: '(n: unknown) random -> integer' },
        ],
        'n',
      ],
    ]);
  });

  test('an annotated parameter contributes its type to the marker', () => {
    expect(
      validCortex('function m(x: integer, y) random scope -> real { x }')
    ).toStrictEqual([
      'DefineFunction',
      'm',
      [
        'Function',
        [
          'Typed',
          ['Block', 'x'],
          { str: '(x: integer, y: unknown) random scope -> real' },
        ],
        ['Typed', 'x', { str: 'integer' }],
        'y',
      ],
    ]);
  });

  test('effects-only: no arrow, wide result', () => {
    // `function tick() scope { … }` declares the effects and leaves the return
    // type to inference — the marker's result is `unknown`.
    expect(
      validCortex('function tick() scope { count = count + 1 }')
    ).toStrictEqual([
      'DefineFunction',
      'tick',
      [
        'Function',
        [
          'Typed',
          ['Block', ['Assign', 'count', ['Add', 'count', 1]]],
          { str: '() scope -> unknown' },
        ],
      ],
    ]);
  });

  test('`pure` is a stated-empty effect set and survives the marker', () => {
    expect(validCortex('function h(x) pure -> real { x + 1 }')).toStrictEqual([
      'DefineFunction',
      'h',
      [
        'Function',
        [
          'Typed',
          ['Block', ['Add', 'x', 1]],
          { str: '(x: unknown) pure -> real' },
        ],
        'x',
      ],
    ]);
  });

  test('block-form definitions round-trip byte for byte', () => {
    expectRoundTrip('function roll(n) random -> integer {Random(Range(1, n))}');
    expectRoundTrip('function tick() scope {count = count + 1}');
    expectRoundTrip('function h(x) pure -> real {x + 1}');
    expectRoundTrip('function m(x: integer, y) random scope -> real {x}');
  });
});

describe('CORTEX EFFECTS — definition form (math)', () => {
  test('the marker carries the FULL signature', () => {
    expect(
      validCortex('f(x) random -> integer = Random(Range(1, x))')
    ).toStrictEqual([
      'DefineFunction',
      'f',
      [
        'Function',
        [
          'Typed',
          ['Random', ['Range', 1, 'x']],
          { str: '(x: unknown) random -> integer' },
        ],
        'x',
      ],
    ]);
    expectRoundTrip('f(x) random -> integer = Random(Range(1, x))');
  });

  test('the specifier is claimed only WITH the arrow', () => {
    // `f(x) random = 5` has no arrow, so the lookahead does not claim it as a
    // definition: it stays an expression (and diagnoses the stray symbol,
    // exactly as before the specifier slot existed).
    const [expr] = parseCortex('f(x) random = 5');
    expect(JSON.stringify(expr)).not.toContain('Assign');
    expect(JSON.stringify(expr)).not.toContain('DefineFunction');
  });
});

describe('CORTEX EFFECTS — regressions (no specifier anywhere)', () => {
  test('a return-type-only block definition is unchanged', () => {
    expect(validCortex('function g(x) -> real { x + 1 }')).toStrictEqual([
      'DefineFunction',
      'g',
      ['Function', ['Typed', ['Block', ['Add', 'x', 1]], { str: 'real' }], 'x'],
    ]);
    expectRoundTrip('function g(x) -> real {x + 1}');
  });

  test('a typed-parameter block definition is unchanged', () => {
    expect(validCortex('function g2(x: integer) -> real { x }')).toStrictEqual([
      'DefineFunction',
      'g2',
      [
        'Function',
        ['Typed', ['Block', 'x'], { str: 'real' }],
        ['Typed', 'x', { str: 'integer' }],
      ],
    ]);
    expectRoundTrip('function g2(x: integer) -> real {x}');
  });

  test('a return-type-only math definition is unchanged', () => {
    expectRoundTrip('f(x) -> integer = x + 1');
  });

  test('a non-effect word after the parameter list still diagnoses today', () => {
    expect(diagnosticCodes('function f(x) bogus { x }')).toEqual([
      'opening-bracket-expected',
    ]);
  });

  test('a PARENTHESIZED effect-bearing return type is a grouped type, not a contract (ruled 2026-08-01)', () => {
    // `-> ((real) random -> real)` ascribes an effectful-arrow RETURN type:
    // the parens are the author's disambiguation, mirrored by the engine's
    // `isGroupedTypeText` gate. No specifier is emitted on round-trip.
    expectRoundTrip('function mk(x) -> ((real) random -> real) {x}');
    expect(validCortex('function mk(x) -> ((real) random -> real) { x }'))
      .toStrictEqual([
        'DefineFunction',
        'mk',
        [
          'Function',
          ['Typed', ['Block', 'x'], { str: '((real) random -> real)' }],
          'x',
        ],
      ]);
  });

  test('an EFFECT-FREE grouped return type is a grouped type too (ruled 2026-08-04)', () => {
    // The ungrouped ground arrow now declares the literal's OWN signature, so
    // grouping is what every "returns a function" return type rests on —
    // effect-free arrows exactly as effect-bearing ones. The parens survive
    // into the marker text and back out.
    expectRoundTrip('f(x) -> ((integer) -> integer) = g');
    expect(validCortex('f(x) -> ((integer) -> integer) = g')).toStrictEqual([
      'DefineFunction',
      'f',
      ['Function', ['Typed', 'g', { str: '((integer) -> integer)' }], 'x'],
    ]);
  });

  test('an UNGROUPED ground marker decomposes to its RESULT (ruled 2026-08-04)', () => {
    // `fnLiteralParts` decomposes an ungrouped ground marker just as it does an
    // effect-bearing one. The marker's argument list is a cosmetic MIRROR (the
    // literal's own operands are the parameters of record), so only the result
    // reaches the surface — and the re-parsed definition means the same thing.
    const def = [
      'Assign',
      'f',
      [
        'Function',
        ['Typed', ['Multiply', 2, 'x'], { str: '(x: number) -> number' }],
        'x',
      ],
    ] as MathJsonExpression;
    expect(serializeCortex(def)).toBe('f(x) -> number = 2x');
    expectRoundTrip('f(x) -> number = 2x');
    // Same arrow type on both sides of the round trip.
    const ce = new ComputeEngine();
    expect(ce.box(def[2] as MathJsonExpression).type.toString()).toBe(
      '(unknown) -> number'
    );
    expect(
      ce
        .box([
          'Function',
          ['Typed', ['Multiply', 2, 'x'], { str: 'number' }],
          'x',
        ] as MathJsonExpression)
        .type.toString()
    ).toBe('(unknown) -> number');
  });
});

describe('CORTEX EFFECTS — anonymous contract literals (option B, ruled 2026-08-01)', () => {
  // An anonymous literal carrying an effect CONTRACT has no lambda spelling
  // (the specifier slot exists only on the named definition forms). The
  // serializer keeps the contract as an explicit `Typed(body, "‹sig›")` call
  // inside the generic `Function(…)` form, which re-parses to the same
  // MathJSON — dropping it would silently weaken the literal.
  test('a specifier-carrying anonymous literal round-trips via explicit Typed(…)', () => {
    const lit = [
      'Function',
      ['Typed', 'x', { str: '(x: unknown) random -> real' }],
      'x',
    ] as MathJsonExpression;
    const out = serializeCortex(lit);
    expect(out).toBe('Function(Typed(x, "(x: unknown) random -> real"), x)');
    expect(validCortex(out)).toStrictEqual([
      'Function',
      ['Typed', 'x', { str: '(x: unknown) random -> real' }],
      'x',
    ]);
  });

  test('an EFFECT-FREE ground marker round-trips the same way (ruled 2026-08-04)', () => {
    // Widened from "effect-bearing" to "decomposed": an ungrouped ground arrow
    // is the literal's own signature too, and the anonymous mapsto can spell
    // none of it — not even the `-> ‹result›`. Dropping it was LOSSY whenever
    // the marker's result is NARROWER than the body's inferred type: `x + 1`
    // over a bare parameter infers `number` (finite-numeric widening), so
    // `(x) |-> x + 1` would have silently widened this literal's `integer`
    // return to `number`.
    const lit = [
      'Function',
      ['Typed', ['Add', 'x', 1], { str: '(x: integer) -> integer' }],
      'x',
    ] as MathJsonExpression;
    const ce = new ComputeEngine();
    expect(ce.box(lit).type.toString()).toBe('(unknown) -> integer');
    // …and the reading it would have degraded to.
    expect(
      ce.box(['Function', ['Add', 'x', 1], 'x'] as MathJsonExpression).type.toString()
    ).toBe('(unknown) -> number');

    const out = serializeCortex(lit);
    expect(out).toBe('Function(Typed(x + 1, "(x: integer) -> integer"), x)');
    expect(validCortex(out)).toStrictEqual(lit);
    // The round trip preserves the arrow, not just the shape.
    expect(ce.box(validCortex(out) as MathJsonExpression).type.toString()).toBe(
      '(unknown) -> integer'
    );
  });

  test('a GROUPED ground return type keeps the anonymous mapsto spelling', () => {
    // The negative arm of the same gate: a grouped marker does NOT decompose,
    // so it is an ordinary return-type ascription and is dropped, exactly as a
    // bare `-> real` is.
    expect(
      serializeCortex([
        'Function',
        ['Typed', ['Add', 'x', 1], { str: '((integer) -> integer)' }],
        'x',
      ] as MathJsonExpression)
    ).toBe('(x) |-> x + 1');
  });

  test('an effect-free ascription stays transparent', () => {
    expect(serializeCortex(['Typed', 'x', { str: 'real' }] as MathJsonExpression)).toBe('x');
  });

  test('a GROUPED effectful return-type ascription stays transparent', () => {
    expect(
      serializeCortex([
        'Typed',
        'x',
        { str: '((real) random -> real)' },
      ] as MathJsonExpression)
    ).toBe('x');
  });
});

describe('CORTEX EFFECTS — invalid specifier', () => {
  test('`pure` cannot be combined with another label', () => {
    // The type grammar rejects `pure random`; the specifier is diagnosed and
    // the definition falls back to the return-type-only ascription.
    const [expr, diagnostics] = parseCortex(
      'function f(x) pure random -> real { x }'
    );
    expect((diagnostics ?? []).map((d) => d.message[0])).toEqual([
      'type-annotation-error',
    ]);
    expect(String((diagnostics ?? [])[0].message[1])).toContain(
      '`pure` cannot be combined with other effect labels'
    );
    expect(JSON.stringify(expr)).toContain('"str":"real"');
  });
});

describe('CORTEX EFFECTS — end to end through the engine', () => {
  test('a declared effect set becomes the function’s type', () => {
    const ce = new ComputeEngine();
    const { diagnostics } = executeCortex(
      ce,
      'function roll(n) random -> integer {Random(Range(1, n))}\nroll(6)'
    );
    expect(diagnostics).toEqual([]);
    expect(ce.box('roll').type.toString()).toBe('(unknown) random -> integer');
  });

  test('an effects-only annotation leaves the return type inferred', () => {
    const ce = new ComputeEngine();
    const { diagnostics } = executeCortex(
      ce,
      'let count = 0\nfunction tick() scope {count = count + 1}'
    );
    expect(diagnostics).toEqual([]);
    expect(ce.box('tick').type.toString()).toContain('scope ->');
  });

  test('a violated effect contract is an `incompatible-type` error value', () => {
    const ce = new ComputeEngine();
    const { value } = executeCortex(
      ce,
      'function bad() pure -> integer {Random(Range(1, 6))}'
    );
    expect(value.toString()).toContain('incompatible-type');
    expect(value.toString()).toContain('pure effects');
    expect(value.toString()).toContain('random effects');
  });

  test('a violated contract in a non-final statement is a `runtime-error` diagnostic', () => {
    const ce = new ComputeEngine();
    const { diagnostics } = executeCortex(
      ce,
      'function bad() pure -> integer {Random(Range(1, 6))}\n1 + 1'
    );
    expect(diagnostics.map((d) => d.message[0])).toEqual(['runtime-error']);
    expect(String(diagnostics[0].message[1])).toContain('incompatible-type');
  });
});
