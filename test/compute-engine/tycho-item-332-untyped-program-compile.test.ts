// Tycho item 332 (2026-09-28): the JavaScript target compiles a whole Epsil
// program — user function definitions, loops over lists that the loop grows,
// element reads, and the library names as Epsil spells them.
//
// The three programs in `fixtures/epsil-gasket/` compute the Apollonian gasket
// (-1, 2, 2, 3): 224 circles of radius at least 0.008. `a` uses user
// functions, `b` has every helper inlined with circles as tuples, `c` the
// same with flat lists. The interpreter answers 224 for each of them (21 s to
// 69 s, measured 2026-09-28), which is why only the compiled route is run
// here.
//
// Each `describe` below the programs pins one of the defects that stopped
// them, on the smallest input that shows it.

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { ComputeEngine } from '../../src/compute-engine';
import { compile } from '../../src/compute-engine/compilation/compile-expression';
import { BaseCompiler } from '../../src/compute-engine/compilation/base-compiler';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { resolveLibraryNames } from '../../src/epsil/resolve-library-names';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { narrow } from '../../src/common/type/subtype';
import { joinEvidenceTypes } from '../../src/compute-engine/library/assignment-evidence';
import { parseType } from '../../src/common/type/parse';
import { typeToString } from '../../src/common/type/serialize';
import type { Expression } from '../../src/compute-engine/global-types';

function boxProgram(ce: ComputeEngine, source: string): Expression {
  const [parsed] = parseEpsil(source, undefined, {});
  return ce.box(resolveLibraryNames(parsed, source, ce) as never);
}

function compileProgram(source: string) {
  return compile(boxProgram(new ComputeEngine(), source), {
    to: 'javascript',
    fallback: false,
  });
}

function runCompiled(source: string): unknown {
  return (compileProgram(source) as { run: () => unknown }).run();
}

function fixture(name: string): string {
  return readFileSync(
    join(__dirname, 'fixtures', 'epsil-gasket', name),
    'utf8'
  );
}

/** The types of every operand of `head` in `expr`, in source order. */
function operandTypesOf(expr: Expression, head: string): string[] {
  const types: string[] = [];
  const walk = (x: Expression) => {
    const ops = (x as { ops?: ReadonlyArray<Expression> }).ops;
    if (ops === undefined) return;
    if (x.operator === head) types.push(ops[0].type.toString());
    ops.forEach(walk);
  };
  walk(expr);
  return types;
}

describe('Tycho 332: whole Epsil programs compile to JavaScript', () => {
  test('a: user functions', () => {
    expect(runCompiled(fixture('a-user-functions.epsil'))).toEqual([
      224,
      [4, 6, 18, 54, 86, 28, 8, 8, 4, 4, 4, 0],
    ]);
  });

  test('b: helpers inlined, circles as tuples', () => {
    expect(runCompiled(fixture('b-inlined-tuples.epsil'))).toBe(224);
  });

  test('c: helpers inlined, circles as flat lists', () => {
    expect(runCompiled(fixture('c-inlined-flat-lists.epsil'))).toBe(224);
  });
});

describe('a `let` with an initial value types its local', () => {
  test('the loop condition placed before the assignment reads a list', () => {
    const source =
      'let xs = [[1, 2]]\nlet i = 1\n' +
      'while i <= length(xs) && i <= 3 { xs = [...xs, [3, 4]]; i = i + 1 }\n' +
      'length(xs)';
    const types = operandTypesOf(
      boxProgram(new ComputeEngine(), source),
      'Length'
    );
    expect(types.length).toBe(2);
    for (const t of types) expect(t).toMatch(/^(list|matrix)</);
    expect(runCompiled(source)).toBe(4);
    expect(executeEpsil(new ComputeEngine(), source).value.toString()).toBe(
      '4'
    );
  });

  test('a declared type is kept', () => {
    const expr = boxProgram(
      new ComputeEngine(),
      'let xs: list<number> = [1]\nwhile false { xs = [...xs, 2] }\nlength(xs)'
    );
    expect(operandTypesOf(expr, 'Length')).toEqual(['list<number>']);
  });
});

describe('a hoisted `let` first read inside a nested block', () => {
  test('the nested block does not get a binding of its own', () => {
    const ce = new ComputeEngine();
    const block = ce.box([
      'Block',
      ['Declare', 'xs', 'list<number>'],
      ['Block', ['Length', 'xs']],
      ['Length', 'xs'],
    ]) as Expression & {
      ops: ReadonlyArray<
        Expression & { localScope?: { bindings: Map<string, unknown> } }
      >;
    };
    expect(block.ops[1].localScope?.bindings.has('xs') ?? false).toBe(false);
    expect(operandTypesOf(block, 'Length')).toEqual([
      'list<number>',
      'list<number>',
    ]);
  });
});

describe('narrow distributes over a union', () => {
  const meet = (a: string, b: string) =>
    typeToString(narrow(parseType(a)!, parseType(b)!));

  test('the arm that satisfies the other side stays', () => {
    expect(
      meet(
        'missing | vector<real^10>',
        'indexed_collection<number> | dictionary<number>'
      )
    ).toBe('vector<real^10>');
    expect(meet('missing | list<real>', 'collection')).toBe('list<real>');
    expect(meet('number', 'integer | string')).toBe('integer');
  });

  test('disjoint sides are still never', () => {
    expect(meet('integer | string', 'boolean')).toBe('never');
  });

  test('an element read used in arithmetic keeps its source typed', () => {
    const source =
      'let Q = [[1.5, 2.5], [3.5, 4.5]]\nlet i = 1\nlet g = Q[i]\n' +
      'let ka = g[1]\nlet ax = ka * g[2]\nax';
    expect(runCompiled(source)).toBe(3.75);
    expect(executeEpsil(new ComputeEngine(), source).value.toString()).toBe(
      '3.75'
    );
  });
});

describe('ranges through Max, Min, Add and Sqrt', () => {
  const ce = new ComputeEngine();
  ce.declare('x', 'real');
  ce.declare('n', 'integer');
  ce.declare('w', 'nan | real');
  ce.declare('q', 'nan | real<0..>');
  ce.declare('L', 'list<real>');
  const typeOf = (json: unknown) => ce.box(json as never).type.toString();

  test('Max and Min of scalars carry the bound of their operands', () => {
    expect(typeOf(['Max', 0, 'x'])).toBe('real<0..>');
    expect(typeOf(['Min', 0, 'x'])).toBe('real<..0>');
    expect(typeOf(['Max', 1, 'n'])).toBe('integer<1..>');
    expect(typeOf(['Max', 'x', 'x'])).toBe('real');
    expect(typeOf(['Max', 0, 'w'])).toBe('nan | real<0..>');
  });

  test('Max of a list keeps its NaN arm and no bound', () => {
    expect(typeOf(['Max', 'L'])).toBe('nan | real');
  });

  test('a sum of NaN-admitting terms keeps the range', () => {
    expect(typeOf(['Add', 'q', 'q'])).toBe('nan | real<0..>');
    expect(typeOf(['Add', ['Power', 'w', 2], 1])).toBe('nan | real<1..>');
    expect(typeOf(['Add', 'w', 1])).toBe('nan | real');
  });

  test('Sqrt of a NaN-admitting non-negative operand is real or NaN', () => {
    expect(typeOf(['Sqrt', 'q'])).toBe('nan | real');
    expect(typeOf(['Sqrt', ['Max', 0, 'w']])).toBe('nan | real');
    expect(typeOf(['Sqrt', 'w'])).toBe('complex | nan');
    expect(typeOf(['Sqrt', 'x'])).toBe('complex');
  });

  test('the compiled square root stays in the real lane', () => {
    const code = (json: unknown) =>
      compile(ce.box(json as never), { to: 'javascript', fallback: false })
        .code;
    expect(code(['Sqrt', 'q'])).toBe('Math.sqrt(_.q)');
    expect(code(['Multiply', 2, ['Sqrt', ['Max', 0, 'w']]])).toBe(
      '2 * Math.sqrt(Math.max(0, _.w))'
    );
    expect(code(['Sqrt', 'w'])).toContain('_SYS.csqrt');
  });

  test('Max of a wide operand and a non-negative one is non-negative', () => {
    const e = new ComputeEngine();
    e.declare('u', 'number');
    expect(BaseCompiler.assumedRealNonNegative(e.box(['Max', 0, 'u']))).toBe(
      true
    );
    expect(BaseCompiler.assumedRealNonNegative(e.box(['Min', 0, 'u']))).toBe(
      false
    );
  });
});

describe('list operators over a parameter of a user function', () => {
  test('the predicate form of Count compiles', () => {
    expect(runCompiled('let xs = [1, 2, 3, 4]\ncount(xs, e => e > 2)')).toBe(2);
  });

  test('Count and Length read a parameter that is a list at run time', () => {
    expect(
      runCompiled(
        'function seen(acc, c) { count(acc, e => abs(e[1] - c[1]) < 1e-6) > 0 }\n' +
          'seen([(1, 2), (3, 4)], (3, 9))'
      )
    ).toBe(true);
    expect(runCompiled('function f(xs) { length(xs) }\nf([1, 2, 3])')).toBe(3);
  });

  test('a value that is not a list at run time stops the run', () => {
    const r = compileProgram('function f(xs) { length(xs) }\nlet g = f\ng') as {
      run: () => (xs: unknown) => unknown;
    };
    const g = r.run();
    expect(g([1, 2, 3])).toBe(3);
    expect(() => g(new Set([1, 2]))).toThrow(RangeError);
    expect(() => g('abc')).toThrow(/Length: the operand is not a list/);
  });

  test('the value form of Count still declines', () => {
    expect(() => compileProgram('let xs = [1, 2, 2]\ncount(xs, 2)')).toThrow(
      /Could not compile `Count`/
    );
  });
});

describe('the join of assignment evidence is structural', () => {
  const join = (a: string, b: string) =>
    typeToString(joinEvidenceTypes(parseType(a)!, parseType(b)!));

  test('two lists join their element types', () => {
    expect(
      join('list<tuple<integer, real>>', 'list<tuple<number, number>>')
    ).toBe('list<tuple<number, number>>');
  });

  test('tuples of one length join slot by slot, other members stay', () => {
    expect(join('missing | tuple<integer, real>', 'tuple<real, integer>')).toBe(
      'missing | tuple<real, real>'
    );
  });

  test('tuples of different lengths stay apart', () => {
    expect(join('tuple<integer>', 'tuple<integer, integer>')).toBe(
      'tuple<integer, integer> | tuple<integer>'
    );
  });
});
