// import { expression, latex } from './utils';

import { Substitution } from '../../src/compute-engine';
import { Expression } from '../../src/math-json';
import { engine } from '../utils';

function match(expr: Expression, pattern: Expression): Substitution | null {
  return engine.pattern(pattern).match(engine.box(expr));
}

describe('PATTERNS  MATCH', () => {
  test('Universal wildcard', () => {
    const pattern: Expression = ['Add', 1, '_'];
    expect(match(['Add', 1, 2], pattern)).toMatchInlineSnapshot(`null`);
    // Commutative
    expect(match(['Add', 2, 1], pattern)).toMatchInlineSnapshot(`null`);
    expect(match(['Add', 2, 1, 3], pattern)).toMatchInlineSnapshot(`null`);
    // Associative
    expect(match(['Add', 1, ['Add', 2, 3]], pattern)).toMatchInlineSnapshot(
      `null`
    );
  });

  test('Named wildcard', () => {
    const pattern: Expression = ['Add', 1, '_a'];
    expect(match(['Add', 1, 2], pattern)).toMatchInlineSnapshot(`null`);
    // Commutative
    expect(match(['Add', 2, 1], pattern)).toMatchInlineSnapshot(`null`);
    expect(match(['Add', 2, 1, 3], pattern)).toMatchInlineSnapshot(`null`);
    // Associative
    expect(match(['Add', 1, ['Add', 2, 3]], pattern)).toMatchInlineSnapshot(
      `null`
    );
  });

  test('Sequence wildcard', () => {
    expect(match(['Add', 1, 2, 3, 4], ['Add', 1, '__a'])).toMatchInlineSnapshot(
      `null`
    );
    expect(
      match(['Add', 1, 2, 3, 4], ['Add', 1, '__a', 4])
    ).toMatchInlineSnapshot(`null`);
    expect(
      match(['Add', 1, 2, 3, 4], ['Add', 2, '__a', 3])
    ).toMatchInlineSnapshot(`null`);
    expect(
      match(['Add', 1, 2, 3, 4, 5], ['Add', 1, 2, '__a', 4, 5])
    ).toMatchInlineSnapshot(`null`);
    expect(
      match(['Add', 1, 2, 4, 5], ['Add', 1, 2, '__a', 4, 5])
    ).toMatchInlineSnapshot(`null`);
  });
});
