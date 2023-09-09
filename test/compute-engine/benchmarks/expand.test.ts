import { BoxedExpression } from '../../../src/compute-engine/public';
import { benchmark, engine } from '../../utils';

//
// Expand Benchmark
//

function expand(e: BoxedExpression): BoxedExpression {
  return engine.fn('Expand', [e]).evaluate();
}

const p = engine.parse(`3x^2yz^7 + 7xyz^2 + 4x + xy^4`);
const e = engine.parse(`(x + y +  z + 1)^{32}`);

// engine.numericMode = 'machine';
// engine.precision = 14;

// console.log(expand(e).toJSON());

// console.log(expand(engine.parse('(a+b)^{10}')).latex);

// Sympy benchmarks.
// Source: https://github.com/sympy/sympy/blob/master/sympy/core/benchmarks/bench_expand.py
describe('SymPy Benchmarks', () => {
  test.skip(`Expand(3x^2yz^7 + 7xyz^2 + 4x + xy^4)`, () => {
    expect(
      benchmark(() => expand(p), {
        mem: 900000,
        time: 3.1,
        exprs: 676, // 173,
      })
    ).toBeLessThan(0.1);
  });

  test.skip(`Expand((x + y +  z + 1)^32)`, () => {
    expect(
      benchmark(() => expand(e), {
        mem: 9360056,
        time: 64.85,
        exprs: 20023,
      })
    ).toBeLessThan(0.1);
  });

  test.skip(`Expand((2 + 3i)^1000)`, () => {
    expect(
      benchmark(() => expand(engine.box(['Power', ['Complex', 2, 3], 1000])), {
        mem: 3256,
        time: 0.09,
        exprs: 6,
      })
    ).toBeLessThan(0.1);
  });

  test.skip(`Expand((2 + \\frac34 i)^1000)`, () => {
    expect(
      benchmark(
        () =>
          expand(
            engine.box(['Power', ['Complex', 2, ['Rational', 3, 4]], 1000])
          ),
        {
          mem: 5200,
          time: 0.22,
          exprs: 7,
        }
      )
    ).toBeLessThan(0.1);
  });
});

//
// Custom benchmarks
//

test.skip(`(a+b)^10`, () => {
  expect(
    benchmark(() => expand(engine.parse('(a+b)^{10}')), {
      mem: 3000000,
      time: 10,
      exprs: 1000, // 670,
    })
  ).toBeLessThan(0.1);
});

test.skip(`(a+b)^20`, () => {
  expect(
    benchmark(() => expand(engine.parse('(a+b)^{20}')), {
      mem: 2022480,
      time: 36, // 8.3,
      exprs: 3800, // 1456,
    })
  ).toBeLessThan(0.1);
});

test.skip(`(a+b)^40`, () => {
  expect(
    benchmark(() => expand(engine.parse('(a+b)^{40}')), {
      mem: 8714104,
      time: 176, // 22.12,
      exprs: 15000, // 7932,
    })
  ).toBeLessThan(0.5);
});

test.skip(`(a+b)^80`, () => {
  expect(
    benchmark(() => expand(engine.parse('(a+b)^{80}')), {
      mem: 1900000,
      time: 17000, // 65.98,
      exprs: 639636, // 38076,
    })
  ).toBeLessThan(0.1);
});

//
// Wolfram Benchmark
//
// From http://adereth.github.io/oneoff/mathematicamark9-20131231/#sources
//
// See also:
//  -  https://www.sagemath.org/tour-benchmarks.html
//  - "COMPARING COMPUTATIONAL SPEED OF MATLAB AND MATHEMATICA ACROSS A SET OF
//  BENCHMARK NUMBER CRUNCHING PROBLEM"  http://ac.inf.elte.hu/Vol_049_2019/219_49.pdf

// {
// "MachineName"->"wolframcloud-prd-cmp-4j-7",
// "System"->"Linuxx86(64-bit)",
// "BenchmarkName"->"WolframMark",
// "FullVersionNumber"->"13.0.0",
// "Date"->"March1,2022",
// "BenchmarkResult"->1.927,
// "TotalTime"->7.185,
// "Results"->{
//  {"DataFitting",0.466},
//  {"DigitsofPi",0.346},
//  {"DiscreteFourierTransform",0.665},
//  {"EigenvaluesofaMatrix",0.6},
//  {"ElementaryFunctions",0.544},
//  {"GammaFunction",0.46},
//  {"LargeIntegerMultiplication",0.433},
//  {"MatrixArithmetic",0.306},
//  {"MatrixMultiplication",0.534},
//  {"MatrixTranspose",0.744},
//  {"NumericalIntegration",0.735},
//  {"PolynomialExpansion",0.103},
//  {"RandomNumberSort",0.328},
//  {"SingularValueDecomposition",0.478},
//  {"SolvingaLinearSystem",0.443}}
//}

// Test 1 - Data Fitting

/*
 Module[
    {data},
    AbsoluteTiming[
      data = Flatten[
        Table[
          {x, y, z, Log[120 x] - Abs[Cos[z/300] / (140 y)]},
          {x, 0.2`, 10,0.22`},
          {y,0.2`, 10, 0.22`},
          {z, 0.2`,10,0.22`}
        ], 2];
      FindFit[data, Log[a x] - Abs[Cos[b z]/(c y)], {a,b,c}, {x,y,z}, AccuracyGoal->6];
    ]
  ]

  Answer: a = 120, b = 140, c = -300
 */

// Test 2 - Digits of Pi

/*
    AbsoluteTiming[N[\[Pi],1000000];]
*/

//  Test 3 - Discrete Fourier Transform

/*
Module[{data},AbsoluteTiming[SeedRandom[1];data=RandomReal[{},{1200000}];Do[Fourier[data],{11}]]]

*/

//  Test 4 - Eigenvalues of a Matrix

/*
Module[{a,b,m},AbsoluteTiming[SeedRandom[1];a=RandomReal[{},{420,420}];b=DiagonalMatrix[RandomReal[{},{420}]];m=a.b.Inverse[a];Do[Eigenvalues[m],{6}]]]

*/

//  Test 5 - Elementary Functions

/*
Module[{m1,m2},AbsoluteTiming[SeedRandom[1];m1=RandomReal[{},{2.2`*^6}];m2=RandomReal[{},{2.2`*^6}];Do[Exp[m1];Sin[m1];ArcTan[m1,m2],{30}]]]

*/

//  Test 6: Gamma Function
/*
Module[{a},AbsoluteTiming[SeedRandom[1];a=RandomInteger[{80000,90000},{55}];Gamma[a]]]

*/

//  Test  7: Large Integer Multiplication

/*
Module[{a},AbsoluteTiming[SeedRandom[1];a=RandomInteger[{10^1100000,10^(1100000+1)},{}];Do[a (a+1),{20}]]]

*/

//  Test  8: Matrix Arithmetic

/*
Module[{m},AbsoluteTiming[SeedRandom[1];m=RandomReal[{},{840,840}];Do[(1.` +0.5` m)^127,{50}];]]

*/

//  Test  9: Matrix Multiplication

/*
Module[{m1,m2},AbsoluteTiming[SeedRandom[1];m1=RandomReal[{},{1050,1050}];m2=RandomReal[{},{1050,1050}];Do[m1.m2,{12}]]]

*/

//  Test 10: Matrix Transpose

/*
Module[{m},AbsoluteTiming[SeedRandom[1];m=RandomReal[{},{2070,2070}];Do[Transpose[m],{40}]]]

*/

//  Test 11: Numerical Integration
// Answer:  3.147414059...

/*
AbsoluteTiming[NIntegrate[Sin[x^2+y^2],{x,-(2.6` \[Pi]),2.6` \[Pi]},{y,-(2.6` \[Pi]),2.6` \[Pi]}];]

*/

//  Test 12: Polynomial Expansion

/*
AbsoluteTiming[Expand[Times@@Table[(c+x)^3,{c,350}]];]

*/

//  Test 13: Random Number Sort

/*
Module[{a},AbsoluteTiming[SeedRandom[1];a=RandomInteger[{1,50000},{520000}];Do[Sort[a],{15}]]]

*/

//  Test 14: Singular Value Decomposition

/*
Module[{m},AbsoluteTiming[SeedRandom[1];m=RandomReal[{},{860,860}];Do[SingularValueDecomposition[m],{2}]]]

*/

//  Test 15: Solving a Linear System

/*
Module[{m,v},AbsoluteTiming[SeedRandom[1];m=RandomReal[{},{1150,1150}];v=RandomReal[{},{1150}];Do[LinearSolve[m,v],{16}]]]

*/
