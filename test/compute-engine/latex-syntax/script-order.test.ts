import { ComputeEngine } from '../../../src/compute-engine';

/**
 * A subscript has the same reading whether the superscript comes before it
 * (`x^2_{01}`) or after it (`x_{01}^2`), on each base kind: a letter, a
 * Greek letter, a command, a constant and a primed symbol, in each grammar.
 * The symbol parser joins a subscript to the symbol name and keeps its text
 * (`x_{01}` is the symbol `x_01`). A subscript after a superscript had the
 * reading of the generic `_` parselet, where the number value of `01`
 * dropped the zero (`x^2_{01}` was `x_1^2`).
 *
 * The constant `π` also has the reading of `\pi`: `π_{01}` is `Pi_01`, as
 * `\pi_{01}` is, and it was `Pi_1`.
 *
 * Each input is read on a new engine, as a host does.
 */

function parse(
  input: string,
  strict: boolean
): {
  json: string;
  codes: string[];
  undeclared: unknown[];
} {
  const e = new ComputeEngine().parse(input, { strict, diagnostics: true });
  const diagnostics = e.parseDiagnostics ?? [];
  return {
    json: JSON.stringify(e.json),
    codes: diagnostics
      .filter((d) => d.code.startsWith('ambiguous-'))
      .map((d) => d.code),
    undeclared: diagnostics
      .filter((d) => d.code === 'undeclared-symbol')
      .map((d) => d.detail?.name),
  };
}

/** Each pair reads the same, reports the same codes and the same
 * undeclared names, and has the reading `json`. */
function expectSameReading(
  strict: boolean,
  cases: [string, string, string][]
): void {
  test.each(cases)('%s is %s', (first, second, json) => {
    const a = parse(first, strict);
    const b = parse(second, strict);
    expect(a.json).toBe(json);
    expect(b.json).toBe(json);
    expect(a.codes).toEqual(b.codes);
    expect(a.undeclared).toEqual(b.undeclared);
  });
}

describe('a braced subscript, strict grammar', () => {
  expectSameReading(true, [
    ['x^2_{01}', 'x_{01}^2', '["Power","x_01",2]'],
    ['\\alpha^2_{01}', '\\alpha_{01}^2', '["Power","alpha_01",2]'],
    ['θ^2_{01}', 'θ_{01}^2', '["Power","theta_01",2]'],
    ['\\pi^2_{01}', '\\pi_{01}^2', '["Power","Pi_01",2]'],
    ['π^2_{01}', 'π_{01}^2', '["Power","Pi_01",2]'],
    ['e^2_{01}', 'e_{01}^2', '["Power","e_01",2]'],
    ['x^2_{a1}', 'x_{a1}^2', '["Power","x_a1",2]'],
    [
      '\\operatorname{speed}^2_{0}',
      '\\operatorname{speed}_{0}^2',
      '["Power","speed_0",2]',
    ],
    ["x'^2_{01}", "x_{01}'^2", '["Power",["Prime","x_01"],2]'],
  ]);
});

describe('a braced subscript, non-strict grammar', () => {
  expectSameReading(false, [
    ['x^2_{01}', 'x_{01}^2', '["Power","x_01",2]'],
    ['\\alpha^2_{01}', '\\alpha_{01}^2', '["Power","alpha_01",2]'],
    ['π^2_{01}', 'π_{01}^2', '["Power","Pi_01",2]'],
    ['x^2_{a1}', 'x_{a1}^2', '["Power","x_a1",2]'],
  ]);
});

describe('an unbraced subscript, non-strict grammar', () => {
  expectSameReading(false, [
    ['x^2_01', 'x_01^2', '["Power","x_01",2]'],
    ['\\alpha^2_01', '\\alpha_01^2', '["Power","alpha_01",2]'],
    ['θ^2_01', 'θ_01^2', '["Power","theta_01",2]'],
    ['\\pi^2_01', '\\pi_01^2', '["Power","Pi_01",2]'],
    ['π^2_01', 'π_01^2', '["Power","Pi_01",2]'],
    ['x^2_max', 'x_max^2', '["Power","x_max",2]'],
    ['x^2_12', 'x_12^2', '["Power","x_12",2]'],
    ["\\alpha'^2_01", "\\alpha_01'^2", '["Power",["Prime","alpha_01"],2]'],
  ]);
  // The subscript ends before the letter. The letter after a subscript
  // that comes first takes the superscript (`x_1y^2` is `x_1·y^2`), so
  // only the subscript and the code are compared.
  test.each([
    ['x^2_1y', 'x_1y', '["Multiply","y",["Power","x_1",2]]'],
    ['x^2_05y', 'x_05y', '["Multiply","y",["Power","x_05",2]]'],
    ['\\alpha^2_1y', '\\alpha_1y', '["Multiply","y",["Power","alpha_1",2]]'],
  ])('%s reports the code of %s', (input, other, json) => {
    expect(parse(input, false).json).toBe(json);
    expect(parse(input, false).codes).toEqual([
      'ambiguous-implicit-subscript',
    ]);
    expect(parse(other, false).codes).toEqual([
      'ambiguous-implicit-subscript',
    ]);
  });
});

describe('the spelling of the base does not change the reading', () => {
  test.each([
    ['π_01', '\\pi_01', false, '"Pi_01"'],
    ['π_{01}', '\\pi_{01}', false, '"Pi_01"'],
    ['π_{01}', '\\pi_{01}', true, '"Pi_01"'],
    ['θ_01', '\\theta_01', false, '"theta_01"'],
  ])('%s is %s (strict: %s)', (a, b, strict, json) => {
    expect(parse(a, strict).json).toBe(json);
    expect(parse(b, strict).json).toBe(json);
    expect(parse(a, strict).codes).toEqual(parse(b, strict).codes);
  });
});

describe('the strict grammar reads one token after `_` in each order', () => {
  // In the strict grammar, an unbraced subscript is one token, in each
  // order: the subscript is `0`, and the `1` that follows is a factor. The
  // `1` takes the superscript only when the superscript comes after it.
  test.each([
    ['x^2_01', '["Power","x_0",2]'],
    ['x_01^2', '"x_0"'],
    ['\\alpha^2_01', '["Power","alpha_0",2]'],
    ['\\alpha_01^2', '"alpha_0"'],
    ['π^2_01', '["Power","Pi_0",2]'],
    ['π_01', '"Pi_0"'],
    ['\\pi_01', '"Pi_0"'],
  ])('%s', (input, json) => {
    expect(parse(input, true).json).toBe(json);
  });
});

/**
 * White space directly before the `_` stops the join of the subscript to
 * the symbol name, in each order and in each grammar. The symbol parser does
 * not join `x _{01}`: it is the subscript `1` of `x`. A subscript after a
 * superscript and white space had the joined reading (`x^2 _{01}` was
 * `x_01^2`, and `x _{01}^2` is `x_1^2`). White space before the superscript
 * does not stop the join. Each pair keeps the white space before the same
 * script. The tokenizer removes the white space after a command (`\alpha _1`
 * is `\alpha_1`), so `{}` gives the white space after `\alpha`.
 */
describe('white space before a subscript', () => {
  for (const strict of [true, false]) {
    describe(`strict: ${strict}`, () => {
      expectSameReading(strict, [
        ['x^2 _{01}', 'x _{01}^2', '["Power","x_1",2]'],
        ['x^2 _a', 'x _a^2', '["Power","x_a",2]'],
        ['x^{2} _{01}', 'x _{01}^{2}', '["Power","x_1",2]'],
        ['π^2 _{01}', 'π _{01}^2', '["Power","Pi_1",2]'],
        ['\\alpha^2{}_{01}', '\\alpha{}_{01}^2', '["Power","alpha_1",2]'],
        [
          "x'^2 _{01}",
          "x' _{01}^2",
          '["Power",["Subscript",["Prime","x"],1],2]',
        ],
        ['x ^2_{01}', 'x_{01} ^2', '["Power","x_01",2]'],
        ['x ^2 _{01}', 'x _{01} ^2', '["Power","x_1",2]'],
      ]);
    });
  }
  // A spacing command before a script is white space, not the base of the
  // script: `x\,_{01}` was `Nothing_1·x`.
  for (const strict of [true, false]) {
    test.each([
      ['x\\,_{01}', '"x_1"'],
      ['x\\, _{01}', '"x_1"'],
      ['x\\;_{01}', '"x_1"'],
      ['x\\quad_{01}', '"x_1"'],
      ['x~_{01}', '"x_1"'],
      ['x\\hspace{1em}_a', '"x_a"'],
      ['x^2\\,_{01}', '["Power","x_1",2]'],
      ['x\\,^2', '["Power","x",2]'],
    ])(`%s is %s (strict: ${strict})`, (input, json) => {
      expect(parse(input, strict).json).toBe(json);
    });
  }
  test('a spacing command with no script after it stays', () => {
    const ce = new ComputeEngine();
    expect(ce.parse('x\\, y', { form: 'raw' }).json).toEqual([
      'InvisibleOperator',
      'x',
      ['HorizontalSpacing', 3],
      'y',
    ]);
  });
  test('an unbraced subscript takes one digit in each order', () => {
    // The `1` takes the superscript only when the superscript comes after
    // it, so only the subscript and the code are compared.
    expect(parse('x^2 _01', false).json).toBe('["Power","x_0",2]');
    expect(parse('x _01^2', false).json).toBe('"x_0"');
    expect(parse('x^2 _01', false).codes).toEqual([
      'ambiguous-implicit-subscript',
    ]);
    expect(parse('x _01^2', false).codes).toEqual([
      'ambiguous-implicit-subscript',
    ]);
  });
});

describe('a subscript that the symbol parser does not join', () => {
  test('an expression subscript stays a Subscript in each order', () => {
    const json = '["Power",["Subscript","x",["Add","n",1]],2]';
    expect(parse('x^2_{n+1}', true).json).toBe(json);
    expect(parse('x_{n+1}^2', true).json).toBe(json);
  });
  test('a base that evaluates its subscript keeps it', () => {
    const json = '["Power","EulerGamma_1",2]';
    expect(parse('\\gamma^2_1', true).json).toBe(json);
    expect(parse('\\gamma_1^2', true).json).toBe(json);
  });
  test('a group base takes only the first digit', () => {
    // A group is not a symbol: no name keeps the text `01`
    expect(parse('(x)^2_01', false).json).toBe('["Power","x_0",2]');
    expect(parse('(x)^2_01', false).codes).toEqual([
      'ambiguous-implicit-subscript',
    ]);
  });
  test('an indexed collection base takes only a declared name', () => {
    const ce = new ComputeEngine();
    ce.assign('B', ce.box(['List', 10, 20, 30]));
    expect(ce.parse('B^2_{2}').json).toEqual(['Power', ['At', 'B', 2], 2]);
    expect(ce.parse('B_{2}^2').json).toEqual(['Power', ['At', 'B', 2], 2]);
    ce.declare('B_2', 'real');
    expect(ce.parse('B^2_{2}').json).toEqual(['Power', 'B_2', 2]);
    expect(ce.parse('B_{2}^2').json).toEqual(['Power', 'B_2', 2]);
  });
});

describe('a subscript after prime marks', () => {
  // The joined name is reported, as the symbol parser reports it when the
  // subscript comes before the prime marks. `x'_{01}` reported `x`.
  test.each([
    ["x'_{01}", "x_{01}'", '["Prime","x_01"]'],
    ["x''_{a}", "x_{a}''", '["Prime","x_a",2]'],
    ["F^{\\prime}_0", "F_0'", '["Prime","F_0"]'],
  ])('%s reports the name of %s', (first, second, json) => {
    for (const strict of [true, false]) {
      const a = parse(first, strict);
      const b = parse(second, strict);
      expect(a.json).toBe(json);
      expect(b.json).toBe(json);
      expect(a.undeclared).toEqual(b.undeclared);
    }
  });
});

/**
 * A prime mark written as a superscript (`^{\prime}`, the spelling of the
 * serializer, `^\prime`, `^{\prime\prime}`, `^{\doubleprime}`) is the same
 * as `'` before a superscript and a subscript: the subscript joins the name
 * under the prime. Only `'` and `\prime` did: `x^{\prime}^2_{01}` was
 * `Subscript(Prime(x), 1)^2`.
 */
describe('a subscript after each spelling of the prime marks', () => {
  for (const strict of [true, false]) {
    describe(`strict: ${strict}`, () => {
      expectSameReading(strict, [
        [
          'x^{\\prime}^2_{01}',
          'x_{01}^{\\prime}^2',
          '["Power",["Prime","x_01"],2]',
        ],
        ['x^\\prime^2_{01}', "x'^2_{01}", '["Power",["Prime","x_01"],2]'],
        [
          'x^{\\doubleprime}^2_{01}',
          'x_{01}^{\\doubleprime}^2',
          '["Power",["Prime","x_01",2],2]',
        ],
        [
          'x^{\\prime\\prime}^2_{01}',
          "x''^2_{01}",
          '["Power",["Prime","x_01",2],2]',
        ],
        // White space before the `_` stops the join, as after `'`
        [
          'x^{\\prime}^2 _{01}',
          'x^{\\prime} _{01}^2',
          '["Power",["Subscript",["Prime","x"],1],2]',
        ],
      ]);
    });
  }
});

describe('an unbraced subscript of two letters, non-strict grammar', () => {
  // Two letters followed by a script or a digit are split: the second
  // letter is a new symbol (`a_kx^k` is `a_k·x^k`). A person can mean a
  // subscript of two letters (`a_{kx}^k`), which is the reading when the
  // superscript comes first (`x^2_ab` is `x_ab^2`). The split reports
  // `ambiguous-implicit-subscript`. The strict grammar reports no code.
  test.each([
    ['x_ab^2', '["Multiply","x_a",["Power","b",2]]'],
    ['a_kx^k', '["Multiply","a_k",["Power","x","k"]]'],
    ['a_nb_n', '["Multiply","a_n","b_n"]'],
    ['\\alpha_kx^k', '["Multiply","alpha_k",["Power","x","k"]]'],
  ])('%s', (input, json) => {
    expect(parse(input, false).json).toBe(json);
    expect(parse(input, false).codes).toEqual([
      'ambiguous-implicit-subscript',
    ]);
    expect(parse(input, true).codes).toEqual([]);
  });
  test('a run that is not split is not reported', () => {
    expect(parse('x^2_ab', false).json).toBe('["Power","x_ab",2]');
    expect(parse('x^2_ab', false).codes).toEqual([]);
    expect(parse('x_ab', false).codes).toEqual([]);
    expect(parse('x_max^2', false).codes).toEqual([]);
  });
});

/**
 * In the non-strict grammar, a Greek name written without a backslash
 * (`alpha`, `pi`) takes a subscript into its name as the backslash spelling
 * does, in each order of the scripts, with the same diagnostics. Before, the
 * subscript stayed outside the name and an unbraced subscript was one token:
 * `alpha_{01}` was `alpha_1`, `alpha_max` was `alpha_m·a·x` and `pi_01` was
 * `Pi_0·1`.
 */
describe('a spelled-out name takes a subscript into its name', () => {
  // Each pair reads the same, reports the same codes and the same
  // undeclared names, and has the reading `json`.
  test.each([
    ['alpha_{01}', '\\alpha_{01}', '"alpha_01"'],
    ['alpha_01', '\\alpha_01', '"alpha_01"'],
    ['alpha_max', '\\alpha_max', '"alpha_max"'],
    ['pi_01', '\\pi_01', '"Pi_01"'],
    ['pi_{max}', '\\pi_{max}', '"Pi_max"'],
    ['theta_1', '\\theta_1', '"theta_1"'],
    ['Delta_{ab}', '\\Delta_{ab}', '"Delta_ab"'],
    ['omega_{01}^2', '\\omega_{01}^2', '["Power","omega_01",2]'],
    ['omega^2_{01}', '\\omega^2_{01}', '["Power","omega_01",2]'],
    ['lambda^2_max', '\\lambda^2_max', '["Power","lambda_max",2]'],
    [
      'sigma_01 + sigma_02',
      '\\sigma_01 + \\sigma_02',
      '["Add","sigma_01","sigma_02"]',
    ],
    ["alpha'_{01}", "\\alpha'_{01}", '["Prime","alpha_01"]'],
    ["alpha'^2_{01}", "\\alpha'^2_{01}", '["Power",["Prime","alpha_01"],2]'],
    ['alpha_ab^2', '\\alpha_ab^2', '["Multiply","alpha_a",["Power","b",2]]'],
    ['alpha_1y', '\\alpha_1y', '["Multiply","alpha_1","y"]'],
    ['alpha_max2', '\\alpha_max2', '["Multiply",2,"alpha_max"]'],
  ])('%s is %s', (first, second, json) => {
    const a = parse(first, false);
    const b = parse(second, false);
    expect(a.json).toBe(json);
    expect(b.json).toBe(json);
    expect(a.codes).toEqual(b.codes);
    expect(a.undeclared).toEqual(b.undeclared);
  });
  describe('in each order of the scripts', () => {
    expectSameReading(false, [
      ['alpha^2_{01}', 'alpha_{01}^2', '["Power","alpha_01",2]'],
      ['alpha^2_01', 'alpha_01^2', '["Power","alpha_01",2]'],
      ['pi^2_01', 'pi_01^2', '["Power","Pi_01",2]'],
      ['theta^2_max', 'theta_max^2', '["Power","theta_max",2]'],
      ["alpha'^2_01", "alpha_01'^2", '["Power",["Prime","alpha_01"],2]'],
    ]);
  });
  test('the split of two letters reports the same code', () => {
    expect(parse('alpha_ab^2', false).codes).toEqual([
      'ambiguous-implicit-subscript',
    ]);
    expect(parse('alpha^2_ab', false).json).toBe('["Power","alpha_ab",2]');
    expect(parse('alpha^2_ab', false).codes).toEqual([]);
  });
  test('white space before the `_` stops the join', () => {
    // As `\alpha{}_{01}` is the subscript `1` of `alpha`
    expect(parse('alpha _{01}', false).json).toBe('"alpha_1"');
    expect(parse('\\alpha{}_{01}', false).json).toBe('"alpha_1"');
    expect(parse('alpha^2 _{01}', false).json).toBe('["Power","alpha_1",2]');
    expect(parse('alpha _{01}^2', false).json).toBe('["Power","alpha_1",2]');
    expect(parse('alpha ^2_{01}', false).json).toBe('["Power","alpha_01",2]');
  });
  test('an indexed collection base takes only a declared name', () => {
    const ce = new ComputeEngine();
    ce.assign('alpha', ce.box(['List', 10, 20, 30]));
    for (const input of ['alpha_{2}', '\\alpha_{2}'])
      expect(ce.parse(input, { strict: false }).json).toEqual([
        'At',
        'alpha',
        2,
      ]);
    ce.declare('alpha_2', 'real');
    for (const input of ['alpha_{2}', '\\alpha_{2}'])
      expect(ce.parse(input, { strict: false }).json).toBe('alpha_2');
  });
  test('the ASCII names of constants keep the subscript', () => {
    const ce = new ComputeEngine();
    // As `\infty_{01}` keeps it
    expect(ce.parse('oo_{01}', { strict: false, form: 'raw' }).json).toEqual([
      'Subscript',
      'PositiveInfinity',
      1,
    ]);
  });
});

/**
 * In the non-strict grammar, an unbraced exponent that is a spelled-out name
 * followed by `_` or a digit is the name, as the command spelling is. It was
 * read one letter at a time: `x^alpha_1` was `x^a·l·p·h·a_1`.
 */
describe('a spelled-out name as an unbraced exponent', () => {
  test.each([
    ['x^alpha_1', 'x^\\alpha_1', '["Power","x","alpha_1"]'],
    ['e^alpha_1', 'e^\\alpha_1', '["Power","ExponentialE","alpha_1"]'],
    ['x^alpha_max', 'x^\\alpha_max', '["Power","x","alpha_max"]'],
    ['x^pi_01', 'x^\\pi_01', '["Power","x","Pi_01"]'],
    ['x^-alpha_1', 'x^-\\alpha_1', '["Power","x",["Negate","alpha_1"]]'],
    ['x^theta_1y', 'x^\\theta_1y', '["Multiply","y",["Power","x","theta_1"]]'],
    [
      'x^alpha_1 t',
      'x^\\alpha_1 t',
      '["Multiply","t",["Power","x","alpha_1"]]',
    ],
    ['x^oo_1', 'x^\\infty_1', '["Power","x_1","PositiveInfinity"]'],
  ])('%s is %s', (first, second, json) => {
    const a = parse(first, false);
    const b = parse(second, false);
    expect(a.json).toBe(json);
    expect(b.json).toBe(json);
    expect(a.codes).toEqual(b.codes);
    expect(a.undeclared).toEqual(b.undeclared);
  });
  test('a digit after the name ends the exponent', () => {
    // The undeclared names are not compared: a spelled-out `alpha` is
    // reported, while `\alpha` is not.
    const json = '["Multiply",2,["Power","x","alpha"]]';
    expect(parse('x^alpha2', false).json).toBe(json);
    expect(parse('x^\\alpha2', false).json).toBe(json);
    expect(parse('x^alpha2', false).codes).toEqual(['ambiguous-exponent-end']);
    expect(parse('x^\\alpha2', false).codes).toEqual([
      'ambiguous-exponent-end',
    ]);
  });
  test('the end of the exponent is reported', () => {
    expect(parse('x^alpha_1 t', false).codes).toEqual([
      'ambiguous-exponent-end',
    ]);
  });
});

/**
 * In the non-strict grammar, a script or a prime after a run of letters
 * that holds a spelled-out name belongs to the last part of the run, as
 * after a run of single letters (`xy_1` is `x·y_1`) and after a command.
 * It applied to the product of the parts: `xalpha_1` was `(x·alpha)_1` and
 * `xalpha^2` was `(x·alpha)^2`. The run still reports
 * `ambiguous-letter-run`.
 */
describe('a script after a run of letters with a spelled-out name', () => {
  test.each([
    ['xalpha_1', 'x\\alpha_1', '["Multiply","alpha_1","x"]'],
    ['alphax_1', '\\alpha x_1', '["Multiply","alpha","x_1"]'],
    ['xalpha^2', 'x\\alpha^2', '["Multiply","x",["Power","alpha",2]]'],
    ['alphax^2', '\\alpha x^2', '["Multiply","alpha",["Power","x",2]]'],
    ['xpi_01', 'x\\pi_01', '["Multiply","Pi_01","x"]'],
    ['xalpha_max', 'x\\alpha_max', '["Multiply","alpha_max","x"]'],
    ['alphabeta_1', '\\alpha\\beta_1', '["Multiply","alpha","beta_1"]'],
    ["xalpha'", "x\\alpha'", '["Multiply","x",["Prime","alpha"]]'],
    [
      'xalpha^2_{01}',
      'x\\alpha^2_{01}',
      '["Multiply","x",["Power","alpha_01",2]]',
    ],
  ])('%s is %s', (first, second, json) => {
    const a = parse(first, false);
    expect(a.json).toBe(json);
    expect(parse(second, false).json).toBe(json);
    expect(a.codes).toEqual(['ambiguous-letter-run']);
  });
  test('the letter-run code names every part of the run', () => {
    const e = new ComputeEngine().parse('xalpha_1', {
      strict: false,
      diagnostics: true,
    });
    const run = (e.parseDiagnostics ?? []).find(
      (d) => d.code === 'ambiguous-letter-run'
    );
    expect(run?.detail).toEqual({ run: 'xalpha', parts: ['x', 'alpha'] });
  });
  // A digit after the run is a subscript of the last part, as after a run
  // of single letters (`xy2` is `x·y_2`). It was a factor: `xalpha2` was
  // `x·alpha·2`, and `xalpha01` was `x·alpha·1`.
  test.each([
    ['xalpha2', 'x\\alpha2', '["Multiply","alpha_2","x"]'],
    ['alphax2', '\\alpha x2', '["Multiply","alpha","x_2"]'],
    ['xpi2', 'x\\pi2', '["Multiply","Pi_2","x"]'],
    ['xalpha01', 'x\\alpha01', '["Multiply","alpha_01","x"]'],
    ['xalpha2y', 'x\\alpha2y', '["Multiply","alpha_2","x","y"]'],
  ])('%s is %s', (first, second, json) => {
    const a = parse(first, false);
    const b = parse(second, false);
    expect(a.json).toBe(json);
    expect(b.json).toBe(json);
    expect(a.codes).toEqual(['ambiguous-letter-run', ...b.codes]);
    expect(b.codes).toEqual(['ambiguous-implicit-subscript']);
  });
});

/**
 * A dictionary entry whose trigger is a symbol with a subscript (`\delta_`
 * for `KroneckerDelta`, `\mu_0` for `Mu0`, `\varepsilon_0` for
 * `VacuumPermittivity`) reads the subscript in each order of the scripts,
 * in each grammar. With the superscript first, the subscript joined the
 * symbol name (`\delta^2_{01}` was `delta_01^2`). With the subscript first,
 * a script after `KroneckerDelta` was a syntax error (`\delta_{01}^2`).
 */
describe('a symbol whose subscript is read by a dictionary entry', () => {
  for (const strict of [true, false]) {
    describe(`strict: ${strict}`, () => {
      expectSameReading(strict, [
        [
          '\\delta^2_{01}',
          '\\delta_{01}^2',
          '["Power",["KroneckerDelta",0,1],2]',
        ],
        [
          '\\delta^2_{nm}',
          '\\delta_{nm}^2',
          '["Power",["KroneckerDelta","n","m"],2]',
        ],
        [
          '\\delta^{-1}_n',
          '\\delta_n^{-1}',
          '["Divide",1,["KroneckerDelta","n"]]',
        ],
        ['\\mu^2_0', '\\mu_0^2', '["Power","Mu0",2]'],
        [
          '\\varepsilon^2_0',
          '\\varepsilon_0^2',
          '["Power","VacuumPermittivity",2]',
        ],
        ['\\gamma^2_{01}', '\\gamma_{01}^2', '["Power","EulerGamma_1",2]'],
        // A set read by a dictionary entry. `\R^2_-` was a syntax error,
        // `\R^2_{-}` and `\mathbb{R}^2_{>0}` were a `Subscript` of
        // `RealNumbers` with an error.
        ['\\R^2_-', '\\R_-^2', '["Power","NegativeNumbers",2]'],
        ['\\R^2_{-}', '\\R_{-}^2', '["Power","NegativeNumbers",2]'],
        [
          '\\mathbb{R}^2_{>0}',
          '\\mathbb{R}_{>0}^2',
          '["Power","PositiveNumbers",2]',
        ],
        [
          '\\R^n_{\\geq0}',
          '\\R_{\\geq0}^n',
          '["Power","NonNegativeNumbers","n"]',
        ],
        // White space before the `_` does not stop a dictionary entry, as
        // LaTeX ignores it. `\R^2 _-` was a syntax error, `\mu^2 _0` was
        // `mu_0^2` and `\delta^2 _{nm}` was `delta_nm^2`.
        ['\\R^2 _-', '\\R_-^2', '["Power","NegativeNumbers",2]'],
        ['\\mu^2 _0', '\\mu_0^2', '["Power","Mu0",2]'],
        [
          '\\delta^2 _{nm}',
          '\\delta_{nm}^2',
          '["Power",["KroneckerDelta","n","m"],2]',
        ],
        [
          '\\mathbb{R}^2 _{>0}',
          '\\mathbb{R}_{>0}^2',
          '["Power","PositiveNumbers",2]',
        ],
      ]);
    });
  }
  test('a prime after `KroneckerDelta` applies to it', () => {
    expect(parse("\\delta_{01}'", true).json).toBe(
      '["Derivative",["Function",["Block",["KroneckerDelta",0,1]]]]'
    );
  });
});

/**
 * In the non-strict grammar, a spelled-out Greek name directly after an
 * argument of one letter without braces (an exponent, a radicand) is read
 * as the name, as after a letter in a run of letters (`xalpha_1` is
 * `x·alpha_1`). It was read one letter at a time: `e^xalpha_1` was
 * `e^x·a·l·p·h·a_1`. A word that a Greek name or a run of letters starts
 * at the argument is not split.
 */
describe('a spelled-out name after an argument of one letter', () => {
  test.each([
    [
      'e^xalpha_1',
      'e^x\\alpha_1',
      '["Multiply","alpha_1",["Power","ExponentialE","x"]]',
    ],
    [
      '\\sqrt xalpha_1',
      '\\sqrt x\\alpha_1',
      '["Multiply","alpha_1",["Sqrt","x"]]',
    ],
    ['e^xpi', 'e^x\\pi', '["Multiply","Pi",["Power","ExponentialE","x"]]'],
  ])('%s is %s', (first, second, json) => {
    expect(parse(first, false).json).toBe(json);
    expect(parse(second, false).json).toBe(json);
  });
  test('the codes do not change', () => {
    expect(parse('e^xalpha_1', false).codes).toEqual([
      'ambiguous-letter-run',
      'ambiguous-exponent-end',
    ]);
  });
  test.each([
    // `beta` is a Greek name that starts at the argument
    ['\\sqrt beta', '["Multiply","ExponentialE","a","t",["Sqrt","b"]]'],
    // `oo` is not a Greek name: `foo` is not `f·∞`
    ['x^foo', '["Multiply","o","o",["Power","x","f"]]'],
    // `alphax` is not one name
    [
      'e^xalphax_1',
      '["Multiply","a","a","h","l","p","x_1",["Power","ExponentialE","x"]]',
    ],
  ])('%s is not split', (input, json) => {
    expect(parse(input, false).json).toBe(json);
  });
  test('the strict grammar does not change', () => {
    expect(parse('e^xalpha_1', true).json).toBe(
      '["Multiply","a","a_1","h","l","p",["Power","ExponentialE","x"]]'
    );
  });
  // A bare function name is read as the function, as after white space.
  // It was read one letter at a time: `e^xsin(t)` was `e^x·s·i·n(t)`.
  test.each([
    ['e^xsin(t)', 'e^x sin(t)', '"Sin"'],
    ['e^xsin t', 'e^x sin t', '"Sin"'],
    ['\\sqrt xsin(t)', '\\sqrt x sin(t)', '"Sin"'],
    ['e^xln(2)', 'e^x ln(2)', '"Ln"'],
  ])('%s is %s', (first, second, head) => {
    const a = parse(first, false);
    expect(a.json).toBe(parse(second, false).json);
    expect(a.json).toContain(head);
  });
  test('a function name reports the end of the exponent', () => {
    expect(parse('e^xsin(t)', false).codes).toContain('ambiguous-exponent-end');
  });
  test.each([
    // `acos` is a function name that starts at the argument
    ['x^acos t', '["Multiply","c","o","s","t",["Power","x","a"]]'],
    // `sinx` is not a function name
    [
      'e^xsinx',
      '["Multiply",["Complex",0,1],"n","s","x",["Power","ExponentialE","x"]]',
    ],
  ])('%s is not split before a function name', (input, json) => {
    expect(parse(input, false).json).toBe(json);
  });
});
