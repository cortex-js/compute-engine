import { serializeCortex } from '../../src/cortex/serialize-cortex';
import { parseCortex } from '../../src/cortex/parse-cortex';
import { MathJsonExpression } from '../../src/math-json/types';

//
// Formatter coverage (Phase 3, item 3).
//
// `formatter.ts` had no unit tests of its own. These exercise it through
// `serializeCortex` at small margins (to force wrapping) and with
// `fancySymbols` (to exercise the alternate operator/separator spacing). The
// first block is a regression test for the continuation-line indentation bug
// (a stacked collection indented its first item by one level and every
// following item by two).
//

const NARROW = { margin: 15, softMargin: 10 } as const;

function leadingSpaces(line: string): number {
  return /^ */.exec(line)![0].length;
}

describe('CORTEX FORMATTER — wrapping', () => {
  test('a long list wraps one item per line, uniformly indented', () => {
    const list: MathJsonExpression = [
      'List',
      1,
      2,
      3,
      4,
      5,
      6,
      7,
      8,
    ];
    const out = serializeCortex(list, NARROW);
    const lines = out.split('\n');

    // Opening/closing fences on their own lines.
    expect(lines[0]).toBe('[');
    expect(lines[lines.length - 1]).toBe(']');

    // Every item line is indented to the SAME column (2 spaces). Before the
    // fix, the first item was at 2 and the rest at 4.
    const itemIndents = lines.slice(1, -1).map(leadingSpaces);
    expect(new Set(itemIndents).size).toBe(1);
    expect(itemIndents[0]).toBe(2);

    // Each item is present, in order.
    expect(lines.slice(1, -1).map((l) => l.trim().replace(/,$/, ''))).toEqual([
      '1',
      '2',
      '3',
      '4',
      '5',
      '6',
      '7',
      '8',
    ]);
  });

  test('a nested stacked collection indents by one level (2 spaces) per depth', () => {
    const expr: MathJsonExpression = [
      'List',
      'aaaaaaaa',
      ['List', 111, 222, 333, 444, 555],
    ];
    const out = serializeCortex(expr, { margin: 12, softMargin: 8 });
    const lines = out.split('\n');

    // Outer items (the symbol and the inner `[`) at column 2.
    expect(lines[0]).toBe('['); // outer open at column 0
    expect(leadingSpaces(lines[1])).toBe(2); // aaaaaaaa,
    // The inner open `[` is the second bracket-only line (skip the outer one).
    const innerOpen = lines.findIndex((l, i) => i > 0 && l.trim() === '[');
    expect(leadingSpaces(lines[innerOpen])).toBe(2);

    // Inner (depth-2) items at column 4, uniformly.
    const innerNumberIndents = lines
      .filter((l) => /\d/.test(l))
      .map(leadingSpaces);
    expect(new Set(innerNumberIndents)).toEqual(new Set([4]));
  });

  test('a list that fits on one line is not wrapped', () => {
    expect(serializeCortex(['List', 1, 2, 3])).toBe('[1, 2, 3]');
  });
});

describe('CORTEX FORMATTER — interpolated strings', () => {
  test('a short interpolation stays inline', () => {
    expect(serializeCortex(['String', "'value: '", ['Add', 'x', 'y']])).toBe(
      '"value: \\(x + y)"'
    );
  });

  test('a long interpolation still serializes to a single string literal', () => {
    const expr: MathJsonExpression = [
      'String',
      "'the sum is '",
      ['Add', 'alpha', 'beta', 'gamma', 'delta'],
      "' and that is all'",
    ];
    const out = serializeCortex(expr, NARROW);
    // The interpolation must remain a well-formed `"…"` literal (opening and
    // closing double quotes, escaped interpolation).
    expect(out.startsWith('"')).toBe(true);
    expect(out.endsWith('"')).toBe(true);
    expect(out).toContain('\\(');
  });
});

describe('CORTEX FORMATTER — fancySymbols spacing', () => {
  const INFIX = '\u205f'; // Medium Mathematical Space around infix operators
  const REL = '\u2005'; // Four-Per-Em Space around relational operators
  const SEP = '\u2009'; // Thin Space after separators

  test('infix operator uses the fancy surrounding space', () => {
    expect(serializeCortex(['Add', 'a', 'b'], { fancySymbols: true })).toBe(
      `a${INFIX}+${INFIX}b`
    );
    expect(
      serializeCortex(['Multiply', 'a', 'b'], { fancySymbols: true })
    ).toBe(`a${INFIX}×${INFIX}b`);
  });

  test('relational operator uses the fancy relational space + glyph', () => {
    expect(
      serializeCortex(['LessEqual', 'a', 'b'], { fancySymbols: true })
    ).toBe(`a${REL}⩽${REL}b`);
  });

  test('separator uses the fancy thin space', () => {
    expect(serializeCortex(['List', 1, 2], { fancySymbols: true })).toBe(
      `[1,${SEP}2]`
    );
  });

  test('fancy spacing survives wrapping at a small margin', () => {
    const out = serializeCortex(['List', 'aa', 'bb', 'cc', 'dd', 'ee'], {
      fancySymbols: true,
      margin: 8,
      softMargin: 5,
    });
    // Wrapped, but the thin separator space that used to dangle at the end of
    // each item line is now trimmed (see the trailing-whitespace regression
    // below); the items and fences are intact.
    expect(out.split('\n')[0]).toBe('[');
    expect(out).toContain('aa,');
    expect(out).toContain('ee,');
  });
});

describe('CORTEX FORMATTER — no trailing whitespace', () => {
  // The stacked/wrapped layout used to leave the separator/operator padding
  // (a plain or "fancy" space) dangling before each line break. Assert every
  // line of a wrapped output is free of trailing whitespace, for both the
  // default and the fancySymbols spacing.
  const TRAILING = /[ \t\u2005\u2009\u205f]$/;

  test('default spacing: no line ends with whitespace when wrapped', () => {
    const out = serializeCortex(['List', 1, 2, 3, 4, 5, 6, 7, 8], NARROW);
    expect(out).toContain('\n'); // actually wrapped
    for (const line of out.split('\n')) expect(TRAILING.test(line)).toBe(false);
  });

  test('fancySymbols spacing: no line ends with whitespace when wrapped', () => {
    const out = serializeCortex(['List', 'aa', 'bb', 'cc', 'dd', 'ee'], {
      fancySymbols: true,
      margin: 8,
      softMargin: 5,
    });
    expect(out).toContain('\n'); // actually wrapped
    for (const line of out.split('\n')) expect(TRAILING.test(line)).toBe(false);
  });
});

describe('CORTEX FORMATTER — a wrapped operator chain has no dangling operator', () => {
  // An UNFENCED list (`fmt.list`) is an infix-operator chain, and its separator
  // is the operator itself. The wrapped layout used to emit the separator after
  // EVERY element, including the last — with no closing fence to absorb it, the
  // output ended in a dangling operator and did not re-parse at all
  // (`a +\nb + c +` → `unexpected-symbol "+"`). Fenced lists are unaffected: a
  // trailing `,` before `]` or `;` before `}` is legal and stays.
  const TRAILING_OPERATOR = /[-+*/%^&|<>=!]+$/;

  test('a wrapped Add chain ends with an operand, not an operator', () => {
    const out = serializeCortex(
      ['Add', 'accumulator', 'someLongVariableName', 'x', 'y'],
      { margin: 30 }
    );
    expect(out).toContain('\n'); // actually wrapped
    expect(TRAILING_OPERATOR.test(out)).toBe(false);
  });

  test('the wrapped output re-parses', () => {
    for (const expr of [
      ['Add', 'accumulator', 'someLongVariableName', 'x', 'y'],
      ['Multiply', 'alpha', 'betaLongName', 'gammaName', 'd'],
      ['And', 'firstCondition', 'secondCondition', 'thirdCondition'],
    ] as MathJsonExpression[]) {
      const out = serializeCortex(expr, { margin: 25 });
      expect(out).toContain('\n');
      const [, diagnostics] = parseCortex(out);
      expect(diagnostics).toEqual([]);
    }
  });

  test('a fenced list keeps its trailing separator (which re-parses)', () => {
    const out = serializeCortex(['List', 1, 2, 3, 4, 5, 6, 7, 8], NARROW);
    expect(out.split('\n').slice(-2)[0].trim()).toBe('8,');
    expect(parseCortex(out)[1]).toEqual([]);
  });
});

describe('CORTEX FORMATTER — the `if` block form stacks conventionally', () => {
  // A `StackBlock` aligns continuation lines to the column where the stack
  // BEGINS. Handing the branches to `fencedList` anchors the body at the `{`,
  // which for a statement block staircases it far to the right. The block form
  // instead builds an outer stack anchored at the `if`, so the body sits one
  // indent in and the closing braces line up under the `if`.
  const longBody: MathJsonExpression = [
    'Block',
    ['Assign', 'accumulator', ['Add', 'accumulator', 'someLongVariableName']],
    ['Multiply', 'accumulator', 2],
  ];

  test('a long if/else stacks with a 2-space body indent', () => {
    const out = serializeCortex([
      'If',
      ['Greater', 'someLongVariableName', 0],
      longBody,
      ['Block', 0],
    ]);
    expect(out.split('\n')).toEqual([
      'if someLongVariableName > 0 {',
      '  accumulator = accumulator + someLongVariableName',
      '  accumulator * 2',
      '} else {',
      '  0',
      '}',
    ]);
  });

  test('an else-if chain keeps every clause at the same column', () => {
    const out = serializeCortex([
      'If',
      ['Greater', 'n', 0],
      longBody,
      ['If', ['Less', 'n', 0], ['Block', ['Negate', 'n']], ['Block', 0]],
    ]);
    const heads = out.split('\n').filter((l) => /^[^ ]/.test(l));
    expect(heads).toEqual(['if n > 0 {', '} else if n < 0 {', '} else {', '}']);
  });

  test('a nested if indents one level per depth', () => {
    const out = serializeCortex(
      [
        'If',
        'outerCondition',
        [
          'Block',
          [
            'If',
            'innerCondition',
            ['Block', ['Assign', 'x', 1], ['Add', 'x', 1]],
            ['Block', 2],
          ],
        ],
        ['Block', 3],
      ],
      { margin: 30 }
    );
    expect(out.split('\n')).toEqual([
      'if outerCondition {',
      '  if innerCondition {',
      '    x = 1',
      '    x + 1',
      '  } else {',
      '    2',
      '  }',
      '} else {',
      '  3',
      '}',
    ]);
  });

  test('a short if still fits on one line', () => {
    expect(serializeCortex(['If', 'c', ['Block', 1], ['Block', 2]])).toBe(
      'if c {1} else {2}'
    );
  });

  // `do { … }` is the other keyword-introduced statement block and gets the
  // same layout: anchored at the keyword, not at the brace.
  test('a nested do-block stacks under its keyword', () => {
    const out = serializeCortex(
      [
        'someFunctionName',
        ['Block', ['Assign', 'x', 1], ['Add', 'x', 1], ['Multiply', 'x', 2]],
      ],
      { margin: 24 }
    );
    expect(out.split('\n')).toEqual([
      'someFunctionName(do {',
      '                   x = 1',
      '                   x + 1',
      '                   x * 2',
      '                 })',
    ]);
    expect(parseCortex(out)[1]).toEqual([]);
  });

  test('every stacked layout re-parses', () => {
    for (const margin of [80, 30, 24]) {
      const out = serializeCortex(
        ['If', 'condition', longBody, ['Block', 0]],
        { margin }
      );
      expect(parseCortex(out)[1]).toEqual([]);
    }
  });
});

describe('CORTEX FORMATTER — string literals keep interior spaces', () => {
  // The trailing-whitespace trim operates only at stacked-fragment ends. A
  // string literal is always emitted as a single inline `"…"` block (interior
  // line breaks are escaped to `\n`), so spaces at the end of a line inside a
  // `"""` multi-line literal must survive serialization and a round-trip.
  test('spaces before an escaped newline are preserved', () => {
    const [value] = parseCortex('"""\nhello   \nworld\n"""');
    // The multi-line literal keeps the three spaces at the end of the first
    // interior line.
    expect((value as { str: string }).str).toBe('hello   \nworld');

    const out = serializeCortex(value);
    expect(out).toBe('"hello   \\nworld"');

    // Round-trip: re-parsing the serialized literal yields the same string.
    const [reparsed] = parseCortex(out);
    expect((reparsed as { str: string }).str).toBe('hello   \nworld');
  });
});
