import { Expression } from '../../src/math-json/math-json-format';
import { engine, exprToString } from '../utils';

function evaluate(expr: Expression): string {
  return exprToString(engine.box(expr)?.evaluate());
}

const emptyList: Expression = ['List'];
const list: Expression = ['List', 7, 13, 5, 19, 2, 3, 11];

const list1: Expression = ['List', 100, 4, 2, 62, 34, 16, 8];
const list2: Expression = ['List', 9, 7, 2, 24];

// List with repeated elements
const list3: Expression = [
  'List',
  3,
  5,
  7,
  7,
  1,
  3,
  5,
  9,
  7,
  3,
  5,
  7,
  1,
  2,
  5,
  9,
];

const matrix: Expression = [
  'List',
  ['List', 2, 3, 4],
  ['List', 6, 7, 9],
  ['List', 11, 12, 13],
];
const range: Expression = ['Range', 2, 19, 2];
const linspace: Expression = ['Linspace', 2, 100, 89];
const string: Expression = "'hello world'";
const expression: Expression = ['Add', 2, ['Multply', 3, 'x']];
const symbol: Expression = 'x';
const dict: Expression = ['Dictionary', ['x', 1], ['y', 2], ['z', 3]];
const tuple: Expression = ['Tuple', 7, 10, 13];

describe('LENGTH', () => {
  test('Length empty list', () =>
    expect(evaluate(['Length', emptyList])).toEqual('0'));

  test('Length list', () =>
    expect(evaluate(['Length', list])).toMatchInlineSnapshot(`7`));

  test('Length matrix', () =>
    expect(evaluate(['Length', matrix])).toMatchInlineSnapshot(`3`));

  test('Length range', () =>
    expect(evaluate(['Length', range])).toMatchInlineSnapshot(`9`));

  test('Length linspace', () =>
    expect(evaluate(['Length', linspace])).toMatchInlineSnapshot(`89`));

  test('Length string', () =>
    expect(evaluate(['Length', string])).toMatchInlineSnapshot(`11`));

  test('Length expression', () =>
    expect(evaluate(['Length', expression])).toMatchInlineSnapshot(`0`));

  test('Length symbol', () =>
    expect(evaluate(['Length', symbol])).toMatchInlineSnapshot(`0`));

  test('Length dict', () =>
    expect(evaluate(['Length', dict])).toMatchInlineSnapshot(`0`));

  test('Length tuple', () =>
    expect(evaluate(['Length', tuple])).toMatchInlineSnapshot(`3`));
});

describe('TAKE 1', () => {
  test('empty list', () =>
    expect(evaluate(['Take', emptyList, 1])).toMatchInlineSnapshot(`["List"]`));

  test('list', () =>
    expect(evaluate(['Take', list, 1])).toMatchInlineSnapshot(`["List", 7]`));

  test('matrix', () =>
    expect(evaluate(['Take', matrix, 1])).toMatchInlineSnapshot(
      `["List", ["List", 2, 3, 4]]`
    ));

  test('range', () =>
    expect(evaluate(['Take', range, 1])).toMatchInlineSnapshot(`["List", 2]`));

  test('linspace', () =>
    expect(evaluate(['Take', linspace, 1])).toMatchInlineSnapshot(
      `["List", 2]`
    ));

  test('string', () =>
    expect(evaluate(['Take', string, 1])).toMatchInlineSnapshot(`'h'`));

  test('expression', () =>
    expect(evaluate(['Take', expression, 1])).toMatchInlineSnapshot(`Nothing`));

  test('symbol', () =>
    expect(evaluate(['Take', symbol, 1])).toMatchInlineSnapshot(`Nothing`));

  test('dict', () =>
    expect(evaluate(['Take', dict, 1])).toMatchInlineSnapshot(`Nothing`));

  test('tuple', () =>
    expect(evaluate(['Take', tuple, 1])).toMatchInlineSnapshot(`["List", 7]`));
});

describe('TAKE (2,3)', () => {
  test('empty list', () =>
    expect(evaluate(['Take', emptyList, 2, 3])).toMatchInlineSnapshot(
      `["List"]`
    ));

  test('list', () =>
    expect(evaluate(['Take', list, 2, 3])).toMatchInlineSnapshot(
      `["List", 13, 5]`
    ));

  test('matrix', () =>
    expect(evaluate(['Take', matrix, 2, 3])).toMatchInlineSnapshot(
      `["List", ["List", 6, 7, 9], ["List", 11, 12, 13]]`
    ));

  test('range', () =>
    expect(evaluate(['Take', range, 2, 3])).toMatchInlineSnapshot(
      `["List", 4, 6]`
    ));

  test('linspace', () =>
    expect(evaluate(['Take', linspace, 2, 3])).toMatchInlineSnapshot(
      `["List", 3.101123595505618, 4.202247191011236]`
    ));

  test('string', () =>
    expect(evaluate(['Take', string, 2, 3])).toMatchInlineSnapshot(`'el'`));

  test('expression', () =>
    expect(evaluate(['Take', expression, 2, 3])).toMatchInlineSnapshot(
      `Nothing`
    ));

  test('symbol', () =>
    expect(evaluate(['Take', symbol, 2, 3])).toMatchInlineSnapshot(`Nothing`));

  test('dict', () =>
    expect(evaluate(['Take', dict, 2, 3])).toMatchInlineSnapshot(`Nothing`));

  test('tuple', () =>
    expect(evaluate(['Take', tuple, 2, 3])).toMatchInlineSnapshot(
      `["List", 10, 13]`
    )); // @fixme
});

describe('TAKE [-1,1]', () => {
  test('empty list', () =>
    expect(
      evaluate(['Take', emptyList, ['Tuple', -1, 1]])
    ).toMatchInlineSnapshot(`["List"]`));

  test('list', () =>
    expect(evaluate(['Take', list, ['Tuple', -1, 1]])).toMatchInlineSnapshot(
      `["List", 11, 3, 2, 19, 5, 13, 7]`
    ));

  test('matrix', () =>
    expect(evaluate(['Take', matrix, ['Tuple', -1, 1]])).toMatchInlineSnapshot(
      `["List", ["List", 11, 12, 13], ["List", 6, 7, 9], ["List", 2, 3, 4]]`
    ));

  test('range', () =>
    expect(evaluate(['Take', range, ['Tuple', -1, 1]])).toMatchInlineSnapshot(
      `["List", 18, 16, 14, 12, 10, 8, 6, 4, 2]`
    ));

  test('linspace', () =>
    expect(evaluate(['Take', linspace, ['Tuple', -1, 1]]))
      .toMatchInlineSnapshot(`
      [
        "List",
        98.89887640449439,
        97.79775280898876,
        96.69662921348315,
        95.59550561797752,
        94.49438202247191,
        93.3932584269663,
        92.29213483146067,
        91.19101123595506,
        90.08988764044943,
        88.98876404494382,
        87.88764044943821,
        86.78651685393258,
        85.68539325842697,
        84.58426966292134,
        83.48314606741573,
        82.38202247191012,
        81.28089887640449,
        80.17977528089888,
        79.07865168539325,
        77.97752808988764,
        76.87640449438203,
        75.7752808988764,
        74.67415730337079,
        73.57303370786516,
        72.47191011235955,
        71.37078651685393,
        70.26966292134831,
        69.1685393258427,
        68.06741573033707,
        66.96629213483146,
        65.86516853932585,
        64.76404494382022,
        63.662921348314605,
        62.561797752808985,
        61.46067415730337,
        60.359550561797754,
        59.258426966292134,
        58.157303370786515,
        57.056179775280896,
        55.95505617977528,
        54.853932584269664,
        53.752808988764045,
        52.651685393258425,
        51.550561797752806,
        50.449438202247194,
        49.348314606741575,
        48.247191011235955,
        47.146067415730336,
        46.04494382022472,
        44.943820224719104,
        43.842696629213485,
        42.741573033707866,
        41.640449438202246,
        40.53932584269663,
        39.438202247191015,
        38.337078651685395,
        37.235955056179776,
        36.13483146067416,
        35.03370786516854,
        33.932584269662925,
        32.8314606741573,
        31.730337078651687,
        30.629213483146067,
        29.528089887640448,
        28.426966292134832,
        27.325842696629213,
        26.224719101123597,
        25.123595505617978,
        24.02247191011236,
        22.921348314606742,
        21.820224719101123,
        20.719101123595507,
        19.617977528089888,
        18.51685393258427,
        17.41573033707865,
        16.314606741573034,
        15.213483146067416,
        14.112359550561798,
        13.01123595505618,
        11.910112359550562,
        10.808988764044944,
        9.707865168539325,
        8.606741573033709,
        7.50561797752809,
        6.404494382022472,
        5.3033707865168545,
        4.202247191011236,
        3.101123595505618,
        2
      ]
    `));

  test('string', () =>
    expect(evaluate(['Take', string, ['Tuple', -1, 1]])).toMatchInlineSnapshot(
      `'dlrow olleh'`
    ));

  test('expression', () =>
    expect(
      evaluate(['Take', expression, ['Tuple', -1, 1]])
    ).toMatchInlineSnapshot(`Nothing`));

  test('symbol', () =>
    expect(evaluate(['Take', symbol, ['Tuple', -1, 1]])).toMatchInlineSnapshot(
      `Nothing`
    ));

  test('dict', () =>
    expect(evaluate(['Take', dict, ['Tuple', -1, 1]])).toMatchInlineSnapshot(
      `Nothing`
    ));

  test('tuple', () =>
    expect(evaluate(['Take', tuple, ['Tuple', -1, 1]])).toMatchInlineSnapshot(
      `["List", 13, 10, 7]`
    ));
});

describe('Drop 2', () => {
  test('empty list', () =>
    expect(evaluate(['Drop', emptyList, 2])).toMatchInlineSnapshot(`Nothing`));

  test('list', () =>
    expect(evaluate(['Drop', list, 2])).toMatchInlineSnapshot(
      `["List", 7, 5, 19, 2, 3, 11]`
    ));

  test('matrix', () =>
    expect(evaluate(['Drop', matrix, 2])).toMatchInlineSnapshot(
      `["List", ["List", 2, 3, 4], ["List", 11, 12, 13]]`
    ));

  test('range', () =>
    expect(evaluate(['Drop', range, 2])).toMatchInlineSnapshot(
      `["List", 2, 6, 8, 10, 12, 14, 16, 18]`
    ));

  test('linspace', () =>
    expect(evaluate(['Drop', linspace, 2])).toMatchInlineSnapshot(`
      [
        "List",
        2,
        4.202247191011236,
        5.3033707865168545,
        6.404494382022472,
        7.50561797752809,
        8.606741573033709,
        9.707865168539325,
        10.808988764044944,
        11.910112359550562,
        13.01123595505618,
        14.112359550561798,
        15.213483146067416,
        16.314606741573034,
        17.41573033707865,
        18.51685393258427,
        19.617977528089888,
        20.719101123595507,
        21.820224719101123,
        22.921348314606742,
        24.02247191011236,
        25.123595505617978,
        26.224719101123597,
        27.325842696629213,
        28.426966292134832,
        29.528089887640448,
        30.629213483146067,
        31.730337078651687,
        32.8314606741573,
        33.932584269662925,
        35.03370786516854,
        36.13483146067416,
        37.235955056179776,
        38.337078651685395,
        39.438202247191015,
        40.53932584269663,
        41.640449438202246,
        42.741573033707866,
        43.842696629213485,
        44.943820224719104,
        46.04494382022472,
        47.146067415730336,
        48.247191011235955,
        49.348314606741575,
        50.449438202247194,
        51.550561797752806,
        52.651685393258425,
        53.752808988764045,
        54.853932584269664,
        55.95505617977528,
        57.056179775280896,
        58.157303370786515,
        59.258426966292134,
        60.359550561797754,
        61.46067415730337,
        62.561797752808985,
        63.662921348314605,
        64.76404494382022,
        65.86516853932585,
        66.96629213483146,
        68.06741573033707,
        69.1685393258427,
        70.26966292134831,
        71.37078651685393,
        72.47191011235955,
        73.57303370786516,
        74.67415730337079,
        75.7752808988764,
        76.87640449438203,
        77.97752808988764,
        79.07865168539325,
        80.17977528089888,
        81.28089887640449,
        82.38202247191012,
        83.48314606741573,
        84.58426966292134,
        85.68539325842697,
        86.78651685393258,
        87.88764044943821,
        88.98876404494382,
        90.08988764044943,
        91.19101123595506,
        92.29213483146067,
        93.3932584269663,
        94.49438202247191,
        95.59550561797752,
        96.69662921348315,
        97.79775280898876,
        98.89887640449439
      ]
    `));

  test('string', () =>
    expect(evaluate(['Drop', string, 2])).toMatchInlineSnapshot(
      `'hllo world'`
    ));

  test('expression', () =>
    expect(evaluate(['Drop', expression, 2])).toMatchInlineSnapshot(`Nothing`));

  test('symbol', () =>
    expect(evaluate(['Drop', symbol, 2])).toMatchInlineSnapshot(`Nothing`));

  test('dict', () =>
    expect(evaluate(['Drop', dict, 2])).toMatchInlineSnapshot(`Nothing`));

  test('tuple', () =>
    expect(evaluate(['Drop', tuple, 2])).toMatchInlineSnapshot(
      `["List", 7, 13]`
    ));
});

describe('INDEXABLE OPERATIONS', () => {
  test('At', () =>
    expect(evaluate(['At', list, 1])).toMatchInlineSnapshot(`7`));

  test('At', () =>
    expect(evaluate(['At', list, -2])).toMatchInlineSnapshot(`Nothing`));

  test('At', () =>
    expect(evaluate(['At', list, 1, 2])).toMatchInlineSnapshot(
      `["At", ["List", 7, 13, 5, 19, 2, 3, 11], 1, 2]`
    ));

  test('At', () =>
    expect(evaluate(['At', matrix, 1, 2])).toMatchInlineSnapshot(`3`));

  test('First', () =>
    expect(evaluate(['First', list])).toMatchInlineSnapshot(`7`));

  test('Second', () =>
    expect(evaluate(['Second', list])).toMatchInlineSnapshot(`13`));

  test('Last', () =>
    expect(evaluate(['Last', list])).toMatchInlineSnapshot(`Nothing`));

  test('Rest', () =>
    expect(evaluate(['Rest', list])).toMatchInlineSnapshot(`["List"]`));

  test('Most', () =>
    expect(evaluate(['Most', list])).toMatchInlineSnapshot(`["List"]`));

  test('RotateLeft', () =>
    expect(evaluate(['RotateLeft', list1, 2])).toMatchInlineSnapshot(
      `["RotateLeft", ["List", 100, 4, 2, 62, 34, 16, 8], 2]`
    ));

  test('RotateRight', () =>
    expect(evaluate(['RotateRight', list1, 2])).toMatchInlineSnapshot(
      `["RotateRight", ["List", 100, 4, 2, 62, 34, 16, 8], 2]`
    ));

  test('Sort', () =>
    expect(evaluate(['Sort', list])).toMatchInlineSnapshot(
      `["Sort", ["List", 7, 13, 5, 19, 2, 3, 11]]`
    ));

  test('Sort', () =>
    expect(evaluate(['Ordering', list])).toMatchInlineSnapshot(
      `["Ordering", ["List", 7, 13, 5, 19, 2, 3, 11]]`
    ));

  // test('Shuffle', () =>
  //   expect(evaluate(['Shuffle', list])).toMatchInlineSnapshot());

  test('Tally', () =>
    expect(evaluate(['Tally', list3])).toMatchInlineSnapshot(
      `["Pair", ["List", 3, 5, 7, 1, 9, 2], ["List", 3, 4, 4, 2, 2, 1]]`
    ));

  test('Unique', () =>
    expect(evaluate(['Unique', list3])).toMatchInlineSnapshot(
      `["List", 3, 5, 7, 1, 9, 2]`
    ));
});

describe('ITERABLE OPERATIONS', () => {
  test('Flatten', () =>
    expect(evaluate(['Flatten', matrix])).toMatchInlineSnapshot(
      `["List", 2, 3, 4, 6, 7, 9, 11, 12, 13]`
    ));

  test('Reverse', () =>
    expect(evaluate(['Reverse', list])).toMatchInlineSnapshot(
      `["List", 7, 13]`
    ));

  test('Map', () =>
    expect(
      evaluate(['Map', list, ['Function', ['Add', 'x', 1], 'x']])
    ).toMatchInlineSnapshot(`["List", 8, 14, 6, 20, 3, 4, 12]`));

  test('Map', () =>
    expect(evaluate(['Map', list, ['Add', '_', 1]])).toMatchInlineSnapshot(
      `["List", 8, 14, 6, 20, 3, 4, 12]`
    ));

  test('Filter', () =>
    expect(
      evaluate(['Filter', list, ['Greater', '_', 10]])
    ).toMatchInlineSnapshot(`["List", 13, 19, 11]`));

  test('Reduce', () =>
    expect(
      evaluate(['Reduce', list, ['Add', '_1', '_2']])
    ).toMatchInlineSnapshot(
      `["Reduce", ["List", 7, 13, 5, 19, 2, 3, 11], ["Add", "_1", "_2"]]`
    ));

  test('Reduce', () =>
    expect(evaluate(['Reduce', list, 'Add'])).toMatchInlineSnapshot(
      `["Reduce", ["List", 7, 13, 5, 19, 2, 3, 11], "Add"]`
    ));

  test('Zip', () =>
    expect(evaluate(['Zip', list1, list2])).toMatchInlineSnapshot(
      `["Zip", ["List", 100, 4, 2, 62, 34, 16, 8], ["List", 9, 7, 2, 24]]`
    ));

  test('Join', () =>
    expect(evaluate(['Join', list1, list2])).toMatchInlineSnapshot(
      `["List", 100, 4, 2, 62, 34, 16, 8, 9, 7, 2, 24]`
    ));
});

// describe('NON-ITERABLE OPERATIONS', () => {

// })
