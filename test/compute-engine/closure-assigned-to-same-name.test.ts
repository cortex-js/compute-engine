import { ComputeEngine } from '../../src/compute-engine';
import type { SemiBoxedExpression } from '../../src/compute-engine';

//
// A function literal that mentions the name it is assigned to is a recursive
// definition only when the mention denotes the binding being assigned. A
// closure that reads another binding of that name keeps reading it.
//

const fn = (body: SemiBoxedExpression, ...params: string[]) =>
  ['Function', body, ...params] as SemiBoxedExpression;
const assign = (name: string, value: SemiBoxedExpression) =>
  ['Assign', name, value] as SemiBoxedExpression;

// The value of the last statement. Every statement before it must not give an
// error, so that a failed assignment does not pass unnoticed.
function run(...statements: SemiBoxedExpression[]) {
  const ce = new ComputeEngine();
  let result = ce.Nothing as ReturnType<typeof ce.box>;
  for (const statement of statements) {
    expect(result.operator).not.toBe('Error');
    result = ce.box(statement).evaluate();
  }
  return result.json;
}

// The value of the last statement, for a program whose global assignment gives
// an effect error although it stores its value: with `h` defined first, the
// assignment of a global named as a local of `h` gives that error. The test
// checks only the binding that the stored closure reads. ROADMAP.md, CE-819.
function lastValue(...statements: SemiBoxedExpression[]) {
  const ce = new ComputeEngine();
  let result = ce.Nothing as ReturnType<typeof ce.box>;
  for (const statement of statements) result = ce.box(statement).evaluate();
  return result.json;
}

// h(n) returns a closure that reads the local `g` of its own call of `h`.
const h = assign(
  'h',
  fn(
    ['Block', assign('g', fn(0, 'z')), fn(['Add', ['g', 'z'], 'n'], 'z')],
    'n'
  )
);
// k(n) stores a closure of `h` in a local that is also named `g`.
const makeK = (argument: SemiBoxedExpression) =>
  assign(
    'k',
    fn(
      ['Block', assign('g', ['h', argument]), fn(['Add', ['g', 'z'], 'n'], 'z')],
      'n'
    )
  );

describe('a closure assigned to a name that it reads as another binding', () => {
  test('two functions with a local of the same name keep their own binding', () => {
    expect(run(h, makeK('n'), ['Apply', ['k', 1], 0])).toEqual(2);
  });

  test('the closure keeps the parameter of its own call', () => {
    expect(run(h, makeK(['Add', 'n', 10]), ['Apply', ['k', 1], 0])).toEqual(12);
  });

  test('.N() gives the same value', () => {
    const ce = new ComputeEngine();
    ce.box(h).evaluate();
    ce.box(makeK('n')).evaluate();
    expect(ce.box(['Apply', ['k', 1], 0]).N().re).toEqual(2);
  });

  test('evaluateAsync() gives the same value', async () => {
    const ce = new ComputeEngine();
    ce.box(h).evaluate();
    ce.box(makeK('n')).evaluate();
    const result = await ce.box(['Apply', ['k', 1], 0]).evaluateAsync();
    expect(result.json).toEqual(2);
  });

  test('a local that holds a number is read as a number', () => {
    expect(
      run(
        assign(
          'h',
          fn(['Block', assign('g', 10), fn(['Add', 'g', 'n'], 'z')], 'n')
        ),
        makeK('n'),
        ['Apply', ['k', 1], 0]
      )
    ).toEqual(12);
  });

  test('a global of the same name is another binding', () => {
    expect(lastValue(h, assign('g', ['h', 1]), ['g', 0])).toEqual(1);
  });

  test('each call of a recursive function keeps its own local', () => {
    expect(
      run(
        assign(
          'h',
          fn(
            [
              'Block',
              assign('g', [
                'If',
                ['Greater', 'n', 0],
                ['h', ['Subtract', 'n', 1]],
                fn(0, 'z'),
              ]),
              fn(['Add', ['g', 'z'], 'n'], 'z'),
            ],
            'n'
          )
        ),
        ['Apply', ['h', 2], 0]
      )
    ).toEqual(3);
  });

  test('a local declared in an inner block does not capture the global', () => {
    expect(
      run(
        assign('g', fn(5, 't')),
        assign('f', fn(['Add', ['g', 'z'], 1], 'z')),
        [
          'Block',
          ['Declare', 'g', 'unknown', fn(9, 't')],
          assign('g', 'f'),
          ['g', 0],
        ]
      )
    ).toEqual(6);
  });

  test('a local declared in an inner block does not capture the outer local', () => {
    expect(
      run([
        'Block',
        assign('g', fn(0, 'z')),
        assign('f', fn(['Add', ['g', 'z'], 1], 'z')),
        [
          'Block',
          ['Declare', 'g', 'unknown', fn(9, 't')],
          assign('g', 'f'),
          ['g', 0],
        ],
      ])
    ).toEqual(1);
  });

  test('a recursive closure of a factory reads its own local', () => {
    expect(
      run(
        assign(
          'mk',
          fn(
            [
              'Block',
              assign(
                'f',
                fn(
                  [
                    'If',
                    ['LessEqual', 'x', 0],
                    'n',
                    ['f', ['Subtract', 'x', 1]],
                  ],
                  'x'
                )
              ),
              'f',
            ],
            'n'
          )
        ),
        assign('f', ['mk', 5]),
        ['f', 2]
      )
    ).toEqual(5);
  });
});

describe('a mention of the assigned binding stays a recursive call', () => {
  const factorial = fn(
    [
      'If',
      ['LessEqual', 'n', 1],
      1,
      ['Multiply', 'n', ['fact', ['Subtract', 'n', 1]]],
    ],
    'n'
  );

  test('a literal assigned at the top level', () => {
    expect(run(assign('fact', factorial), ['fact', 4])).toEqual(24);
  });

  test('a literal boxed before the assignment', () => {
    const ce = new ComputeEngine();
    ce.assign('fact', ce.box(factorial));
    expect(ce.box(['fact', 4]).evaluate().json).toEqual(24);
  });

  test('a literal boxed before the name is declared in a pushed scope', () => {
    const ce = new ComputeEngine();
    const literal = ce.box(factorial);
    ce.pushScope();
    ce.declare('fact', 'function');
    ce.assign('fact', literal);
    expect(ce.box(['fact', 4]).evaluate().json).toEqual(24);
    ce.popScope();
  });

  const localRecursion = assign(
    'f',
    fn(
      [
        'If',
        ['LessEqual', 'x', 0],
        0,
        ['Add', 'n', ['f', ['Subtract', 'x', 1]]],
      ],
      'x'
    )
  );

  test('a local of a function body', () => {
    expect(
      run(assign('t', fn(['Block', localRecursion, ['f', 3]], 'n')), ['t', 2])
    ).toEqual(6);
  });

  test('a local of a block nested in a function body', () => {
    expect(
      run(assign('t', fn(['Block', ['Block', localRecursion, ['f', 3]]], 'n')), [
        't',
        2,
      ])
    ).toEqual(6);
  });

  test('a reassignment of a name that has a value', () => {
    expect(
      run(
        assign('f', fn(10, 'x')),
        assign(
          'f',
          fn(
            ['If', ['LessEqual', 'x', 0], 11, ['f', ['Subtract', 'x', 1]]],
            'x'
          )
        ),
        ['f', 3]
      )
    ).toEqual(11);
  });

  test('a free name of a closure reads the function assigned to it later', () => {
    // The literal has no binding of `g` outside it, so `g` is the global.
    expect(
      run(
        assign('w', fn(fn(['If', ['LessEqual', 'z', 0], 'n', ['g', ['Subtract', 'z', 1]]], 'z'), 'n')),
        assign('g', ['w', 7]),
        ['g', 2]
      )
    ).toEqual(7);
  });
});
