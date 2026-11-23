/**
 * The `///` comments of a protocol and of its members (CE-1730): the parser
 * carries them in the fourth operand of `DeclareProtocol`, the engine keeps
 * them in the protocol record (`ProtocolRecord.description`,
 * `ProtocolMember.description`), the serializer writes them back, and the
 * editor shows them for a protocol that a prelude declared on the engine:
 * the hover of the protocol, the signature help and the completion of a
 * member, also when the call is written `rotate(c, ▮)`, and for a receiver
 * whose type is the result type of a function of the engine.
 */

import { ComputeEngine } from '../../src/compute-engine';
import { epsilCompletions } from '../../src/epsil/completion';
import { epsilHover } from '../../src/epsil/hover';
import { epsilSignatureHelp } from '../../src/epsil/signature-help';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';

const PRELUDE = [
  '/// Things that move.',
  'protocol Movable {',
  '  /// Moves the thing by `d`.',
  '  function move(self: Self, d: real) -> Self',
  '  function stay(self: Self) -> Self',
  '}',
  'type Spot = tuple<x: real, y: real> is Movable {',
  '  function move(self: Spot, d: real) -> Spot { Spot(self.x + d, self.y) }',
  '  function stay(self: Spot) -> Spot { self }',
  '}',
  '/// A spot at `(x, y)`.',
  'function spot(x: real, y: real) -> Spot { Spot(x, y) }',
].join('\n');

const strip = (x: unknown) =>
  JSON.parse(
    JSON.stringify(x, (k, v) => (k === 'sourceOffsets' ? undefined : v))
  );

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  const { diagnostics } = executeEpsil(ce, PRELUDE);
  expect(diagnostics.filter((d) => d.severity === 'error')).toEqual([]);
  return ce;
}

describe('THE DOCUMENTATION OF A PROTOCOL IN THE ENGINE', () => {
  test('the parser carries the comments in the fourth operand', () => {
    const [ast] = parseEpsil(
      '/// The shapes.\nprotocol Shape {\n  /// The area.\n  function area(self: Self) -> real\n}'
    );
    expect(strip(ast)).toEqual({
      fn: [
        'Program',
        {
          fn: [
            'DeclareProtocol',
            { sym: 'Shape' },
            {
              fn: [
                'Dictionary',
                {
                  fn: [
                    'KeyValuePair',
                    { sym: 'area' },
                    {
                      fn: [
                        'Pair',
                        { str: 'function' },
                        { str: '(self: Self) -> real' },
                      ],
                    },
                  ],
                },
              ],
            },
            { fn: ['List'] },
            {
              fn: [
                'Dictionary',
                {
                  fn: [
                    'KeyValuePair',
                    { sym: 'description' },
                    { str: 'The shapes.' },
                  ],
                },
                {
                  fn: [
                    'KeyValuePair',
                    { sym: 'members' },
                    {
                      fn: [
                        'Dictionary',
                        {
                          fn: [
                            'KeyValuePair',
                            { sym: 'area' },
                            { str: 'The area.' },
                          ],
                        },
                      ],
                    },
                  ],
                },
              ],
            },
          ],
        },
      ],
    });
  });

  test('a protocol with no comment keeps its form', () => {
    const [ast] = parseEpsil(
      'protocol Shape { function area(self: Self) -> real }'
    );
    expect((strip(ast) as any).fn[1].fn).toHaveLength(3);
  });

  test('the record holds the comments of the protocol and of its members', () => {
    const ce = engine();
    const record = (ce as any)._protocolRegistry.Movable;
    expect(record.description).toBe('Things that move.');
    expect(record.members.move.description).toBe('Moves the thing by `d`.');
    expect(record.members.stay.description).toBeUndefined();
  });

  test('a later statement replaces the comments', () => {
    const ce = engine();
    executeEpsil(
      ce,
      'protocol Movable {\n  function move(self: Self, d: real) -> Self\n  function stay(self: Self) -> Self\n}'
    );
    const record = (ce as any)._protocolRegistry.Movable;
    expect(record.description).toBeUndefined();
    expect(record.members.move.description).toBeUndefined();
  });

  test('the host documents a protocol with ce.declareProtocol', () => {
    const ce = new ComputeEngine();
    ce.declareProtocol(
      'Sized',
      { functions: { size: '(self: Self) -> integer' } },
      { description: 'Has a size.', memberDescriptions: { size: 'The size.' } }
    );
    const record = (ce as any)._protocolRegistry.Sized;
    expect(record.description).toBe('Has a size.');
    expect(record.members.size.description).toBe('The size.');
    expect(() =>
      ce.declareProtocol(
        'Other',
        { functions: { size: '(self: Self) -> integer' } },
        { memberDescriptions: { length: 'No such member.' } }
      )
    ).toThrow(/no member "length"/);
  });

  test('the serializer writes the comments back', () => {
    const [ast] = parseEpsil(PRELUDE.split('\ntype')[0]);
    const text = serializeEpsil(ast as any);
    expect(text).toBe(
      [
        '/// Things that move.',
        'protocol Movable {',
        '  /// Moves the thing by `d`.',
        '  function move(self: Self, d: real) -> Self',
        '  function stay(self: Self) -> Self',
        '}',
      ].join('\n')
    );
    expect(strip(parseEpsil(text)[0])).toEqual(strip(ast));
  });
});

describe('THE EDITOR SHOWS THE COMMENTS OF A PROTOCOL OF THE ENGINE', () => {
  const ce = engine();
  const help = (source: string) =>
    epsilSignatureHelp(ce, source, source.length)?.signatures[0];

  test('the hover of the protocol', () => {
    expect(epsilHover(ce, 'Movable', 1)).toMatchObject({
      kind: 'type',
      detail: 'protocol Movable',
      description: ['Things that move.'],
    });
  });

  test('the hover of a member is the member, not its dispatcher', () => {
    expect(epsilHover(ce, 'move', 1)).toMatchObject({
      kind: 'function',
      detail: '(self: Self, d: real) -> Self',
      description: ['Moves the thing by `d`.'],
    });
  });

  test('a receiver made by a function of the engine has its result type', () => {
    expect(help('let s = spot(1, 2)\ns.move(')).toMatchObject({
      label: 'move(self: Spot, d: real) -> Spot',
      documentation: 'Moves the thing by `d`.',
    });
  });

  test('a member called as a function shows its declared signature', () => {
    expect(help('let s = spot(1, 2)\nmove(s, ')).toMatchObject({
      label: 'move(self: Spot, d: real) -> Spot',
      documentation: 'Moves the thing by `d`.',
    });
    // The type of the first argument is not known: `Self` is `any`.
    expect(help('move(')?.label).toBe('move(self: any, d: real) -> any');
  });

  test('the completion of a member has its comment', () => {
    const source = 'let s = spot(1, 2)\ns.mo';
    const item = epsilCompletions(ce, source, source.length).items.find(
      (i) => i.label === 'move'
    );
    expect(item).toMatchObject({
      documentation: 'Moves the thing by `d`.',
      description: ['Moves the thing by `d`.'],
    });
  });

  test('a protocol of the source shows its comments too', () => {
    const source =
      '/// Sized things.\nprotocol Sized {\n  /// The size.\n  function size(self: Self) -> integer\n}\ntype Box = tuple<n: integer> is Sized {\n  function size(self: Box) -> integer { self.n }\n}\nlet b: Box = Box(3)\nb.size(';
    expect(
      epsilSignatureHelp(new ComputeEngine(), source, source.length)
        ?.signatures[0].documentation
    ).toBe('The size.');
    expect(
      epsilHover(
        new ComputeEngine(),
        source,
        source.indexOf('protocol Sized') + 10
      )
    ).toMatchObject({ kind: 'type', description: ['Sized things.'] });
  });
});

describe('WHERE THE DOCUMENTATION OF A MEMBER DOES NOT APPLY', () => {
  test('a member named like an Object method serializes', () => {
    const source =
      'protocol Printable {\n  function toString(self: Self) -> string\n}';
    const [ast] = parseEpsil(source);
    expect(serializeEpsil(ast as any)).toBe(source);
  });

  test('a function of the engine that shadows a member is the function', () => {
    const ce = new ComputeEngine();
    executeEpsil(
      ce,
      'protocol Pushable {\n  /// Pushes.\n  function nudge(self: Self) -> real\n}\n/// A plain nudge.\nfunction nudge(x: real, y: real) { x + y }'
    );
    expect(epsilHover(ce, 'nudge', 1)).toMatchObject({
      detail: '(x: real, y: real) -> real',
      description: ['A plain nudge.'],
    });
    const help = epsilSignatureHelp(ce, 'nudge(', 6)?.signatures[0];
    expect(help?.label).toBe('nudge(x: real, y: real) -> real');
  });

  test('a function of the engine shadows a member that the source declares', () => {
    const ce = new ComputeEngine();
    executeEpsil(ce, 'function nudge(x: real, y: real) { x + y }');
    const source =
      'protocol Pushable {\n  function nudge(self: Self) -> real\n}\nnudge(';
    expect(
      epsilSignatureHelp(ce, source, source.length)?.signatures[0].label
    ).toBe('nudge(x: real, y: real) -> real');
  });

  test('a value made by a function that maps over a list is not typed by its signature', () => {
    const source = 'let ys = sin([1, 2])\nys.';
    const items = epsilCompletions(
      new ComputeEngine(),
      source,
      source.length
    ).items;
    expect(items.some((i) => i.label === 're')).toBe(false);
  });

  test('a protocol declared below the call does not describe it', () => {
    const source =
      'sin(\nprotocol Waves {\n  function sin(self: Self, k: integer) -> real\n}';
    const help = epsilSignatureHelp(new ComputeEngine(), source, 4);
    expect(help?.signatures[0].label).not.toContain('k: integer');
  });

  test('two protocols of the source that declare a member do not choose one', () => {
    const source = [
      'protocol A {\n  /// From A.\n  function size(self: Self) -> integer\n}',
      'protocol B {\n  /// From B.\n  function size(self: Self, k: real) -> real\n}',
      'size(',
    ].join('\n');
    const help = epsilSignatureHelp(new ComputeEngine(), source, source.length);
    expect(help?.signatures[0]?.documentation).not.toBe('From A.');
  });
});
