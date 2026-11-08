import { ComputeEngine } from '../../src/compute-engine';
import type { Expression } from '../../src/compute-engine/global-types';

//
// The latent effects of an inline function literal (what fires when an
// operator applies it) are the effects on its arrow. When the type of the
// literal is not in its cache, `_literalArrowEffects()` computes these
// effects alone, without the types of the parameters and of the body, which
// cost more: a definite integral boxes a new literal for `EvaluateAt` at each
// evaluation. These tests read the effects alone first, on a new literal,
// and then compare them with the effects of the full type of the same
// literal: the two must be the same set.
//

/** With `CE_EFFECTS_PARANOID` set, `_literalArrowEffects()` also reads the
 * type, to compare the two sets. */
const PARANOID =
  process.env.CE_EFFECTS_PARANOID !== undefined &&
  process.env.CE_EFFECTS_PARANOID !== '0';

/** The effects of `literal` computed alone, then those of its type. The
 * type cache records the generation of each computation of the type
 * (`_typeGeneration`): it does not change during the first read, so that
 * read computed the effects without the type. */
function bothEffects(literal: Expression): [unknown, unknown] {
  const typeGeneration = (literal as any)._typeGeneration;
  const alone = literal._literalArrowEffects!();
  if (!PARANOID)
    expect((literal as any)._typeGeneration).toBe(typeGeneration);
  return [alone, literal.type.effects];
}

describe('CE-351: the effects of a function literal without its type', () => {
  const cases: [string, unknown, unknown][] = [
    ['a pure body', ['Function', ['Add', 'x', 1], 'x'], undefined],
    ['a body that draws', ['Function', ['Add', 'x', ['Random']], 'x'], ['random']],
    [
      'a nested literal that draws, applied in the body',
      [
        'Function',
        ['Apply', ['Function', ['Multiply', 'y', ['Random']], 'y'], 'x'],
        'x',
      ],
      ['random'],
    ],
    [
      'a stated `pure` contract',
      ['Function', ['Typed', ['Add', 'x', 1], "'(real) pure -> real'"], 'x'],
      [],
    ],
    [
      'a stated `random` contract on a pure body',
      ['Function', ['Typed', ['Add', 'x', 1], "'(real) random -> real'"], 'x'],
      ['random'],
    ],
    ['no parameter', ['Function', ['Random']], ['random']],
  ];

  test.each(cases)('%s', (_name, json, expected) => {
    const ce = new ComputeEngine();
    const literal = ce.expr(json as any);
    const [alone, fromType] = bothEffects(literal);
    expect(alone).toEqual(fromType);
    expect(alone).toEqual(expected);
  });

  test('a write to a variable outside the literal', () => {
    const ce = new ComputeEngine();
    ce.declare('counter', 'integer');
    ce.assign('counter', 0);
    const literal = ce.expr([
      'Function',
      ['Assign', 'counter', ['Add', 'counter', 'x']],
      'x',
    ]);
    const [alone, fromType] = bothEffects(literal);
    expect(alone).toEqual(fromType);
    expect(alone).not.toBeUndefined();
  });

  test('an operator that applies the literal has its latent effects', () => {
    const ce = new ComputeEngine();
    const drawing = ce.expr([
      'Map',
      ['Function', ['Add', 'x', ['Random']], 'x'],
      ['List', 1, 2],
    ]);
    expect(drawing.isPure).toBe(false);
    const pure = ce.expr([
      'Map',
      ['Function', ['Add', 'x', 1], 'x'],
      ['List', 1, 2],
    ]);
    expect(pure.isPure).toBe(true);
  });

  test('a definite integral is pure and keeps its value', () => {
    const ce = new ComputeEngine();
    const integral = ce.expr([
      'Integrate',
      ['Divide', 1, 'x'],
      ['Limits', 'x', 1, 2],
    ]);
    expect(integral.isPure).toBe(true);
    expect(integral.evaluate().json).toEqual(['Ln', 2]);
  });
});
