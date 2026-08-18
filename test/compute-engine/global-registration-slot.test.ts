/**
 * The self-registration slot (`globalThis[Symbol.for('io.cortexjs.compute-engine')]`)
 * is the discovery channel for bundle-external consumers that may only
 * `import type` from this package (e.g. Tycho resolves every CE value export
 * through it at runtime). Its shape is an ADDITIVE contract: consumers
 * feature-detect each name, so entries may be added but never removed or
 * change meaning. This test locks the current contract.
 */
import '../../src/compute-engine';

const slot = (globalThis as Record<symbol, unknown>)[
  Symbol.for('io.cortexjs.compute-engine')
] as Record<string, unknown>;

describe('global registration slot', () => {
  it('is populated by importing the full entry point', () => {
    expect(slot).toBeDefined();
  });

  it('carries every name of the additive contract', () => {
    const contract: Record<string, 'function' | 'string' | 'object'> = {
      ComputeEngine: 'function',
      version: 'string',
      LatexSyntax: 'function',
      LATEX_DICTIONARY: 'object',
      isExpression: 'function',
      isNumber: 'function',
      isSymbol: 'function',
      isFunction: 'function',
      isString: 'function',
      isCharacter: 'function',
      isTensor: 'function',
      isDictionary: 'function',
      isObject: 'function',
      isCollection: 'function',
      isIndexedCollection: 'function',
      numericValue: 'function',
      sym: 'function',
      compile: 'function',
    };
    for (const [name, type] of Object.entries(contract))
      expect(`${name}: ${typeof slot[name]}`).toBe(`${name}: ${type}`);
  });

  it('slot compile is the standalone wrapper, usable without an engine', () => {
    const compile = slot.compile as (expr: unknown) => {
      success: boolean;
      run: (args: Record<string, number>) => number;
    };
    const result = compile('x + 1');
    expect(result.success).toBe(true);
    expect(result.run({ x: 2 })).toBe(3);
  });
});
