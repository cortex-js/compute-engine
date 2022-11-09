// import { expression, latex } from './utils';

import { Pattern, Substitution } from '../../src/compute-engine';
import { Expression } from '../../src/math-json';
import { engine } from '../utils';

function pattern(p: Expression) {
  return engine.pattern(p);
}

function match(pattern: Pattern, expr: Expression): Substitution | null {
  const result = pattern.match(engine.box(expr));
  if (result === null) return null;
  const r = {};
  for (const key of Object.keys(result)) r[key] = result[key].toString();
  return r;
}

describe('PATTERNS  MATCH - Universal wildcard', () => {
  const pattern = engine.pattern(['Add', 1, '_']);
  test('Simple match', () =>
    expect(match(pattern, ['Add', 1, 2])).toMatchInlineSnapshot(`{}`));
  test('Commutative', () =>
    expect(match(pattern, ['Add', 2, 1])).toMatchInlineSnapshot(`{}`));
  test('Commutative, multiple ops', () =>
    expect(match(pattern, ['Add', 2, 1, 3])).toMatchInlineSnapshot(`null`)); // @fixme
  // Associative
  test('Associative', () =>
    expect(match(pattern, ['Add', 1, ['Add', 2, 3]])).toMatchInlineSnapshot(
      `null`
    )); // @fixme
});

describe('PATTERNS  MATCH - Named wildcard', () => {
  const pattern = engine.pattern(['Add', 1, '_a']);
  test('Commutative wildcards', () => {
    expect(match(pattern, ['Add', 1, 2])).toMatchInlineSnapshot(`{_a: "2"}`);
    // Commutative
    expect(match(pattern, ['Add', 2, 1])).toMatchInlineSnapshot(`{_a: "2"}`);
  });
  test('Associative wildcards', () => {
    expect(match(pattern, ['Add', 2, 1, 3])).toMatchInlineSnapshot(`null`); // @fixme
    expect(match(pattern, ['Add', 1, ['Add', 2, 3]])).toMatchInlineSnapshot(
      `null`
    ); // @fixme
  });
});

describe('PATTERNS  MATCH - Sequence wildcard', () => {
  test('Sequence wildcard', () => {
    expect(
      pattern(['Add', 1, '__a']).match(engine.box(['Add', 1, 2, 3, 4]))
    ).toMatchInlineSnapshot(`null`); // @fixme should be [2, 3, 4]
    expect(
      pattern(['Add', 1, '__a', 4]).match(engine.box(['Add', 1, 2, 3, 4]))
    ).toMatchInlineSnapshot(`null`); // @fixme should be [2,3]
    expect(
      pattern(['Add', 1, 2, '__a', 3]).match(engine.box(['Add', 1, 2, 3]))
    ).toMatchInlineSnapshot(`null`); // @fixme should be []
    expect(
      pattern(['Add', 1, 2, '__a', 4]).match(engine.box(['Add', 1, 2, 3, 4]))
    ).toMatchInlineSnapshot(`{__a: 3}`); // @fixme should be [3]
    expect(
      pattern(['Add', 1, 2, '__a', 3]).match(engine.box(['Add', 1, 2, 3]))
    ).toMatchInlineSnapshot(`null`); // @fixme should be []
  });
});
