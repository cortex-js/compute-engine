/**
 * Extending an engine that is already constructed (GitHub issue #393):
 * `LatexSyntax.addEntries()` adds LaTeX notation, `ce.loadLibrary()` adds a
 * library of definitions, and `ce.libraryOf()` tells which library defines a
 * name.
 */
import { ComputeEngine } from '../../src/compute-engine';
import {
  LatexSyntax,
  LATEX_DICTIONARY,
  parse as freeParse,
} from '../../src/latex-syntax';
import type { LatexDictionaryEntry } from '../../src/compute-engine/latex-syntax/types';
import type { LibraryDefinition } from '../../src/compute-engine/global-types';
import type { MathJsonExpression } from '../../src/math-json/types';

const INTEGER_MOD_RING: Partial<LatexDictionaryEntry> = {
  name: 'IntegerModRing',
  latexTrigger: '\\mathbb{Z}/',
  parse: (parser) => {
    const n = parser.parseNumber();
    if (n === null) return null;
    if (!parser.matchAll(['\\mathbb', '<{>', 'Z', '<}>'])) return null;
    return ['IntegerModRing', n];
  },
  serialize: (serializer, expr) =>
    `\\mathbb{Z}/${serializer.serialize((expr as MathJsonExpression[])[1])}\\mathbb{Z}`,
};

const RESIDUES: LibraryDefinition = {
  name: 'residues',
  requires: ['arithmetic'],
  definitions: {
    Sq: { evaluate: ['Function', ['Multiply', 'x', 'x'], 'x'] },
    GravitationalG: { value: 6.674e-11, type: 'real', isConstant: true },
  },
};

function errorOf(f: () => unknown): string {
  try {
    f();
  } catch (e) {
    return (e as Error).message;
  }
  return 'NO THROW';
}

describe('LatexSyntax.addEntries()', () => {
  test('a notation added to a running engine serializes and parses', () => {
    const ce = new ComputeEngine();
    ce.declare('IntegerModRing', { signature: '(integer) -> any' });
    const expr = ce.box(['IntegerModRing', 5]);
    expect(expr.latex).toBe('\\mathrm{IntegerModRing}(5)');

    ce.latexSyntax!.addEntries!([INTEGER_MOD_RING]);

    expect(expr.latex).toBe('\\mathbb{Z}/5\\mathbb{Z}');
    expect(ce.parse('\\mathbb{Z}/5\\mathbb{Z}').json).toEqual([
      'IntegerModRing',
      5,
    ]);
    // The rest of the dictionary still applies
    expect(ce.parse('\\frac{x}{2}+1').json).toEqual([
      'Add',
      ['Multiply', ['Rational', 1, 2], 'x'],
      1,
    ]);
  });

  test('an engine created without the option has its own notation', () => {
    const ce1 = new ComputeEngine();
    const ce2 = new ComputeEngine();
    ce1.latexSyntax!.addEntries!([INTEGER_MOD_RING]);
    expect(ce1.box(['IntegerModRing', 5]).latex).toBe(
      '\\mathbb{Z}/5\\mathbb{Z}'
    );
    expect(ce2.box(['IntegerModRing', 5]).latex).toBe(
      '\\mathrm{IntegerModRing}(5)'
    );
  });

  test('an instance given to two engines changes for both', () => {
    const syntax = new LatexSyntax();
    const ce1 = new ComputeEngine({ latexSyntax: syntax });
    const ce2 = new ComputeEngine({ latexSyntax: syntax });
    expect(ce1.latexSyntax).toBe(syntax);
    syntax.addEntries([INTEGER_MOD_RING]);
    expect(ce1.box(['IntegerModRing', 5]).latex).toBe(
      '\\mathbb{Z}/5\\mathbb{Z}'
    );
    expect(ce2.box(['IntegerModRing', 5]).latex).toBe(
      '\\mathbb{Z}/5\\mathbb{Z}'
    );
  });

  test('the default dictionary, the caller array and the free parse() are unchanged', () => {
    const before = LATEX_DICTIONARY.length;
    const dictionary = [...LATEX_DICTIONARY];
    const syntax = new LatexSyntax({ dictionary });
    expect(syntax.parse('\\mathbb{Z}/5\\mathbb{Z}')).not.toEqual([
      'IntegerModRing',
      5,
    ]);
    syntax.addEntries([INTEGER_MOD_RING]);
    expect(syntax.parse('\\mathbb{Z}/5\\mathbb{Z}')).toEqual([
      'IntegerModRing',
      5,
    ]);
    expect(LATEX_DICTIONARY.length).toBe(before);
    expect(dictionary.length).toBe(before);
    expect(freeParse('\\mathbb{Z}/5\\mathbb{Z}')).not.toEqual([
      'IntegerModRing',
      5,
    ]);
  });

  test('the named triggers are rebuilt', () => {
    const syntax = new LatexSyntax();
    const find = () =>
      syntax.getNamedTriggers().find((t) => t.name === 'IntegerModRing');
    expect(find()).toBeUndefined();
    syntax.addEntries([INTEGER_MOD_RING]);
    expect(find()?.triggers).toEqual(['\\mathbb{Z}/']);
  });

  test('a malformed argument throws', () => {
    const syntax = new LatexSyntax();
    expect(
      errorOf(() => syntax.addEntries({} as unknown as LatexDictionaryEntry[]))
    ).toBe(
      `LatexSyntax.addEntries(): expected an array of LaTeX dictionary entries`
    );
    expect(
      errorOf(() =>
        syntax.addEntries(['x'] as unknown as LatexDictionaryEntry[])
      )
    ).toBe(
      `LatexSyntax.addEntries(): each LaTeX dictionary entry must be an object`
    );
  });
});

describe('ce.loadLibrary()', () => {
  test('an expression boxed before the call uses the new definition', () => {
    const ce = new ComputeEngine();
    const expr = ce.box(['Sq', 3]);
    expect(expr.evaluate().toString()).toBe('Sq(3)');
    expect(ce.loadLibrary(RESIDUES)).toBe(ce);
    expect(expr.evaluate().toString()).toBe('9');
    expect(ce.box('GravitationalG').N().re).toBeCloseTo(6.674e-11);
  });

  test('the derivative of a library operator', () => {
    const ce = new ComputeEngine();
    ce.loadLibrary(RESIDUES);
    expect(
      ce
        .box(['D', ['Sq', 'x'], 'x'])
        .evaluate()
        .toString()
    ).toBe('2x');
  });

  test('a library that requires a library loaded earlier', () => {
    const ce = new ComputeEngine();
    ce.loadLibrary(RESIDUES);
    ce.loadLibrary({
      name: 'cubes',
      requires: ['residues'],
      definitions: {
        Cube: { evaluate: ['Function', ['Multiply', ['Sq', 'x'], 'x'], 'x'] },
      },
    });
    expect(ce.box(['Cube', 2]).evaluate().toString()).toBe('8');
    expect(ce.libraryOf('Cube')).toBe('cubes');
  });

  test('the errors, and nothing is declared when the checks fail', () => {
    const ce = new ComputeEngine({
      libraries: ['core', 'control-structures', 'arithmetic'],
    });
    expect(
      errorOf(() => ce.loadLibrary({ name: 'b', requires: ['residues'] }))
    ).toBe(
      `Library "b" requires "residues", which is not loaded. Load "residues" first.`
    );
    expect(
      errorOf(() =>
        ce.loadLibrary(
          ComputeEngine.getStandardLibrary().find((l) => l.name === 'units')!
        )
      )
    ).toBe(
      `Cannot load the standard library "units" after the engine is constructed: use the "libraries" constructor option`
    );
    expect(errorOf(() => ce.loadLibrary({ name: 'arithmetic' }))).toBe(
      `A library named "arithmetic" is already loaded`
    );
    expect(
      errorOf(() => ce.loadLibrary('residues' as unknown as LibraryDefinition))
    ).toBe(
      `Invalid library definition: expected an object with at least a "name" field`
    );

    ce.loadLibrary(RESIDUES);
    expect(errorOf(() => ce.loadLibrary(RESIDUES))).toBe(
      `A library named "residues" is already loaded`
    );
    expect(
      errorOf(() =>
        ce.loadLibrary({
          name: 'other',
          definitions: { Sq: { evaluate: ['Function', 'x', 'x'] } },
        })
      )
    ).toBe(`Library "other": "Sq" is already defined by library "residues"`);

    ce.declare('h', 'real');
    expect(
      errorOf(() =>
        ce.loadLibrary({
          name: 'partial',
          definitions: [
            { Fresh: { evaluate: ['Function', 'x', 'x'] } },
            { h: { value: 1 } },
          ],
        })
      )
    ).toBe(`Library "partial": "h" is already declared in the global scope`);
    // The check runs before any definition is declared
    expect(ce.lookupDefinition('Fresh')).toBeUndefined();
    expect(ce.libraryOf('Fresh')).toBeUndefined();

    expect(
      errorOf(() =>
        ce.loadLibrary({
          name: 'twice',
          definitions: [
            { T: { evaluate: ['Function', 'x', 'x'] } },
            { T: { evaluate: ['Function', 'x', 'x'] } },
          ],
        })
      )
    ).toBe(`Library "twice" defines "T" more than once`);
    expect(ce.lookupDefinition('T')).toBeUndefined();
  });

  test('a definition that declare() rejects: nothing is declared', () => {
    const ce = new ComputeEngine();
    const bad = {
      name: 'lib',
      definitions: {
        Aa: { signature: '(number) -> number' },
        Bb: { signature: '(number) -> number', bogus: 1 },
      },
    } as unknown as LibraryDefinition;
    expect(errorOf(() => ce.loadLibrary(bad))).toBe(
      `Operator Definition "Bb": unexpected key "bogus"`
    );
    // The definition declared before the rejected one is removed
    expect(ce.libraryOf('Aa')).toBeUndefined();
    expect(ce.lookupDefinition('Aa')).toBeUndefined();
    // The corrected library loads
    ce.loadLibrary({
      name: 'lib',
      definitions: {
        Aa: { evaluate: ['Function', ['Multiply', 2, 'x'], 'x'] },
        Bb: { signature: '(number) -> number' },
      },
    });
    expect(ce.libraryOf('Aa')).toBe('lib');
    expect(ce.box(['Aa', 3]).evaluate().toString()).toBe('6');
  });

  test('a rejected definition inside a caller checkpoint', () => {
    const ce = new ComputeEngine();
    const cp = ce.checkpoint();
    expect(
      errorOf(() =>
        ce.loadLibrary({
          name: 'lib',
          definitions: {
            Aa: { signature: '(number) -> number' },
            Bb: { signature: '(number) -> number', bogus: 1 },
          },
        } as unknown as LibraryDefinition)
      )
    ).toBe(`Operator Definition "Bb": unexpected key "bogus"`);
    expect(ce.lookupDefinition('Aa')).toBeUndefined();
    ce.loadLibrary(RESIDUES);
    expect(ce.box(['Sq', 3]).evaluate().toString()).toBe('9');
    // The caller checkpoint is still live and undoes the library
    ce.restore(cp);
    expect(ce.box(['Sq', 3]).evaluate().toString()).toBe('Sq(3)');
    expect(ce.libraryOf('Sq')).toBeUndefined();
  });

  test('a standard library in requires', () => {
    const ce = new ComputeEngine({ libraries: ['core'] });
    expect(
      errorOf(() => ce.loadLibrary({ name: 'z', requires: ['arithmetic'] }))
    ).toBe(
      `Library "z" requires the standard library "arithmetic", which is not loaded. A standard library cannot be loaded after the engine is constructed: select "arithmetic" with the "libraries" constructor option.`
    );
  });

  test('a checkpoint taken before the call undoes it', () => {
    const ce = new ComputeEngine();
    const cp = ce.checkpoint();
    ce.loadLibrary(RESIDUES);
    expect(ce.box(['Sq', 3]).evaluate().toString()).toBe('9');
    ce.restore(cp);
    expect(ce.box(['Sq', 3]).evaluate().toString()).toBe('Sq(3)');
    expect(ce.libraryOf('Sq')).toBeUndefined();
    // The library name is free again
    ce.loadLibrary(RESIDUES);
    expect(ce.box(['Sq', 3]).evaluate().toString()).toBe('9');
    expect(ce.libraryOf('Sq')).toBe('residues');
  });

  test('with addEntries(), a library and its notation load together', () => {
    const ce = new ComputeEngine();
    ce.loadLibrary({
      name: 'rings',
      definitions: { IntegerModRing: { signature: '(integer) -> any' } },
    });
    ce.latexSyntax!.addEntries!([INTEGER_MOD_RING]);
    const expr = ce.parse('\\mathbb{Z}/5\\mathbb{Z}');
    expect(expr.json).toEqual(['IntegerModRing', 5]);
    expect(expr.latex).toBe('\\mathbb{Z}/5\\mathbb{Z}');
    expect(ce.libraryOf(expr.operator)).toBe('rings');
  });
});

describe('ce.libraryOf()', () => {
  test('standard names, caller libraries, declarations', () => {
    const ce = new ComputeEngine({
      libraries: [...ComputeEngine.getStandardLibrary(), RESIDUES],
    });
    expect(ce.libraryOf('Sin')).toBe('trigonometry');
    expect(ce.libraryOf('Add')).toBe('arithmetic');
    expect(ce.libraryOf('Sq')).toBe('residues');
    expect(ce.libraryOf('GravitationalG')).toBe('residues');
    expect(ce.libraryOf('NotDefinedAnywhere')).toBeUndefined();
    ce.declare('MyOp', { evaluate: ['Function', 'x', 'x'] });
    expect(ce.libraryOf('MyOp')).toBeUndefined();
  });

  test('a declaration that shadows a library name', () => {
    const ce = new ComputeEngine();
    ce.loadLibrary(RESIDUES);
    ce.pushScope();
    ce.declare('Sq', { evaluate: ['Function', 'x', 'x'] });
    ce.declare('Sin', { evaluate: ['Function', 'x', 'x'] });
    expect(ce.libraryOf('Sq')).toBeUndefined();
    expect(ce.libraryOf('Sin')).toBeUndefined();
    ce.popScope();
    expect(ce.libraryOf('Sq')).toBe('residues');
    expect(ce.libraryOf('Sin')).toBe('trigonometry');
  });
});
