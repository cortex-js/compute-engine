// import { expression, latex } from './utils';

import { Pattern, Substitution } from '../../src/compute-engine';
import { Expression } from '../../src/math-json';
import { engine } from '../utils';

function pattern(p: Expression) {
  return engine.pattern(p);
}

function match(pattern: Pattern, expr: Expression): Substitution | null {
  return pattern.match(engine.box(expr));
}

describe('PATTERNS  MATCH - Universal wildcard', () => {
  const pattern = engine.pattern(['Add', 1, '_']);
  test('Simple match', () =>
    expect(match(pattern, ['Add', 1, 2])).toMatchInlineSnapshot(`null`));
  test('Commutative', () =>
    expect(match(pattern, ['Add', 2, 1])).toMatchInlineSnapshot(`null`));
  test('Commutative, multiple ops', () =>
    expect(match(pattern, ['Add', 2, 1, 3])).toMatchInlineSnapshot(`null`));
  // Associative
  test('Associative', () =>
    expect(match(pattern, ['Add', 1, ['Add', 2, 3]])).toMatchInlineSnapshot(
      `null`
    ));
});

describe('PATTERNS  MATCH - Named wildcard', () => {
  const pattern = engine.pattern(['Add', 1, '_a']);
  test('Named wildcard', () => {
    expect(match(pattern, ['Add', 1, 2])).toMatchInlineSnapshot(`null`);
    // Commutative
    expect(match(pattern, ['Add', 2, 1])).toMatchInlineSnapshot(`null`);
    expect(match(pattern, ['Add', 2, 1, 3])).toMatchInlineSnapshot(`null`);
    // Associative
    expect(match(pattern, ['Add', 1, ['Add', 2, 3]])).toMatchInlineSnapshot(
      `null`
    );
  });
});

describe('PATTERNS  MATCH - Sequence wildcard', () => {
  test('Sequence wildcard', () => {
    expect(
      pattern(['Add', 1, '__a']).match(engine.box(['Add', 1, 2, 3, 4]))
    ).toMatchInlineSnapshot(`null`);
    expect(
      pattern(['Add', 1, '__a', 4]).match(engine.box(['Add', 1, 2, 3, 4]))
    ).toMatchInlineSnapshot(`null`);
    expect(
      pattern(['Add', 1, 2, '__a', 3]).match(engine.box(['Add', 1, 2, 3]))
    ).toMatchInlineSnapshot(`null`);
    expect(
      pattern(['Add', 1, 2, '__a', 4]).match(engine.box(['Add', 1, 2, 3, 4]))
    ).toMatchInlineSnapshot(`null`);
    expect(
      pattern(['Add', 1, 2, '__a', 3]).match(engine.box(['Add', 1, 2, 3]))
    ).toMatchInlineSnapshot(`null`);
  });
});
