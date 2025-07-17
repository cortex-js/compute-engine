import { Expression } from '../../src/math-json/types.ts';
import { engine, exprToString } from '../utils';
import { isDictionary } from '../../src/compute-engine/boxed-expression/utils';

function evaluate(expr: Expression) {
  return exprToString(
    engine.box(expr)?.evaluate().toMathJson({ shorthands: [] })
  );
}

function box(expr: Expression) {
  return engine.box(expr);
}

describe('Dictionary', () => {
  describe('Dictionary expressions', () => {
    test('empty dictionary', () => {
      expect(evaluate(['Dictionary'])).toMatchInlineSnapshot(`{dict: {}}`);
    });

    test('simple dictionary with string keys', () => {
      expect(
        evaluate([
          'Dictionary',
          ['Tuple', { str: 'x' }, 120],
          ['Tuple', { str: 'y' }, 36],
        ])
      ).toMatchInlineSnapshot(`{dict: {x: {num: "120"}; y: {num: "36"}}}`);
    });

    test('dictionary with symbol keys', () => {
      expect(
        evaluate([
          'Dictionary',
          ['Tuple', { sym: 'alpha' }, 1],
          ['Tuple', { sym: 'beta' }, 2],
        ])
      ).toMatchInlineSnapshot(`{dict: {alpha: {num: "1"}; beta: {num: "2"}}}`);
    });

    test('dictionary with mixed value types', () => {
      expect(
        evaluate([
          'Dictionary',
          ['Tuple', { str: 'number' }, 42],
          ['Tuple', { str: 'string' }, { str: 'hello' }],
          ['Tuple', { str: 'boolean' }, { sym: 'True' }],
          ['Tuple', { str: 'expression' }, { fn: ['Add', 'x', 1] }],
        ])
      ).toMatchInlineSnapshot(`
        {
          dict: {
            number: {num: "42"};
              string: {str: "hello"};
              boolean: {sym: "True"};
              expression: {fn: ["Add", {sym: "x"}, {num: "1"}]}
          }
        }
      `);
    });

    test('dictionary with list values', () => {
      expect(
        evaluate([
          'Dictionary',
          ['Tuple', { str: 'list1' }, ['List', 1, 2, 3]],
          ['Tuple', { str: 'list2' }, ['List', 'a', 'b', 'c']],
        ])
      ).toMatchInlineSnapshot(
        `{dict: {list1: ["List", 1, 2, 3]; list2: ["List", "a", "b", "c"]}}`
      );
    });

    test('nested dictionaries', () => {
      expect(
        evaluate([
          'Dictionary',
          [
            'Tuple',
            { str: 'outer' },
            ['Dictionary', ['Tuple', { str: 'inner' }, 'nested']],
          ],
        ])
      ).toMatchInlineSnapshot(
        `{dict: {outer: {dict: {inner: {sym: "nested"}}}}}`
      );
    });
  });

  describe('Dictionary shorthand', () => {
    test('empty dictionary shorthand', () => {
      expect(evaluate({ dict: {} })).toMatchInlineSnapshot(`{dict: {}}`);
    });

    test('simple dictionary shorthand', () => {
      expect(evaluate({ dict: { x: 1, y: 2, z: 3 } })).toMatchInlineSnapshot(
        `{dict: {x: {num: "1"}; y: {num: "2"}; z: {num: "3"}}}`
      );
    });

    test('dictionary shorthand with string values', () => {
      expect(
        evaluate({
          dict: { title: 'My Dictionary', description: 'A test dictionary' },
        })
      ).toMatchInlineSnapshot(`
        {
          dict: {
            title: {str: "My Dictionary"};
              description: {str: "A test dictionary"}
          }
        }
      `);
    });

    test('dictionary shorthand with boolean values', () => {
      expect(
        evaluate({ dict: { enabled: true, visible: false } })
      ).toMatchInlineSnapshot(
        `{dict: {enabled: {sym: "True"}; visible: {sym: "False"}}}`
      );
    });

    test('dictionary shorthand with array values', () => {
      expect(
        evaluate({ dict: { list: [1, 2, 3], items: ['a', 'b', 'c'] } })
      ).toMatchInlineSnapshot(
        `{dict: {list: ["List", 1, 2, 3]; items: ["List", "a", "b", "c"]}}`
      );
    });

    test('dictionary shorthand with mixed types', () => {
      expect(
        evaluate({
          dict: {
            number: 42,
            string: 'hello',
            boolean: true,
            list: [1, 2, 3],
          },
        })
      ).toMatchInlineSnapshot(`
        {
          dict: {
            number: {num: "42"};
              string: {str: "hello"};
              boolean: {sym: "True"};
              list: ["List", 1, 2, 3]
          }
        }
      `);
    });

    test('dictionary shorthand with sym values', () => {
      expect(
        evaluate({ dict: { x: { sym: 'alpha' }, y: { sym: 'beta' } } })
      ).toMatchInlineSnapshot(`{dict: {x: {sym: "alpha"}; y: {sym: "beta"}}}`);
    });

    test('dictionary shorthand with fn values', () => {
      expect(
        evaluate({
          dict: {
            add: { fn: ['Add', 'x', 1] },
            multiply: { fn: ['Multiply', 'x', 2] },
          },
        })
      ).toMatchInlineSnapshot(`
        {
          dict: {
            add: {fn: ["Add", {sym: "x"}, {num: "1"}]};
              multiply: {fn: ["Multiply", {num: "2"}, {sym: "x"}]}
          }
        }
      `);
    });
  });

  describe('Key-value pair handling', () => {
    test('single key-value pair as tuple', () => {
      expect(
        evaluate(['Tuple', { str: 'key' }, 'value'])
      ).toMatchInlineSnapshot(`{fn: ["Pair", {str: "key"}, {sym: "value"}]}`);
    });

    test('accessing dictionary values', () => {
      const dict = box([
        'Dictionary',
        ['Tuple', { str: 'x' }, 120],
        ['Tuple', { str: 'y' }, 36],
      ]);

      if (isDictionary(dict)) {
        expect(dict.get('x')).toMatchInlineSnapshot(`120`);
        expect(dict.get('y')).toMatchInlineSnapshot(`36`);
        expect(dict.get('z')).toMatchInlineSnapshot(`undefined`);
      }
    });

    test('dictionary has method', () => {
      const dict = box([
        'Dictionary',
        ['Tuple', { str: 'x' }, 120],
        ['Tuple', { str: 'y' }, 36],
      ]);

      if (isDictionary(dict)) {
        expect(dict.has('x')).toBe(true);
        expect(dict.has('y')).toBe(true);
        expect(dict.has('z')).toBe(false);
      }
    });

    test('dictionary keys', () => {
      const dict = box([
        'Dictionary',
        ['Tuple', { str: 'x' }, 120],
        ['Tuple', { str: 'y' }, 36],
      ]);

      if (isDictionary(dict)) {
        expect(dict.keys).toEqual(['x', 'y']);
      }
    });

    test('dictionary values', () => {
      const dict = box([
        'Dictionary',
        ['Tuple', { str: 'x' }, 120],
        ['Tuple', { str: 'y' }, 36],
      ]);

      if (isDictionary(dict)) {
        const values = dict.values.map((v: any) => v.json);
        expect(values).toEqual([120, 36]);
      }
    });

    test('dictionary entries', () => {
      const dict = box([
        'Dictionary',
        ['Tuple', { str: 'x' }, 120],
        ['Tuple', { str: 'y' }, 36],
      ]);

      if (isDictionary(dict)) {
        const entries = dict.entries.map(([k, v]: [string, any]) => [
          k,
          v.json,
        ]);
        expect(entries).toEqual([
          ['x', 120],
          ['y', 36],
        ]);
      }
    });

    test('dictionary count', () => {
      const dict = box([
        'Dictionary',
        ['Tuple', { str: 'x' }, 120],
        ['Tuple', { str: 'y' }, 36],
      ]);

      if (isDictionary(dict)) {
        expect(dict.count).toBe(2);
      }
    });

    test('empty dictionary count', () => {
      const dict = box(['Dictionary']);
      if (isDictionary(dict)) {
        expect(dict.count).toBe(0);
      }
    });
  });

  describe('Unicode key normalization', () => {
    test('unicode keys are normalized', () => {
      // Test with different Unicode representations of the same character
      const dict1 = box([
        'Dictionary',
        ['Tuple', { str: 'é' }, 1], // U+00E9 (composed)
      ]);

      const dict2 = box([
        'Dictionary',
        ['Tuple', { str: 'é' }, 2], // U+0065 U+0301 (decomposed)
      ]);

      // Both should have the same normalized key
      if (isDictionary(dict1) && isDictionary(dict2)) {
        expect(dict1.keys).toEqual(['é']);
        expect(dict2.keys).toEqual(['é']);
      }
    });

    test('unicode keys in shorthand', () => {
      const dict = box({ dict: { naïve: 'value', café: 'coffee' } });

      if (isDictionary(dict)) {
        expect(dict.keys.sort()).toEqual(['café', 'naïve']);
        expect(dict.get('naïve')).toMatchInlineSnapshot(`'value'`);
        expect(dict.get('café')).toMatchInlineSnapshot(`'coffee'`);
      }
    });

    // @todo: should add non-NFC forms to the test suite i.e. café vs. café
    test('complex unicode keys', () => {
      const dict = box([
        'Dictionary',
        ['Tuple', { str: '🔑' }, 'key'],
        ['Tuple', { str: '🎯' }, 'target'],
        ['Tuple', { str: '中文' }, 'chinese'],
      ]);

      if (isDictionary(dict)) {
        expect(dict.get('🔑')).toMatchInlineSnapshot(`key`);
        expect(dict.get('🎯')).toMatchInlineSnapshot(`target`);
        expect(dict.get('中文')).toMatchInlineSnapshot(`chinese`);
      }
    });
  });

  describe('Dictionary operations and properties', () => {
    test('dictionary is collection', () => {
      const dict = box(['Dictionary', ['Tuple', { str: 'x' }, 120]]);

      if (isDictionary(dict)) {
        expect(dict.isCollection).toBe(true);
        expect(dict.isIndexedCollection).toBe(false);
        expect(dict.isLazyCollection).toBe(false);
        expect(dict.isFiniteCollection).toBe(true);
      }
    });

    test('empty dictionary properties', () => {
      const dict = box(['Dictionary']);

      if (isDictionary(dict)) {
        expect(dict.isEmptyCollection).toBe(true);
        expect(dict.count).toBe(0);
      }
    });

    test('non-empty dictionary properties', () => {
      const dict = box(['Dictionary', ['Tuple', { str: 'x' }, 120]]);

      if (isDictionary(dict)) {
        expect(dict.isEmptyCollection).toBe(false);
        expect(dict.count).toBe(1);
      }
    });

    test('dictionary iteration', () => {
      const dict = box([
        'Dictionary',
        ['Tuple', { str: 'x' }, 120],
        ['Tuple', { str: 'y' }, 36],
      ]);

      if (isDictionary(dict)) {
        const items = Array.from(dict.each()).map((item: any) => item.json);
        expect(items).toEqual([
          ['Tuple', 'x', 120],
          ['Tuple', 'y', 36],
        ]);
      }
    });

    test('dictionary complexity', () => {
      const dict = box(['Dictionary', ['Tuple', { str: 'x' }, 120]]);

      if (isDictionary(dict)) {
        expect(dict.complexity).toBe(1000);
      }
    });

    test('dictionary is pure', () => {
      const dict = box(['Dictionary', ['Tuple', { str: 'x' }, 120]]);

      if (isDictionary(dict)) {
        expect(dict.isPure).toBe(true);
      }
    });

    test('dictionary is canonical', () => {
      const dict = box(['Dictionary', ['Tuple', { str: 'x' }, 120]]);

      if (isDictionary(dict)) {
        expect(dict.isCanonical).toBe(true);
      }
    });

    test('dictionary value property', () => {
      const dict = box(['Dictionary', ['Tuple', { str: 'x' }, 120]]);

      if (isDictionary(dict)) {
        expect(dict.value).toBeUndefined();
      }
    });
  });

  describe('Error handling', () => {
    test.skip('invalid key type in tuple', () => {
      expect(() =>
        evaluate([
          'Dictionary',
          ['Tuple', 123, 'value'], // numeric key should fail
        ])
      ).toThrow();
    }); // @fixme

    test.skip('empty string key', () => {
      expect(() =>
        evaluate([
          'Dictionary',
          ['Tuple', { str: '' }, 'value'], // empty string key should fail
        ])
      ).toThrow();
    }); // @fixme

    test('malformed tuple', () => {
      expect(() =>
        evaluate([
          'Dictionary',
          ['Tuple', { str: 'key' }], // missing value
        ])
      ).toThrow();
    });

    test.skip('too many elements in tuple', () => {
      expect(() =>
        evaluate([
          'Dictionary',
          ['Tuple', { str: 'key' }, 'value', 'extra'], // too many elements
        ])
      ).toThrow();
    }); // @fixme

    test('invalid tuple element', () => {
      expect(() =>
        evaluate([
          'Dictionary',
          ['NotATuple', { str: 'key' }, 'value'], // invalid pair type
        ])
      ).toThrow();
    });
  });
});
