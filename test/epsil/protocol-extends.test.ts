/**
 * PROTOCOL EXTENSION in Epsil — `protocol A extends B, C { … }`.
 *
 * The `extends` tail of a `protocol` statement names the protocols this one
 * extends, separated by commas. `extends` is a soft keyword: it is read only
 * in this position, so a symbol named `extends` stays legal everywhere else.
 * The statement lowers to `["DeclareProtocol", name, members, ["List",
 * parent, …]]`, with the members operand required (`["Dictionary"]` when the
 * protocol has no members of its own) so that the position of the parents
 * is fixed; with no tail, the statement keeps its two-operand form.
 *
 * The engine side (closure, expansion of a conformance, diagnostics) is
 * tested through the host API in
 * `test/compute-engine/protocol-extends.test.ts`; this file tests the Epsil
 * spelling: the parser, the serializer, and the statements end to end.
 *
 * Source: `docs/plans/2026-10-31-protocol-refinement.md`, rules R1–R10.
 */
import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil } from '../../src/epsil/execute-epsil';
import { parseEpsil } from '../../src/epsil/parse-epsil';
import { serializeEpsil } from '../../src/epsil/serialize-epsil';
import { validEpsil } from '../utils';

let ce: ComputeEngine;

beforeEach(() => {
  ce = new ComputeEngine();
});

/** The diagnostic messages (code + arguments) of a parse, in order. */
function parseDiagnostics(source: string): unknown[] {
  const [, diagnostics] = parseEpsil(source);
  return diagnostics.map((d) => d.message);
}

/** Run an Epsil batch and return its final value as a string. */
function run(source: string): string {
  return String(executeEpsil(ce, source).value);
}

/** Every diagnostic of a batch, flattened to text. */
function messages(source: string): string[] {
  return executeEpsil(ce, source).diagnostics.map((d) =>
    (Array.isArray(d.message) ? d.message : [d.message]).map(String).join(' | ')
  );
}

const PARTIAL_ORDER =
  'protocol PartialOrder {\n  function compare(self: Self, other: Self) -> integer\n}';
const FLOOR_ORDER =
  'protocol FloorOrder extends PartialOrder {\n  function floor(self: Self) -> integer\n}';
const MONEY = 'type Money = tuple<cents: integer>';
const MONEY_IS_FLOOR_ORDER = [
  'type Money is FloorOrder {',
  '  function compare(self: Money, other: Money) -> integer { self.cents - other.cents }',
  '  function floor(self: Money) -> integer { self.cents }',
  '}',
].join('\n');

describe('PARSING the `extends` tail', () => {
  test('the parents lower to a third `List` operand', () => {
    expect(validEpsil('protocol A extends B, C {}')).toStrictEqual([
      'DeclareProtocol',
      'A',
      ['Dictionary'],
      ['List', 'B', 'C'],
    ]);
  });

  test('a protocol with members and one parent', () => {
    expect(
      validEpsil(
        'protocol A extends B {\n  function m(self: Self) -> integer\n}'
      )
    ).toStrictEqual([
      'DeclareProtocol',
      'A',
      [
        'Dictionary',
        [
          'KeyValuePair',
          'm',
          [
            'Pair',
            { str: 'function' },
            { str: '(self: Self) -> integer' },
          ],
        ],
      ],
      ['List', 'B'],
    ]);
  });

  test('with no tail, the two-operand form is unchanged', () => {
    expect(validEpsil('protocol Copyable {}')).toStrictEqual([
      'DeclareProtocol',
      'Copyable',
    ]);
  });

  test('a hard-reserved parent name is written in its verbatim form', () => {
    expect(validEpsil('protocol A extends `if` {}')).toStrictEqual([
      'DeclareProtocol',
      'A',
      ['Dictionary'],
      ['List', 'if'],
    ]);
  });

  test('`extends` is a soft keyword: a symbol of that name stays legal', () => {
    expect(parseDiagnostics('let extends = 2\nextends + 1')).toEqual([]);
    expect(run('let extends = 2\nextends + 1')).toBe('3');
  });

  test('a missing name after `extends` or after a comma', () => {
    expect(parseDiagnostics('protocol A extends {}')).toEqual([
      ['protocol-name-expected'],
    ]);
    expect(parseDiagnostics('protocol A extends B, {}')).toEqual([
      ['protocol-name-expected'],
    ]);
    expect(parseDiagnostics('protocol A extends let {}')).toEqual([
      ['protocol-name-expected'],
    ]);
    expect(parseDiagnostics('protocol A extends if {}')).toEqual([
      ['reserved-word', 'if'],
    ]);
  });

  test('a missing `{` after the parent list', () => {
    expect(parseDiagnostics('protocol A extends B C {}')).toEqual([
      ['opening-bracket-expected', '{'],
    ]);
  });

  test('an unknown parent is not a parse error: the engine reports it', () => {
    expect(parseDiagnostics('protocol Z extends Nope {}')).toEqual([]);
    expect(run('protocol Z extends Nope {}')).toContain('protocol-unknown');
  });
});

describe('SERIALIZING the `extends` tail round-trips', () => {
  test.each([
    ['protocol A extends B {}'],
    ['protocol A extends B, C {}'],
    ['protocol A extends `if`, C {}'],
    ['protocol A extends B {\n  function m(self: Self) -> integer\n}'],
    ['protocol A {\n  function m(self: Self) -> integer\n}'],
    ['protocol A {}'],
  ])('%s', (src) => {
    const [ast, diagnostics] = parseEpsil(src);
    expect(diagnostics).toEqual([]);
    const text = serializeEpsil(ast!);
    expect(text).toBe(src);
    expect(validEpsil(text)).toStrictEqual(validEpsil(src));
  });

  test('a parent named by a contextual statement word is printed verbatim', () => {
    const src = 'protocol `alias` {}\nprotocol Q extends `alias` {}';
    const [ast, diagnostics] = parseEpsil(src);
    expect(diagnostics).toEqual([]);
    const text = serializeEpsil(ast!);
    expect(text).toContain('extends `alias`');
    expect(parseEpsil(text)[1]).toEqual([]);
    expect(validEpsil(text)).toStrictEqual(validEpsil(src));
  });

  test('a conformance to a protocol named by a contextual statement word is printed verbatim', () => {
    const src = 'protocol `alias` {}\ntype integer is `alias`';
    const [ast, diagnostics] = parseEpsil(src);
    expect(diagnostics).toEqual([]);
    const text = serializeEpsil(ast!);
    expect(text).toContain('is `alias`');
    expect(parseEpsil(text)[1]).toEqual([]);
    expect(validEpsil(text)).toStrictEqual(validEpsil(src));
  });

  test('an empty parent list is the same as no list, and is not printed', () => {
    expect(
      serializeEpsil(['DeclareProtocol', 'A', ['Dictionary'], ['List']])
    ).toBe('protocol A {}');
  });
});

describe('a protocol hierarchy in Epsil, end to end', () => {
  test('one block implements the closure; the type conforms to each ancestor', () => {
    expect(
      run(
        [
          PARTIAL_ORDER,
          FLOOR_ORDER,
          MONEY,
          MONEY_IS_FLOOR_ORDER,
          'compare(Money(3), Money(5))',
        ].join('\n')
      )
    ).toBe('-2');
    expect(run('floor(Money(7))')).toBe('7');
    expect(ce.conformsTo('Money', 'FloorOrder')).toBe(true);
    expect(ce.conformsTo('Money', 'PartialOrder')).toBe(true);
  });

  test('an inherited member is qualified by the protocol that declares it', () => {
    run([PARTIAL_ORDER, FLOOR_ORDER, MONEY, MONEY_IS_FLOOR_ORDER].join('\n'));
    expect(run('let y = Money(4)\ny.(PartialOrder.compare)(Money(1))')).toBe(
      '3'
    );
    // The dot form of a FUNCTION member gives the same hint as the call form.
    const hint =
      '`compare` is a member of `PartialOrder`, which `FloorOrder` extends; write `PartialOrder.compare`';
    const dot = run('let x = Money(4)\nx.(FloorOrder.compare)(Money(1))');
    expect(dot).toContain('protocol-member-unknown');
    expect(dot).toContain(hint);
    const call = run('FloorOrder.compare(Money(1), Money(2))');
    expect(call).toContain(hint);
  });

  test('a replacement that gives a descendant a member conflict is reported at the end of each batch', () => {
    run(
      [
        'protocol P {}',
        'protocol Q extends P {\n  function m(self: Self) -> integer\n}',
      ].join('\n')
    );
    // The edited cell moves `m` into `P`, but does not declare `Q` again.
    const conflict =
      'protocol-extends-member-conflict | Q | `m` is declared by `Q` and by `P`, which `Q` extends; a member name can be declared by only one protocol of a closure. Remove `m` from one of the two protocols';
    expect(
      messages('protocol P {\n  function m(self: Self) -> integer\n}\n1')
    ).toEqual([conflict]);
    // A later batch reports it again, until `Q` is declared again without `m`.
    expect(messages('1')).toEqual([conflict]);
    expect(messages('protocol Q extends P {}\n1')).toEqual([]);
    expect(messages('1')).toEqual([]);
  });
});
