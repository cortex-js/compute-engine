import { engine as ce } from '../../utils';

/**
 * Geometry notation is transcribed as inert "shell" heads (Tier 3, #6 of the
 * parser-hardening plan): `\angle`/`\varangle`/`∠` → `Angle`, `\triangle` →
 * `Triangle`, `\square ABCD` → `Quadrilateral`, `\perp` → `Perpendicular`,
 * `\parallel` → `Parallel`, `\widehat` → `Arc`, `\overparen` → `OverParen`.
 * These heads have NO evaluation semantics — CE does not model geometry; the
 * faithful structural parse is for downstream graphical consumers. Parse
 * quality and round-trip serialization matter; evaluation does not.
 */

const json = (s: string) => ce.parse(s).json;
const latex = (s: string) => ce.parse(s).toLatex();
const isClean = (s: string) => {
  const e = ce.parse(s);
  return e.isValid && !JSON.stringify(e.json).includes('"Error"');
};

describe('Angle mark (\\angle / \\varangle / ∠)', () => {
  test('point-label run → separate operands (source order)', () => {
    expect(json('\\angle ABC')).toEqual(['Angle', 'A', 'B', 'C']);
    expect(json('\\angle BAC')).toEqual(['Angle', 'B', 'A', 'C']);
  });

  test('space-separated labels', () => {
    expect(json('\\angle A B C')).toEqual(['Angle', 'A', 'B', 'C']);
    expect(json('\\angle A O B')).toEqual(['Angle', 'A', 'O', 'B']);
  });

  test('single label', () => {
    expect(json('\\angle A')).toEqual(['Angle', 'A']);
  });

  test('subscripted / primed labels preserved in order', () => {
    expect(json('\\angle A_1C_1B_1')).toEqual([
      'Angle',
      'A_1',
      'C_1',
      'B_1',
    ]);
    expect(json("\\angle BA'C")).toEqual(['Angle', 'B', ['Prime', 'A'], 'C']);
  });

  test('expression fallback (not a plain letter run)', () => {
    // `\angle(\alpha, \beta)` — angle between two lines: wrap the single
    // following (parenthesized) expression rather than a letter run.
    expect(json('\\angle(\\alpha,\\beta)')).toEqual([
      'Angle',
      ['Tuple', 'alpha', 'beta'],
    ]);
  });

  test('\\varangle folds onto the Angle head', () => {
    expect(json('\\varangle X Y Z')).toEqual(['Angle', 'X', 'Y', 'Z']);
  });

  test('\\measuredangle and \\Varangle fold onto the Angle head', () => {
    expect(json('\\measuredangle O_1 O O_2')).toEqual([
      'Angle',
      'O_1',
      'O',
      'O_2',
    ]);
    expect(json('\\Varangle ACM')).toEqual(['Angle', 'A', 'C', 'M']);
  });

  test('Unicode ∠ (U+2220) is the same as \\angle', () => {
    expect(json('∠ABC')).toEqual(['Angle', 'A', 'B', 'C']);
  });

  test('Unicode ∡ (U+2221) is the same as \\measuredangle', () => {
    expect(json('∡ABC')).toEqual(['Angle', 'A', 'B', 'C']);
  });

  test('capture stops at relational operators', () => {
    expect(json('\\angle ABC = 90^\\circ')).toEqual([
      'Equal',
      ['Angle', 'A', 'B', 'C'],
      ['Multiply', ['Rational', 1, 2], 'Pi'],
    ]);
    expect(json('\\angle A C P=\\angle Q C B')).toEqual([
      'Equal',
      ['Angle', 'A', 'C', 'P'],
      ['Angle', 'Q', 'C', 'B'],
    ]);
  });

  test('angle measures compose in arithmetic (number-typed, stays symbolic)', () => {
    expect(isClean('\\angle ABC + \\angle APC = 180^\\circ')).toBe(true);
    expect(json('\\angle ABC + \\angle APC')).toEqual([
      'Add',
      ['Angle', 'A', 'B', 'C'],
      ['Angle', 'A', 'P', 'C'],
    ]);
  });

  test('m(\\angle A) — measure wrapper', () => {
    expect(isClean('m(\\angle A) = 60^\\circ')).toBe(true);
  });
});

describe('Triangle mark (\\triangle)', () => {
  test('point-label run → Triangle head', () => {
    expect(json('\\triangle ABC')).toEqual(['Triangle', 'A', 'B', 'C']);
    expect(json('\\triangle A B C')).toEqual(['Triangle', 'A', 'B', 'C']);
  });

  test('subscripted / primed labels', () => {
    expect(json('\\triangle A_1A_2A_3')).toEqual([
      'Triangle',
      'A_1',
      'A_2',
      'A_3',
    ]);
    expect(json("\\triangle DBC'")).toEqual([
      'Triangle',
      'D',
      'B',
      ['Prime', 'C'],
    ]);
  });

  test('infix \\triangle (SymmetricDifference) still available with a left operand', () => {
    // Set symmetric difference: `A \triangle B`.
    expect(ce.parse('X \\triangle Y').operator).toBe('SymmetricDifference');
  });
});

describe('Quadrilateral / \\square', () => {
  test('\\square ABCD → Quadrilateral', () => {
    expect(json('\\square ABCD')).toEqual([
      'Quadrilateral',
      'A',
      'B',
      'C',
      'D',
    ]);
  });

  test('bare \\square (placeholder / QED) → square symbol', () => {
    expect(json('\\square')).toEqual('square');
  });
});

describe('Perpendicular / Parallel relations', () => {
  test('\\perp is an infix relation (operands may be juxtaposition runs)', () => {
    expect(ce.parse('FG \\perp AO').operator).toBe('Perpendicular');
    expect(ce.parse('NK \\perp AB').operator).toBe('Perpendicular');
  });

  test('\\parallel → Parallel (not logical Or)', () => {
    expect(ce.parse('AB \\parallel CD').operator).toBe('Parallel');
    expect(isClean('AB \\parallel CD')).toBe(true);
  });

  test('\\perp with subgroup operand', () => {
    expect(isClean('\\alpha \\perp (SAB)')).toBe(true);
  });

  test('a trailing \\perp with no right operand does not throw', () => {
    expect(() => ce.parse('x \\perp')).not.toThrow();
  });
});

describe('Arc / over-paren accents', () => {
  test('\\widehat{ABC} → Arc (multi-letter spread)', () => {
    expect(json('\\widehat{ABC}')).toEqual(['Arc', 'A', 'B', 'C']);
    expect(json('\\widehat{A B Y}')).toEqual(['Arc', 'A', 'B', 'Y']);
    expect(json('\\widehat{EK}')).toEqual(['Arc', 'E', 'K']);
  });

  test('\\widehat{a} — single-letter argument (previously an error; now Arc)', () => {
    // Before this change `\widehat` was an unhandled command and produced an
    // Error node. It now parses to an inert `Arc` head.
    expect(json('\\widehat{a}')).toEqual(['Arc', 'a']);
  });

  test('arc measures compose in arithmetic', () => {
    expect(isClean('\\widehat{ABC} - \\widehat{ATD} = \\widehat{DAC}')).toBe(
      true
    );
  });

  test('\\overparen{BC} → OverParen', () => {
    expect(json('\\overparen{BC}')).toEqual(['OverParen', 'B', 'C']);
    expect(isClean('\\operatorname{arc}\\overparen{BC}')).toBe(true);
  });
});

describe('Round-trip serialization', () => {
  test('Angle serializes to \\angle and re-parses identically', () => {
    expect(latex('\\angle ABC')).toBe('\\angle ABC');
    expect(json('\\angle ABC')).toEqual(json(latex('\\angle ABC')));
  });

  test('Quadrilateral round-trips', () => {
    expect(latex('\\square ABCD')).toBe('\\square ABCD');
    expect(json('\\square ABCD')).toEqual(json(latex('\\square ABCD')));
  });

  test('Perpendicular / Parallel round-trip', () => {
    expect(ce.expr(['Perpendicular', 'A', 'B']).toLatex()).toBe(
      'A\\perp B'
    );
    expect(ce.expr(['Parallel', 'A', 'B']).toLatex()).toBe('A\\parallel B');
  });

  test('Arc / OverParen round-trip', () => {
    expect(latex('\\widehat{ABC}')).toBe('\\widehat{ABC}');
    expect(latex('\\overparen{BC}')).toBe('\\overparen{BC}');
    expect(json('\\widehat{ABC}')).toEqual(json(latex('\\widehat{ABC}')));
  });
});

describe('Inertness — geometry heads never reduce', () => {
  test('evaluate() returns the expression unchanged', () => {
    for (const e of [
      ['Angle', 'A', 'B', 'C'],
      ['Triangle', 'A', 'B', 'C'],
      ['Quadrilateral', 'A', 'B', 'C', 'D'],
      ['Perpendicular', 'A', 'B'],
      ['Parallel', 'A', 'B'],
      ['Arc', 'A', 'B', 'C'],
      ['OverParen', 'B', 'C'],
    ] as const) {
      const boxed = ce.expr(e as any);
      expect(boxed.evaluate().json).toEqual(boxed.json);
    }
  });
});

describe('Similarity relation (\\sim / \\nsim / \\simeq)', () => {
  test('triangle similarity', () => {
    expect(json('\\triangle ABC \\sim \\triangle DEF')).toEqual([
      'Tilde',
      ['Triangle', 'A', 'B', 'C'],
      ['Triangle', 'D', 'E', 'F'],
    ]);
  });

  test('\\sim is a generic inert relation', () => {
    expect(json('a \\sim b')).toEqual(['Tilde', 'a', 'b']);
    // "is distributed as"
    expect(isClean('X \\sim N(0,1)')).toBe(true);
    // chained relation
    expect(json('a \\sim b \\sim c')).toEqual(['Tilde', 'a', 'b', 'c']);
    // inert: evaluation returns the expression unchanged
    const boxed = ce.expr(['Tilde', 'a', 'b']);
    expect(boxed.evaluate().json).toEqual(boxed.json);
  });

  test('\\nsim negates, \\simeq maps to TildeEqual', () => {
    expect(json('a \\nsim b')).toEqual(['Not', ['Tilde', 'a', 'b']]);
    expect(json('a \\simeq b')).toEqual(['TildeEqual', 'a', 'b']);
  });

  test('round-trip', () => {
    expect(latex('a \\sim b')).toEqual('a\\sim b');
  });
});
