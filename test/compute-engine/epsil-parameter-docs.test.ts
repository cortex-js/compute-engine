import { ComputeEngine } from '../../src/compute-engine';
import { parseType } from '../../src/common/type/parse';
import type { Type } from '../../src/common/type/types';
import { epsilCompletions } from '../../src/epsil/completion';
import { describeName } from '../../src/epsil/describe-name';
import { splitDocComment } from '../../src/epsil/doc-tags';
import { epsilLibraryNames } from '../../src/epsil/library-names';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { epsilHover } from '../../src/epsil/hover';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { resolveLibraryNames } from '../../src/epsil/resolve-library-names';
import { epsilSignatureHelp } from '../../src/epsil/signature-help';

// CE-1812: the documentation and the sample of each parameter, and of each
// key of an options parameter. CE-1813: the examples of a definition, in the
// Epsil spelling.

const ce = new ComputeEngine();

/** The text before `▮` and its offset. */
function at(source: string): [string, number] {
  const offset = source.indexOf('▮');
  return [source.replace('▮', ''), offset];
}
const help = (source: string) => epsilSignatureHelp(ce, ...at(source));
const items = (source: string) => epsilCompletions(ce, ...at(source)).items;

const PLOT = `/// A 2D plot.
///
/// More text.
/// @param series one item or a list of items
/// @param options the options of the plot
/// @key options.x: tuple<real, real> -- the x range
/// @sample options.x (-5, 5)
/// @key options.grid: boolean -- whether to draw
///   a grid
/// @default options.grid false
/// @key options.color: "red" | "blue" -- the color
/// @sample series x => x^2
/// @example plot(x => x^2)
function plot(series, options = {}) { series }
`;

describe('DOC COMMENT TAGS', () => {
  test('the tags leave the description and become structured data', () => {
    const { description, parameters, examples } = splitDocComment(
      PLOT.split('\n')
        .filter((l) => l.startsWith('///'))
        .map((l) => l.slice(3).replace(/^ /, ''))
        .join('\n')
    );
    expect(description).toBe('A 2D plot.\n\nMore text.');
    expect(examples).toEqual(['plot(x => x^2)']);
    expect(Object.fromEntries(parameters)).toEqual({
      series: {
        documentation: 'one item or a list of items',
        sample: 'x => x^2',
      },
      options: {
        documentation: 'the options of the plot',
        keys: [
          {
            name: 'x',
            type: 'tuple<real, real>',
            documentation: 'the x range',
            sample: '(-5, 5)',
          },
          {
            name: 'grid',
            type: 'boolean',
            documentation: 'whether to draw a grid',
            default: 'false',
          },
          { name: 'color', type: '"red" | "blue"', documentation: 'the color' },
        ],
      },
    });
  });

  test('an unknown tag stays in the description', () => {
    expect(splitDocComment('Text.\n@deprecated use g').description).toBe(
      'Text.\n@deprecated use g'
    );
  });

  test('a rest parameter is documented by its name', () => {
    expect(
      splitDocComment('@param ...xs the values').parameters.get('xs')
    ).toEqual({ documentation: 'the values' });
  });
});

describe('SIGNATURE HELP: PARAMETER DOCUMENTATION', () => {
  test('a function of the source', () => {
    const result = help(`${PLOT}plot(▮`);
    expect(result?.signatures[0].documentation).toBe('A 2D plot.');
    expect(result?.signatures[0].description).toEqual([
      'A 2D plot.',
      'More text.',
    ]);
    expect(result?.examples).toEqual(['plot(x => x^2)']);
    const [series, options] = result!.signatures[0].parameters;
    expect(series.documentation).toBe('one item or a list of items');
    expect(series.sample).toBe('x => x^2');
    expect(options.keys?.map((k) => k.name)).toEqual(['x', 'grid', 'color']);
    expect(result?.activeKey).toBeUndefined();
  });

  test('a named argument resolves to the same parameter', () => {
    const result = help(`${PLOT}plot(x, options: ▮`);
    expect(result?.activeParameter).toBe(1);
    expect(result?.signatures[0].parameters[1].documentation).toBe(
      'the options of the plot'
    );
  });

  test('the active key: in its value, and on the key', () => {
    expect(help(`${PLOT}plot(x, {grid -> ▮`)?.activeKey).toBe('grid');
    expect(help(`${PLOT}plot(x, {x -> (0, 1), gr▮id -> 1}`)?.activeKey).toBe(
      'grid'
    );
    expect(help(`${PLOT}plot(x, options: {x -> ▮`)?.activeKey).toBe('x');
  });

  test('no active key outside a dictionary that is the argument', () => {
    expect(help(`${PLOT}plot(x, {gr▮`)?.activeKey).toBeUndefined();
    expect(help(`${PLOT}plot(x, [{x -> ▮`)?.activeKey).toBeUndefined();
    expect(help(`${PLOT}plot({x -> ▮`)?.activeKey).toBeUndefined();
  });

  test('a function of the engine, from its parameters field', () => {
    const engine = new ComputeEngine();
    engine.declare('Scaled', {
      signature: '(x: real, k: real) -> real',
      evaluate: ([x, k]) => x.mul(k),
      parameters: {
        x: 'The value.',
        k: { description: 'The factor.', sample: '2' },
      },
      examples: ['Scaled(Pi, 2)'],
    });
    const result = epsilSignatureHelp(engine, 'Scaled(', 7);
    expect(result?.signatures[0].parameters).toMatchObject([
      { name: 'x', documentation: 'The value.' },
      { name: 'k', documentation: 'The factor.', sample: '2' },
    ]);
    expect(result?.examples).toEqual(['Scaled(pi, 2)']);
  });
});

describe('COMPLETION: PARAMETER DOCUMENTATION', () => {
  test('a named-argument item carries the documentation and the sample', () => {
    const series = items(`${PLOT}plot(▮`).find((i) => i.label === 'series');
    expect(series).toMatchObject({
      insertText: 'series: ',
      documentation: 'one item or a list of items',
      sample: 'x => x^2',
    });
  });

  test('at a key, the keys not written yet and nothing else', () => {
    const keys = items(`${PLOT}plot(x, {x -> (0, 1), ▮`);
    expect(keys.map((i) => i.label)).toEqual(['grid', 'color']);
    expect(keys[0]).toMatchObject({
      insertText: 'grid -> ',
      snippet: 'grid -> ${1}${0}',
      detail: 'boolean',
      documentation: 'whether to draw a grid',
    });
    expect(items(`${PLOT}plot(x, options: {▮`)[0]).toMatchObject({
      label: 'x',
      snippet: 'x -> ${1:(-5, 5)}${0}',
    });
  });

  test('before an arrow, the name only', () => {
    expect(items(`${PLOT}plot(x, {gr▮ -> true})`)[0]).toMatchObject({
      label: 'grid',
    });
    expect(
      items(`${PLOT}plot(x, {gr▮ -> true})`)[0].insertText
    ).toBeUndefined();
  });

  test('the value of a key typed as a union of string literals', () => {
    const values = items(`${PLOT}plot(x, {color -> ▮`);
    expect(values.slice(0, 2).map((i) => i.label)).toEqual(['"red"', '"blue"']);
  });

  test('a library item carries its examples in the Epsil spelling', () => {
    const join = items('joi▮').find((i) => i.label === 'join');
    expect(join?.examples).toEqual([
      'join([1, 2], [3, 4])',
      'join("ab", "cd")',
    ]);
  });
});

describe('HOVER: EXAMPLES AND TAGS', () => {
  test('the tags of a function of the source are not in its description', () => {
    const [source] = at(`${PLOT}plot(1)`);
    const result = epsilHover(ce, source, PLOT.length + 1);
    expect(result?.description).toEqual(['A 2D plot.', 'More text.']);
    expect(result?.examples).toEqual(['plot(x => x^2)']);
  });

  test('a function of the engine defined with a doc comment', () => {
    const engine = new ComputeEngine();
    executeEpsil(
      engine,
      '/// Twice.\n/// @param x a number\n/// @example twice(2)\nfunction twice(x) { 2 * x }'
    );
    expect(describeName(engine, 'twice')).toMatchObject({
      description: ['Twice.'],
      parameters: { x: { documentation: 'a number' } },
      examples: ['twice(2)'],
    });
  });
});

describe('THE LIBRARY DOCUMENTATION', () => {
  const library = new ComputeEngine();
  const names = [...new Set(epsilLibraryNames().values())];

  test('every example in the Epsil spelling parses', () => {
    const broken: string[] = [];
    let count = 0;
    for (const name of names)
      for (const example of describeName(library, name)?.examples ?? []) {
        count += 1;
        const [, diagnostics] = parseEpsil(example);
        if (diagnostics.some((d) => d.severity === 'error'))
          broken.push(`${name}: ${example}`);
      }
    expect(count).toBeGreaterThan(400);
    expect(broken).toEqual([]);
  });

  /** The samples of the library that do not parse or are not of the type
   * of their parameter or key. */
  function brokenSamples(
    engine: ComputeEngine,
    ids: readonly string[]
  ): string[] {
    const broken: string[] = [];
    const check = (where: string, sample: string, type: Type | undefined) => {
      const [ast, diagnostics] = parseEpsil(sample);
      if (diagnostics.some((d) => d.severity === 'error')) {
        broken.push(`${where}: ${sample} does not parse`);
        return;
      }
      if (type === undefined) return;
      const value = engine.box(resolveLibraryNames(ast, sample, engine));
      if (!value.type.matches(type))
        broken.push(`${where}: ${sample} is not of the type of its parameter`);
    };
    for (const id of ids) {
      const entry = describeName(engine, id);
      const signature = engine.operatorInfo(id)?.signature?.type;
      const arms =
        typeof signature !== 'object'
          ? []
          : signature.kind === 'intersection'
            ? signature.types
            : [signature];
      const typeOf = (name: string): Type | undefined => {
        for (const arm of arms) {
          if (typeof arm !== 'object' || arm.kind !== 'signature') continue;
          const element = [...(arm.args ?? []), ...(arm.optArgs ?? [])].find(
            (e) => e.name === name
          );
          if (element !== undefined) return element.type;
        }
        return undefined;
      };
      for (const [name, doc] of Object.entries(entry?.parameters ?? {})) {
        if (doc.sample !== undefined)
          check(`${id}(${name})`, doc.sample, typeOf(name));
        for (const key of doc.keys ?? [])
          for (const text of [key.sample, key.default])
            if (text !== undefined)
              check(
                `${id}(${name}.${key.name})`,
                text,
                key.type === undefined ? undefined : parseType(key.type)
              );
      }
      // A sample by position is of the type of that parameter in every arm
      // that has it.
      (entry?.positionalParameters ?? []).forEach((doc, i) => {
        if (doc?.sample === undefined) return;
        for (const arm of arms) {
          if (typeof arm !== 'object' || arm.kind !== 'signature') continue;
          const elements = [
            ...(arm.args ?? []),
            ...(arm.optArgs ?? []),
            ...(arm.variadicArg === undefined ? [] : [arm.variadicArg]),
          ];
          const element =
            elements[Math.min(i, elements.length - 1)] ?? undefined;
          if (i >= elements.length && arm.variadicArg === undefined) continue;
          check(`${id}(#${i})`, doc.sample, element?.type);
        }
      });
    }
    return broken;
  }

  test('every sample parses and is of the type of its parameter', () => {
    expect(brokenSamples(library, names)).toEqual([]);
  });

  test('the check finds a sample by position of the wrong type', () => {
    const engine = new ComputeEngine();
    engine.declare('Twice', {
      signature: '(integer) -> integer',
      evaluate: ([x]) => x.mul(2),
      parameters: [{ sample: '"two"' }],
    });
    expect(brokenSamples(engine, ['Twice'])).toEqual([
      'Twice(#0): "two" is not of the type of its parameter',
    ]);
  });

  test('the check finds a sample of the wrong type', () => {
    const engine = new ComputeEngine();
    engine.declare('Pad', {
      signature: '(xs: list<integer>, count: integer) -> list<integer>',
      evaluate: ([xs]) => xs,
      parameters: {
        xs: { sample: '[1, 2, 3]' },
        count: { sample: '"two"' },
      },
    });
    expect(brokenSamples(engine, ['Pad'])).toEqual([
      'Pad(count): "two" is not of the type of its parameter',
    ]);
  });
});

describe('A HELD ARGUMENT READS THE NAMES OF THE CALLER', () => {
  // Tycho declares `hold function plot(series, options = {})`: a parameter
  // name must not capture a name of the caller.
  const run = (source: string) =>
    executeEpsil(new ComputeEngine(), source).value.toString();
  const PLOT_HOLD = 'hold function plot(series, options = {})';

  test('a function of the caller named as the parameter', () => {
    expect(
      run(
        `${PLOT_HOLD} { Apply(Evaluate(series), 3) }\nfunction series(x) { x^2 }\nplot(series)`
      )
    ).toBe('9');
    expect(
      run(
        `${PLOT_HOLD} { Apply(Evaluate(options), 3) }\nfunction options(x) { x + 100 }\nplot(1, options)`
      )
    ).toBe('103');
  });

  test('a variable of the caller named as the parameter', () => {
    expect(
      run(
        `${PLOT_HOLD} { Evaluate(series) }\nlet options = 5\nplot(options + 1)`
      )
    ).toBe('6');
    expect(
      run(
        `${PLOT_HOLD} { Evaluate(series) }\nfunction g(series) { plot(series * 2) }\ng(21)`
      )
    ).toBe('42');
  });
});

describe('REVIEW CASES', () => {
  test('a tag fills the fields of a key that the parameters field leaves out', () => {
    const engine = new ComputeEngine();
    engine.declare('Draw', {
      signature: '(options: dictionary) -> nothing',
      evaluate: () => engine.Nothing,
      description: '@sample options.grid true',
      parameters: { options: { keys: { grid: { type: 'boolean' } } } },
    });
    expect(describeName(engine, 'Draw')?.parameters?.options.keys).toEqual([
      { name: 'grid', type: 'boolean', sample: 'true' },
    ]);
  });

  test('an example keeps a name whose spelling the engine binds', () => {
    const engine = new ComputeEngine();
    expect(describeName(engine, 'Sin')?.examples?.[0]).toBe('sin(pi / 6)');
    executeEpsil(engine, 'let pi = 3');
    expect(describeName(engine, 'Sin')?.examples?.[0]).toBe('sin(Pi / 6)');
    const sin = epsilCompletions(engine, 'si', 2).items.find(
      (i) => i.label === 'sin'
    );
    expect(sin?.examples?.[0]).toBe('sin(Pi / 6)');
  });

  test('the code after an unclosed dictionary is not a written key', () => {
    const source = `${PLOT}plot(x, {▮\nlet a = f(1,\n  grid -> 2)`;
    expect(items(source).map((i) => i.label)).toEqual(['x', 'grid', 'color']);
    expect(
      items(`${PLOT}plot(x, {\n  x -> 1,\n  ▮\n  grid -> true\n})`).map(
        (i) => i.label
      )
    ).toEqual(['color']);
  });

  test('the examples of every clause of a function of the source', () => {
    const source =
      'function f(0) { 1 }\n/// @example f(2)\nfunction f(n) { n * f(n - 1) }\nf(▮';
    expect(help(source)?.examples).toEqual(['f(2)']);
  });
});

describe('REVIEW CASES, ROUND 2', () => {
  test('a value continued on the next line does not end the dictionary', () => {
    expect(
      items(`${PLOT}plot(x, {x -> 1 +\n  2, grid -> true, ▮})`).map(
        (i) => i.label
      )
    ).toEqual(['color']);
  });
});

describe('AN EXAMPLE AND THE NAMES OF THE SOURCE', () => {
  test('a name that the source declares keeps its MathJSON spelling', () => {
    expect(help('let pi = 3\nsin(▮')?.examples?.[0]).toBe('sin(Pi / 6)');
    expect(help('sin(▮')?.examples?.[0]).toBe('sin(pi / 6)');
    const sin = items('let pi = 3\nsi▮').find((i) => i.label === 'sin');
    expect(sin?.examples?.[0]).toBe('sin(Pi / 6)');
    const [source, offset] = at('let pi = 3\ns▮in(1)');
    expect(epsilHover(ce, source, offset)?.examples?.[0]).toBe('sin(Pi / 6)');
  });

  test('a declaration after the offset does not count', () => {
    expect(help('sin(▮)\nlet pi = 3')?.examples?.[0]).toBe('sin(pi / 6)');
  });
});

describe('AN EXAMPLE AND THE NAMES OF THE SOURCE: SCOPES', () => {
  const hoverAt = (text: string) => epsilHover(ce, ...at(text));
  test('a parameter shadows the spelling inside its function only', () => {
    expect(help('function f(pi) { sin(▮) }')?.examples?.[0]).toBe(
      'sin(Pi / 6)'
    );
    expect(help('function f(pi) { 1 }\nsin(▮')?.examples?.[0]).toBe(
      'sin(pi / 6)'
    );
    expect(hoverAt('function f(pi) { s▮in(1) }')?.examples?.[0]).toBe(
      'sin(Pi / 6)'
    );
  });

  test('a std:: name reads the names of the source too', () => {
    expect(hoverAt('let pi = 3\nstd::s▮in(1)')?.examples?.[0]).toBe(
      'sin(Pi / 6)'
    );
    expect(help('let pi = 3\nstd::sin(▮')?.examples?.[0]).toBe('sin(Pi / 6)');
  });
});

describe('DOCUMENTATION BY POSITION', () => {
  const engine = new ComputeEngine();
  engine.declare('Haversine', {
    signature: '(real) -> real',
    description: 'The haversine of an angle.',
    evaluate: ([x]) => x,
    parameters: [{ description: 'The angle, in radians.', sample: 'pi / 4' }],
  });
  engine.declare('Clamp3', {
    signature:
      '((real, real, real) -> real) & ((integer, integer, integer) -> integer)',
    evaluate: ([x]) => x,
    parameters: ['The value.', '', { description: 'The upper bound.' }],
  });

  test('a parameter with no name is documented at its position', () => {
    const result = epsilSignatureHelp(engine, 'Haversine(', 10);
    expect(result?.signatures[0].parameters[0]).toMatchObject({
      type: 'real',
      documentation: 'The angle, in radians.',
      sample: 'pi / 4',
    });
    expect(describeName(engine, 'Haversine')?.positionalParameters).toEqual([
      { documentation: 'The angle, in radians.', sample: 'pi / 4' },
    ]);
  });

  test('each arm of an overload set, and an empty entry', () => {
    const result = epsilSignatureHelp(engine, 'Clamp3(1, 2, ', 13);
    for (const signature of result!.signatures)
      expect(signature.parameters.map((p) => p.documentation)).toEqual([
        'The value.',
        undefined,
        'The upper bound.',
      ]);
    expect(describeName(engine, 'Clamp3')?.positionalParameters).toEqual([
      { documentation: 'The value.' },
      null,
      { documentation: 'The upper bound.' },
    ]);
  });

  test('the parameter filled by the piped value keeps its documentation', () => {
    const source = '1 |> Haversine(';
    const p = epsilSignatureHelp(engine, source, source.length)?.signatures[0]
      .parameters[0];
    expect(p?.documentation).toBe('The angle, in radians.');
  });
});

describe('ONE DOCUMENTATION FOR BOTH FORMS OF AN ARGUMENT', () => {
  const engine = new ComputeEngine();
  engine.declare('Pad', {
    signature: '(xs: list<integer>, count: integer) -> list<integer>',
    evaluate: ([x]) => x,
    parameters: ['The list.', { description: 'How many.', sample: '2' }],
  });

  test('a positional and a named argument show the same documentation', () => {
    for (const source of ['Pad([1], ', 'Pad([1], count: '])
      expect(
        epsilSignatureHelp(engine, source, source.length)?.signatures[0]
          .parameters[1]
      ).toMatchObject({ documentation: 'How many.', sample: '2' });
  });

  test('a documentation by position reaches the named-argument item', () => {
    const item = epsilCompletions(engine, 'Pad([1], ', 9).items.find(
      (i) => i.label === 'count'
    );
    expect(item).toMatchObject({ documentation: 'How many.', sample: '2' });
  });
});

describe('DOCUMENTATION BY POSITION: REVIEW CASES', () => {
  test('a tag fills what the list entry leaves out, field by field', () => {
    const engine = new ComputeEngine();
    engine.declare('Half', {
      signature: '(x: real) -> real',
      evaluate: ([x]) => x.div(2),
      description: 'Half of a value.\n@sample x 2',
      parameters: ['The value.'],
    });
    const p = epsilSignatureHelp(engine, 'Half(', 5)?.signatures[0]
      .parameters[0];
    expect(p).toMatchObject({ documentation: 'The value.', sample: '2' });
    const item = epsilCompletions(engine, 'Half(', 5).items.find(
      (i) => i.label === 'x'
    );
    expect(item).toMatchObject({ documentation: 'The value.', sample: '2' });
  });

  test('the keys of an options parameter with no name', () => {
    const engine = new ComputeEngine();
    engine.declare('Chart', {
      signature: '(real, dictionary) -> nothing',
      evaluate: () => engine.Nothing,
      parameters: ['', { keys: { grid: 'Show the grid.', axes: '' } }],
    });
    const labels = epsilCompletions(engine, 'Chart(1, {', 10).items.map(
      (i) => i.label
    );
    expect(labels).toEqual(['grid', 'axes']);
  });

  test('a hole or a null entry of the list skips a position', () => {
    const engine = new ComputeEngine();
    engine.declare('Pair', {
      signature: '(real, real) -> real',
      evaluate: ([x]) => x,
      // eslint-disable-next-line no-sparse-arrays
      parameters: [, 'The second.'] as never,
    });
    expect(describeName(engine, 'Pair')?.positionalParameters).toEqual([
      null,
      { documentation: 'The second.' },
    ]);
    engine.declare('Pair2', {
      signature: '(real, real) -> real',
      evaluate: ([x]) => x,
      parameters: [null, 'The second.'] as never,
    });
    expect(
      epsilSignatureHelp(engine, 'Pair2(1, ', 9)?.signatures[0].parameters[1]
        .documentation
    ).toBe('The second.');
  });
});

describe('DOCUMENTATION BY POSITION: ARMS AND REST', () => {
  test('each arm of an overload set reads its own position', () => {
    const engine = new ComputeEngine();
    engine.declare('Plot2', {
      signature:
        '((dictionary) -> nothing) & ((real, real, dictionary) -> nothing)',
      evaluate: () => engine.Nothing,
      parameters: [
        { keys: { first: 'At position 0.' } },
        '',
        { keys: { third: 'At position 2.' } },
      ],
    });
    const at = (source: string) =>
      epsilCompletions(engine, source, source.length).items.map((i) => i.label);
    expect(at('Plot2({')).toEqual(['first']);
    expect(at('Plot2(1, 2, {')).toEqual(['third']);
  });

  test('every argument of a rest parameter has its documentation', () => {
    const engine = new ComputeEngine();
    engine.declare('Merge', {
      signature: '(dictionary*) -> dictionary',
      evaluate: ([x]) => x,
      parameters: [{ keys: { a: 'The a.', b: 'The b.' } }],
    });
    const at = (source: string) =>
      epsilCompletions(engine, source, source.length).items.map((i) => i.label);
    expect(at('Merge({')).toEqual(['a', 'b']);
    expect(at('Merge({a -> 1}, {')).toEqual(['a', 'b']);
  });
});

describe('DOCUMENTATION BY POSITION: THE ARM OF A NAMED CALL', () => {
  test('a named-argument item reads the arm that the written names select', () => {
    const engine = new ComputeEngine();
    engine.declare('Mode', {
      signature:
        '((value: real, count: integer) -> real) & ((count: integer, mode: string) -> real)',
      evaluate: ([x]) => x,
      parameters: ['At position 0.', 'At position 1.'],
    });
    const source = 'Mode(mode: "fast", ';
    const item = epsilCompletions(engine, source, source.length).items.find(
      (i) => i.label === 'count'
    );
    expect(item?.documentation).toBe('At position 0.');
  });
});
