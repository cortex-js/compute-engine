import { ComputeEngine } from '../../src/compute-engine';
import { Expression } from '../../src/math-json/types.ts';
import { engine, exprToString } from '../utils';
import { isDictionary } from '../../src/compute-engine/boxed-expression/utils';
import { dictionaryFromExpression } from '../../src/math-json/utils';

function evaluate(expr: Expression) {
  return exprToString(
    engine.expr(expr)?.evaluate().toMathJson({ shorthands: [] })
  );
}

function box(expr: Expression) {
  return engine.expr(expr);
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
      ).toMatchInlineSnapshot(`
        {
          dict: {
            list1: {fn: ["List", {num: "1"}, {num: "2"}, {num: "3"}]};
              list2: {fn: ["List", {sym: "a"}, {sym: "b"}, {sym: "c"}]}
          }
        }
      `);
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
      ).toMatchInlineSnapshot(`
        {
          dict: {
            list: {fn: ["List", {num: "1"}, {num: "2"}, {num: "3"}]};
              items: {fn: ["List", {str: "a"}, {str: "b"}, {str: "c"}]}
          }
        }
      `);
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
              list: {fn: ["List", {num: "1"}, {num: "2"}, {num: "3"}]}
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
        // Keys are string literals (`{ str: 'x' }`), so they serialize as the
        // quoted MathJSON string form `'x'` (not the bare `x`, which would
        // re-box as a symbol — see REVIEW.md G6).
        expect(items).toEqual([
          ['Tuple', "'x'", 120],
          ['Tuple', "'y'", 36],
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

// REVIEW.md C8: dictionaryFromExpression looped from index 1 over the 0-based,
// head-stripped operands (dropping the first entry) and returned an unwrapped
// shape for the KeyValuePair branch.
describe('dictionaryFromExpression (REVIEW.md C8)', () => {
  it('keeps the first entry of a Dictionary expression', () => {
    const d = dictionaryFromExpression([
      'Dictionary',
      ['Tuple', { str: 'a' }, 1],
      ['Tuple', { str: 'b' }, 2],
    ] as any);
    expect(d).toEqual({ dict: { a: 1, b: 2 } });
  });
  it('wraps the KeyValuePair branch in a { dict } object', () => {
    const d = dictionaryFromExpression(['Tuple', { str: 'k' }, 9] as any);
    expect(d).toEqual({ dict: { k: 9 } });
  });
});

describe('Dictionary key access via At', () => {
  const dict: Expression = { dict: { height: 42, width: 7 } } as any;

  it('reads a value by string key', () => {
    expect(box(['At', dict, { str: 'height' }] as any).evaluate().valueOf()).toBe(
      42
    );
  });

  it('returns Nothing for a missing key', () => {
    expect(box(['At', dict, { str: 'depth' }] as any).evaluate().symbol).toBe(
      'Nothing'
    );
  });

  it('leaves a non-string index unevaluated (string keys only)', () => {
    expect(box(['At', dict, 2] as any).evaluate().operator).toBe('At');
  });

  it('parses bracket key-access LaTeX to At', () => {
    // CE strings are `\text{…}`; the postfix `[` accepts a string key.
    const ce = new ComputeEngine();
    const data = ce.box(dict);
    ce.declare('data', data.type);
    ce.assign('data', data);
    expect(ce.parse('\\mathrm{data}[\\text{height}]', { form: 'raw' }).json).toEqual(
      ['At', 'data', "'height'"]
    );
    expect(
      ce.parse('\\mathrm{data}[\\text{width}]').evaluate().valueOf()
    ).toBe(7);
  });

  it('still indexes an indexed collection positionally', () => {
    expect(box(['At', ['List', 7, 13, 5], 1] as any).evaluate().valueOf()).toBe(
      7
    );
  });
});

describe('Dictionary structural equality (RT-P1-2)', () => {
  const d = (...pairs: [string, Expression][]) =>
    box(['Dictionary', ...pairs.map(([k, v]) => ['Tuple', { str: k }, v])]);

  test('equal dictionaries are isSame (same order)', () => {
    expect(d(['a', 1], ['b', 2]).isSame(d(['a', 1], ['b', 2]))).toBe(true);
  });

  test('equal dictionaries are isSame regardless of key order', () => {
    // A dictionary is a keyed collection; entry order is not significant.
    expect(d(['a', 1], ['b', 2]).isSame(d(['b', 2], ['a', 1]))).toBe(true);
  });

  test('a differing value makes them not isSame', () => {
    expect(d(['a', 1], ['b', 2]).isSame(d(['a', 1], ['b', 99]))).toBe(false);
  });

  test('a differing key makes them not isSame', () => {
    expect(d(['a', 1], ['b', 2]).isSame(d(['a', 1], ['c', 2]))).toBe(false);
  });

  test('a differing key count makes them not isSame', () => {
    expect(d(['a', 1], ['b', 2]).isSame(d(['a', 1]))).toBe(false);
  });

  test('a dictionary is not isSame as a non-dictionary (both directions)', () => {
    const dict = d(['a', 1]);
    expect(dict.isSame(box(1))).toBe(false);
    expect(box(1).isSame(dict)).toBe(false);
  });

  test('nested dictionaries compare by structure', () => {
    const nested = (leaf: Expression) =>
      d(['x', box(['Dictionary', ['Tuple', { str: 'y' }, leaf]])]);
    expect(nested(5).isSame(nested(5))).toBe(true);
    expect(nested(5).isSame(nested(6))).toBe(false);
  });

  test('isEqual agrees with isSame for dictionaries', () => {
    expect(d(['a', 1], ['b', 2]).isEqual(d(['a', 1], ['b', 2]))).toBe(true);
    expect(d(['a', 1], ['b', 2]).isEqual(d(['a', 1], ['b', 99]))).toBe(false);
  });

  test('.json round-trips for a dictionary', () => {
    const dict = d(['a', 1], ['b', 2]);
    expect(engine.expr(dict.json).isSame(dict)).toBe(true);
  });
});

// Serialization must never re-enter the public `toMathJson()` boundary from
// inside the serializer: `serializeJson()` used to route every
// dictionary-*typed* expression (including symbols merely typed or valued
// `dictionary`) back through `expr.toMathJson()`, which recursed forever and
// re-tripped the digits/fractionalDigits deprecation warning on each pass
// (Tycho 0.72.0 report: warning flood + stack overflow).
describe('Dictionary serialization boundary (Tycho 0.72.0 report)', () => {
  let ce: ComputeEngine;
  beforeAll(() => {
    ce = new ComputeEngine();
  });

  test('toMathJson() with no options resolves defaults', () => {
    const dict = box(['Dictionary', ['Tuple', { str: 'a' }, 1]]);
    expect(dict.toMathJson()).toEqual({ dict: { a: 1 } });
  });

  test('entry values serialize through the internal serializer, without deprecation warnings', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      const dict = box([
        'Dictionary',
        ['Tuple', { str: 'a' }, 1],
        ['Tuple', { str: 'b' }, ['Add', 'x', 1]],
      ]);
      expect(dict.toMathJson({ shorthands: [] })).toEqual({
        dict: {
          a: { num: '1' },
          b: { fn: ['Add', { sym: 'x' }, { num: '1' }] },
        },
      });
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test('a symbol bound to a dictionary value serializes as a symbol', () => {
    const spy = jest.spyOn(console, 'warn').mockImplementation(() => {});
    try {
      ce.assign(
        'dictValProbe',
        ce.box(['Dictionary', ['Tuple', { str: 'a' }, 1]])
      );
      // Previously: infinite recursion + a deprecation warning per pass.
      expect(ce.box('dictValProbe').toMathJson()).toEqual('dictValProbe');
      expect(ce.box('dictValProbe').latex).toEqual('\\mathrm{dictValProbe}');
      expect(spy).not.toHaveBeenCalled();
    } finally {
      spy.mockRestore();
    }
  });

  test('a dictionary-typed symbol with no value serializes as a symbol', () => {
    ce.declare('dictTypeProbe', 'dictionary');
    expect(ce.box('dictTypeProbe').toMathJson()).toEqual('dictTypeProbe');
    expect(ce.box('dictTypeProbe').latex).toEqual('\\mathrm{dictTypeProbe}');
  });
});
