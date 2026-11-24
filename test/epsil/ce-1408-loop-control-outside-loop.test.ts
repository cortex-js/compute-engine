import { ComputeEngine } from '../../src/compute-engine';
import { executeEpsil, executeEpsilAsync } from '../../src/epsil/execute-epsil';

//
// CE-1408: a `Break()` or `Continue()` outside a loop. The parser reports
// the call form as `control-outside-loop`, as it reports the keywords. At
// run time, a `Break` or a `Continue` that reaches a statement of the
// program, or the end of a function body, is the error
// `control-outside-loop`: the program goes on with the next statement, and
// a loop of the caller does not end. A case of a `match` is not a function
// boundary.
//

function engine(): ComputeEngine {
  const ce = new ComputeEngine();
  ce.iterationLimit = 200;
  return ce;
}

function messages(r: { diagnostics: { message: unknown }[] }): string[] {
  return r.diagnostics.map((d) =>
    Array.isArray(d.message) ? d.message.join(' | ') : String(d.message)
  );
}

function run(source: string): { value: string; diagnostics: string[] } {
  const r = executeEpsil(engine(), source);
  return { value: r.value.toString(), diagnostics: messages(r) };
}

describe('CE-1408: Break and Continue outside a loop', () => {
  test('a Break() in a do block at the top level does not stop the program', () => {
    expect(run('let s = 0; do { Break() }; s = 5; s')).toEqual({
      value: '5',
      diagnostics: ['control-outside-loop | Break()'],
    });
  });

  test('a Continue() in an if at the top level does not stop the program', () => {
    expect(run('let s = 0; if true { Continue() }; s = 5; s')).toEqual({
      value: '5',
      diagnostics: ['control-outside-loop | Continue()'],
    });
  });

  test('the keyword break at the top level does not stop the program', () => {
    expect(run('let s = 0; do { break }; s = 5; s')).toEqual({
      value: '5',
      diagnostics: ['control-outside-loop | break'],
    });
  });

  test('the last statement gives the error value', () => {
    const r = executeEpsil(engine(), 'Break()');
    expect(r.value.json).toEqual([
      'Error',
      ['ErrorCode', "'control-outside-loop'", "'Break'", "'program'"],
      "'Break()'",
    ]);
    expect(messages(r)).toEqual(['control-outside-loop | Break()']);
  });

  test('a Break(x) in a callback of fixedPoint is an error', () => {
    for (const max of ['', ', 100']) {
      const r = executeEpsil(
        engine(),
        `fixedPoint(x => if x > 10 { Break(x) } else { x + 1 }, 0${max})`
      );
      expect(r.value.json).toEqual([
        'Error',
        ['ErrorCode', "'control-outside-loop'", "'Break'", "'function'"],
        "'Break(11)'",
      ]);
      expect(messages(r)).toEqual(['control-outside-loop | Break()']);
    }
  });

  test('a Break() returned by a function does not end the loop of the caller', () => {
    const r = run(
      'let s = 0; let g = x => Break(x); for i in 1..5 { s = s + i; g(i) }; s'
    );
    // The error of `g(1)` ends the loop, as any error value of a statement
    // of a loop body does, and the run reports it.
    expect(r.value).toBe('1');
    expect(r.diagnostics).toEqual([
      'control-outside-loop | Break()',
      'runtime-error | `Break` left a function body: it is not inside a loop of the function at `Break(1)` |  | control-outside-loop',
    ]);
  });

  test('a Break() of another statement is reported in a statement with its own stray Break()', () => {
    // The parser's diagnostic marks the `Break()` of the untaken branch; the
    // error comes from the function `g` of the first statement, and is a
    // second problem.
    const r = run(
      'let g = () => Break()\nlet s = 0\nfor i in 1..3 { s = s + i; g() }; if false { Break() }\ns'
    );
    expect(r.value).toBe('1');
    expect(r.diagnostics).toEqual([
      'control-outside-loop | Break()',
      'control-outside-loop | Break()',
      'runtime-error | `Break` left a function body: it is not inside a loop of the function at `Break()` |  | control-outside-loop',
    ]);
  });

  test('a function of the program named Break is an ordinary call', () => {
    expect(run('function Break() { 3 }; Break()')).toEqual({
      value: '3',
      diagnostics: [],
    });
  });

  test('Break() and Continue() inside a loop still control it', () => {
    expect(
      run(
        'let s = 0; for i in 1..5 { s = s + i; if i == 2 { Break() } }; s'
      )
    ).toEqual({ value: '3', diagnostics: [] });
    expect(
      run(
        'let s = 0; for i in 1..5 { if i == 2 { Continue() }; s = s + i }; s'
      )
    ).toEqual({ value: '13', diagnostics: [] });
  });

  test('a match case in a loop passes break and continue to the loop', () => {
    expect(
      run(
        'let s = 0; while true { s = s + 1; match s { 3 => break\n _ => continue } }; s'
      )
    ).toEqual({ value: '3', diagnostics: [] });
    // A case with a capture and a guard.
    expect(
      run(
        'let s = 0; for i in 1..5 { s = s + i; match i { k if k > 2 => Break()\n _ => Continue() } }; s'
      )
    ).toEqual({ value: '6', diagnostics: [] });
  });

  test('the asynchronous route gives the same result', async () => {
    const r = await executeEpsilAsync(
      engine(),
      'let s = 0; do { Break() }; s = 5; s'
    );
    expect(r.value.toString()).toBe('5');
    expect(messages(r)).toEqual(['control-outside-loop | Break()']);
  });
});

describe('CE-1408: MathJSON', () => {
  test('a Break that leaves a function literal is an error', () => {
    const ce = engine();
    expect(
      ce
        .box([
          'Block',
          ['Declare', 's', 'integer'],
          ['Assign', 's', 0],
          [
            'Loop',
            [
              'Block',
              ['Assign', 's', ['Add', 's', 'i']],
              ['Apply', ['Function', ['Break']]],
            ],
            ['Element', 'i', ['Range', 1, 4]],
          ],
          's',
        ])
        .evaluate().json
    ).toEqual([
      'Error',
      ['ErrorCode', "'control-outside-loop'", "'Break'", "'function'"],
      "'Break()'",
    ]);
  });

  test('a Break returned by Return from a function literal is an error', () => {
    const ce = engine();
    expect(
      ce
        .box([
          'Apply',
          ['Function', ['Block', ['Return', ['Break', 'x']]], 'x'],
          3,
        ])
        .evaluate().json
    ).toEqual([
      'Error',
      ['ErrorCode', "'control-outside-loop'", "'Break'", "'function'"],
      "'Break(3)'",
    ]);
  });

  test('a Break that leaves a function literal under N() is an error', () => {
    // With an exact argument, `.N()` takes a path of its own.
    const ce = engine();
    const value = ce
      .box(['Apply', ['Function', ['Break', 'x'], 'x'], ['Rational', 1, 3]])
      .N();
    expect(value.operator).toBe('Error');
    expect(value.op1.json).toEqual([
      'ErrorCode',
      "'control-outside-loop'",
      "'Break'",
      "'function'",
    ]);
  });

  test('a Break in a Match case ends the loop around the Match', () => {
    const ce = engine();
    expect(
      ce
        .box([
          'Block',
          ['Declare', 's', 'integer'],
          ['Assign', 's', 0],
          [
            'Loop',
            [
              'Block',
              ['Assign', 's', ['Add', 's', 'i']],
              [
                'Match',
                'i',
                ['MatchCase', 2, ['Break']],
                ['MatchCase', '_', ['Continue']],
              ],
            ],
            ['Element', 'i', ['Range', 1, 4]],
          ],
          's',
        ])
        .evaluate().json
    ).toBe(3);
  });

  test('a Break statement of a Program does not end it', () => {
    const ce = engine();
    expect(ce.box(['Program', ['Break'], 5]).evaluate().json).toBe(5);
  });
});
