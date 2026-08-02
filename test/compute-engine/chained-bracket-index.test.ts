import { ComputeEngine } from '../../src/compute-engine';

/**
 * Chained postfix bracket indexing: `X[a][b]` parses as nested `At`,
 * regardless of the shape of the base (bare symbol, subscripted symbol,
 * bracket literal, function application) and to any chain depth.
 *
 * The index expression itself is left as-parsed (`Range`, `Equal`,
 * `Greater`, ...); only the nesting structure is asserted here.
 */

const ce = new ComputeEngine();

const raw = (s: string) => ce.parse(s, { canonical: false }).json;

describe('chained bracket index (non-canonical)', () => {
  test('subscripted base, range index then numeric index', () => {
    expect(raw(String.raw`P_{a}\left[1...3\right]\left[1\right]`)).toEqual([
      'At',
      ['At', 'P_a', ['Range', 1, 3]],
      1,
    ]);
  });

  test('subscripted base, symbol index then numeric index', () => {
    expect(raw(String.raw`P_{a}\left[b\right]\left[1\right]`)).toEqual([
      'At',
      ['At', 'P_a', 'b'],
      1,
    ]);
  });

  test('bracket-literal base, three-deep chain', () => {
    expect(
      raw(String.raw`\left[1...9\right]\left[c=0\right]\left[1\right]`)
    ).toEqual(['At', ['At', ['Range', 1, 9], ['Equal', 'c', 0]], 1]);
  });

  test('bare symbol base, range index then numeric index', () => {
    expect(raw(String.raw`P\left[1...3\right]\left[1\right]`)).toEqual([
      'At',
      ['At', 'P', ['Range', 1, 3]],
      1,
    ]);
  });

  test('bare symbol base, relation index', () => {
    expect(raw(String.raw`P\left[0...x-1\right]\left[P>0\right]`)).toEqual([
      'At',
      ['At', 'P', ['Range', 0, ['Subtract', 'x', 1]]],
      ['Greater', 'P', 0],
    ]);
  });

  test('four-deep chain', () => {
    expect(raw(String.raw`P\left[1\right]\left[2\right]\left[3\right]`)).toEqual(
      ['At', ['At', ['At', 'P', 1], 2], 3]
    );
  });

  test('bare bracket fences (no \\left/\\right)', () => {
    expect(raw(String.raw`P[1][2]`)).toEqual(['At', ['At', 'P', 1], 2]);
  });

  test('single index is unchanged', () => {
    expect(raw(String.raw`P_{a}\left[1\right]`)).toEqual(['At', 'P_a', 1]);
    expect(raw(String.raw`P\left[1\right]`)).toEqual(['At', 'P', 1]);
  });
});

describe('chained bracket index (canonical)', () => {
  test('canonical route nests as well', () => {
    expect(ce.parse(String.raw`P\left[1...3\right]\left[1\right]`).json).toEqual(
      ['At', ['At', 'P', ['Range', 1, 3]], 1]
    );
  });

  test('nested list literal evaluates through the chain', () => {
    expect(
      ce
        .parse(
          String.raw`\left[\left[10,20\right],\left[30,40\right]\right]\left[2\right]\left[1\right]`
        )
        .evaluate().json
    ).toEqual(30);
  });

  test('single-level index still evaluates', () => {
    expect(
      ce.parse(String.raw`\left[10,20,30\right]\left[1\right]`).evaluate().json
    ).toEqual(10);
  });

  test('indexing a declared indexed collection chains', () => {
    const engine = new ComputeEngine();
    engine.assign('Q', engine.box(['List', ['List', 1, 2], ['List', 3, 4]]));
    expect(
      engine.parse(String.raw`Q\left[2\right]\left[2\right]`).evaluate().json
    ).toEqual(4);
  });
});
