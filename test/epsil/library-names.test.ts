import { readFileSync } from 'node:fs';
import { join } from 'node:path';

import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { STANDARD_LIBRARIES } from '../../src/compute-engine/library/library';
import type { MathJsonExpression } from '../../src/math-json/types';
import { describeName } from '../../src/cli/doc';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import {
  ENGINE_INTERNAL_NAMES,
  GRAMMAR_CONSTRUCTS,
  LITERAL_CONSTRUCTORS,
  RELATION_NOTATIONS,
  canonicalLibraryName,
  epsilLibraryNames,
  epsilNameOf,
  lowercaseSpelling,
} from '../../src/epsil/library-names';
import { OPERATORS } from '../../src/epsil/operators';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { HARD_RESERVED_WORDS } from '../../src/epsil/reserved-words';
import { resolveLibraryNames } from '../../src/epsil/resolve-library-names';

//
// The lowercase spellings of the standard library (`sin` for `Sin`, `pi`
// for `Pi`): the spelling table (`library-names.ts`) and the resolution pass
// that gives it meaning (`resolve-library-names.ts`). The pass runs on the
// raw parse tree, so the tests below read the resolved tree directly where
// the question is "what did the name resolve to", and run the program where
// the question is "what does it compute".
//

/** The resolved tree of `source`, without source offsets. */
function resolved(source: string, ce = new ComputeEngine()): unknown {
  const [ast] = parseEpsil(source);
  return strip(resolveLibraryNames(ast, source, ce));
}

function strip(node: MathJsonExpression): unknown {
  return JSON.parse(
    JSON.stringify(node).replace(/,"sourceOffsets":\[\d+,\d+\]/g, '')
  );
}

/** The value of `source` as text, on a fresh engine unless one is given. */
function run(source: string, ce = new ComputeEngine()): string {
  return executeEpsil(ce, source).value.toString();
}

/** The value of `source` as a symbol name (`True`, `False`), or `undefined`
 * when the value is not a symbol. */
function runSymbol(source: string): string | undefined {
  return executeEpsil(new ComputeEngine(), source).value.symbol ?? undefined;
}

/** The names of every definition of the standard library, operators and
 * constants alike. */
function standardLibraryNames(): Set<string> {
  const names = new Set<string>();
  for (const library of STANDARD_LIBRARIES) {
    const definitions = library.definitions;
    if (definitions === undefined) continue;
    for (const table of Array.isArray(definitions)
      ? definitions
      : [definitions])
      for (const name of Object.keys(table)) names.add(name);
  }
  return names;
}

describe('the spelling rule', () => {
  test('lowercases the first letter', () => {
    expect(lowercaseSpelling('Sin')).toBe('sin');
    expect(lowercaseSpelling('ArcSin')).toBe('arcSin');
    expect(lowercaseSpelling('IsPrime')).toBe('isPrime');
    expect(lowercaseSpelling('Log10')).toBe('log10');
    expect(lowercaseSpelling('Pi')).toBe('pi');
  });

  test('lowercases a leading run of capitals, keeping the one that starts the next word', () => {
    expect(lowercaseSpelling('GCD')).toBe('gcd');
    expect(lowercaseSpelling('LCM')).toBe('lcm');
    expect(lowercaseSpelling('LUDecomposition')).toBe('luDecomposition');
    expect(lowercaseSpelling('QRDecomposition')).toBe('qrDecomposition');
    expect(lowercaseSpelling('NDSolve')).toBe('ndSolve');
    expect(lowercaseSpelling('DSolve')).toBe('dSolve');
    expect(lowercaseSpelling('NIntegrate')).toBe('nIntegrate');
  });

  test('a name that does not start with a capital has no spelling', () => {
    expect(lowercaseSpelling('e')).toBeUndefined();
    expect(lowercaseSpelling('kg')).toBeUndefined();
    expect(lowercaseSpelling('__unit__')).toBeUndefined();
  });
});

describe('the exclusions', () => {
  test('single-letter names', () => {
    expect(epsilNameOf('D')).toBeUndefined();
    expect(epsilNameOf('N')).toBeUndefined();
  });

  test('operators the language writes as symbols', () => {
    for (const name of [
      'Add',
      'Power',
      'Pipe',
      'Equal',
      'And',
      'Element',
      'Range',
    ])
      expect([name, epsilNameOf(name)]).toEqual([name, undefined]);
  });

  test('hard reserved words', () => {
    for (const name of ['If', 'Match', 'Function', 'Break', 'Continue'])
      expect([name, epsilNameOf(name)]).toEqual([name, undefined]);
  });

  test('literals, grammar constructs, relation glyphs, internal heads', () => {
    for (const name of [
      'List',
      'Tuple',
      'Set',
      'Dictionary',
      'String',
      'True',
      'False',
      'NaN',
    ])
      expect([name, epsilNameOf(name)]).toEqual([name, undefined]);
    for (const name of [
      'Block',
      'Declare',
      'Which',
      'Typed',
      'Spread',
      'At',
      'Loop',
    ])
      expect([name, epsilNameOf(name)]).toEqual([name, undefined]);
    for (const name of ['Approx', 'Tilde', 'Precedes', 'PlusMinus'])
      expect([name, epsilNameOf(name)]).toEqual([name, undefined]);
    for (const name of ['ErrorCode', 'RuntimeError', 'Signature', 'Object'])
      expect([name, epsilNameOf(name)]).toEqual([name, undefined]);
  });

  test('names kept on purpose', () => {
    for (const [name, spelling] of [
      ['Abs', 'abs'],
      ['Sqrt', 'sqrt'],
      ['Exp', 'exp'],
      ['Any', 'any'],
      ['Type', 'type'],
      ['Symbol', 'symbol'],
      ['Complex', 'complex'],
      ['Union', 'union'],
      ['Xor', 'xor'],
      ['Print', 'print'],
      ['Input', 'input'],
      ['Nothing', 'nothing'],
      ['Missing', 'missing'],
      ['GoldenRatio', 'goldenRatio'],
    ])
      expect([name, epsilNameOf(name)]).toEqual([name, spelling]);
  });
});

describe('the spelling table', () => {
  const names = standardLibraryNames();

  test('every hand-curated exclusion names a real library definition', () => {
    const stale: string[] = [];
    for (const set of [
      GRAMMAR_CONSTRUCTS,
      LITERAL_CONSTRUCTORS,
      RELATION_NOTATIONS,
      ENGINE_INTERNAL_NAMES,
    ])
      for (const name of set) if (!names.has(name)) stale.push(name);
    expect(stale).toEqual([]);
  });

  test('every Epsil operator-table name and hard reserved word is excluded', () => {
    for (const op of OPERATORS)
      if (names.has(op.name))
        expect([op.name, epsilNameOf(op.name)]).toEqual([op.name, undefined]);
    for (const spelling of epsilLibraryNames().keys())
      expect(HARD_RESERVED_WORDS.has(spelling)).toBe(false);
  });

  test('no two library names share a spelling, and the reverse map is consistent', () => {
    const seen = new Map<string, string>();
    for (const name of names) {
      const spelling = epsilNameOf(name);
      if (spelling === undefined) continue;
      expect([spelling, seen.get(spelling) ?? name]).toEqual([spelling, name]);
      seen.set(spelling, name);
      expect(canonicalLibraryName(spelling)).toBe(name);
    }
    expect(epsilLibraryNames().size).toBe(seen.size);
  });

  test('the size of the table', () => {
    // The audit of 2026-09-05 counted 499 operators and 45 constants with a
    // spelling, then gave `Any`, `Type`, `Symbol`, `Complex`, `Rational`,
    // `Real`, `Imaginary`, `Color`, `Error` theirs. A change here is a
    // library change; check it against `docs/plans/2026-09-05-epsil-standard-library-lowercase-aliases.md`.
    expect(epsilLibraryNames().size).toBeGreaterThanOrEqual(540);
  });

  test('a spelling names nothing that the engine binds', () => {
    // The spelling is a property of the language: the engine has no `sin`,
    // and the hand-written `print`/`input` aliases are gone.
    const ce = new ComputeEngine();
    for (const spelling of ['sin', 'print', 'input', 'pi', 'map'])
      expect([spelling, ce.lookupDefinition(spelling)]).toEqual([
        spelling,
        undefined,
      ]);
  });
});

describe('the resolution pass', () => {
  test('a call head', () => {
    expect(resolved('sin(x)')).toEqual({ fn: ['Sin', { sym: 'x' }] });
    expect(run('sin(0)')).toBe('0');
    expect(run('gcd(12, 18)')).toBe('6');
    expect(run('abs(-3)')).toBe('3');
    expect(runSymbol('isPrime(7)')).toBe('True');
    expect(run('luDecomposition([[1, 2], [3, 4]])')).not.toMatch(
      /luDecomposition/
    );
  });

  test('a value-position name (a callback)', () => {
    expect(resolved('map(sin, [0, 1])')).toEqual({
      fn: ['Map', { sym: 'Sin' }, { fn: ['List', { num: '0' }, { num: '1' }] }],
    });
    expect(resolved('xs |> map(sin)')).toEqual({
      fn: ['Pipe', { sym: 'xs' }, { fn: ['Map', { sym: 'Sin' }] }],
    });
    expect(run('map(sin, [0, 1])')).toBe('[0,sin(1)]');
  });

  test('a constant', () => {
    expect(resolved('pi')).toEqual({ sym: 'Pi' });
    expect(resolved('nothing')).toEqual({ sym: 'Nothing' });
    expect(resolved('missing')).toEqual({ sym: 'Missing' });
    expect(resolved('goldenRatio')).toEqual({ sym: 'GoldenRatio' });
    expect(run('sin(pi / 2)')).toBe('1');
  });

  test('both spellings name the same thing', () => {
    expect(runSymbol('sin(1) == Sin(1)')).toBe('True');
    expect(runSymbol('pi == Pi')).toBe('True');
  });

  test('the raw tree keeps what was written', () => {
    const [ast] = parseEpsil('sin(x)');
    expect(strip(ast)).toEqual({ fn: ['sin', { sym: 'x' }] });
  });

  test('a program-bound name is not a library name, in every binding form', () => {
    expect(run('let sum = 0; sum + 1')).toBe('1');
    expect(run('const sum = 2; sum + 1')).toBe('3');
    expect(run('function mean(x) { 42 }; mean(7)')).toBe('42');
    expect(run('((count) => count + 1)(1)')).toBe('2');
    expect(run('[1, 2, 3] |> map(count => count * 2)')).toBe('[2,4,6]');
    expect(
      run('let acc = 0; for count in [1, 2] { acc = acc + count }; acc')
    ).toBe('3');
    expect(
      run(
        'let acc = 0; for (count, sum) in [(1, 2)] { acc = count + sum }; acc'
      )
    ).toBe('3');
    expect(run('match (0, 3) { (0, count) => count }')).toBe('3');
    expect(run('if let count = 5 { count }')).toBe('5');
    // A `let` after a use: the use above reads the library, as it would with
    // any outer binding.
    expect(resolved('mean; let mean = 1')).toEqual({
      fn: [
        'Block',
        { sym: 'Mean' },
        {
          fn: [
            'Declare',
            { sym: 'mean' },
            {
              fn: [
                'Dictionary',
                { fn: ['KeyValuePair', { sym: 'value' }, { num: '1' }] },
              ],
            },
          ],
        },
      ],
    });
  });

  test('a variable a binder operator binds is not a library name', () => {
    // `Sum` declares its index through the engine's binding-site selector;
    // the pass reads that selector, so `count` is the index, not `Count`.
    expect(run('sum(count^2, count in 1..3)')).toBe('14');
    expect(resolved('integrate(count^2, count)')).toEqual({
      fn: [
        'Integrate',
        { fn: ['Power', { sym: 'count' }, { num: '2' }] },
        { sym: 'count' },
      ],
    });
    expect(resolved('forAll(count in integers, count > 0)')).toEqual({
      fn: [
        'ForAll',
        { fn: ['Element', { sym: 'count' }, { sym: 'Integers' }] },
        { fn: ['Greater', { sym: 'count' }, { num: '0' }] },
      ],
    });
  });

  test('a variable an operator takes as a plain operand is not a library name', () => {
    // `Limit`, `Solve`, and the `{x, 2}` order form of `D` declare no
    // binding site for their variable; the pass applies the rule the
    // engine's `Limit` handler applies — a symbol operand that also occurs
    // as a value in another operand is the variable.
    expect(resolved('limit(count^2, count, 0)')).toEqual({
      fn: [
        'Limit',
        { fn: ['Power', { sym: 'count' }, { num: '2' }] },
        { sym: 'count' },
        { num: '0' },
      ],
    });
    expect(resolved('D(count^3, {count, 2})')).toEqual({
      fn: [
        'D',
        { fn: ['Power', { sym: 'count' }, { num: '3' }] },
        { fn: ['Set', { sym: 'count' }, { num: '2' }] },
      ],
    });
    expect(resolved('solve(sum^2 == 4, sum)')).toEqual({
      fn: [
        'Solve',
        {
          fn: [
            'Equal',
            { fn: ['Power', { sym: 'sum' }, { num: '2' }] },
            { num: '4' },
          ],
        },
        { sym: 'sum' },
      ],
    });
    // A name used as a call head in the same call is a function, not a
    // variable: both `sin` here are the sine.
    expect(resolved('map(sin, [sin(1)])')).toEqual({
      fn: [
        'Map',
        { sym: 'Sin' },
        { fn: ['List', { fn: ['Sin', { num: '1' }] }] },
      ],
    });
  });

  test('an iterator clause binds its variable from its own clause onward', () => {
    // The first clause's collection is read in the enclosing scope, where
    // `pi` is the constant; the second clause then binds `pi`.
    expect(resolved('Comprehension(k, k in [pi], pi in [1, 2])')).toEqual({
      fn: [
        'Comprehension',
        { sym: 'k' },
        { fn: ['Element', { sym: 'k' }, { fn: ['List', { sym: 'Pi' }] }] },
        {
          fn: [
            'Element',
            { sym: 'pi' },
            { fn: ['List', { num: '1' }, { num: '2' }] },
          ],
        },
      ],
    });
  });

  test('a verbatim callee borrows nothing from the library', () => {
    // `` `integrate` `` is the raw symbol, not `Integrate`, so it binds no
    // variable: both `sin` are the sine.
    expect(resolved('`integrate`(sin(0), sin)')).toEqual({
      fn: ['integrate', { fn: ['Sin', { num: '0' }] }, { sym: 'Sin' }],
    });
  });

  test('the binder operators of the standard library', () => {
    // The pass learns an operator's bound variables from its binding-site
    // selector. This pins which operators declare one, so an operator that
    // gains a selector (or loses it) shows up here: add a case above for a
    // new binder, since a bound variable that spells a library name would
    // otherwise resolve to the library.
    const ce = new ComputeEngine();
    const binders = [...ce.contextStack[0].lexicalScope.bindings]
      .filter(
        ([, def]) =>
          'operator' in def && def.operator.bindingSites !== undefined
      )
      .map(([name]) => name)
      .sort();
    expect(binders).toEqual([
      'Comprehension',
      'D',
      'Exists',
      'ExistsUnique',
      'ForAll',
      'Integrate',
      'Loop',
      'NDSolveFunction',
      'NotExists',
      'NotForAll',
      'Product',
      'Series',
      'Sum',
    ]);
  });

  test('an engine-bound name is not a library name', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let mean = 5');
    expect(run('mean * 2', ce)).toBe('10');
    ce.declare('sum', 'integer');
    ce.assign('sum', 7);
    expect(run('sum + 1', ce)).toBe('8');
    // The lowercase library values `e`, `i` and the units were never
    // spellings; they resolve as they always did.
    expect(run('i^2')).toBe('-1');
    expect(run('let e = 3; e^2')).toBe('9');
  });

  test('a free library name is the library definition', () => {
    // `mean` alone is the `Mean` function: `mean + 1` is a type error, not a
    // sum with an unknown number (the documented behavior; declare the
    // variable first).
    const result = executeEpsil(new ComputeEngine(), 'mean + 1');
    expect(result.value.operator).toBe('Error');
    expect(result.diagnostics.map((d) => d.message[0])).toContain(
      'static-type-error'
    );
  });

  test('a name with no spelling is an unknown call, with the library name suggested', () => {
    for (const [source, name, suggestion] of [
      ['add(1, 2)', 'add', 'Add'],
      ['list(1)', 'list', 'List'],
      ['d(x)', 'd', 'D'],
    ]) {
      const result = executeEpsil(new ComputeEngine(), source);
      expect(result.value.operator).toBe(name);
      expect(result.diagnostics.map((d) => d.message)).toEqual([
        ['unknown-function', name, suggestion],
      ]);
    }
  });

  test('a did-you-mean suggestion is spelled in lowercase', () => {
    const result = executeEpsil(new ComputeEngine(), 'lenght([1, 2])');
    expect(result.diagnostics.map((d) => d.message)).toEqual([
      ['unknown-function', 'lenght', 'length'],
    ]);
  });

  test('the verbatim form names the raw symbol, with no suggestion', () => {
    const result = executeEpsil(new ComputeEngine(), '`sin`(2)');
    expect(result.value.operator).toBe('sin');
    expect(result.diagnostics).toEqual([]);
  });

  test('the compiled lane', () => {
    const ce = new ComputeEngine();
    const source = 'sin(x) + pi';
    const expr = ce.box(resolveLibraryNames(parseEpsil(source)[0], source, ce));
    expect(expr.json).toEqual(['Add', ['Sin', 'x'], 'Pi']);
    expect(compile(expr)?.run?.({ x: 0 })).toBeCloseTo(Math.PI, 12);
  });
});

describe('the tools', () => {
  const ce = new ComputeEngine();

  test('`epsil doc` and the hover describe the library name behind a spelling', () => {
    const entry = describeName(ce, 'sin');
    expect(entry?.id).toBe('Sin');
    expect(entry?.epsilName).toBe('sin');
    expect(describeName(ce, 'Sin')?.epsilName).toBe('sin');
    expect(describeName(ce, 'Add')?.epsilName).toBeUndefined();
    expect(describeName(ce, 'add')).toBeUndefined();
  });

  test('the generated library page lists both spellings', () => {
    const page = readFileSync(
      join(__dirname, '../../src/epsil/docs/library.md'),
      'utf8'
    );
    expect(page).toContain('| `sin` | `Sin` |');
    expect(page).toContain('| `pi` | `Pi` |');
    expect(page).toContain('| — | `Add` |');
    expect(page).not.toContain('Lowercase alias for');
  });
});
