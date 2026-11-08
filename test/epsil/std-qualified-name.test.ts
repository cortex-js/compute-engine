import { ComputeEngine } from '../../src/compute-engine';
import { checkEpsil } from '../../src/epsil/check-epsil';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { resolveLibraryNames } from '../../src/epsil/resolve-library-names';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import type { MathJsonExpression } from '../../src/math-json/types';

//
// `std::name` names the standard-library definition of `name`, also where
// the program binds `name`. It parses to `["Module", name]`, and the
// resolution pass rewrites an Epsil spelling to the library name
// (`std::pi` is `["Module", "Pi"]`). Design:
// `docs/plans/2026-11-07-ce1099-std-module.md`.
//

function strip(node: MathJsonExpression): unknown {
  return JSON.parse(
    JSON.stringify(node).replace(/,"sourceOffsets":\[\d+,\d+\]/g, '')
  );
}

/** The parse tree of `source`, without source offsets, and the codes of its
 * diagnostics. */
function parsed(source: string): [unknown, string[]] {
  const [ast, diagnostics] = parseEpsil(source);
  return [
    strip(ast),
    diagnostics.map((d) =>
      Array.isArray(d.message) ? d.message[0] : d.message
    ),
  ];
}

/** The resolved tree of `source`, without source offsets. */
function resolved(source: string): unknown {
  const [ast] = parseEpsil(source);
  return strip(resolveLibraryNames(ast, source, new ComputeEngine()));
}

/** The value of `source` as text, and the codes of its diagnostics. */
function run(source: string): [string, string[]] {
  const r = executeEpsil(new ComputeEngine(), source);
  return [
    r.value.toString(),
    r.diagnostics.map((d) =>
      Array.isArray(d.message) ? d.message[0] : d.message
    ),
  ];
}

describe('parse', () => {
  test('a qualified constant', () => {
    expect(parsed('std::pi')).toEqual([{ fn: ['Module', { sym: 'pi' }] }, []]);
    expect(parsed('std::Pi')).toEqual([{ fn: ['Module', { sym: 'Pi' }] }, []]);
  });

  test('a qualified call', () => {
    expect(parsed('std::floor(2.5)')).toEqual([
      { fn: ['Apply', { fn: ['Module', { sym: 'floor' }] }, { num: '2.5' }] },
      [],
    ]);
  });

  test('a qualified name as a call argument is not a named argument', () => {
    expect(parsed('f(std::pi)')).toEqual([
      { fn: ['f', { fn: ['Module', { sym: 'pi' }] }] },
      [],
    ]);
  });

  test('the resolution pass gives the library name, in either spelling', () => {
    expect(resolved('std::pi')).toEqual({ fn: ['Module', { sym: 'Pi' }] });
    expect(resolved('std::Pi')).toEqual({ fn: ['Module', { sym: 'Pi' }] });
    expect(resolved('let floor = 3; std::floor(2.5)')).toEqual({
      fn: [
        'Block',
        {
          fn: [
            'Declare',
            { sym: 'floor' },
            {
              fn: [
                'Dictionary',
                { fn: ['KeyValuePair', { sym: 'value' }, { num: '3' }] },
              ],
            },
          ],
        },
        {
          fn: [
            'Apply',
            { fn: ['Module', { sym: 'Floor' }] },
            { num: '2.5' },
          ],
        },
      ],
    });
  });
});

describe('evaluate', () => {
  test.each([
    ['std::pi', 'pi'],
    ['std::Pi + 1', '1 + pi'],
    ['std::floor(2.5)', '2'],
    ['std::sin(std::pi / 2)', '1'],
    ['map(std::floor, [1.5, 2.5])', '[1,2]'],
    ['let f = std::floor\nf(2.7)', '2'],
  ])('%j', (source, value) => {
    expect(run(source)).toEqual([value, []]);
  });

  test('a binding of the program does not hide the library definition', () => {
    // A local `Pi` in a function body, and both spellings of `floor` bound
    // at the top level.
    expect(run('function f() { let Pi = 3; std::pi + Pi }\nf()')).toEqual([
      '3 + pi',
      [],
    ]);
    expect(
      run(
        'function Floor(x) { x + 100 }\nlet floor = 7\nstd::floor(2.5) + Floor(1) + floor'
      )
    ).toEqual(['110', []]);
    expect(
      run(
        'function Floor(x) { x + 100 }\nlet floor = 7\nmap(std::floor, [1.5, 2.5])'
      )
    ).toEqual(['[1,2]', []]);
  });

  test('`std` is not reserved and not a binding', () => {
    expect(run('let std = 5\nstd::pi + std')).toEqual(['5 + pi', []]);
  });
});

describe('static errors', () => {
  test('a module other than `std` is unknown-module', () => {
    const [ast, codes] = parsed('foo::bar');
    expect(codes).toEqual(['unknown-module']);
    expect(ast).toEqual({
      fn: ['Error', { str: 'unknown-module' }, { str: 'foo' }],
    });
  });

  test('a name that is not in the library is not-a-library-name', () => {
    const r = executeEpsil(new ComputeEngine(), 'std::xyz');
    expect(r.value.json).toEqual(['Error', "'not-a-library-name'", 'xyz']);
    expect(run('std::xyz')[1]).toEqual(['not-a-library-name']);
    // The verbatim form names the raw symbol: `pi` is not a library name.
    expect(run('std::`pi`')[1]).toEqual(['not-a-library-name']);
    // A name of the program is not a library name.
    expect(run('let mine = 1\nstd::mine')[1]).toEqual(['not-a-library-name']);
    // `epsil check` reports it too.
    const codes = checkEpsil(new ComputeEngine(), 'std::xyz').diagnostics.map((d) =>
      Array.isArray(d.message) ? d.message[0] : d.message
    );
    expect(codes).toContain('not-a-library-name');
  });

  test('`std::` with no name is a parse error', () => {
    expect(parsed('std::')[1]).toEqual(['symbol-expected']);
  });

  test('a qualified name does not nest', () => {
    expect(parsed('std::a::b')[1]).toEqual(['unexpected-symbol']);
  });
});

describe('serialize', () => {
  test('a qualified name', () => {
    expect(serializeEpsil(['Module', 'Pi'])).toBe('std::pi');
    expect(serializeEpsil(['Apply', ['Module', 'Floor'], 2.5])).toBe(
      'std::floor(2.5)'
    );
    expect(serializeEpsil(['Module', 'Pi'], { libraryNames: 'mathjson' })).toBe(
      'std::Pi'
    );
    // Any other `Apply` keeps its generic form.
    expect(serializeEpsil(['Apply', 'f', 'x'])).toBe('apply(f, x)');
  });

  test('the round trip gives the same tree', () => {
    for (const source of ['std::pi', 'std::floor(2.5) + 1', 'std::pi.a']) {
      const [ast] = parseEpsil(source);
      const tree = resolveLibraryNames(ast, source, new ComputeEngine());
      const text = serializeEpsil(tree);
      expect(text).toBe(source);
    }
  });

  test('a bare name is never qualified, even when both spellings are bound', () => {
    // A bare `Pi` in MathJSON reads whatever `Pi` reads where the text is
    // read. The engine writes `["Module", "Pi"]` when it means the library
    // definition and a local hides it, so only that form is written
    // `std::pi`; a bare `Pi` stays a bare name, which reads the same binding.
    const isBound = (name: string) => name === 'pi' || name === 'Pi';
    expect(serializeEpsil(['Add', 'Pi', 1], { isBound })).toBe('Pi + 1');
    expect(serializeEpsil(['Add', ['Module', 'Pi'], 1], { isBound })).toBe(
      'std::pi + 1'
    );
    // One spelling bound: the other one is written, as before.
    expect(serializeEpsil('Pi', { isBound: (n) => n === 'pi' })).toBe('Pi');
    expect(serializeEpsil('Pi', { isBound: (n) => n === 'Pi' })).toBe('pi');
  });

  test('the value of a program that binds both spellings reads back', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'let floor = 7\nfunction Floor(x) { x + 100 }');
    const isBound = (name: string) => ce.lookupDefinition(name) !== undefined;
    const text = serializeEpsil(['Apply', ['Module', 'Floor'], 2.5], {
      isBound,
    });
    expect(text).toBe('std::floor(2.5)');
    expect(executeEpsil(ce, text).value.toString()).toBe('2');
  });
});

describe('a function value with a local that shadows the library name', () => {
  test('serialized and read again, it keeps the library constant', () => {
    const ce = new ComputeEngine();
    const r = executeEpsil(ce, 'let f = () => do { let Pi = 3; std::pi + Pi }\nf');
    expect(r.diagnostics).toEqual([]);
    expect(r.value.json).toEqual([
      'Function',
      [
        'Block',
        ['Declare', 'Pi', { dict: { value: 3 } }],
        ['Add', 'Pi', ['Module', 'Pi']],
      ],
    ]);
    // Read again as MathJSON, the function gives 3 + π, not 3 + 3.
    const g = ce.box(r.value.json);
    expect(ce.box(['Apply', g]).evaluate().N().re).toBeCloseTo(3 + Math.PI, 12);
    // Written as Epsil, the library constant is `std::pi`.
    const text = serializeEpsil(r.value.json);
    expect(text).toContain('std::pi');
    expect(run(`let f = ${text}\nf()`)).toEqual(['3 + pi', []]);
  });
});

describe('a qualified call boxes its arguments as the unqualified call does', () => {
  test.each([
    ['head(1 + 2)', 'std::head(1 + 2)', '"Add"'],
    ['log(8, base: 2)', 'std::log(8, base: 2)', '3'],
    ['sum(k, k in 1..3)', 'std::sum(k, k in 1..3)', '6'],
  ])('%s and %s', (plain, qualified, value) => {
    expect(run(plain)).toEqual([value, []]);
    expect(run(qualified)).toEqual([value, []]);
  });

  test('an argument of the same name reads the binding of the program', () => {
    expect(run('let max = 3\nstd::max(max, 1)')).toEqual(['3', []]);
    expect(run('let max = 3\nstd::max(max, 5)')).toEqual(['5', []]);
    expect(run('function floor(x) { 0 }\nstd::floor(floor(2.5))')).toEqual([
      '0',
      [],
    ]);
    expect(
      run('function Floor(x) { x + 100 }\nstd::floor(Floor(1))')
    ).toEqual(['101', []]);
  });

  test('a parameter of the same name does not take the qualified call', () => {
    expect(
      run('function f(Floor) { (Floor, std::floor(2.5)) }\nf(10)')
    ).toEqual(['(10, 2)', []]);
  });

  test('also where the program binds the name', () => {
    expect(run('let head = 0\nstd::head(1 + 2)')).toEqual(['"Add"', []]);
    expect(run('function log(x) { 0 }\nstd::log(8, base: 2)')).toEqual([
      '3',
      [],
    ]);
    expect(run('let sum = 0\nstd::sum(k, k in 1..3)')).toEqual(['6', []]);
  });
});

describe('Module cannot be rebound', () => {
  test.each([
    'function f(Module) { std::pi + Module }\nf(1)',
    'sum(Module + std::pi, Module in [1, 2])',
  ])('a parameter or an index named Module: %j', (source) => {
    const [value, codes] = run(source);
    expect(codes).toEqual(['module-binding']);
    expect(value).toContain('pi');
  });

  test.each([
    'function Module(x) { 0 }\nstd::pi',
    'let Module = 5\nstd::pi',
    'Module = 5\nstd::pi',
  ])('%j', (source) => {
    expect(run(source)).toEqual(['pi', ['module-binding']]);
  });

  test('the statement evaluates to the module-binding error', () => {
    const r = executeEpsil(new ComputeEngine(), 'let Module = 5');
    expect(r.value.json).toEqual([
      'Error',
      ['ErrorCode', "'module-binding'", "'Module'"],
    ]);
  });
});

describe('a qualified call where the program binds the capitalized name', () => {
  test('an ordinary library function is applied to the argument values', () => {
    // The user `Not` gives `False`, and the library `Not` of it is `True`.
    const not = executeEpsil(
      new ComputeEngine(),
      'function Not(x) { x }\nstd::Not(Not(false))'
    );
    expect(not.value.json).toBe('True');
    expect(not.diagnostics).toEqual([]);
    expect(run('function Abs(x) { x - 100 }\nstd::abs(Abs(1))')).toEqual([
      '99',
      [],
    ]);
    expect(run('function Abs(x) { x - 100 }\nstd::abs("abc")')).toEqual([
      '3',
      [],
    ]);
  });

  test.each([
    ['function Sum(x) { 0 }\nstd::sum(k, k in 1..3)', '6'],
    ['function Log(x) { 0 }\nstd::log(8, base: 2)', '3'],
    ['function If(c, a, b) { 0 }\nstd::If(true, 1, 2)', '1'],
  ])(
    'a library function that holds or binds an argument, or a named argument: %j',
    (source, value) => {
      expect(run(source)).toEqual([value, []]);
    }
  );
});

describe('a parameter with the name of a library function', () => {
  test('a qualified call that is the first reference of the parameter reads the library', () => {
    expect(run('function g(Floor) { std::floor(2.5) }\ng(10)')).toEqual([
      '2',
      [],
    ]);
  });
});

describe('the separator of a qualified name', () => {
  test('only the ASCII `::` separates a qualified name; the glyph `∷` is an error', () => {
    // `∷` (U+2237 PROPORTION) is not an input form of `::`
    // (`FANCY_UNICODE` in `src/epsil/characters.ts`).
    expect(parsed('std::pi')[1]).toEqual([]);
    expect(parsed('std∷pi')[1]).toEqual(['unexpected-symbol']);
  });
});
