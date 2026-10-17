/**
 * The load order of the `libraries` constructor option, and the derivative of
 * an operator that a caller library defines (GitHub issue #393).
 */
import { ComputeEngine } from '../../src/compute-engine';
import { sortLibraries } from '../../src/compute-engine/library/library';
import type { LibraryDefinition } from '../../src/compute-engine/global-types';

const SQ_LIBRARY: LibraryDefinition = {
  name: 'residues',
  definitions: {
    Sq: { evaluate: ['Function', ['Multiply', 'x', 'x'], 'x'] },
    F2: {
      evaluate: ['Function', ['Multiply', 'x', ['Power', 'y', 2]], 'x', 'y'],
    },
  },
};

function lib(name: string, requires?: string[]): LibraryDefinition {
  return requires ? { name, requires } : { name };
}

function names(libs: readonly LibraryDefinition[]): string[] {
  return libs.map((l) => l.name);
}

describe('sortLibraries', () => {
  test('the standard library order', () => {
    expect(names(ComputeEngine.getStandardLibrary())).toEqual([
      'core',
      'control-structures',
      'logic',
      'collections',
      'colors',
      'regexp',
      'relop',
      'arithmetic',
      'fractals',
      'trigonometry',
      'calculus',
      'polynomials',
      'combinatorics',
      'number-theory',
      'special-functions',
      'linear-algebra',
      'statistics',
      'units',
      'physics',
    ]);
  });

  test('a library with no requires listed last loads last', () => {
    const sorted = sortLibraries([
      ...ComputeEngine.getStandardLibrary(),
      lib('r'),
    ]);
    expect(names(sorted).at(-1)).toBe('r');
  });

  test('a dependency loads first, the input order is kept otherwise', () => {
    expect(
      names(
        sortLibraries([
          lib('a', ['c']),
          lib('r'),
          lib('c'),
          lib('d', ['a', 'b']),
          lib('b'),
        ])
      )
    ).toEqual(['c', 'a', 'r', 'b', 'd']);
  });

  test('a missing dependency is an error', () => {
    expect(() => sortLibraries([lib('a', ['zz'])])).toThrow(
      'Library "a" requires "zz", which is not available'
    );
  });

  test('a cycle is an error', () => {
    expect(() =>
      sortLibraries([lib('a', ['b']), lib('b', ['c']), lib('c', ['a'])])
    ).toThrow(/Circular dependency detected among libraries: a, b, c/);
    expect(() => sortLibraries([lib('a', ['a'])])).toThrow(
      /Circular dependency detected among libraries: a/
    );
  });

  test('a duplicate name is an error', () => {
    expect(() => sortLibraries([lib('a'), lib('a')])).toThrow(
      'Duplicate library name: "a"'
    );
  });
});

describe('a caller library listed after the standard libraries', () => {
  let errors: unknown[][];
  let ce: ComputeEngine;
  beforeAll(() => {
    errors = [];
    const spy = jest
      .spyOn(console, 'error')
      .mockImplementation((...args: unknown[]) => {
        errors.push(args);
      });
    try {
      ce = new ComputeEngine({
        libraries: [...ComputeEngine.getStandardLibrary(), SQ_LIBRARY],
      });
    } finally {
      spy.mockRestore();
    }
  });

  test('loads without errors', () => {
    expect(errors).toEqual([]);
  });

  test('Block keeps its definition', () => {
    expect(ce.parse('x := 2').evaluate().toString()).toBe('2');
    expect(ce.parse('x + 1').evaluate().toString()).toBe('3');
    expect(
      ce
        .box(['Block', ['Assign', 'y', 3], ['Add', 'y', 1]])
        .evaluate()
        .toString()
    ).toBe('4');
  });

  test('its operator evaluates', () => {
    expect(ce.box(['Sq', 3]).evaluate().toString()).toBe('9');
  });
});

describe('the derivative of a caller-library operator', () => {
  const ce = new ComputeEngine({
    libraries: [...ComputeEngine.getStandardLibrary(), SQ_LIBRARY],
  });
  const declared = new ComputeEngine();
  declared.declare('Sq', {
    evaluate: ['Function', ['Multiply', 'x', 'x'], 'x'],
  });

  test('is the same as for a declared operator', () => {
    const d = ce.box(['D', ['Sq', 't'], 't']).evaluate();
    expect(d.toString()).toBe('2t');
    expect(
      declared
        .box(['D', ['Sq', 't'], 't'])
        .evaluate()
        .toString()
    ).toBe(d.toString());
  });

  test('agrees with a central difference', () => {
    const d = ce.box(['D', ['Sq', 't'], 't']).evaluate();
    const h = 1e-5;
    for (const t0 of [-1.5, 0.3, 2.7]) {
      const exact = d.subs({ t: t0 }).N().re;
      const f = (u: number) => ce.box(['Sq', u]).N().re;
      expect(exact).toBeCloseTo((f(t0 + h) - f(t0 - h)) / (2 * h), 6);
    }
  });

  test('of an operator with two arguments', () => {
    expect(
      ce
        .box(['D', ['F2', 'a', 't'], 't'])
        .evaluate()
        .toString()
    ).toBe('2a * t');
  });

  // The `evaluate` handler of `F2` is MathJSON, so its function literal is
  // stored in a non-canonical form. The multi-index `Derivative`
  // differentiates the canonical form of the literal.
  test('a multi-index Derivative of a MathJSON literal', () => {
    const assert = jest.spyOn(console, 'assert').mockImplementation(() => {});
    try {
      // F2(x, y) = x·y², ∂F2/∂y = 2xy, ∂²F2/∂x∂y = 2y
      const first = ce.box(['Derivative', 'F2', 0, 1]).evaluate();
      expect(first.toString()).toBe('(x, y) => 2x * y');
      // The second request finds the closed form of the first in the memo.
      expect(ce.box(['Derivative', 'F2', 0, 1]).evaluate()).toBe(first);
      for (let i = 0; i < 2; i++) {
        expect(
          ce.box(['Apply', ['Derivative', 'F2', 0, 1], 2, 3]).evaluate().re
        ).toBe(12);
        expect(
          ce.box(['Apply', ['Derivative', 'F2', 1, 1], 2, 3]).evaluate().re
        ).toBe(6);
      }
      const failed = assert.mock.calls.filter((call) => !call[0]);
      expect(failed).toEqual([]);
    } finally {
      assert.mockRestore();
    }
  });
});

// A lazy operator holds its operands: they are statements, conditions or
// binders. `D` must not run its `evaluate` handler on fabricated wildcard
// operands to find a body: the handler can run statements, throw, or loop.
describe('the derivative of a lazy caller-library operator', () => {
  const calls: string[] = [];
  const HELD_LIBRARY: LibraryDefinition = {
    name: 'held',
    definitions: {
      Held: {
        lazy: true,
        signature: '(any) -> number',
        evaluate: (ops) => {
          calls.push(ops.map((op) => op.toString()).join(', '));
          throw new Error('Held evaluated');
        },
      },
      HeldCube: {
        lazy: true,
        signature: '(number) -> number',
        evaluate: ['Function', ['Power', 'x', 3], 'x'],
      },
    },
  };
  const ce = new ComputeEngine({
    libraries: [...ComputeEngine.getStandardLibrary(), HELD_LIBRARY],
  });

  test('does not run the evaluate handler and stays symbolic', () => {
    calls.length = 0;
    const d = ce.box(['D', ['Held', ['Power', 'x', 2]], 'x']).evaluate();
    expect(d.toString()).toBe('D(Held(x^2), x)');
    expect(ce.box(['Derivative', 'Held']).evaluate().operator).toBe(
      'Derivative'
    );
    expect(calls).toEqual([]);
  });

  test('of a declared lazy operator does not run the evaluate handler', () => {
    const declared = new ComputeEngine();
    const declaredCalls: string[] = [];
    declared.declare('Held', {
      lazy: true,
      signature: '(any) -> number',
      evaluate: (ops) => {
        declaredCalls.push(ops.map((op) => op.toString()).join(', '));
        throw new Error('Held evaluated');
      },
    });
    const d = declared.box(['D', ['Held', ['Power', 'x', 2]], 'x']).evaluate();
    expect(d.toString()).toBe('D(Held(x^2), x)');
    expect(declaredCalls).toEqual([]);
  });

  test('with a function-literal handler differentiates the literal', () => {
    expect(
      ce
        .box(['D', ['HeldCube', ['Power', 'x', 2]], 'x'])
        .evaluate()
        .toString()
    ).toBe('6x^5');
    expect(ce.box(['Derivative', 'HeldCube']).evaluate().toString()).toBe(
      '(x) => 3x^2'
    );
  });

  test('of a library lazy operator does not run its loop', () => {
    expect(ce.box(['Derivative', 'Loop']).evaluate().operator).toBe(
      'Derivative'
    );
  });

  test('of If and Which stays symbolic', () => {
    // `If(_)` and `Which(_)` are invalid: `If` needs a then branch, and
    // `Which` an even number of operands. There is no function to
    // differentiate.
    expect(ce.box(['Derivative', 'If']).evaluate().operator).toBe('Derivative');
    expect(ce.box(['Derivative', 'Which']).evaluate().operator).toBe(
      'Derivative'
    );
    // `If(x)` is `If(x, Error("missing"))`, and the error is the value.
    expect(ce.box(['D', ['If', 'x'], 'x']).evaluate().operator).toBe('Error');
  });

  test('of Block', () => {
    // `Block(x)` has the value `x`, so `Block` applied to one argument is the
    // identity function.
    expect(ce.box(['Derivative', 'Block']).evaluate().toString()).toBe(
      '(x) => 1'
    );
    expect(
      ce
        .box(['D', ['Block', ['Power', 'x', 2]], 'x'])
        .evaluate()
        .toString()
    ).toBe('2x');
    // A block of several statements has the value of the last one, which
    // can read a local variable assigned before it: stay symbolic. Before,
    // the first statement was differentiated, and the result was 3.
    expect(
      ce
        .box(['D', ['Block', ['Multiply', 3, 'x'], ['Power', 'x', 2]], 'x'])
        .evaluate().operator
    ).toBe('D');
  });
});

describe('the derivative of a user function that shadows a library name', () => {
  test('uses the user definition', () => {
    const ce = new ComputeEngine();
    ce.parse('\\operatorname{Sinh}(x) := 3x').evaluate();
    expect(ce.box(['Sinh', 2]).evaluate().toString()).toBe('6');
    expect(
      ce
        .box(['D', ['Sinh', 't'], 't'])
        .evaluate()
        .toString()
    ).toBe('3');
    // Not shadowed: the library rule applies
    expect(
      ce
        .box(['D', ['Sin', 't'], 't'])
        .evaluate()
        .toString()
    ).toBe('cos(t)');
  });
});

// `Function` is in `core`, and a function literal is canonicalized with a
// `Block` body. `Block` is in `core` too, so a library list with `core` but
// without `control-structures` can build and apply function literals.
describe('a library list without control-structures', () => {
  for (const libraries of [['core', 'arithmetic'], ['core']]) {
    test(`${libraries.join(', ')}: function literals work`, () => {
      const errors: unknown[][] = [];
      const spy = jest
        .spyOn(console, 'error')
        .mockImplementation((...args: unknown[]) => {
          errors.push(args);
        });
      const asserts: unknown[][] = [];
      const assertSpy = jest
        .spyOn(console, 'assert')
        .mockImplementation((cond?: unknown, ...args: unknown[]) => {
          if (!cond) asserts.push(args);
        });
      try {
        const ce = new ComputeEngine({
          libraries: [...libraries, SQ_LIBRARY],
        });
        expect(ce.lookupDefinition('Block')).toBeDefined();
        const apply = ce
          .box(['Apply', ['Function', ['Multiply', 'x', 2], 'x'], 3])
          .evaluate();
        const sq = ce.box(['Sq', 3]).evaluate();
        if (libraries.includes('arithmetic')) {
          expect(apply.toString()).toBe('6');
          expect(sq.toString()).toBe('9');
        } else {
          // No `Multiply` definition: the product stays symbolic, but the
          // function literal is applied.
          expect(apply.toString()).toBe('2 * 3');
          expect(sq.toString()).toBe('3 * 3');
        }
        expect(
          ce
            .box(['Block', ['Assign', 'y', 3], 'y'])
            .evaluate()
            .toString()
        ).toBe('3');
      } finally {
        spy.mockRestore();
        assertSpy.mockRestore();
      }
      expect(errors).toEqual([]);
      expect(asserts).toEqual([]);
    });
  }
});

describe('getStandardLibrary with a subset of categories', () => {
  test('adds the libraries the requested ones require, in load order', () => {
    expect(
      ComputeEngine.getStandardLibrary('physics').map((l) => l.name)
    ).toEqual(['core', 'arithmetic', 'units', 'physics']);
    expect(
      ComputeEngine.getStandardLibrary(['core']).map((l) => l.name)
    ).toEqual(['core']);
  });

  test('the result can build an engine', () => {
    const ce = new ComputeEngine({
      libraries: [...ComputeEngine.getStandardLibrary('physics')],
    });
    expect(ce.parse('2+3').evaluate().toString()).toBe('5');
  });

  test('an unknown category still throws', () => {
    expect(() => ComputeEngine.getStandardLibrary('nope' as any)).toThrow(
      'Unknown library category "nope"'
    );
  });
});
