import { Expression } from '../../../src/math-json/math-json-format';
import { latex, engine as ce } from '../../utils';

describe('POWER', () => {
  test('Power Invalid forms', () => {
    expect(latex(['Power'])).toMatchInlineSnapshot(
      `\\error{\\blacksquare}^{\\error{\\blacksquare}}`
    );
    expect(
      latex(['Power', null as unknown as Expression])
    ).toMatchInlineSnapshot(`\\error{\\blacksquare}^{\\error{\\blacksquare}}`);
    expect(
      latex(['Power', undefined as unknown as Expression])
    ).toMatchInlineSnapshot(`\\error{\\blacksquare}^{\\error{\\blacksquare}}`);
    expect(latex(['Power', 1])).toMatchInlineSnapshot(
      `1^{\\error{\\blacksquare}}`
    );
    expect(latex(['Power', NaN])).toMatchInlineSnapshot(
      `\\operatorname{NaN}^{\\error{\\blacksquare}}`
    );
    expect(latex(['Power', Infinity])).toMatchInlineSnapshot(
      `\\infty^{\\error{\\blacksquare}}`
    );
  });
});

describe('INVERSE FUNCTION', () => {
  test('Valid forms', () => {
    expect(latex(['Apply', ['InverseFunction', 'Sin']])).toMatchInlineSnapshot(
      `\\arcsin(\\error{\\blacksquare})`
    );
    expect(latex(['Apply', ['InverseFunction', 'f']])).toMatchInlineSnapshot(
      `f^{-1}()`
    );
  });
});

describe('COMPLEX SYMBOLS', () => {
  test('\\mathord{x_{\\mathrm{max}}}', () =>
    expect(
      ce.parse('\\mathord{x_{\\mathrm{max}}}').canonical.toJSON()
    ).toMatchInlineSnapshot(`x_max`));
});

describe('SUPSUB', () => {
  test('Superscript', () => {
    expect(ce.parse('2^2')).toMatchInlineSnapshot(`["Square", 2]`);
    expect(ce.parse('x^t')).toMatchInlineSnapshot(`["Power", "x", "t"]`);
    expect(ce.parse('2^{10}')).toMatchInlineSnapshot(`["Power", 2, 10]`);
    expect(ce.parse('\\pi^2')).toMatchInlineSnapshot(`["Square", "Pi"]`);
    expect(ce.parse('2^23')).toMatchInlineSnapshot(
      `["Multiply", 3, ["Square", 2]]`
    );
    expect(ce.parse('2^\\pi')).toMatchInlineSnapshot(`["Power", 2, "Pi"]`);
    expect(ce.parse('2^\\frac12')).toMatchInlineSnapshot(`["Sqrt", 2]`);
    expect(ce.parse('2^{3^4}')).toMatchInlineSnapshot(
      `["Power", 2, ["Power", 3, 4]]`
    );
    expect(ce.parse('2^{10}')).toMatchInlineSnapshot(`["Power", 2, 10]`);
    expect(ce.parse('2^{-2}')).toMatchInlineSnapshot(
      `["Divide", 1, ["Square", 2]]`
    );
    expect(ce.parse('2^3^4')).toMatchInlineSnapshot(
      `["Power", 2, ["List", 3, 4]]`
    );
    expect(ce.parse('2^{3^4}')).toMatchInlineSnapshot(
      `["Power", 2, ["Power", 3, 4]]`
    );
    expect(ce.parse('12^34.5')).toMatchInlineSnapshot(
      `["Multiply", 4.5, ["Power", 12, 3]]`
    );
    expect(ce.parse('x^2')).toMatchInlineSnapshot(`["Square", "x"]`);
    expect(ce.parse('x^{x+1}')).toMatchInlineSnapshot(
      `["Power", "x", ["Add", "x", 1]]`
    );
  });
  test('Subscript', () => {
    expect(ce.parse('x_0')).toMatchInlineSnapshot(`["At", "x", 0]`);
    expect(ce.parse('x^2_0')).toMatchInlineSnapshot(`["Square", "x_0"]`);
    expect(ce.parse('x_0^2')).toMatchInlineSnapshot(`["At", "x", 0]`);
    expect(ce.parse('x_{n+1}')).toMatchInlineSnapshot(
      `["At", "x", ["Add", "n", 1]]`
    );
    expect(ce.parse('x_n_{+1}')).toMatchInlineSnapshot(`
      [
        "At",
        "x",
        [
          "Error",
          ["ErrorCode", "'incompatible-domain'", "Values", "Anything"],
          ["At", "n", 1]
        ]
      ]
    `);
  });
  test('Pre-sup, pre-sub', () => {
    expect(ce.parse('_p^qx')).toMatchInlineSnapshot(
      `["Multiply", "_", "x", ["Power", "p", "q"]]`
    ); // @fixme: nope...
    expect(ce.parse('_p^qx_r^s')).toMatchInlineSnapshot(
      `["Triple", "_", ["Power", "p", "q"], ["At", "x", ["Power", "r", "s"]]]`
    ); // @fixme: nope...
    expect(ce.parse('_{p+1}^{q+1}x_{r+1}^{s+1}')).toMatchInlineSnapshot(`
      [
        "Tuple",
        "_",
        ["Power", ["Add", "p", 1], ["Add", "q", 1]],
        [
          "Power",
          [
            "Error",
            ["ErrorCode", "'incompatible-domain'", "Numbers", "Anything"],
            ["At", "x", ["Add", "r", 1]]
          ],
          ["Add", "s", 1]
        ]
      ]
    `); // @fixme: nope...
    expect(ce.parse('x{}_{p+1}^{q+1}x_{r+1}^{s+1}')).toMatchInlineSnapshot(`
      [
        "Tuple",
        [
          "Power",
          [
            "Error",
            ["ErrorCode", "'incompatible-domain'", "Numbers", "Symbols"],
            ["Subscript", "x", ["Add", "p", 1]]
          ],
          ["Add", "q", 1]
        ],
        [
          "Power",
          [
            "Error",
            ["ErrorCode", "'incompatible-domain'", "Numbers", "Anything"],
            ["At", "x", ["Add", "r", 1]]
          ],
          ["Add", "s", 1]
        ]
      ]
    `); // @fixme: nope...
  });
  test('Sup/Sub groups', () => {
    expect(ce.parse('(x+1)^{n-1}')).toMatchInlineSnapshot(
      `["Power", ["Add", "x", 1], ["Subtract", "n", 1]]`
    );
    expect(ce.parse('(x+1)_{n-1}')).toMatchInlineSnapshot(
      `["Subscript", ["Add", "x", 1], ["Add", "n", -1]]`
    );
    expect(ce.parse('(x+1)^n_0')).toMatchInlineSnapshot(
      `["Power", ["Subscript", ["Add", "x", 1], 0], "n"]`
    );
    expect(ce.parse('^p_q{x+1}^n_0')).toMatchInlineSnapshot(`
      [
        "Superscript",
        ["Error", "'missing'", ["LatexString", "'^'"]],
        ["Error", "'missing'"]
      ]
    `); // @fixme: nope...
    expect(ce.parse('^{12}_{34}(x+1)^n_0')).toMatchInlineSnapshot(
      `["Superscript", ["Error", "'missing'", ["LatexString", "'^'"]], 12]`
    ); // @fixme: nope...
  });
  test('Accents', () => {
    expect(ce.parse('\\vec{x}')).toMatchInlineSnapshot(`["OverVector", "x"]`);
    expect(ce.parse('\\vec{AB}')).toMatchInlineSnapshot(
      `["OverVector", ["Multiply", "A", "B"]]`
    ); // @fixme: nope...
    expect(ce.parse('\\vec{AB}^{-1}')).toMatchInlineSnapshot(
      `["Divide", 1, ["OverVector", ["Multiply", "A", "B"]]]`
    );
  });
});

describe('PRIME', () => {
  test('Valid forms', () => {
    expect(ce.parse("f'")).toMatchInlineSnapshot(`["Derivative", "f"]`);
    expect(ce.parse("f''")).toMatchInlineSnapshot(`["Derivative", "f", 2]`);
    expect(ce.parse("f'''")).toMatchInlineSnapshot(`["Derivative", "f", 3]`);
    expect(ce.parse('f\\prime')).toMatchInlineSnapshot(`["Derivative", "f"]`);
    expect(ce.parse('f\\prime\\prime')).toMatchInlineSnapshot(
      `["Derivative", "f", 2]`
    );
    expect(ce.parse('f\\prime\\prime\\prime')).toMatchInlineSnapshot(
      `["Derivative", "f", 3]`
    );
    expect(ce.parse('f\\doubleprime')).toMatchInlineSnapshot(
      `["Derivative", "f", 2]`
    );
    expect(ce.parse('f^{\\prime}')).toMatchInlineSnapshot(
      `["Derivative", "f"]`
    );
    expect(ce.parse('f^{\\prime\\prime}')).toMatchInlineSnapshot(
      `["Derivative", "f", 2]`
    );
    expect(ce.parse('f^{\\prime\\prime\\prime}')).toMatchInlineSnapshot(
      `["Derivative", "f", 3]`
    );
    expect(ce.parse('f^{\\doubleprime}')).toMatchInlineSnapshot(
      `["Derivative", "f", 2]`
    );
  });
});
