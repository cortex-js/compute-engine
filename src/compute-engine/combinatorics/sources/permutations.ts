// The permutations table: one row per statistic, ported from the enumeratio library.
// The Epsil text is the definition and the source of truth. Only
// `scripts/combinatorics/generate.ts` and the tests read this file; it is
// compiled into `../compiled.ts`, so the Epsil text stays out of the runtime
// bundle.

import type { Source } from './source.js';

export const PERMUTATION_SOURCES: readonly Source[] = [
  {
    head: 'Adjacencies',
    findstat: 'St000214',
    summary: 'Positions i with p(i+1) = p(i) - 1.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i + 1] == p[i] - 1))',
  },
  {
    head: 'AdjacentCycles',
    findstat: 'St000153',
    summary: 'Cycles of the form (a, a+1, ..., a+k), fixed points included.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => Count(Filter(Range(i, Length(p), 1), m => p[m] == i && Count(Filter(Range(i, Length(p), 1), j => j < m && (p[j] < j + 1 || p[j] > j + 1))) == 0)) > 0))',
  },
  {
    head: 'AdmissibleInversions',
    findstat: 'St000463',
    summary:
      'Pairs i < j with p(i) > p(j) and either p(i-1) < p(i) or some entry between them larger than p(i).',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Sum(Map(j => 1, Filter(Range(i + 1, Length(p)), j => p[i] > p[j] && ((p[i - 1] < p[i] if i > 1 else False) || (Max(Map(k => p[k], Range(i + 1, j - 1))) > p[i] if i + 1 < j else False))))), Range(1, Length(p) - 1)))',
  },
  {
    head: 'Alignments',
    findstat: 'St000222',
    summary: 'Pairs i, j of arcs of the permutation diagram that align.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Count(Filter(Range(1, Length(p)), j => j < i && i < p[i] && p[i] < p[j] || p[j] < p[i] && p[i] <= i && i < j || j <= p[j] && p[j] < p[i] && p[i] < i || p[i] < i && i < j && j <= p[j])), Range(1, Length(p))))',
  },
  {
    head: 'AlternatingSubsetBreakCount',
    findstat: 'St001639',
    summary:
      'The subsets of 1 .. n alternating in parity whose image under p is not.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(0, 2 ^ Length(p) - 1), m => Apply((s: list<integer>) => Apply((t: list<integer>) => Sum(Map(i => Count(Filter(Range(1, Length(p)), j => j > i && (j - i) % 2 == 0 && s[i] * s[j] == 1 && Count(Filter(Range(1, Length(p)), k => k > i && k < j && s[k] == 1)) == 0)), Range(1, Length(p)))) == 0 && Sum(Map(i => Count(Filter(Range(1, Length(p)), j => j > i && (j - i) % 2 == 0 && t[i] * t[j] == 1 && Count(Filter(Range(1, Length(p)), k => k > i && k < j && t[k] == 1)) == 0)), Range(1, Length(p)))) > 0, Map(v => s[Sum(Map(j => j if p[j] == v else 0, Range(1, Length(p))))], Range(1, Length(p)))), Map(k => 1 if m % 2 ^ k >= 2 ^ (k - 1) else 0, Range(1, Length(p) + 1)))))',
  },
  {
    head: 'ArithmeticProgressionsOfLengthTwo',
    findstat: 'St001565',
    summary: 'Triples i < j < k with p(k) - p(j) = p(j) - p(i).',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[k] - p[j] == p[j] - p[i])), Range(i + 1, Length(p) - 1))), Range(1, Length(p) - 2)))',
  },
  {
    head: 'AscentTopSum',
    findstat: 'St000471',
    summary: 'The sum of the ascent tops: p(i+1) over the ascents i.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => p[i + 1], Filter(Range(1, Length(p) - 1), i => p[i] < p[i + 1])))',
  },
  {
    head: 'Ascents',
    findstat: 'St000245',
    summary:
      'The number of ascents of $p$: positions $i$ with $p_i < p_{i+1}$.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] < p[i + 1]))',
  },
  {
    head: 'AugmentedDoubleAscents',
    findstat: 'St001948',
    summary:
      'Positions i with w(i) < w(i+1) < w(i+2) in the word w = 0 p(1) ... p(n).',
    epsil:
      'p => 0 if Length(p) < 2 else Apply((w: list<integer>) => Count(Filter(Range(1, Length(w) - 2, 1), i => w[i] < w[i + 1] && w[i + 1] < w[i + 2])), Join([0], p))',
  },
  {
    head: 'BabsonSteingrimssonStatisticDoublePrime',
    findstat: 'St000797',
    summary:
      'Descents plus the occurrences of the vincular patterns 1-32, 3-12 and 3-21.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])) + (0 if Length(p) < 3 else Sum(Map(j => Count(Filter(Range(1, j - 1), i => p[i] < p[j + 1] && p[j + 1] < p[j] || p[j] < p[j + 1] && p[j + 1] < p[i] || p[j + 1] < p[j] && p[j] < p[i])), Range(2, Length(p) - 1))))',
  },
  {
    head: 'BigAscents',
    findstat: 'St000646',
    summary: 'Positions i with p(i+1) - p(i) > 1.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i + 1] - p[i] > 1))',
  },
  {
    head: 'BigDeficiencies',
    findstat: 'St000710',
    summary: 'Positions with i - p(i) > 1.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => i - p[i] > 1))',
  },
  {
    head: 'BigExcedances',
    findstat: 'St000711',
    summary: 'Positions with p(i) - i > 1.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] - i > 1))',
  },
  {
    head: 'Bonds',
    findstat: 'St001405',
    summary: 'Positions i with |p(i) - p(i+1)| = 1.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1, 1), i => Abs(p[i] - p[i + 1]) == 1))',
  },
  {
    head: 'BoxedOccurrencesOf132',
    findstat: 'St001083',
    summary:
      'Occurrences of 132 with no other entry positioned between the first and last and valued between the least and greatest.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[i] < p[k] && p[k] < p[j] && Count(Filter(Range(1, Length(p)), m => m > i && m < k && m != j && p[m] > p[i] && p[m] < p[j])) == 0)), Range(i + 1, Length(p)))), Range(1, Length(p))))',
  },
  {
    head: 'BruhatLowerCovers',
    findstat: 'St000957',
    summary:
      'Pairs i < j with p(i) > p(j) and no entry between them valued between p(j) and p(i).',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Count(Filter(Range(i + 1, Length(p), 1), j => p[i] > p[j] && Count(Filter(Range(i + 1, j - 1, 1), k => p[k] > p[j] && p[k] < p[i])) == 0)), Range(1, Length(p) - 1)))',
  },
  {
    head: 'BruhatTranspositionCount',
    findstat: 'St001558',
    summary: 'Transpositions that are at most p in Bruhat order.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Sum(Map(i => Count(Filter(Range(i + 1, Length(p), 1), j => Sum(Map(k => Count(Filter(Range(i + 1, j, 1), m => Count(Filter(Range(1, k, 1), u => p[u] >= m)) < Max(k - m + 1, 0) + 1)), Range(i, j - 1, 1))) == 0)), Range(1, Length(p)))), 0)',
  },
  {
    head: 'ComajorIndex',
    findstat: 'St000833',
    summary: 'The sum of n - i over the descents i.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Length(p) - i, Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])))',
  },
  {
    head: 'ConsecutiveSwapClassSize',
    findstat: 'St000458',
    summary:
      'The permutations reached from p by swapping adjacent entries that differ by 1, p included.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply((q: list<integer>) => Apply((a_init: list<integer>) => Fold((a: list<integer>, m) => Apply((a_next: list<integer>) => a_next, Join(a, [Sum(Map(v => a[m - 2 ^ (v - 1) + 1] if (1 if m % 2 ^ v >= 2 ^ (v - 1) else 0) == 1 && Count(Filter(Range(1, Length(p)), w => Abs(w - v) != 1 && q[w] < q[v] && (1 if m % 2 ^ w >= 2 ^ (w - 1) else 0) == 0)) == 0 else 0, Range(1, Length(p))))])), a_init, Range(1, 2 ^ Length(p) - 1)), [1])[2 ^ Length(p)], Map(v => Sum(Map(j => j if p[j] == v else 0, Range(1, Length(p)))), Range(1, Length(p))))',
  },
  {
    head: 'CycleAsOneLinePreimageSize',
    findstat: 'St000279',
    summary:
      'The permutations whose cycles, each from its least point and in order of those, read p as one word.',
    epsil:
      'p => 1 if Length(p) < 1 else 2 ^ (Count(Filter(Range(1, Length(p)), i => p[i] == Min(Map(j => p[j], Range(i, Length(p)))))) - 1) if p[1] == 1 else 0',
  },
  {
    head: 'CycleDescents',
    findstat: 'St000317',
    summary:
      'Steps down within the cycles, each written from its smallest point.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] < i && Fold((w, k) => w if w <= 0 else 0 if w == p[i] else -1 if w < p[i] else p[w], p[p[i]], Range(1, Length(p), 1)) < 0))',
  },
  {
    head: 'CycleMinimumExceedancesDeficiencies',
    findstat: 'St001269',
    summary:
      'The sum over the cycles of the lesser of the number of exceedances and the number of the other points.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Sum(Map(i => Min([Count(Filter(Range(1, Length(p)), m => Count(Filter(Range(1, Length(p), 1), k => Fold((w, t) => p[w], i, Range(1, k, 1)) == m)) > 0 && p[m] > m)), Count(Filter(Range(1, Length(p)), m => Count(Filter(Range(1, Length(p), 1), k => Fold((w, t) => p[w], i, Range(1, k, 1)) == m)) > 0 && p[m] <= m))]), Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0))), 0)',
  },
  {
    head: 'CyclesOfLengthAtLeastThree',
    findstat: 'St000486',
    summary: 'Cycles of size at least three.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Map(i => Min(Filter(Range(1, Length(p), 1), k => Fold((w, j) => p[w], i, Range(1, k, 1)) == i)), Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0)), c => c >= 3))',
  },
  {
    head: 'CyclesOfLengthAtMostTwo',
    findstat: 'St000488',
    summary: 'Cycles of size one or two.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Map(i => Min(Filter(Range(1, Length(p), 1), k => Fold((w, j) => p[w], i, Range(1, k, 1)) == i)), Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0)), c => c <= 2))',
  },
  {
    head: 'CyclicBonds',
    findstat: 'St001516',
    summary: 'Positions i with |p(i) - p(i+1)| = 1, with p(n+1) = p(1).',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => Abs(p[i] - (p[1] if i == Length(p) else p[i + 1])) == 1))',
  },
  {
    head: 'CyclicDescents',
    findstat: 'St000619',
    summary:
      'Descents of p read cyclically, counting position n when p(n) > p(1).',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])) + (1 if p[Length(p)] > p[1] else 0)',
  },
  {
    head: 'CyclicMisalignments',
    findstat: 'St001536',
    summary: 'Pairs (i, j) with i, p(i), j, p(j) in cyclic order.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Count(Filter(Range(1, Length(p)), j => i < p[i] && p[i] < j && j < p[j] || p[i] < j && j < p[j] && p[j] < i || j < p[j] && p[j] < i && i < p[i] || p[j] < i && i < p[i] && p[i] < j)), Range(1, Length(p))))',
  },
  {
    head: 'CyclicSmallWeakExcedances',
    findstat: 'St000236',
    summary: 'Positions with p(i) = i or p(i) = i + 1, read cyclically.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == i || p[i] == (1 if i == Length(p) else i + 1)))',
  },
  {
    head: 'CyclicValleys',
    findstat: 'St000243',
    summary:
      'Positions lower than both neighbours, reading the word cyclically.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((w: list<integer>) => Count(Filter(Range(2, Length(w) - 1, 1), i => w[i - 1] > w[i] && w[i] < w[i + 1])), Join([p[Length(p)]], p, [p[1]]))',
  },
  {
    head: 'DecompositionNumber',
    findstat: 'St000056',
    summary:
      'The k with {p(1), ..., p(k)} = {1, ..., k}: the blocks of p as a direct sum.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => Max(Map(j => p[j], Range(1, i))) == i))',
  },
  {
    head: 'Depth',
    findstat: 'St000029',
    summary: 'Half the total displacement, (1/2) * sum |p(i) - i|.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Abs(p[i] - i), Range(1, Length(p)))) / 2',
  },
  {
    head: 'DescentDifferenceSum',
    findstat: 'St000030',
    summary: 'The sum of p(i) - p(i+1) over the descents i.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => p[i] - p[i + 1], Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])))',
  },
  {
    head: 'DescentWeightMinusInversions',
    findstat: 'St001911',
    summary: 'The sum of i(n - i) over the descents i, less the inversions.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => i * (Length(p) - i) if p[i] > p[i + 1] else 0, Range(1, Length(p) - 1))) - Sum(Map(i => Count(Filter(Range(i + 1, Length(p)), j => p[i] > p[j])), Range(1, Length(p))))',
  },
  {
    head: 'Descents',
    findstat: 'St000021',
    summary:
      'The number of descents of $p$: positions $i$ with $p_i > p_{i+1}$.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1]))',
  },
  {
    head: 'DescentsAndRecoils',
    findstat: 'St001061',
    summary: 'Indices i < n that are both a descent of p and a recoil.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1] && Sum(Map(j => j if p[j] == i else 0, Range(1, Length(p)))) > Sum(Map(j => j if p[j] == i + 1 else 0, Range(1, Length(p))))))',
  },
  {
    head: 'DescentsOfDistanceThree',
    findstat: 'St001520',
    summary: 'Positions i with p(i) > p(i+3).',
    epsil:
      'p => 0 if Length(p) < 4 else Count(Filter(Range(1, Length(p) - 3), i => p[i] > p[i + 3]))',
  },
  {
    head: 'DescentsOfTypeTwo',
    findstat: 'St001737',
    summary: 'Descents i with p(i) larger than everything before it.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1, 1), i => p[i] > p[i + 1] && p[i] == Max(Map(j => p[j], Range(1, i)))))',
  },
  {
    head: 'DescentsPlusRecoils',
    findstat: 'St000824',
    summary:
      'Descents plus recoils: the two counts added, not the union of the indices.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])) + Count(Filter(Range(1, Length(p) - 1), i => Sum(Map(j => j if p[j] == i else 0, Range(1, Length(p)))) > Sum(Map(j => j if p[j] == i + 1 else 0, Range(1, Length(p))))))',
  },
  {
    head: 'Disorder',
    findstat: 'St000446',
    summary:
      'Scanning cyclically for 1, then 2, ...: the entries passed that are still larger than the one sought.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(v => Apply((a: number) => Apply((b: number) => Count(Filter(Range(1, Length(p)), q => p[q] > v && (a < b && q > a && q < b || a > b && (q > a || q < b)))), Sum(Map(j => j if p[j] == v else 0, Range(1, Length(p))))), Sum(Map(j => j if p[j] == v - 1 else 0, Range(1, Length(p))))), Range(1, Length(p) - 1, 1)))',
  },
  {
    head: 'DistinctCycleLengths',
    summary: 'How many distinct cycle sizes occur.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p), 1), m => Count(Filter(Map(i => Min(Filter(Range(1, Length(p), 1), k => Fold((w, j) => p[w], i, Range(1, k, 1)) == i)), Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0)), c => c == m)) > 0))',
  },
  {
    head: 'DistinctPatternCount',
    findstat: 'St000520',
    summary:
      'The order patterns of the subsequences of p, the empty one included, counted once each.',
    epsil:
      'p => 1 if Length(p) < 1 else Max(Count(Filter(Range(0, 2 ^ Length(p) - 1), m => Apply((va: list<integer>) => Count(Filter(Filter(Range(0, 2 ^ Length(p) - 1), r => r < m), r => Apply((vb: list<integer>) => Sum(Map(t => Count(Filter(Filter(Range(1, Length(p)), u => u > t && u <= Length(va)), u => (1 if va[t] < va[u] else 0) != (1 if vb[t] < vb[u] else 0))), Filter(Range(1, Length(p)), t => t <= Length(va)))) == 0 if Length(va) == Length(vb) else False, Map(q => p[q], Filter(Range(1, Length(p)), q => (1 if r % 2 ^ q >= 2 ^ (q - 1) else 0) == 1))))) == 0, Map(q => p[q], Filter(Range(1, Length(p)), q => (1 if m % 2 ^ q >= 2 ^ (q - 1) else 0) == 1))))), 0)',
  },
  {
    head: 'DoubleDeficiencies',
    findstat: 'St000732',
    summary: 'Positions with i > p(i) > p(p(i)).',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] < i && p[i] > p[p[i]]))',
  },
  {
    head: 'DoubleExcedances',
    findstat: 'St000731',
    summary: 'Positions with i < p(i) < p(p(i)).',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] > i && p[i] < p[p[i]]))',
  },
  {
    head: 'ElizaldePakRank',
    findstat: 'St000352',
    summary: 'The largest k with p(i) > k for all i <= k.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), k => Count(Filter(Range(1, k, 1), m => Min(Map(j => p[j], Range(1, m))) <= m)) == 0))',
  },
  {
    head: 'EvenInversions',
    findstat: 'St000538',
    summary: 'Inversions i < j with j - i even.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Sum(Map(j => 1, Filter(Range(i + 1, Length(p)), j => p[i] > p[j] && (j - i) % 2 == 0))), Range(1, Length(p) - 1)))',
  },
  {
    head: 'Excedances',
    findstat: 'St000155',
    summary: 'The number of excedances of $p$: positions $i$ with $p_i > i$.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] > i))',
  },
  {
    head: 'ExclusiveRightToLeftMinima',
    findstat: 'St000374',
    summary: 'Right-to-left minima that are not left-to-right maxima.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == Min(Map(j => p[j], Range(i, Length(p)))) && p[i] < Max(Map(j => p[j], Range(1, i)))))',
  },
  {
    head: 'FinalRises',
    findstat: 'St000989',
    summary: 'The ascents at the end: n - 1 less the last descent position.',
    epsil:
      'p => 0 if Length(p) < 2 else Length(p) - 1 - (0 if Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])) == 0 else Max(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])))',
  },
  {
    head: 'FirstDescent',
    findstat: 'St000654',
    summary: 'The smallest descent position, or n when p is increasing.',
    epsil:
      'p => Length(p) if Length(p) < 2 else Length(p) if Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])) == 0 else Min(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1]))',
  },
  {
    head: 'FirstEntry',
    findstat: 'St000054',
    summary: 'The first entry p(1).',
    epsil: 'p => 0 if Length(p) < 1 else p[1]',
  },
  {
    head: 'FixedPointMajorIndex',
    findstat: 'St000339',
    summary:
      'The sum of the fixed points less the triangular number of their count, plus the major index of the word without its fixed points.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Filter(Range(1, Length(p)), i => p[i] == i)) - Count(Filter(Range(1, Length(p)), i => p[i] == i)) * (Count(Filter(Range(1, Length(p)), i => p[i] == i)) + 1) / 2 + Apply((d: list<integer>) => Sum(Map(i => i, Filter(Range(1, Length(d) - 1, 1), i => d[i] > d[i + 1]))), Filter(Map(i => 0 if p[i] == i else p[i], Range(1, Length(p))), v => v != 0))',
  },
  {
    head: 'FixedPointsBeforeLargestMovedPoint',
    findstat: 'St001810',
    summary: 'Fixed points smaller than the largest i with p(i) != i.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Max(Join([0], Filter(Range(1, Length(p)), i => p[i] < i || p[i] > i))), 1), i => p[i] == i))',
  },
  {
    head: 'GlobalDescents',
    findstat: 'St000546',
    summary: 'Positions i < n with p(j) > p(k) whenever j <= i < k.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => Min(Map(j => p[j], Range(1, i))) > Max(Map(j => p[j], Range(i + 1, Length(p))))))',
  },
  {
    head: 'Hag',
    findstat: 'St001671',
    summary:
      'The excedance tops less their positions, plus the inversions among the excedance tops less those among the rest, plus the pairs k < i, over excedances i, with p(k) <= i.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Sum(Map(i => p[i] - i, Filter(Range(1, Length(p)), i => p[i] > i))), 0) + Sum(Map(i => Count(Filter(Range(i + 1, Length(p)), j => p[j] > j && p[i] > p[j])) if p[i] > i else 0, Range(1, Length(p)))) + Sum(Map(i => Count(Filter(Range(1, i - 1, 1), k => p[k] <= i)), Filter(Range(1, Length(p)), i => p[i] > i))) - Sum(Map(i => Count(Filter(Range(i + 1, Length(p)), j => p[j] <= j && p[i] > p[j])) if p[i] <= i else 0, Range(1, Length(p))))',
  },
  {
    head: 'HalfPermanentOfIdentityPlusPermutation',
    findstat: 'St001661',
    summary:
      'Half the permanent of the identity matrix plus the permutation matrix, which is 2 to the power of the cycles less one.',
    epsil:
      'p => 0 if Length(p) < 1 else 2 ^ (Count(Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0)) - 1)',
  },
  {
    head: 'HertzsprungOccurrencesOf132',
    findstat: 'St001663',
    summary: 'Positions i with p(i+1) = p(i) + 2 and p(i+2) = p(i) + 1.',
    epsil:
      'p => 0 if Length(p) < 3 else Count(Filter(Range(1, Length(p) - 2), i => p[i + 1] == p[i] + 2 && p[i + 2] == p[i] + 1))',
  },
  {
    head: 'HookFactorizationPrefixLength',
    findstat: 'St000338',
    summary:
      'The length of the leading increasing factor p of the hook factorization p t1 ... tk.',
    epsil:
      'p => Length(p) if Length(p) < 2 else Fold((a, b) => b if b <= a - 2 && p[b] > p[b + 1] else a, Length(p) + 1, Range(Length(p) - 1, 1, -1)) - 1',
  },
  {
    head: 'InterpolatingPolynomialDegree',
    findstat: 'St001958',
    summary:
      'The degree of the polynomial through the points (i, p(i)): the largest k with a nonzero k-th finite difference.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Filter(Range(0, Length(p) - 1), k => Sum(Map(j => Binomial(k, j) * (1 if (k - j) % 2 == 0 else -1) * p[j + 1], Range(0, k))) != 0))',
  },
  {
    head: 'InverseFoataArrowPairs',
    findstat: 'St001745',
    summary: 'Pairs i < j with p(i) < inverse Foata of p(i) < p(j).',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Count(Filter(Range(1, Length(p)), t => t > i && p[t] > ((p[i + 1] if p[i + 1] < Max(Map(j => p[j], Range(1, i))) else Max(Map(j => p[j], Range(1, i)))) if i < Length(p) else Max(Map(j => p[j], Range(1, i)))))) if ((p[i + 1] if p[i + 1] < Max(Map(j => p[j], Range(1, i))) else Max(Map(j => p[j], Range(1, i)))) if i < Length(p) else Max(Map(j => p[j], Range(1, i)))) > p[i] else 0, Range(1, Length(p))))',
  },
  {
    head: 'InversionIndex',
    findstat: 'St000616',
    summary: 'The sum of the larger entry p(i) over the inversions i < j.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Sum(Map(j => p[i], Filter(Range(i + 1, Length(p)), j => p[i] > p[j] && True))), Range(1, Length(p) - 1)))',
  },
  {
    head: 'Inversions',
    findstat: 'St000018',
    summary:
      'The number of inversions of a permutation $p$: pairs $i < j$ with $p_i > p_j$ (its Kendall-tau distance from the identity).',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Count(Filter(Range(i + 1, Length(p)), j => p[i] > p[j])), Range(1, Length(p))))',
  },
  {
    head: 'InversionsBetweenExcedancesWithLinkedGreater',
    findstat: 'St001550',
    summary: 'Pairs i < j < p(j) < p(i) with p^-1(j) < j.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Count(Filter(Range(1, Length(p)), j => i < j && j < p[j] && p[j] < p[i] && Sum(Map(m => m if p[m] == j else 0, Range(1, Length(p)))) < j)), Range(1, Length(p))))',
  },
  {
    head: 'InversionsOfDistanceAtMostThree',
    findstat: 'St000494',
    summary: 'Inversions i < j with j - i <= 3.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Sum(Map(j => 1, Filter(Range(i + 1, Length(p)), j => p[i] > p[j] && j - i <= 3))), Range(1, Length(p) - 1)))',
  },
  {
    head: 'InversionsOfSecondEntry',
    findstat: 'St001557',
    summary: 'Positions after the second with a smaller entry than p(2).',
    epsil:
      'p => 0 if Length(p) < 3 else Count(Filter(Range(3, Length(p)), j => p[j] < p[2]))',
  },
  {
    head: 'InversionsPlusMajorIndex',
    findstat: 'St001379',
    summary: 'The number of inversions plus the major index.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Count(Filter(Range(i + 1, Length(p)), j => p[i] > p[j])), Range(1, Length(p)))) + Sum(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1]))',
  },
  {
    head: 'InvisibleInversions',
    findstat: 'St001727',
    summary: 'Pairs i < j with p(i) > p(j) > i.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Sum(Map(j => 1, Filter(Range(i + 1, Length(p)), j => p[i] > p[j] && p[j] > i))), Range(1, Length(p) - 1)))',
  },
  {
    head: 'LabellingPermutationPreimageSize',
    findstat: 'St000280',
    summary:
      'The parking functions sent to p by the map to the labelling permutation.',
    epsil:
      'p => 1 if Length(p) < 2 else Max(Sum(Apply((a_init: list<integer>) => Fold((a: list<integer>, b) => Apply((a_next: list<integer>) => a_next, Map(v => Sum(Map(u => a[u], Range(1, v))) - (a[v] if p[b - 1] > p[b] else 0) if v <= b else 0, Range(1, Length(p)))), a_init, Range(2, Length(p))), Map(i => 1 if i == 1 else 0, Range(1, Length(p))))), 0)',
  },
  {
    head: 'LargestDirectSummandSize',
    findstat: 'St000844',
    summary: 'The size of the largest block of p as a direct sum.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((b: list<integer>) => Max(Map(i => b[i + 1] - b[i], Range(1, Length(b) - 1, 1))), Join([0], Filter(Range(1, Length(p)), i => Max(Map(j => p[j], Range(1, i))) == i)))',
  },
  {
    head: 'LargestRunLength',
    summary:
      "The length of the longest increasing run (the catalog's second spelling of LongestRun).",
    epsil:
      'p => 0 if Length(p) < 1 else (1 if Length(p) < 2 else Apply(r => r[2], Fold((a, i) => Apply(c => [c, Max(a[2], c)], a[1] + 1 if p[i - 1] < p[i] else 1), [1, 1], Range(2, Length(p)))))',
  },
  {
    head: 'LargestUniversalPatternSize',
    findstat: 'St001741',
    summary:
      'The largest k such that p contains every permutation of size k as a pattern.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Max(Apply((firsts: list<integer>) => Count(Filter(Range(1, Length(p)), k => Count(Filter(firsts, s => s == k)) == (1 if k < 2 else Product(Range(1, k))))), Map(m => Apply((va: list<integer>) => Length(va) if Count(Filter(Filter(Range(0, 2 ^ Length(p) - 1), r => r < m), r => Apply((vb: list<integer>) => Sum(Map(t => Count(Filter(Filter(Range(1, Length(p)), u => u > t && u <= Length(va)), u => (1 if va[t] < va[u] else 0) != (1 if vb[t] < vb[u] else 0))), Filter(Range(1, Length(p)), t => t <= Length(va)))) == 0 if Length(va) == Length(vb) else False, Map(q => p[q], Filter(Range(1, Length(p)), q => (1 if r % 2 ^ q >= 2 ^ (q - 1) else 0) == 1))))) == 0 else 0, Map(q => p[q], Filter(Range(1, Length(p)), q => (1 if m % 2 ^ q >= 2 ^ (q - 1) else 0) == 1))), Range(0, 2 ^ Length(p) - 1))), 0), 0)',
  },
  {
    head: 'LastDescent',
    findstat: 'St000653',
    summary: 'The largest descent position, or 0 when p is increasing.',
    epsil:
      'p => 0 if Length(p) < 2 else 0 if Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])) == 0 else Max(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1]))',
  },
  {
    head: 'LeftOuterPeaks',
    findstat: 'St000035',
    summary:
      'Peaks of the word 0 p(1) ... p(n): the interior peaks, plus one when p(1) > p(2).',
    epsil:
      'p => 0 if Length(p) < 2 else Apply((w: list<integer>) => Count(Filter(Range(2, Length(w) - 1), i => w[i - 1] < w[i] && w[i] > w[i + 1])), Join([0], p))',
  },
  {
    head: 'LeftToRightMaximaOrRightToLeftMinima',
    findstat: 'St001004',
    summary:
      'Positions that are a left-to-right maximum, a right-to-left minimum, or both.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == Max(Map(j => p[j], Range(1, i))) || p[i] == Min(Map(j => p[j], Range(i, Length(p))))))',
  },
  {
    head: 'LeftToRightMaximaXorRightToLeftMinima',
    findstat: 'St001005',
    summary:
      'Positions that are a left-to-right maximum or a right-to-left minimum but not both.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == Max(Map(j => p[j], Range(1, i))) && p[i] > Min(Map(j => p[j], Range(i, Length(p)))) || p[i] == Min(Map(j => p[j], Range(i, Length(p)))) && p[i] < Max(Map(j => p[j], Range(1, i)))))',
  },
  {
    head: 'LexicographicRank',
    findstat: 'St000020',
    summary:
      'The position of p among the permutations of its size in lexicographic order, counting from 1.',
    epsil:
      'p => 1 if Length(p) < 1 else 1 + Max(Sum(Map(i => Count(Filter(Range(i + 1, Length(p), 1), j => p[j] < p[i])) * (1 if Length(p) - i < 2 else Product(Range(1, Length(p) - i))), Range(1, Length(p)))), 0)',
  },
  {
    head: 'LongestArithmeticProgression',
    findstat: 'St001566',
    summary:
      'The length of a longest subsequence whose entries form an arithmetic progression, of either sign.',
    epsil:
      'p => Length(p) if Length(p) < 2 else Max(Map(i => Max(Map(d => Min(Filter(Range(1, Length(p)), t => p[i] + t * d < 1 || p[i] + t * d > Length(p) || Sum(Map(m => m if p[m] == p[i] + t * d else 0, Range(1, Length(p)))) < Sum(Map(m => m if p[m] == p[i] + (t - 1) * d else 0, Range(1, Length(p)))))), Filter(Range(1 - Length(p), Length(p) - 1), d => d != 0))), Range(1, Length(p))))',
  },
  {
    head: 'LongestDecreasingSubsequence',
    summary: 'The length of a longest decreasing subsequence.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Fold((a, b) => Apply(k => Join(a, [b]) if k > Count(a) else ReplaceAt(a, k, b), Count(Filter(a, t => t > b)) + 1), [], p))',
  },
  {
    head: 'LongestIncreasingSubsequenceCount',
    findstat: 'St000883',
    summary: 'The number of longest increasing subsequences of p.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply((r: list<integer>) => Sum(Map(i => r[Length(p) + i] if r[i] == Max(Map(j => r[j], Range(1, Length(p)))) else 0, Range(1, Length(p)))), Fold((a, b) => Apply(L => Apply(c => ReplaceAt(ReplaceAt(a, b, L), Length(p) + b, c), 1 if L == 1 else Sum(Map(j => a[Length(p) + j], Filter(Range(1, Length(p)), j => j < b && p[j] < p[b] && a[j] == L - 1)))), 1 + Max(Join([0], Map(j => a[j], Filter(Range(1, Length(p)), j => j < b && p[j] < p[b]))))), Map(w => 0, Range(1, 2 * Length(p))), Range(1, Length(p))))',
  },
  {
    head: 'LongestRun',
    summary: 'The length of the longest run of consecutive increases.',
    epsil:
      'p => 0 if Length(p) < 1 else (1 if Length(p) < 2 else Apply(r => r[2], Fold((a, i) => Apply(c => [c, Max(a[2], c)], a[1] + 1 if p[i - 1] < p[i] else 1), [1, 1], Range(2, Length(p)))))',
  },
  {
    head: 'LongestTwinLength',
    findstat: 'St001517',
    summary:
      'The size of a largest pair of disjoint subsequences of p that are order isomorphic.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Join([0], Map(m => Apply((va: list<integer>) => Max(Join([0], Map(r => Apply((vb: list<integer>) => (Length(va) if Sum(Map(t => Count(Filter(Filter(Range(1, Length(p)), u => u > t && u <= Length(va)), u => (1 if va[t] < va[u] else 0) != (1 if vb[t] < vb[u] else 0))), Filter(Range(1, Length(p)), t => t <= Length(va)))) == 0 else 0) if Count(Filter(Range(1, Length(p)), q => (1 if m % 2 ^ q >= 2 ^ (q - 1) else 0) == 1 && (1 if r % 2 ^ q >= 2 ^ (q - 1) else 0) == 1)) == 0 && Length(va) == Length(vb) else 0, Map(q => p[q], Filter(Range(1, Length(p)), q => (1 if r % 2 ^ q >= 2 ^ (q - 1) else 0) == 1))), Filter(Range(0, 2 ^ Length(p) - 1), r => r > m)))), Map(q => p[q], Filter(Range(1, Length(p)), q => (1 if m % 2 ^ q >= 2 ^ (q - 1) else 0) == 1))), Range(0, 2 ^ Length(p) - 1))))',
  },
  {
    head: 'LowerMiddleEntry',
    findstat: 'St001807',
    summary: 'The entry p(floor((n+1)/2)).',
    epsil:
      'p => 0 if Length(p) < 1 else p[(Length(p) + 1 - (Length(p) + 1) % 2) / 2]',
  },
  {
    head: 'Mad',
    findstat: 'St000795',
    summary: "Foata and Zeilberger's mad: 2 (2-31) + (31-2) + (21).",
    epsil:
      'p => (0 if Length(p) < 3 else Sum(Map(j => Count(Filter(Range(1, j - 1), i => p[j + 1] < p[i] && p[i] < p[j])), Range(2, Length(p) - 1)))) + (0 if Length(p) < 3 else Sum(Map(j => Count(Filter(Range(1, j - 1), i => p[j + 1] < p[i] && p[i] < p[j])), Range(2, Length(p) - 1)))) + (0 if Length(p) < 3 else Sum(Map(i => Count(Filter(Range(i + 2, Length(p)), k => p[i + 1] < p[k] && p[k] < p[i])), Range(1, Length(p) - 2)))) + (0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])))',
  },
  {
    head: 'MajorIndexAfterZeroingFixedPoints',
    findstat: 'St000334',
    summary:
      'The major index of the word with every fixed point replaced by 0.',
    epsil:
      'p => 0 if Length(p) < 2 else Apply((w: list<integer>) => Sum(Map(i => i, Filter(Range(1, Length(w) - 1, 1), i => w[i] > w[i + 1]))), Map(i => 0 if p[i] == i else p[i], Range(1, Length(p))))',
  },
  {
    head: 'MajorIndexMinusInversions',
    findstat: 'St001377',
    summary: 'The major index less the number of inversions.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])) - Sum(Map(i => Count(Filter(Range(i + 1, Length(p)), j => p[i] > p[j])), Range(1, Length(p))))',
  },
  {
    head: 'Mak',
    findstat: 'St000794',
    summary: "Foata and Zeilberger's mak: (2-31) + (32-1) + (1-32) + (21).",
    epsil:
      'p => (0 if Length(p) < 3 else Sum(Map(j => Count(Filter(Range(1, j - 1), i => p[j + 1] < p[i] && p[i] < p[j])), Range(2, Length(p) - 1)))) + (0 if Length(p) < 3 else Sum(Map(i => Count(Filter(Range(i + 2, Length(p)), k => p[k] < p[i + 1] && p[i + 1] < p[i])), Range(1, Length(p) - 2)))) + (0 if Length(p) < 3 else Sum(Map(j => Count(Filter(Range(1, j - 1), i => p[i] < p[j + 1] && p[j + 1] < p[j])), Range(2, Length(p) - 1)))) + (0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])))',
  },
  {
    head: 'MaximalCycleDifference',
    findstat: 'St000209',
    summary: 'The largest difference between two elements of one cycle.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Map(i => Max(Map(m => Abs(m - i), Filter(Range(1, Length(p)), m => Count(Filter(Range(1, Length(p), 1), k => Fold((w, t) => p[w], i, Range(1, k, 1)) == m)) > 0))), Range(1, Length(p))))',
  },
  {
    head: 'MaximalDisplacement',
    findstat: 'St000956',
    summary: 'The largest |p(i) - i|.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Map(i => Abs(p[i] - i), Range(1, Length(p))))',
  },
  {
    head: 'MaximalJump',
    findstat: 'St001246',
    summary: 'The largest |p(i+1) - p(i)|.',
    epsil:
      'p => 0 if Length(p) < 2 else Max(Map(i => Abs(p[i + 1] - p[i]), Range(1, Length(p) - 1, 1)))',
  },
  {
    head: 'MaximalRiseSize',
    findstat: 'St000651',
    summary: 'The largest p(i+1) - p(i), or 0 when p has no rise.',
    epsil:
      'p => 0 if Length(p) < 2 else Max(Join([0], Map(i => p[i + 1] - p[i], Range(1, Length(p) - 1))))',
  },
  {
    head: 'MaximumOfDescentsAndInverseDescents',
    findstat: 'St001489',
    summary:
      'The larger of the number of descents and the number of inverse descents.',
    epsil:
      'p => 0 if Length(p) < 2 else Max([Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])), Count(Filter(Range(1, Length(p) - 1), i => Sum(Map(m => m if p[m] == i else 0, Range(1, Length(p)))) > Sum(Map(m => m if p[m] == i + 1 else 0, Range(1, Length(p))))))])',
  },
  {
    head: 'MidPointsOfOccurrencesOf321',
    findstat: 'St000371',
    summary:
      'Positions that are the middle of a 321 occurrence: neither a left-to-right maximum nor a right-to-left minimum.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] < Max(Map(j => p[j], Range(1, i))) && p[i] > Min(Map(j => p[j], Range(i, Length(p))))))',
  },
  {
    head: 'MinimalInversionsEitherDirection',
    findstat: 'St001511',
    summary:
      'The smaller of the number of inversions and the number of non-inversions.',
    epsil:
      'p => 0 if Length(p) < 2 else Min([Sum(Map(i => Count(Filter(Range(i + 1, Length(p)), j => p[i] > p[j])), Range(1, Length(p)))), Sum(Map(i => Count(Filter(Range(i + 1, Length(p), 1), j => p[i] < p[j])), Range(1, Length(p))))])',
  },
  {
    head: 'MinimalStarTranspositionFactorizationCount',
    findstat: 'St001081',
    summary:
      'The minimal length factorizations of p into the transpositions (1 a).',
    epsil:
      'p => 1 if Length(p) < 1 else Apply((k: integer) => Apply((m: integer) => (1 if Length(p) + m - 2 * (k + 1) < 2 else Product(Range(1, Length(p) + m - 2 * (k + 1)))) * Product(Map(i => Min(Filter(Range(1, Length(p), 1), k => Fold((w, j) => p[w], i, Range(1, k, 1)) == i)), Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0))) / (1 if Length(p) - k < 2 else Product(Range(1, Length(p) - k))), Length(Map(i => Min(Filter(Range(1, Length(p), 1), k => Fold((w, j) => p[w], i, Range(1, k, 1)) == i)), Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0)))), Count(Filter(Range(1, Length(p)), i => p[i] == i && i > 1)))',
  },
  {
    head: 'MinorIndex',
    summary:
      'The minor index of $p$: the sum of the ascent positions $\\\\sum_{p_i < p_{i+1}} i$.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Filter(Range(1, Length(p) - 1), i => p[i] < p[i + 1]))',
  },
  {
    head: 'NeighboringNumber',
    findstat: 'St001344',
    summary:
      'The smallest |p(i+1) - p(i)|, the wrap-around gap |p(1) - p(n)| included.',
    epsil:
      'p => 0 if Length(p) < 2 else Min(Join(Map(i => Abs(p[i + 1] - p[i]), Range(1, Length(p) - 1, 1)), [Abs(p[Length(p)] - p[1])]))',
  },
  {
    head: 'NonAttackingNeighbors',
    findstat: 'St001388',
    summary: 'Positions i with |p(i) - p(i+1)| > 1.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => Abs(p[i] - p[i + 1]) > 1))',
  },
  {
    head: 'NonCyclicSmallWeakExcedances',
    findstat: 'St000242',
    summary: 'Positions that are not cyclic small weak excedances.',
    epsil:
      'p => 0 if Length(p) < 1 else Length(p) - Count(Filter(Range(1, Length(p)), i => p[i] == i || p[i] == (1 if i == Length(p) else i + 1)))',
  },
  {
    head: 'NonInitialLeftToRightMinima',
    findstat: 'St000541',
    summary: 'Positions i >= 2 with p(i) smaller than everything before it.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(2, Length(p), 1), i => p[i] < Min(Map(j => p[j], Range(1, i - 1)))))',
  },
  {
    head: 'NonInversions',
    findstat: 'St000246',
    summary: 'Pairs i < j with p(i) < p(j).',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Count(Filter(Range(i + 1, Length(p)), j => p[i] < p[j])), Range(1, Length(p))))',
  },
  {
    head: 'NonNegativeWalkSteps',
    findstat: 'St001332',
    summary:
      'Steps of the walk (up at an ascent, down at a descent) that begin and end at height at least 0.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => 2 * Count(Filter(Range(1, i, 1), j => p[j] < p[j + 1])) - i >= (1 if p[i] < p[i + 1] else 0)))',
  },
  {
    head: 'NonRecords',
    findstat: 'St001715',
    summary:
      'Positions that are none of a left-to-right maximum or minimum, or a right-to-left maximum or minimum.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] < Max(Map(j => p[j], Range(1, i))) && p[i] > Min(Map(j => p[j], Range(1, i))) && p[i] < Max(Map(j => p[j], Range(i, Length(p)))) && p[i] > Min(Map(j => p[j], Range(i, Length(p))))))',
  },
  {
    head: 'NonSmallWeakExcedances',
    findstat: 'St000238',
    summary: 'Positions with p(i) not in {i, i + 1}.',
    epsil:
      'p => 0 if Length(p) < 1 else Length(p) - Count(Filter(Range(1, Length(p)), i => p[i] == i || p[i] == i + 1))',
  },
  {
    head: 'NontrivialCycles',
    findstat: 'St000162',
    summary: 'Cycles of size at least two: the cycles less the fixed points.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Map(i => Min(Filter(Range(1, Length(p), 1), k => Fold((w, j) => p[w], i, Range(1, k, 1)) == i)), Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0)), c => c > 1))',
  },
  {
    head: 'NormalizedSumOfDistancesToGreaterElement',
    findstat: 'St000624',
    summary:
      'The same sum, each gap one less: the entries strictly between a position and its nearest greater entry.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Min(Join([i, Length(p) + 1 - i], Map(j => Abs(j - i), Filter(Range(1, Length(p)), j => p[j] > p[i])))) - 1, Range(1, Length(p))))',
  },
  {
    head: 'OccurrencesOf123Or132',
    findstat: 'St000423',
    summary: 'Triples ordered as 123 or as 132.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[i] < p[j] && p[j] < p[k] || p[i] < p[k] && p[k] < p[j])), Range(i + 1, Length(p) - 1))), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf123Or231',
    findstat: 'St000427',
    summary: 'Triples ordered as 123 or as 231.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[i] < p[j] && p[j] < p[k] || p[k] < p[i] && p[i] < p[j])), Range(i + 1, Length(p) - 1))), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf123Or321',
    findstat: 'St000429',
    summary: 'Triples ordered as 123 or as 321.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[i] < p[j] && p[j] < p[k] || p[k] < p[j] && p[j] < p[i])), Range(i + 1, Length(p) - 1))), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf132',
    findstat: 'St000220',
    summary: 'Triples i < j < k with p(i) < p(k) < p(j).',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[i] < p[k] && p[k] < p[j])), Range(i + 1, Length(p)))), Range(1, Length(p))))',
  },
  {
    head: 'OccurrencesOf132Or213',
    findstat: 'St000425',
    summary: 'Triples ordered as 132 or as 213.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[i] < p[k] && p[k] < p[j] || p[j] < p[i] && p[i] < p[k])), Range(i + 1, Length(p) - 1))), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf132Or231',
    findstat: 'St000424',
    summary: 'Triples ordered as 132 or as 231.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[i] < p[k] && p[k] < p[j] || p[k] < p[i] && p[i] < p[j])), Range(i + 1, Length(p) - 1))), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf132Or321',
    findstat: 'St000433',
    summary: 'Triples ordered as 132 or as 321.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[i] < p[k] && p[k] < p[j] || p[k] < p[j] && p[j] < p[i])), Range(i + 1, Length(p) - 1))), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf1432',
    findstat: 'St001847',
    summary: 'Quadruples i < j < k < l ordered as 1432.',
    epsil:
      'p => 0 if Length(p) < 4 else Sum(Map(i => Sum(Map(j => Sum(Map(k => Count(Filter(Range(k + 1, Length(p)), l => p[i] < p[l] && p[l] < p[k] && p[k] < p[j])), Range(j + 1, Length(p) - 1))), Range(i + 1, Length(p) - 2))), Range(1, Length(p) - 3)))',
  },
  {
    head: 'OccurrencesOf213',
    findstat: 'St000218',
    summary: 'Triples i < j < k with p(j) < p(i) < p(k).',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[j] < p[i] && p[i] < p[k])), Range(i + 1, Length(p)))), Range(1, Length(p))))',
  },
  {
    head: 'OccurrencesOf213Or312',
    findstat: 'St000434',
    summary: 'Triples ordered as 213 or as 312.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[j] < p[i] && p[i] < p[k] || p[j] < p[k] && p[k] < p[i])), Range(i + 1, Length(p) - 1))), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf2143',
    findstat: 'St000407',
    summary: 'Quadruples i < j < k < l ordered as 2143.',
    epsil:
      'p => 0 if Length(p) < 4 else Sum(Map(i => Sum(Map(j => Sum(Map(k => Count(Filter(Range(k + 1, Length(p)), l => p[j] < p[i] && p[i] < p[l] && p[l] < p[k])), Range(j + 1, Length(p) - 1))), Range(i + 1, Length(p) - 2))), Range(1, Length(p) - 3)))',
  },
  {
    head: 'OccurrencesOf21Dash3',
    findstat: 'St000355',
    summary: 'Triples i, i+1, k with k > i+1 ordered as 213 (21-3).',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Count(Filter(Range(i + 2, Length(p)), k => p[i + 1] < p[i] && p[i] < p[k])), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf231Or312',
    findstat: 'St000432',
    summary: 'Triples ordered as 231 or as 312.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[k] < p[i] && p[i] < p[j] || p[j] < p[k] && p[k] < p[i])), Range(i + 1, Length(p) - 1))), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf23Dash1',
    findstat: 'St000359',
    summary: 'Triples i, i+1, k with k > i+1 ordered as 231 (23-1).',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Count(Filter(Range(i + 2, Length(p)), k => p[k] < p[i] && p[i] < p[i + 1])), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf312',
    findstat: 'St000217',
    summary: 'Triples i < j < k with p(j) < p(k) < p(i).',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[j] < p[k] && p[k] < p[i])), Range(i + 1, Length(p)))), Range(1, Length(p))))',
  },
  {
    head: 'OccurrencesOf31Dash2',
    findstat: 'St000358',
    summary: 'Triples i, i+1, k with k > i+1 ordered as 312 (31-2).',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Count(Filter(Range(i + 2, Length(p)), k => p[i + 1] < p[k] && p[k] < p[i])), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf321Or3412',
    findstat: 'St001411',
    summary: 'Triples ordered as 321, plus quadruples ordered as 3412.',
    epsil:
      'p => (0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[k] < p[j] && p[j] < p[i])), Range(i + 1, Length(p) - 1))), Range(1, Length(p) - 2)))) + (0 if Length(p) < 4 else Sum(Map(i => Sum(Map(j => Sum(Map(k => Count(Filter(Range(k + 1, Length(p)), l => p[k] < p[l] && p[l] < p[i] && p[i] < p[j])), Range(j + 1, Length(p) - 1))), Range(i + 1, Length(p) - 2))), Range(1, Length(p) - 3))))',
  },
  {
    head: 'OccurrencesOf3241Or4231',
    findstat: 'St000404',
    summary: 'Quadruples ordered as 3241 or as 4231.',
    epsil:
      'p => 0 if Length(p) < 4 else Sum(Map(i => Sum(Map(j => Sum(Map(k => Count(Filter(Range(k + 1, Length(p)), l => p[l] < p[j] && p[j] < p[i] && p[i] < p[k] || p[l] < p[j] && p[j] < p[k] && p[k] < p[i])), Range(j + 1, Length(p) - 1))), Range(i + 1, Length(p) - 2))), Range(1, Length(p) - 3)))',
  },
  {
    head: 'OccurrencesOf3412Or4231',
    findstat: 'St000622',
    summary: 'Quadruples ordered as 3412 or as 4231.',
    epsil:
      'p => 0 if Length(p) < 4 else Sum(Map(i => Sum(Map(j => Sum(Map(k => Count(Filter(Range(k + 1, Length(p)), l => p[k] < p[l] && p[l] < p[i] && p[i] < p[j] || p[l] < p[j] && p[j] < p[k] && p[k] < p[i])), Range(j + 1, Length(p) - 1))), Range(i + 1, Length(p) - 2))), Range(1, Length(p) - 3)))',
  },
  {
    head: 'OccurrencesOf41352Or42351Or51342Or52341',
    findstat: 'St001059',
    summary: 'Quintuples ordered as 41352, 42351, 51342 or 52341.',
    epsil:
      'p => 0 if Length(p) < 5 else Sum(Map(i => Sum(Map(j => Sum(Map(k => Sum(Map(l => Count(Filter(Range(l + 1, Length(p)), m => p[j] < p[m] && p[m] < p[k] && p[k] < p[i] && p[i] < p[l] || p[m] < p[j] && p[j] < p[k] && p[k] < p[i] && p[i] < p[l] || p[j] < p[m] && p[m] < p[k] && p[k] < p[l] && p[l] < p[i] || p[m] < p[j] && p[j] < p[k] && p[k] < p[l] && p[l] < p[i])), Range(k + 1, Length(p) - 1))), Range(j + 1, Length(p) - 2))), Range(i + 1, Length(p) - 3))), Range(1, Length(p) - 4)))',
  },
  {
    head: 'OccurrencesOf4231',
    findstat: 'St000408',
    summary: 'Quadruples i < j < k < l ordered as 4231.',
    epsil:
      'p => 0 if Length(p) < 4 else Sum(Map(i => Sum(Map(j => Sum(Map(k => Count(Filter(Range(k + 1, Length(p)), l => p[l] < p[j] && p[j] < p[k] && p[k] < p[i])), Range(j + 1, Length(p) - 1))), Range(i + 1, Length(p) - 2))), Range(1, Length(p) - 3)))',
  },
  {
    head: 'OccurrencesOfConsecutive132',
    findstat: 'St001086',
    summary: 'Triples i, i+1, i+2 ordered as 132 (consecutive 132).',
    epsil:
      'p => 0 if Length(p) < 3 else Count(Filter(Range(1, Length(p) - 2), i => p[i] < p[i + 2] && p[i + 2] < p[i + 1]))',
  },
  {
    head: 'OccurrencesOfInitial12Dash3',
    findstat: 'St001084',
    summary: 'Triples 1, 2, k ordered as 123 (|12-3).',
    epsil:
      'p => 0 if Length(p) < 3 else Count(Filter(Range(3, Length(p)), k => p[1] < p[2] && p[2] < p[k]))',
  },
  {
    head: 'OccurrencesOfInitial1Dash23',
    findstat: 'St001087',
    summary: 'Triples 1, j, j+1 ordered as 123 (|1-23).',
    epsil:
      'p => 0 if Length(p) < 3 else Count(Filter(Range(2, Length(p) - 1), j => p[1] < p[j] && p[j] < p[j + 1]))',
  },
  {
    head: 'OccurrencesOfInitial231',
    findstat: 'St000800',
    summary: 'Triples 1 < j < k ordered as 231 (|231).',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[k] < p[1] && p[1] < p[j])), Range(2, Length(p) - 1)))',
  },
  {
    head: 'OccurrencesOfInitial312',
    findstat: 'St000801',
    summary: 'Triples 1 < j < k ordered as 312 (|312).',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[j] < p[k] && p[k] < p[1])), Range(2, Length(p) - 1)))',
  },
  {
    head: 'OddDescents',
    findstat: 'St001114',
    summary: 'Descents i with i odd.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1] && i % 2 == 1))',
  },
  {
    head: 'OneBoxPatterns',
    findstat: 'St000064',
    summary:
      'Positions i with a neighbouring entry, left or right, differing from p(i) by exactly 1.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p)), i => (Abs(p[i] - p[i - 1]) == 1 if i > 1 else False) || (Abs(p[i] - p[i + 1]) == 1 if i < Length(p) else False)))',
  },
  {
    head: 'OverlapSetSize',
    findstat: 'St001096',
    summary:
      'Shifts i < n for which the first n - i entries and the last n - i entries are in the same relative order.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => Max(Sum(Map(a => Count(Filter(Range(1, Length(p) - i, 1), b => b > a && (-1 if p[a] < p[b] else 1 if p[a] > p[b] else 0) != (-1 if p[a + i] < p[b + i] else 1 if p[a + i] > p[b + i] else 0))), Range(1, Length(p) - i, 1))), 0) == 0))',
  },
  {
    head: 'Peaks',
    findstat: 'St000023',
    summary:
      'The number of peaks of $p$: interior positions $i$ with $p_{i-1} < p_i > p_{i+1}$.',
    epsil:
      'p => 0 if Length(p) < 3 else Count(Filter(Range(2, Length(p) - 1), i => p[i - 1] < p[i] && p[i] > p[i + 1]))',
  },
  {
    head: 'PermutationBreadth',
    findstat: 'St000842',
    summary:
      'The least Manhattan distance |i - j| + |p(i) - p(j)| between two points of the permutation matrix.',
    epsil:
      'p => 0 if Length(p) < 2 else Min(Map(i => Min(Map(j => Abs(i - j) + Abs(p[i] - p[j]), Range(i + 1, Length(p)))), Range(1, Length(p) - 1)))',
  },
  {
    head: 'PermutationGenus',
    findstat: 'St001394',
    summary:
      'The genus g with n + 1 - 2g the cycles of p plus the cycles of p^-1 composed with the long cycle.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((q: list<integer>) => (Length(p) + 1 - Count(Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0)) - Count(Filter(Range(1, Length(p)), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else q[w], q[i], Range(1, Length(p), 1)) == 0))) / 2, Map(i => Sum(Map(j => j if p[j] == i % Length(p) + 1 else 0, Range(1, Length(p)))), Range(1, Length(p))))',
  },
  {
    head: 'PinnacleSum',
    findstat: 'St001519',
    summary: 'The sum of the peak values: p(i) over the interior peaks i.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => p[i], Filter(Range(2, Length(p) - 1), i => p[i - 1] < p[i] && p[i] > p[i + 1])))',
  },
  {
    head: 'PositionsOfLetterOneIn123',
    findstat: 'St001682',
    summary: 'Positions that start an occurrence of 123.',
    epsil:
      'p => 0 if Length(p) < 3 else Count(Filter(Range(1, Length(p) - 2), i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[i] < p[j] && p[j] < p[k])), Range(i + 1, Length(p) - 1))) > 0))',
  },
  {
    head: 'PositionsOfLetterThreeIn132',
    findstat: 'St001683',
    summary: 'Positions that are the middle of an occurrence of 132.',
    epsil:
      'p => 0 if Length(p) < 3 else Count(Filter(Range(2, Length(p) - 1), j => Sum(Map(i => Count(Filter(Range(j + 1, Length(p)), k => p[i] < p[k] && p[k] < p[j])), Range(1, j - 1))) > 0))',
  },
  {
    head: 'PrefixExchangeDistance',
    findstat: 'St001077',
    summary:
      'The star transpositions (1 i) needed to sort p: the moved points, plus the nontrivial cycles, less two when 1 is moved.',
    epsil:
      'p => 0 if Length(p) < 1 else Length(p) - Count(Filter(Range(1, Length(p)), i => p[i] == i)) + Count(Filter(Map(i => Min(Filter(Range(1, Length(p), 1), k => Fold((w, j) => p[w], i, Range(1, k, 1)) == i)), Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0)), c => c >= 2)) - (0 if p[1] == 1 else 2)',
  },
  {
    head: 'PrimeColumnSums',
    findstat: 'St001285',
    summary: 'Positions i with i + p(i) prime.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => i + p[i] >= 2 && Count(Filter(Range(2, i + p[i]), d => d < i + p[i] && (i + p[i]) % d == 0)) == 0))',
  },
  {
    head: 'PrimeProductsPlusOne',
    findstat: 'St001288',
    summary: 'Positions i with i * p(i) + 1 prime.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => i * p[i] + 1 >= 2 && Count(Filter(Range(2, i * p[i] + 1), d => d < i * p[i] + 1 && (i * p[i] + 1) % d == 0)) == 0))',
  },
  {
    head: 'PureExcedances',
    findstat: 'St001665',
    summary: 'Excedances i < p(i) with no j < i where i <= p(j) < p(i).',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] > i && Count(Filter(Range(1, i), j => p[j] >= i && p[j] < p[i])) == 0))',
  },
  {
    head: 'RajchgotIndex',
    findstat: 'St001759',
    summary:
      'The sum over positions i of n - i less the longest increasing subsequence of the larger entries after p(i).',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Sum(Map(i => Length(p) - i - Apply((v: list<integer>) => Count(Fold((a, b) => Apply(k => Join(a, [b]) if k > Count(a) else ReplaceAt(a, k, b), Count(Filter(a, t => t < b)) + 1), [], v)), Map(j => p[j], Filter(Range(1, Length(p)), j => j > i && p[j] > p[i]))), Range(1, Length(p)))), 0)',
  },
  {
    head: 'RecursiveStartMinimumCount',
    findstat: 'St000873',
    summary:
      "FindStat's aix: the number of times, peeling the word, the minimum of what is left is its first entry.",
    epsil:
      'p => 0 if Length(p) < 1 else Fold((a, b) => a if a[1] > a[2] else Apply((bottom: integer) => Apply((low: integer) => [a[1] + 1, a[2], a[3] + 1] if low == a[1] else [1, 0, a[3]] if low == a[2] else [a[1], low - 1, a[3]], Max(Sum(Map(j => j if p[j] == bottom else 0, Range(a[1], a[2], 1))), 0)), Min(Map(j => p[j], Range(a[1], a[2], 1)))), [1, Length(p), 0], Range(1, Length(p)))[3]',
  },
  {
    head: 'ReducedWordSupport',
    findstat: 'St000019',
    summary:
      'The simple reflections in a reduced word: the i < n with some entry of p(1), ..., p(i) larger than i.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => Max(Map(j => p[j], Range(1, i))) > i))',
  },
  {
    head: 'RepeatedLehmerCodeEntries',
    findstat: 'St001298',
    summary: "The Lehmer code's length less its number of distinct entries.",
    epsil:
      'p => 0 if Length(p) < 1 else Length(p) - Count(Filter(Range(0, Length(p) - 1, 1), v => Count(Filter(Range(1, Length(p)), i => Count(Filter(Range(i + 1, Length(p), 1), j => p[j] < p[i])) == v)) > 0))',
  },
  {
    head: 'RestrictedNonInversionsBetweenExcedancesWithLinkedRightmost',
    findstat: 'St001551',
    summary: 'Pairs i < j < p(i) < p(j) with p^-1(j) < j.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Count(Filter(Range(1, Length(p)), j => i < j && j < p[i] && p[i] < p[j] && Sum(Map(m => m if p[m] == j else 0, Range(1, Length(p)))) < j)), Range(1, Length(p))))',
  },
  {
    head: 'RightOuterPeaks',
    findstat: 'St000834',
    summary:
      'Peaks of the word p(1) ... p(n) 0: the interior peaks, plus one when p(n) > p(n-1).',
    epsil:
      'p => 0 if Length(p) < 2 else Apply((w: list<integer>) => Count(Filter(Range(2, Length(w) - 1), i => w[i - 1] < w[i] && w[i] > w[i + 1])), Join(p, [0]))',
  },
  {
    head: 'RightTethers',
    findstat: 'St000666',
    summary: 'Large ascents between two rafts.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1, 1), i => (p[i + 1] == p[i] + 1 if i >= 1 && i <= Length(p) - 1 else False) && (p[i + 1 + 1] > p[i + 1] + 1 if i + 1 >= 1 && i + 1 <= Length(p) - 1 else False) && (p[i + 2 + 1] == p[i + 2] + 1 if i + 2 >= 1 && i + 2 <= Length(p) - 1 else False)))',
  },
  {
    head: 'RightToLeftMinima',
    findstat: 'St000991',
    summary: 'Positions smaller than everything after them.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == Min(Map(j => p[j], Range(i, Length(p))))))',
  },
  {
    head: 'Runs',
    findstat: 'St000470',
    summary:
      'Maximal increasing runs \u2014 one more than the number of descents.',
    epsil:
      'p => 0 if Length(p) < 1 else (0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1]))) + 1',
  },
  {
    head: 'Separators',
    findstat: 'St001402',
    summary:
      'The values v that are a vertical separator of p, or whose image under p^-1 is a vertical separator of p^-1.',
    epsil:
      'p => 0 if Length(p) < 3 else Count(Filter(Range(1, Length(p)), v => Apply((s: integer) => Apply((t: integer) => (Abs(p[s - 1] - p[s + 1]) == 1 if s >= 2 && s <= Length(p) - 1 else False) || (Abs(Sum(Map(j => j if p[j] == t - 1 else 0, Range(1, Length(p)))) - Sum(Map(j => j if p[j] == t + 1 else 0, Range(1, Length(p))))) == 1 if t >= 2 && t <= Length(p) - 1 else False), p[p[v]]), Sum(Map(j => j if p[j] == v else 0, Range(1, Length(p)))))))',
  },
  {
    head: 'ShiftedMajorIndex',
    findstat: 'St000961',
    summary: 'The sum of the positions i with p(i) - p(i+1) >= 2.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Filter(Range(1, Length(p) - 1), i => p[i] - p[i + 1] > 1))',
  },
  {
    head: 'ShortestDistinctWindowLength',
    findstat: 'St000923',
    summary:
      'The least k such that no two windows of k consecutive entries are order isomorphic.',
    epsil:
      'p => 0 if Length(p) < 1 else Min(Filter(Range(1, Length(p)), k => Sum(Map(s => Count(Filter(Filter(Range(1, Length(p)), t => t > s && t + (k - 1) <= Length(p)), t => Sum(Map(a => Count(Filter(Filter(Range(1, Length(p)), b => b > a && b <= k), b => (1 if p[s + (a - 1)] < p[s + (b - 1)] else 0) != (1 if p[t + (a - 1)] < p[t + (b - 1)] else 0))), Filter(Range(1, Length(p)), a => a < k))) == 0)), Filter(Range(1, Length(p)), s => s + (k - 1) <= Length(p)))) == 0))',
  },
  {
    head: 'SimsunDoubleDescents',
    findstat: 'St000367',
    summary:
      'Double descents in the restrictions of p to the values 1..k, over all k, counted with multiplicity.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Sum(Map(k => Max(0, Min(Join([Length(p) + 1], Map(m => p[m], Filter(Range(1, Length(p)), m => m > i && m < k && m != j)))) - p[i]) if p[i] > p[j] && p[j] > p[k] else 0, Filter(Range(1, Length(p)), k => k > j))), Filter(Range(1, Length(p)), j => j > i))), Range(1, Length(p))))',
  },
  {
    head: 'SmallWeakExcedances',
    findstat: 'St000239',
    summary: 'Positions with p(i) = i or p(i) = i + 1.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == i || p[i] == i + 1))',
  },
  {
    head: 'SmallestFixedPoint',
    findstat: 'St001468',
    summary: 'The smallest i with p(i) = i, or n + 1 when there is none.',
    epsil:
      'p => Min(Join(Filter(Range(1, Length(p), 1), i => p[i] == i), [Length(p) + 1]))',
  },
  {
    head: 'SortingIndex',
    findstat: 'St000224',
    summary: 'The total distance the entries move in selection sort.',
    epsil:
      'p => 0 if Length(p) < 1 else Fold((a, b) => Apply(t => (a[1] + (b - t), ReplaceAt(ReplaceAt(a[2], t, a[2][b]), b, b)), Sum(Map(j => j if a[2][j] == b else 0, Range(1, Length(p))))), (0, p), Range(Length(p), 1, -1))[1]',
  },
  {
    head: 'StackSortable',
    summary:
      '1 when p avoids the pattern 231, 0 otherwise — exactly the stack-sortable permutations.',
    epsil:
      'p => 1 if Length(p) < 3 else (1 if Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[k] < p[i] && p[i] < p[j])), Range(i + 1, Length(p)))), Range(1, Length(p)))) == 0 else 0)',
  },
  {
    head: 'StackSortingPasses',
    findstat: 'St000028',
    summary: "The passes of West's stack sorting needed to sort p.",
    epsil:
      'p => 0 if Length(p) < 2 else Fold((a, b) => Apply((l: list<integer>) => Join([a[1] + (0 if Count(Filter(Range(1, Length(p) - 1), i => l[i] > l[i + 1])) == 0 else 1)], Apply((g: list<integer>) => Apply((r: list<integer>) => Map(k => Sum(Map(i => l[i] if r[i] == k else 0, Range(1, Length(p)))), Range(1, Length(p))), Map(i => 1 + Count(Filter(Range(1, Length(p)), j => g[j] < g[i] || g[j] == g[i] && l[j] < l[i])), Range(1, Length(p)))), Map(i => Min(Join([Length(p) + 1], Filter(Range(1, Length(p)), j => j > i && l[j] > l[i]))), Range(1, Length(p))))), Map(m => a[m + 1], Range(1, Length(p)))), Join([0], p), Range(1, Length(p)))[1]',
  },
  {
    head: 'StandardizedBiAlternatingInversionNumber',
    findstat: 'St000677',
    summary:
      'Half of floor(n/2)^2 plus the signed inversions, each pair i < j weighted by (-1)^(i+j).',
    epsil:
      'p => 0 if Length(p) < 2 else (Length(p) - Length(p) % 2) / 2 * ((Length(p) - Length(p) % 2) / 2 + 1) / 2 + (Sum(Map(i => Sum(Map(j => 1, Filter(Range(i + 1, Length(p)), j => p[i] < p[j] && (j - i) % 2 == 0))), Range(1, Length(p) - 1))) - Sum(Map(i => Sum(Map(j => 1, Filter(Range(i + 1, Length(p)), j => p[i] < p[j] && (j - i) % 2 == 1))), Range(1, Length(p) - 1))))',
  },
  {
    head: 'StrongFixedPoints',
    findstat: 'St000221',
    summary:
      'Positions that are both a left-to-right maximum and a right-to-left minimum.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == Max(Map(j => p[j], Range(1, i))) && p[i] == Min(Map(j => p[j], Range(i, Length(p))))))',
  },
  {
    head: 'SubsetHoleyness',
    findstat: 'St001469',
    summary:
      'The most any subset S of 1 .. n gains in elements m with m + 1 outside it on passing to its image p(S).',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Map(m => Apply((s: list<integer>) => Apply((t: list<integer>) => Sum(Map(i => t[i] * (1 - t[i + 1]), Range(1, Length(p)))) - Sum(Map(i => s[i] * (1 - s[i + 1]), Range(1, Length(p)))), Join(Map(v => s[Sum(Map(j => j if p[j] == v else 0, Range(1, Length(p))))], Range(1, Length(p))), [0])), Map(k => 1 if m % 2 ^ k >= 2 ^ (k - 1) else 0, Range(1, Length(p) + 1))), Range(0, 2 ^ Length(p) - 1)))',
  },
  {
    head: 'SumOfDistancesToGreaterElement',
    findstat: 'St000625',
    summary:
      'Over each position, the gap to the nearest greater entry, the ends counting as greater.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Min(Join([i, Length(p) + 1 - i], Map(j => Abs(j - i), Filter(Range(1, Length(p)), j => p[j] > p[i])))), Range(1, Length(p))))',
  },
  {
    head: 'TailPairsOfOccurrencesOf321',
    findstat: 'St000123',
    summary:
      'Pairs j < k with p(j) > p(k) and some entry before j above p(j), the positions of the 2 and the 1 of the occurrences of 321.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Count(Filter(Range(i + 1, Length(p), 1), j => p[j] < p[i])), Filter(Range(1, Length(p)), i => p[i] < Max(Map(j => p[j], Range(1, i))))))',
  },
  {
    head: 'ThreeCycleCount',
    summary: 'Cycles of size exactly three.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Map(i => Min(Filter(Range(1, Length(p), 1), k => Fold((w, j) => p[w], i, Range(1, k, 1)) == i)), Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0)), c => c == 3))',
  },
  {
    head: 'ThreeExcedances',
    findstat: 'St000649',
    summary: 'Positions with p(i) = i + 3.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == i + 3))',
  },
  {
    head: 'ThreeShiftedMajorIndex',
    findstat: 'St000962',
    summary: 'The sum of the positions i with p(i) - p(i+1) > 3.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Filter(Range(1, Length(p) - 1), i => p[i] - p[i + 1] > 3))',
  },
  {
    head: 'TotalDisplacement',
    findstat: 'St000830',
    summary: 'The sum of |p(i) - i|.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Abs(p[i] - i), Range(1, Length(p))))',
  },
  {
    head: 'TwoCycleCount',
    summary: 'Cycles of size exactly two.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Map(i => Min(Filter(Range(1, Length(p), 1), k => Fold((w, j) => p[w], i, Range(1, k, 1)) == i)), Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0)), c => c == 2))',
  },
  {
    head: 'TwoRises',
    findstat: 'St000534',
    summary: 'Positions i with p(i+1) = p(i) + 2.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i + 1] == p[i] + 2))',
  },
  {
    head: 'UlamDistance',
    findstat: 'St000829',
    summary:
      'The entries to remove to leave an increasing sequence: n less the length of a longest increasing subsequence.',
    epsil:
      'p => 0 if Length(p) < 1 else Length(p) - Count(Fold((a, b) => Apply(k => Join(a, [b]) if k > Count(a) else ReplaceAt(a, k, b), Count(Filter(a, t => t < b)) + 1), [], p))',
  },
  {
    head: 'UpperMiddleEntry',
    findstat: 'St001806',
    summary: 'The entry p(floor(n/2) + 1).',
    epsil:
      'p => 0 if Length(p) < 1 else p[(Length(p) - Length(p) % 2) / 2 + 1]',
  },
  {
    head: 'ValleysIncludingBoundary',
    findstat: 'St000099',
    summary:
      'Positions lower than both neighbours, a larger entry standing off each end.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => (True if i == 1 else p[i - 1] > p[i]) && (True if i == Length(p) else p[i] < p[i + 1])))',
  },
  {
    head: 'VeryBigAscents',
    findstat: 'St000871',
    summary: 'Positions i with p(i+1) - p(i) > 2.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i + 1] - p[i] > 2))',
  },
  {
    head: 'VisibleDescents',
    findstat: 'St001729',
    summary: 'Positions i with p(i+1) <= min(i, p(i)).',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i + 1] <= i && p[i + 1] <= p[i]))',
  },
  {
    head: 'WeakAntiexcedances',
    findstat: 'St000702',
    summary: 'Positions with p(i) <= i.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] <= i))',
  },
  {
    head: 'WeakExcedances',
    findstat: 'St000213',
    summary: 'Positions with p(i) >= i.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] >= i))',
  },
  {
    head: 'AdjacenciesWithZeroAppended',
    findstat: 'St000215',
    summary: 'Positions i with p(i) = p(i+1) + 1, reading p(n+1) = 0.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == 1 if i == Length(p) else p[i] == p[i + 1] + 1))',
  },
  {
    head: 'AdjacentTranspositions',
    findstat: 'St001465',
    summary: 'Two-cycles (i, i+1).',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1, 1), i => p[i] == i + 1 && p[i + 1] == i))',
  },
  {
    head: 'AdmissibleInversionsPlusDescents',
    findstat: 'St000868',
    summary: 'ShareshianWachsAdmissibleInversions plus the descents.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Sum(Map(j => 1, Filter(Range(i + 1, Length(p)), j => p[i] > p[j] && ((p[j] < p[j + 1] if j < Length(p) else False) || (p[j] > Min(Map(k => p[k], Range(i + 1, j - 1))) if i + 1 < j else False))))), Range(1, Length(p) - 1))) + Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1]))',
  },
  {
    head: 'AlternatingRuns',
    findstat: 'St000483',
    summary: 'The interior peaks plus the interior valleys.',
    epsil:
      'p => 0 if Length(p) < 3 else Apply((w: list<integer>) => Count(Filter(Range(2, Length(w) - 1), i => w[i - 1] < w[i] && w[i] > w[i + 1])), p) + Apply((w: list<integer>) => Count(Filter(Range(2, Length(w) - 1), i => w[i - 1] < w[i] && w[i] > w[i + 1])), Map(i => Length(p) + 1 - p[i], Range(1, Length(p))))',
  },
  {
    head: 'Antiexcedances',
    findstat: 'St000703',
    summary:
      'The number of antiexcedances of $p$: positions $i$ with $p_i < i$.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] < i))',
  },
  {
    head: 'AscentBottomSum',
    findstat: 'St000472',
    summary: 'The sum of the ascent bottoms: p(i) over the ascents i.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => p[i], Filter(Range(1, Length(p) - 1), i => p[i] < p[i + 1])))',
  },
  {
    head: 'AscentTopsWithSmallerValuesBefore',
    findstat: 'St001640',
    summary:
      'Ascents i whose top p(i+1) has every smaller value among p(1), ..., p(i).',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1, 1), i => p[i] < p[i + 1] && Count(Filter(Map(j => p[j], Range(1, i)), t => t < p[i + 1])) == p[i + 1] - 1))',
  },
  {
    head: 'AscentsOfDistanceTwo',
    findstat: 'St000837',
    summary: 'Positions i with p(i) < p(i+2).',
    epsil:
      'p => 0 if Length(p) < 3 else Count(Filter(Range(1, Length(p) - 2), i => p[i] < p[i + 2]))',
  },
  {
    head: 'BabsonSteingrimssonStatistic',
    findstat: 'St000692',
    summary:
      "Babson and Steingrimsson's stat: (13-2) + (21-3) + (32-1) + (21).",
    epsil:
      'p => (0 if Length(p) < 3 else Sum(Map(i => Count(Filter(Range(i + 2, Length(p)), k => p[i] < p[k] && p[k] < p[i + 1])), Range(1, Length(p) - 2)))) + (0 if Length(p) < 3 else Sum(Map(i => Count(Filter(Range(i + 2, Length(p)), k => p[i + 1] < p[i] && p[i] < p[k])), Range(1, Length(p) - 2)))) + (0 if Length(p) < 3 else Sum(Map(i => Count(Filter(Range(i + 2, Length(p)), k => p[k] < p[i + 1] && p[i + 1] < p[i])), Range(1, Length(p) - 2)))) + (0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])))',
  },
  {
    head: 'BabsonSteingrimssonStatisticPrime',
    findstat: 'St000796',
    summary:
      'Descents plus the occurrences of the vincular patterns 13-2, 31-2 and 32-1.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])) + (0 if Length(p) < 3 else Sum(Map(i => Count(Filter(Range(i + 2, Length(p)), k => p[i] < p[k] && p[k] < p[i + 1] || p[i + 1] < p[k] && p[k] < p[i] || p[k] < p[i + 1] && p[i + 1] < p[i])), Range(1, Length(p) - 2))))',
  },
  {
    head: 'BigAscentsAfterPrependingZero',
    findstat: 'St000742',
    summary:
      'Positions of the word 0 p(1) ... p(n) that rise by more than 1, the first entry counted against 0.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((w: list<integer>) => Count(Filter(Range(1, Length(w)), i => w[i + 1] - w[i] > 1)), Join([0], p))',
  },
  {
    head: 'BigDescents',
    findstat: 'St000647',
    summary: 'Positions i with p(i) - p(i+1) > 1.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] - p[i + 1] > 1))',
  },
  {
    head: 'BinStatistic',
    findstat: 'St001976',
    summary:
      'The sum of the binomial coefficients (i + 1 choose 2) over the descents i.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => i * (i + 1) / 2, Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])))',
  },
  {
    head: 'BoxedOccurrencesOf123',
    findstat: 'St001082',
    summary:
      'Occurrences of 123 with no other entry positioned between the first and last and valued between them.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[i] < p[j] && p[j] < p[k] && Count(Filter(Range(1, Length(p)), m => m > i && m < k && m != j && p[m] > p[i] && p[m] < p[k])) == 0)), Range(i + 1, Length(p)))), Range(1, Length(p))))',
  },
  {
    head: 'BreakpointGraphCycles',
    findstat: 'St000696',
    summary:
      'The alternating cycles of the breakpoint graph on 0, ..., n: a black edge from p(i) to p(i-1) and a grey edge from i to i+1, indices cyclic.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply((w: list<integer>) => Apply((q: list<integer>) => Count(Filter(Range(1, Length(p) + 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else q[w], q[i], Range(1, Length(p) + 1, 1)) == 0)), Map(i => w[(Sum(Map(m => m if w[m] == i else 0, Range(1, Length(p) + 1))) + (Length(p) - 1)) % (Length(p) + 1) + 1] % (Length(p) + 1) + 1, Range(1, Length(p) + 1))), Join([1], Map(i => p[i] + 1, Range(1, Length(p)))))',
  },
  {
    head: 'BruhatNonInversionTranspositionCount',
    findstat: 'St001559',
    summary:
      'Transpositions at most p in Bruhat order that are not inversions of p.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Sum(Map(i => Count(Filter(Range(i + 1, Length(p), 1), j => Sum(Map(k => Count(Filter(Range(i + 1, j, 1), m => Count(Filter(Range(1, k, 1), u => p[u] >= m)) < Max(k - m + 1, 0) + 1)), Range(i, j - 1, 1))) == 0)), Range(1, Length(p)))) - Sum(Map(i => Count(Filter(Range(i + 1, Length(p)), j => p[i] > p[j])), Range(1, Length(p)))), 0)',
  },
  {
    head: 'ChordDiagramComponentCount',
    findstat: 'St001461',
    summary:
      'The connected components of the chord diagram of p: the labels in a circle with a chord from each i to p(i).',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((c: list<integer>) => Count(Filter(Range(1, Length(p)), i => c[i] == i)), Apply((a_init: list<integer>) => Fold((a: list<integer>, b) => Apply((a_next: list<integer>) => a_next, Map(i => Min(Map(j => a[j] if j == i || j == p[i] || i == p[j] || (1 if Min(i, p[i]) < j && j < Max(i, p[i]) else 0) != (1 if Min(i, p[i]) < p[j] && p[j] < Max(i, p[i]) else 0) else Length(p) + 1, Range(1, Length(p)))), Range(1, Length(p)))), a_init, Range(1, Length(p))), Range(1, Length(p))))',
  },
  {
    head: 'ConjugacyClassSize',
    findstat: 'St000690',
    summary:
      'The number of permutations of the same cycle type: n! over the product of the cycle sizes and the factorials of the multiplicities.',
    epsil:
      'p => 1 if Length(p) < 1 else (1 if Length(p) < 2 else Product(Range(1, Length(p)))) / (Product(Map(i => Min(Filter(Range(1, Length(p), 1), k => Fold((w, j) => p[w], i, Range(1, k, 1)) == i)), Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0))) * Product(Map(m => Apply((f: number) => 1 if f < 2 else Product(Range(1, f)), Count(Filter(Map(i => Min(Filter(Range(1, Length(p), 1), k => Fold((w, j) => p[w], i, Range(1, k, 1)) == i)), Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0)), c => c == m))), Range(1, Length(p), 1))))',
  },
  {
    head: 'Convexity',
    findstat: 'St000226',
    summary:
      'The largest 2 p(i) - p(i-1) - p(i+1) over the interior positions, or 0.',
    epsil:
      'p => 0 if Length(p) < 3 else Max(Join([0], Map(i => 2 * p[i] - p[i - 1] - p[i + 1], Range(2, Length(p) - 1))))',
  },
  {
    head: 'CycleCount',
    findstat: 'St000031',
    summary: 'The number of cycles in the disjoint-cycle decomposition of $p$.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0))',
  },
  {
    head: 'CycleInverseClassSize',
    findstat: 'St001359',
    summary:
      "2 to the power of the cycles of length at least three: the permutations got by inverting any of p's cycles.",
    epsil:
      'p => 1 if Length(p) < 1 else 2 ^ Count(Filter(Map(i => Min(Filter(Range(1, Length(p), 1), k => Fold((w, j) => p[w], i, Range(1, k, 1)) == i)), Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0)), c => c >= 3))',
  },
  {
    head: 'CyclePeaks',
    findstat: 'St000994',
    summary: 'Values i with p^-1(i) < i > p(i).',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => Sum(Map(j => j if p[j] == i else 0, Range(1, Length(p)))) < i && p[i] < i))',
  },
  {
    head: 'CyclesOfLengthAtMostThree',
    findstat: 'St000489',
    summary: 'Cycles of size at most three.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Map(i => Min(Filter(Range(1, Length(p), 1), k => Fold((w, j) => p[w], i, Range(1, k, 1)) == i)), Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0)), c => c <= 3))',
  },
  {
    head: 'CyclicAlignments',
    findstat: 'St001535',
    summary: 'Pairs (i, j) with i, j, p(j), p(i) in cyclic order.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Count(Filter(Range(1, Length(p)), j => i < j && j < p[j] && p[j] < p[i] || j < p[j] && p[j] < p[i] && p[i] < i || p[j] < p[i] && p[i] < i && i < j || p[i] < i && i < j && j < p[j])), Range(1, Length(p))))',
  },
  {
    head: 'CyclicCrossings',
    findstat: 'St001537',
    summary: 'Pairs (i, j) with i, p(j), p(i), j in cyclic order.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Count(Filter(Range(1, Length(p)), j => i < p[j] && p[j] < p[i] && p[i] < j || p[j] < p[i] && p[i] < j && j < i || p[i] < j && j < i && i < p[j] || j < i && i < p[j] && p[j] < p[i])), Range(1, Length(p))))',
  },
  {
    head: 'CyclicMaximalJump',
    findstat: 'St001245',
    summary: 'The largest |p(i+1) - p(i)|, with p(n+1) = p(1).',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Join(Map(i => Abs(p[i + 1] - p[i]), Range(1, Length(p) - 1, 1)), [Abs(p[Length(p)] - p[1])]))',
  },
  {
    head: 'CyclicSmallExcedances',
    findstat: 'St000241',
    summary:
      'Positions with p(i) = i + 1, read cyclically: the last position counts when p(n) = 1.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == (1 if i == Length(p) else i + 1)))',
  },
  {
    head: 'CyclicSubsetHoleyness',
    findstat: 'St001470',
    summary:
      'The holeyness with successors taken cyclically: n is followed by 1.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Map(m => Apply((s: list<integer>) => Apply((t: list<integer>) => Sum(Map(i => t[i] * (1 - t[i % Length(p) + 1]), Range(1, Length(p)))) - Sum(Map(i => s[i] * (1 - s[i % Length(p) + 1]), Range(1, Length(p)))), Join(Map(v => s[Sum(Map(j => j if p[j] == v else 0, Range(1, Length(p))))], Range(1, Length(p))), [0])), Map(k => 1 if m % 2 ^ k >= 2 ^ (k - 1) else 0, Range(1, Length(p) + 1))), Range(0, 2 ^ Length(p) - 1)))',
  },
  {
    head: 'CyclicallyAdjacentTranspositions',
    findstat: 'St001466',
    summary: 'Two-cycles (i, i+1), and the two-cycle (1, n).',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1, 1), i => p[i] == i + 1 && p[i + 1] == i)) + (1 if Length(p) > 2 && p[1] == Length(p) && p[Length(p)] == 1 else 0)',
  },
  {
    head: 'Denert',
    findstat: 'St000156',
    summary:
      'Sum of the excedance positions, plus the inversions within each of the excedance and non-excedance subwords.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Filter(Range(1, Length(p)), i => p[i] > i)) + Sum(Map(i => Count(Filter(Range(i + 1, Length(p)), j => p[j] > j && p[i] > p[j])) if p[i] > i else 0, Range(1, Length(p)))) + Sum(Map(i => Count(Filter(Range(i + 1, Length(p)), j => p[j] <= j && p[i] > p[j])) if p[i] <= i else 0, Range(1, Length(p))))',
  },
  {
    head: 'DescentBottomSum',
    findstat: 'St000154',
    summary: 'The sum of the descent bottoms: p(i+1) over the descents i.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => p[i + 1], Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])))',
  },
  {
    head: 'DescentTopSum',
    findstat: 'St000111',
    summary: 'The sum of the descent tops: p(i) over the descents i.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => p[i], Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])))',
  },
  {
    head: 'DescentWordFiberSize',
    findstat: 'St000530',
    summary: 'The permutations of the same size with the same descents as p.',
    epsil:
      'p => 1 if Length(p) < 2 else Sum(Fold((a, b) => Map(j => Sum(Map(m => a[m], Filter(Range(1, Count(a)), m => m >= j))) if p[b] > p[b + 1] else Sum(Map(m => a[m], Filter(Range(1, Count(a)), m => m < j))), Range(1, Count(a) + 1)), [1], Range(1, Length(p) - 1)))',
  },
  {
    head: 'DescentsAfterZeroingFixedPoints',
    findstat: 'St000333',
    summary: 'The descents of the word with every fixed point replaced by 0.',
    epsil:
      'p => 0 if Length(p) < 2 else Apply((w: list<integer>) => Sum(Map(i => 1, Filter(Range(1, Length(w) - 1, 1), i => w[i] > w[i + 1]))), Map(i => 0 if p[i] == i else p[i], Range(1, Length(p))))',
  },
  {
    head: 'DescentsMinusOneUnlessFirstEntryOne',
    findstat: 'St001960',
    summary: 'The number of descents of p, less one when p(1) is not 1.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])) - (0 if p[1] == 1 else 1)',
  },
  {
    head: 'DescentsOfDistanceTwo',
    findstat: 'St000836',
    summary: 'Positions i with p(i) > p(i+2).',
    epsil:
      'p => 0 if Length(p) < 3 else Count(Filter(Range(1, Length(p) - 2), i => p[i] > p[i + 2]))',
  },
  {
    head: 'DescentsOrRecoils',
    findstat: 'St000831',
    summary: 'Indices i < n that are a descent of p or a recoil.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1] || Sum(Map(j => j if p[j] == i else 0, Range(1, Length(p)))) > Sum(Map(j => j if p[j] == i + 1 else 0, Range(1, Length(p))))))',
  },
  {
    head: 'DiaconisGrahamDefect',
    findstat: 'St001906',
    summary:
      'Half of the total displacement less the number of inversions and the reflection length.',
    epsil:
      'p => 0 if Length(p) < 1 else (Sum(Map(i => Abs(p[i] - i), Range(1, Length(p)))) - Sum(Map(i => Count(Filter(Range(i + 1, Length(p)), j => p[i] > p[j])), Range(1, Length(p)))) - (Length(p) - Count(Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0)))) / 2',
  },
  {
    head: 'DistanceTwoSwapClassSize',
    findstat: 'St000669',
    summary:
      'The permutations reached from p by swapping adjacent entries that differ by 2, p included.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply((q: list<integer>) => Apply((a_init: list<integer>) => Fold((a: list<integer>, m) => Apply((a_next: list<integer>) => a_next, Join(a, [Sum(Map(v => a[m - 2 ^ (v - 1) + 1] if (1 if m % 2 ^ v >= 2 ^ (v - 1) else 0) == 1 && Count(Filter(Range(1, Length(p)), w => Abs(w - v) != 2 && q[w] < q[v] && (1 if m % 2 ^ w >= 2 ^ (w - 1) else 0) == 0)) == 0 else 0, Range(1, Length(p))))])), a_init, Range(1, 2 ^ Length(p) - 1)), [1])[2 ^ Length(p)], Map(v => Sum(Map(j => j if p[j] == v else 0, Range(1, Length(p)))), Range(1, Length(p))))',
  },
  {
    head: 'DistinctDiagonalSums',
    findstat: 'St000891',
    summary:
      'The number of distinct sums along the diagonals of the permutation matrix.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(0, Length(p), 1), v => Count(Filter(Range(1 - Length(p), Length(p) - 1, 1), k => Count(Filter(Range(1, Length(p)), i => p[i] - i == k)) == v)) > 0))',
  },
  {
    head: 'DoubleAscents',
    findstat: 'St000365',
    summary: 'Positions i with p(i) < p(i+1) < p(i+2).',
    epsil:
      'p => 0 if Length(p) < 3 else Count(Filter(Range(1, Length(p) - 2), i => p[i] < p[i + 1] && p[i + 1] < p[i + 2]))',
  },
  {
    head: 'DoubleDescents',
    findstat: 'St000366',
    summary: 'Positions i with p(i) > p(i+1) > p(i+2).',
    epsil:
      'p => 0 if Length(p) < 3 else Count(Filter(Range(1, Length(p) - 2), i => p[i] > p[i + 1] && p[i + 1] > p[i + 2]))',
  },
  {
    head: 'DoubleSuccessions',
    findstat: 'St001130',
    summary: 'Positions i with p(i+1) = p(i) + 1 and p(i+2) = p(i) + 2.',
    epsil:
      'p => 0 if Length(p) < 3 else Count(Filter(Range(1, Length(p) - 2), i => p[i + 1] == p[i] + 1 && p[i + 2] == p[i] + 2))',
  },
  {
    head: 'EvenDescents',
    findstat: 'St001115',
    summary: 'Descents i with i even.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1] && i % 2 == 0))',
  },
  {
    head: 'EvenWeakDeficienciesAndOddWeakExcedances',
    findstat: 'St001439',
    summary: 'Positions i with p(i) <= i for even i, and p(i) >= i for odd i.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] <= i if i % 2 == 0 else p[i] >= i))',
  },
  {
    head: 'ExclusiveLeftToRightMaxima',
    findstat: 'St000996',
    summary: 'Left-to-right maxima that are not right-to-left minima.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == Max(Map(j => p[j], Range(1, i))) && p[i] > Min(Map(j => p[j], Range(i, Length(p))))))',
  },
  {
    head: 'ExteriorLength',
    findstat: 'St001052',
    summary:
      'The longest proper prefix whose relative order is that of the suffix of the same length.',
    epsil:
      'p => 0 if Length(p) < 2 else Max(Map(i => Length(p) - i, Filter(Range(1, Length(p) - 1), i => Max(Sum(Map(a => Count(Filter(Range(1, Length(p) - i, 1), b => b > a && (-1 if p[a] < p[b] else 1 if p[a] > p[b] else 0) != (-1 if p[a + i] < p[b + i] else 1 if p[a + i] > p[b + i] else 0))), Range(1, Length(p) - i, 1))), 0) == 0)))',
  },
  {
    head: 'FirstAscent',
    findstat: 'St000990',
    summary: 'The smallest ascent position, or n when p is decreasing.',
    epsil:
      'p => Length(p) if Length(p) < 2 else Length(p) if Count(Filter(Range(1, Length(p) - 1), i => p[i] < p[i + 1])) == 0 else Min(Filter(Range(1, Length(p) - 1), i => p[i] < p[i + 1]))',
  },
  {
    head: 'FirstDirectSummandSize',
    findstat: 'St000501',
    summary: 'The smallest k with {p(1), ..., p(k)} = {1, ..., k}.',
    epsil:
      'p => 0 if Length(p) < 1 else Min(Filter(Range(1, Length(p)), i => Max(Map(j => p[j], Range(1, i))) == i))',
  },
  {
    head: 'FixedPointAgreementCount',
    findstat: 'St001528',
    summary:
      'The permutations s of the same size such that p composed with s has as many fixed points as p.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply((f: integer) => Binomial(Length(p), f) * Sum(Map(j => (-1) ^ j * (Product(Range(j + 1, Length(p) - f)) if j < Length(p) - f else 1), Range(0, Length(p) - f))), Count(Filter(Range(1, Length(p)), i => p[i] == i)))',
  },
  {
    head: 'FixedPoints',
    findstat: 'St000022',
    summary: 'The number of fixed points of $p$: positions $i$ with $p_i = i$.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == i))',
  },
  {
    head: 'GlobalAscents',
    findstat: 'St000234',
    summary: 'Positions i < n with p(j) < p(k) whenever j <= i < k.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => Max(Map(j => p[j], Range(1, i))) <= i))',
  },
  {
    head: 'GreaterNeighborOfMaximum',
    findstat: 'St000060',
    summary: 'The larger of the two entries beside n, an end counting as 0.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Max([p[i - 1] if i > 1 else 0, p[i + 1] if i < Length(p) else 0]) if p[i] == Length(p) else 0, Range(1, Length(p))))',
  },
  {
    head: 'HalfParityMismatches',
    findstat: 'St001801',
    summary: 'Half the positions i where i and p(i) differ in parity.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => (p[i] + i) % 2 == 1)) / 2',
  },
  {
    head: 'HalfSymmetryClassSize',
    findstat: 'St000402',
    summary: 'Half the size of the symmetry class of p, rounded down.',
    epsil:
      'p => 0 if Length(p) < 1 else (8 / (1 + (1 if Count(Filter(Range(1, Length(p)), i => p[i] != p[Length(p) + 1 - i])) == 0 else 0) + (1 if Count(Filter(Range(1, Length(p)), i => p[i] != Length(p) + 1 - p[i])) == 0 else 0) + (1 if Count(Filter(Range(1, Length(p)), i => p[Length(p) + 1 - i] != Length(p) + 1 - p[i])) == 0 else 0) + (1 if Count(Filter(Range(1, Length(p)), i => p[p[i]] != i)) == 0 else 0) + (1 if Count(Filter(Range(1, Length(p)), i => p[p[i]] != Length(p) + 1 - i)) == 0 else 0) + (1 if Count(Filter(Range(1, Length(p)), i => p[Length(p) + 1 - p[i]] != i)) == 0 else 0) + (1 if Count(Filter(Range(1, Length(p)), i => p[Length(p) + 1 - p[i]] != Length(p) + 1 - i)) == 0 else 0)) - 8 / (1 + (1 if Count(Filter(Range(1, Length(p)), i => p[i] != p[Length(p) + 1 - i])) == 0 else 0) + (1 if Count(Filter(Range(1, Length(p)), i => p[i] != Length(p) + 1 - p[i])) == 0 else 0) + (1 if Count(Filter(Range(1, Length(p)), i => p[Length(p) + 1 - i] != Length(p) + 1 - p[i])) == 0 else 0) + (1 if Count(Filter(Range(1, Length(p)), i => p[p[i]] != i)) == 0 else 0) + (1 if Count(Filter(Range(1, Length(p)), i => p[p[i]] != Length(p) + 1 - i)) == 0 else 0) + (1 if Count(Filter(Range(1, Length(p)), i => p[Length(p) + 1 - p[i]] != i)) == 0 else 0) + (1 if Count(Filter(Range(1, Length(p)), i => p[Length(p) + 1 - p[i]] != Length(p) + 1 - i)) == 0 else 0)) % 2) / 2',
  },
  {
    head: 'HookFactorInversions',
    findstat: 'St000337',
    summary: 'The inversions summed over the hook factors t1, ..., tk of p.',
    epsil:
      'p => 0 if Length(p) < 2 else Fold((a, b) => Apply((e: integer) => [b, a[2] + Sum(Map(i => Count(Filter(Range(i + 1, e, 1), j => p[i] > p[j])), Range(b, e, 1)))] if b <= e - 1 && p[b] > p[b + 1] else a, a[1] - 1), [Length(p) + 1, 0], Range(Length(p) - 1, 1, -1))[2]',
  },
  {
    head: 'InsertionBumpsOfOne',
    findstat: 'St001390',
    summary:
      'One more than the longest decreasing subsequence of the entries before 1.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((v: list<integer>) => 1 + Count(Fold((a, b) => Apply(k => Join(a, [b]) if k > Count(a) else ReplaceAt(a, k, b), Count(Filter(a, t => t > b)) + 1), [], v)), Map(i => p[i], Filter(Range(1, Length(p)), i => i < Sum(Map(j => j if p[j] == 1 else 0, Range(1, Length(p)))))))',
  },
  {
    head: 'InverseFoataArrowAscents',
    findstat: 'St001744',
    summary:
      'Adjacent ascents p(i) < p(i+1) where inverse Foata sends p(i) to p(i+1).',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] < p[i + 1] && p[i + 1] < Max(Map(j => p[j], Range(1, i)))))',
  },
  {
    head: 'InverseMajorIndex',
    findstat: 'St000305',
    summary:
      'The major index of the inverse: the sum of the values v with v + 1 to the left of v.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => i if Sum(Map(j => j if p[j] == i else 0, Range(1, Length(p)))) > Sum(Map(j => j if p[j] == i + 1 else 0, Range(1, Length(p)))) else 0, Range(1, Length(p) - 1)))',
  },
  {
    head: 'InversionSum',
    findstat: 'St000055',
    summary: 'The sum of j - i over the inversions i < j.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Sum(Map(j => j - i, Filter(Range(i + 1, Length(p)), j => p[i] > p[j] && True))), Range(1, Length(p) - 1)))',
  },
  {
    head: 'InversionsBetweenExcedancesAndFixedPoints',
    findstat: 'St001552',
    summary: 'Pairs i < j = p(j) < p(i).',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Count(Filter(Range(1, Length(p)), j => p[j] == j && i < j && j < p[i])), Range(1, Length(p))))',
  },
  {
    head: 'InversionsOfCyclicEmbedding',
    findstat: 'St001074',
    summary:
      'The inversions of the cycle (p(1), ..., p(n), n + 1), as a permutation of n + 1.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((q: list<integer>) => Sum(Map(i => Count(Filter(Range(i + 1, Length(p) + 1), j => q[i] > q[j])), Range(1, Length(p)))), Map(v => p[1] if v == Length(p) + 1 else Sum(Map(m => (Length(p) + 1 if m == Length(p) else p[m + 1]) if p[m] == v else 0, Range(1, Length(p)))), Range(1, Length(p) + 1)))',
  },
  {
    head: 'InversionsOfDistanceAtMostTwo',
    findstat: 'St000495',
    summary: 'Inversions i < j with j - i <= 2.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Sum(Map(j => 1, Filter(Range(i + 1, Length(p)), j => p[i] > p[j] && j - i <= 2))), Range(1, Length(p) - 1)))',
  },
  {
    head: 'InversionsOfThirdEntry',
    findstat: 'St001556',
    summary: 'Positions after the third with a smaller entry than p(3).',
    epsil:
      'p => 0 if Length(p) < 4 else Count(Filter(Range(4, Length(p)), j => p[j] < p[3]))',
  },
  {
    head: 'InvisibleDescents',
    findstat: 'St001728',
    summary: 'Positions i with p(i) > p(i+1) > i.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1] && p[i + 1] > i))',
  },
  {
    head: 'IsolatedDescents',
    findstat: 'St000884',
    summary: 'Descents i such that neither i-1 nor i+1 is a descent.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1] && (p[i - 1] < p[i - 1 + 1] if i - 1 >= 1 && i - 1 <= Length(p) - 1 else True) && (p[i + 1] < p[i + 1 + 1] if i + 1 >= 1 && i + 1 <= Length(p) - 1 else True)))',
  },
  {
    head: 'LargestGreatestCommonDivisorOfPositionAndValue',
    findstat: 'St001778',
    summary: 'The largest gcd(i, p(i)).',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Map(i => i * p[i] / LCM(i, p[i]), Range(1, Length(p))))',
  },
  {
    head: 'LargestSearchTreeLeafLabel',
    findstat: 'St000727',
    summary:
      'The largest label of a leaf of the binary search tree of p, inserting p(1), ..., p(n) in order.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Map(i => p[i], Filter(Range(1, Length(p)), i => Apply((lo: integer) => Apply((hi: integer) => Count(Filter(Range(1, Length(p)), k => k > i && p[k] > lo && p[k] < hi)) == 0, Min(Join([Length(p) + 1], Map(j => p[j], Filter(Range(1, i), j => p[j] > p[i]))))), Max(Join([0], Map(j => p[j], Filter(Range(1, i), j => p[j] < p[i]))))))))',
  },
  {
    head: 'LargestWeakExcedancePosition',
    findstat: 'St001497',
    summary: 'The largest i with p(i) >= i.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Filter(Range(1, Length(p)), i => p[i] >= i))',
  },
  {
    head: 'LastEntry',
    findstat: 'St000740',
    summary: 'The last entry p(n).',
    epsil: 'p => 0 if Length(p) < 1 else p[Length(p)]',
  },
  {
    head: 'LeftToRightMaxima',
    findstat: 'St000314',
    summary: 'Positions larger than everything before them.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == Max(Map(j => p[j], Range(1, i)))))',
  },
  {
    head: 'LeftToRightMaximaPositionSum',
    findstat: 'St000756',
    summary: 'The sum of the positions of the left-to-right maxima.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Filter(Range(1, Length(p)), i => p[i] == Max(Map(j => p[j], Range(1, i)))))',
  },
  {
    head: 'LeftToRightMinima',
    findstat: 'St000542',
    summary: 'Positions smaller than everything before them.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == Min(Map(j => p[j], Range(1, i)))))',
  },
  {
    head: 'Load',
    findstat: 'St000304',
    summary: 'The major index of the reverse of the inverse.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Length(p) - i if Sum(Map(j => j if p[j] == i else 0, Range(1, Length(p)))) < Sum(Map(j => j if p[j] == i + 1 else 0, Range(1, Length(p)))) else 0, Range(1, Length(p) - 1)))',
  },
  {
    head: 'LongestCycleLength',
    findstat: 'St000485',
    summary: 'The size of the largest cycle.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Map(i => Min(Filter(Range(1, Length(p), 1), k => Fold((w, j) => p[w], i, Range(1, k, 1)) == i)), Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0)))',
  },
  {
    head: 'LongestIncreasingSubsequence',
    findstat: 'St000062',
    summary: 'The length of a longest increasing subsequence.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Fold((a, b) => Apply(k => Join(a, [b]) if k > Count(a) else ReplaceAt(a, k, b), Count(Filter(a, t => t < b)) + 1), [], p))',
  },
  {
    head: 'LongestKOneTwoPattern',
    findstat: 'St000451',
    summary:
      'The largest k such that p has an occurrence of k 1 2 ... (k-1): a first entry above an increasing run of later, smaller ones.',
    epsil:
      'p => 1 if Length(p) < 1 else 1 + Max(Map(i => Count(Fold((a, b) => Apply(k => Join(a, [p[b]]) if k > Count(a) else ReplaceAt(a, k, p[b]), Count(Filter(a, t => t < p[b])) + 1) if b > i && p[b] < p[i] else a, [], Range(1, Length(p)))), Range(1, Length(p))))',
  },
  {
    head: 'LongestSuccessionRun',
    findstat: 'St001652',
    summary:
      'The length of the longest factor p(k), ..., p(l) with p(i+1) = p(i) + 1.',
    epsil:
      'p => 0 if Length(p) < 1 else Fold((a, b) => [Max([a[1], a[2] + 1]), a[2] + 1, b] if b == a[3] + 1 else [Max([a[1], 1]), 1, b], [0, 0, 0], p)[1]',
  },
  {
    head: 'LongestWeakTwinLength',
    findstat: 'St001667',
    summary:
      'The size of a largest pair of disjoint subsequences of p with the same pattern of rises and falls.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Join([0], Map(m => Apply((va: list<integer>) => Max(Join([0], Map(r => Apply((vb: list<integer>) => (Length(va) if Sum(Map(t => 1 if (1 if va[t] < va[t + 1] else 0) != (1 if vb[t] < vb[t + 1] else 0) else 0, Filter(Range(1, Length(p)), t => t < Length(va)))) == 0 else 0) if Count(Filter(Range(1, Length(p)), q => (1 if m % 2 ^ q >= 2 ^ (q - 1) else 0) == 1 && (1 if r % 2 ^ q >= 2 ^ (q - 1) else 0) == 1)) == 0 && Length(va) == Length(vb) else 0, Map(q => p[q], Filter(Range(1, Length(p)), q => (1 if r % 2 ^ q >= 2 ^ (q - 1) else 0) == 1))), Filter(Range(0, 2 ^ Length(p) - 1), r => r > m)))), Map(q => p[q], Filter(Range(1, Length(p)), q => (1 if m % 2 ^ q >= 2 ^ (q - 1) else 0) == 1))), Range(0, 2 ^ Length(p) - 1))))',
  },
  {
    head: 'LusztigAFunction',
    findstat: 'St001874',
    summary:
      "Lusztig's a-function: the sum of binomial(c, 2) over the column lengths c of the Robinson-Schensted shape.",
    epsil:
      'p => 0 if Length(p) < 1 else Apply((s: list<integer>) => Max(Sum(Map(i => (i - 1) * s[i], Range(1, Length(s)))), 0), Apply((rs_len: integer) => Apply((rs_state: list<integer>) => Map(fl_r => rs_state[fl_r], Range(1, Count(Filter(Range(1, rs_len, 1), fl_q => rs_state[fl_q] > 0)), 1)), Apply((rs_w: list<integer>) => Apply((rs_n: integer) => Apply((rs_nn: integer) => Apply((rs_row: list<integer>) => Apply((rs_col: list<integer>) => Fold((rs_s, rs_k) => Apply((rs_chain: list<integer>) => Join(Fold((rs_q_built, rs_q) => Join(rs_q_built, [rs_s[rs_q] + 1 if rs_chain[2rs_q] == rs_s[rs_q] + 1 else rs_s[rs_q]]), [], Range(1, rs_n, 1)), Fold((rs_j_built, rs_j) => Join(rs_j_built, [Apply((rs_q: integer) => Apply((rs_c: integer) => rs_chain[2rs_q - 1] if rs_chain[2rs_q] == rs_c else rs_s[rs_n + (rs_q - 1) * rs_n + rs_c], rs_col[rs_j]), rs_row[rs_j])]), [], Range(1, rs_nn, 1))), Fold((rs_acc, rs_q) => Apply((rs_v: integer) => Apply((rs_l: integer) => Apply((rs_p: integer) => Join(rs_acc, [rs_p, 0 if rs_v == 0 || rs_p > rs_l else rs_s[rs_n + (rs_q - 1) * rs_n + rs_p]]), 0 if rs_v == 0 else 1 + Count(Filter(Range(1, rs_l, 1), rs_c => rs_s[rs_n + (rs_q - 1) * rs_n + rs_c] < rs_v))), rs_s[rs_q]), rs_acc[2rs_q - 1]), [rs_w[rs_k]], Range(1, rs_n, 1))), Map(rs_j => 0, Range(1, rs_n + 1rs_nn, 1)), Range(1, rs_n, 1)), Map(rs_j => (rs_j - 1) % rs_n + 1, Range(1, rs_nn, 1))), Map(rs_j => Floor((rs_j - 1) / rs_n) + 1, Range(1, rs_nn, 1))), rs_n * rs_n), Length(rs_w)), p)), Length(p)))',
  },
  {
    head: 'MajorIndex',
    findstat: 'St000004',
    summary:
      'The major index of $p$: the sum of the descent positions $\\sum_{p_i > p_{i+1}} i$.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1]))',
  },
  {
    head: 'MajorIndexMinusExcedances',
    findstat: 'St000462',
    summary: 'The major index less the number of positions with p(i) > i.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])) - Count(Filter(Range(1, Length(p)), i => p[i] > i))',
  },
  {
    head: 'MajorIndexPlusInverseMajorIndex',
    findstat: 'St000825',
    summary: 'The major index plus the major index of the inverse.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])) + Sum(Map(i => i if Sum(Map(j => j if p[j] == i else 0, Range(1, Length(p)))) > Sum(Map(j => j if p[j] == i + 1 else 0, Range(1, Length(p)))) else 0, Range(1, Length(p) - 1)))',
  },
  {
    head: 'Makl',
    findstat: 'St000798',
    summary: "Foata and Zeilberger's makl: (1-32) + (31-2) + (32-1) + (21).",
    epsil:
      'p => (0 if Length(p) < 3 else Sum(Map(j => Count(Filter(Range(1, j - 1), i => p[i] < p[j + 1] && p[j + 1] < p[j])), Range(2, Length(p) - 1)))) + (0 if Length(p) < 3 else Sum(Map(i => Count(Filter(Range(i + 2, Length(p)), k => p[i + 1] < p[k] && p[k] < p[i])), Range(1, Length(p) - 2)))) + (0 if Length(p) < 3 else Sum(Map(i => Count(Filter(Range(i + 2, Length(p)), k => p[k] < p[i + 1] && p[i + 1] < p[i])), Range(1, Length(p) - 2)))) + (0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] > p[i + 1])))',
  },
  {
    head: 'MaximalDiagonalOccupancy',
    findstat: 'St000887',
    summary:
      'The most entries on one diagonal of the permutation matrix: the largest number of i sharing a p(i) - i.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Map(i => Count(Filter(Range(1, Length(p)), j => p[j] - j == p[i] - i)), Range(1, Length(p))))',
  },
  {
    head: 'MaximalExcedance',
    findstat: 'St000141',
    summary: 'The largest p(i) - i.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Map(i => p[i] - i, Range(1, Length(p))))',
  },
  {
    head: 'MaximalModularDisplacement',
    findstat: 'St001569',
    summary: 'The largest cyclic distance between p(i) and i, taken mod n.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Map(i => Min([(p[i] - i + Length(p)) % Length(p), (i - p[i] + Length(p)) % Length(p)]), Range(1, Length(p))))',
  },
  {
    head: 'MaximalSuccessiveDifference',
    findstat: 'St000652',
    summary:
      'The largest p(i+1) - p(i), negative for a decreasing permutation.',
    epsil:
      'p => 0 if Length(p) < 2 else Max(Map(i => p[i + 1] - p[i], Range(1, Length(p) - 1)))',
  },
  {
    head: 'MidPointsOfOccurrencesOf123',
    findstat: 'St000372',
    summary: 'Positions that are the middle of a 123 occurrence.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] > Min(Map(j => p[j], Range(1, i))) && p[i] < Max(Map(j => p[j], Range(i, Length(p))))))',
  },
  {
    head: 'MinimalCycleDifference',
    findstat: 'St000210',
    summary:
      'The smallest, over the cycles, of the largest difference between two elements of a cycle.',
    epsil:
      'p => 0 if Length(p) < 1 else Min(Map(i => Max(Map(m => Abs(m - i), Filter(Range(1, Length(p)), m => Count(Filter(Range(1, Length(p), 1), k => Fold((w, t) => p[w], i, Range(1, k, 1)) == m)) > 0))), Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0)))',
  },
  {
    head: 'MinimalJump',
    findstat: 'St001162',
    summary: 'The smallest |p(i+1) - p(i)|.',
    epsil:
      'p => 0 if Length(p) < 2 else Min(Map(i => Abs(p[i + 1] - p[i]), Range(1, Length(p) - 1, 1)))',
  },
  {
    head: 'NestedExcedances',
    findstat: 'St001513',
    summary: 'Pairs i < j with i < j < p(j) < p(i).',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Sum(Map(j => 1, Filter(Range(i + 1, Length(p)), j => j < p[j] && p[j] < p[i]))), Range(1, Length(p) - 1)))',
  },
  {
    head: 'NonCyclicSmallExcedances',
    findstat: 'St000235',
    summary: 'Positions that are not cyclic small excedances.',
    epsil:
      'p => 0 if Length(p) < 1 else Length(p) - Count(Filter(Range(1, Length(p)), i => p[i] == (1 if i == Length(p) else i + 1)))',
  },
  {
    head: 'NonFixedPoints',
    findstat: 'St000673',
    summary: 'Positions i with p(i) != i.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] != i))',
  },
  {
    head: 'NonInversionSum',
    findstat: 'St000341',
    summary: 'The sum of j - i over the non-inversions i < j.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Sum(Map(j => j - i, Filter(Range(i + 1, Length(p)), j => p[i] < p[j]))), Range(1, Length(p) - 1)))',
  },
  {
    head: 'NonLeftToRightMaxima',
    findstat: 'St000316',
    summary: 'Positions smaller than something before them.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] < Max(Map(j => p[j], Range(1, i)))))',
  },
  {
    head: 'NonOverlappingDescents',
    findstat: 'St001928',
    summary:
      'Descents taken greedily left to right, none starting where the last one ended.',
    epsil:
      'p => 0 if Length(p) < 2 else Fold((a, b) => [a[1] + 1, b] if p[b] > p[b + 1] && a[2] < b - 1 else a, [0, -1], Range(1, Length(p) - 1, 1))[1]',
  },
  {
    head: 'NonSmallExcedances',
    findstat: 'St000240',
    summary: 'Positions with p(i) != i + 1.',
    epsil:
      'p => 0 if Length(p) < 1 else Length(p) - Count(Filter(Range(1, Length(p)), i => p[i] == i + 1))',
  },
  {
    head: 'NonWeakExcedanceMidPointsOfOccurrencesOf321',
    findstat: 'St000375',
    summary:
      'Positions i with p(i) < i that are the middle of a 321 occurrence.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] < i && p[i] < Max(Map(j => p[j], Range(1, i))) && p[i] > Min(Map(j => p[j], Range(i, Length(p))))))',
  },
  {
    head: 'NormalizedLeafLabelSum',
    findstat: 'St000726',
    summary:
      'The sum of the leaf labels of the increasing binary tree of p, less n.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Sum(Map(i => p[i], Filter(Range(1, Length(p)), i => (p[i - 1] < p[i] if i > 1 else True) && (p[i] > p[i + 1] if i < Length(p) else True)))), 0) - Length(p)',
  },
  {
    head: 'OccurrencesOf123',
    findstat: 'St000002',
    summary: 'Triples i < j < k with p(i) < p(j) < p(k).',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[i] < p[j] && p[j] < p[k])), Range(i + 1, Length(p)))), Range(1, Length(p))))',
  },
  {
    head: 'OccurrencesOf123Or213',
    findstat: 'St000428',
    summary: 'Triples ordered as 123 or as 213.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[i] < p[j] && p[j] < p[k] || p[j] < p[i] && p[i] < p[k])), Range(i + 1, Length(p) - 1))), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf123Or312',
    findstat: 'St000430',
    summary: 'Triples ordered as 123 or as 312.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[i] < p[j] && p[j] < p[k] || p[j] < p[k] && p[k] < p[i])), Range(i + 1, Length(p) - 1))), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf12Dash3',
    findstat: 'St000357',
    summary: 'Triples i, i+1, k with k > i+1 ordered as 123 (12-3).',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Count(Filter(Range(i + 2, Length(p)), k => p[i] < p[i + 1] && p[i + 1] < p[k])), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf1324',
    findstat: 'St000405',
    summary: 'Quadruples i < j < k < l ordered as 1324.',
    epsil:
      'p => 0 if Length(p) < 4 else Sum(Map(i => Sum(Map(j => Sum(Map(k => Count(Filter(Range(k + 1, Length(p)), l => p[i] < p[k] && p[k] < p[j] && p[j] < p[l])), Range(j + 1, Length(p) - 1))), Range(i + 1, Length(p) - 2))), Range(1, Length(p) - 3)))',
  },
  {
    head: 'OccurrencesOf132Or213Or321',
    findstat: 'St000457',
    summary: 'Triples ordered as 132, 213 or 321.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[i] < p[k] && p[k] < p[j] || p[j] < p[i] && p[i] < p[k] || p[k] < p[j] && p[j] < p[i])), Range(i + 1, Length(p) - 1))), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf132Or312',
    findstat: 'St000426',
    summary: 'Triples ordered as 132 or as 312.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[i] < p[k] && p[k] < p[j] || p[j] < p[k] && p[k] < p[i])), Range(i + 1, Length(p) - 1))), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf13Dash2',
    findstat: 'St000356',
    summary: 'Triples i, i+1, k with k > i+1 ordered as 132 (13-2).',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Count(Filter(Range(i + 2, Length(p)), k => p[i] < p[k] && p[k] < p[i + 1])), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf14Dash2Dash3Or14Dash3Dash2',
    findstat: 'St000709',
    summary:
      'Adjacent ascents p(i) < p(i+1) with two later entries between them, in either order, counted in pairs.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Apply((c: number) => c * (c - 1) / 2, Count(Filter(Range(i + 2, Length(p)), j => p[i] < p[j] && p[j] < p[i + 1]))) if p[i] < p[i + 1] else 0, Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf213Or231',
    findstat: 'St000435',
    summary: 'Triples ordered as 213 or as 231.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[j] < p[i] && p[i] < p[k] || p[k] < p[i] && p[i] < p[j])), Range(i + 1, Length(p) - 1))), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf213Or321',
    findstat: 'St000431',
    summary: 'Triples ordered as 213 or as 321.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[j] < p[i] && p[i] < p[k] || p[k] < p[j] && p[j] < p[i])), Range(i + 1, Length(p) - 1))), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf2143Or4213',
    findstat: 'St000751',
    summary: 'Quadruples ordered as 2143 or as 4213.',
    epsil:
      'p => 0 if Length(p) < 4 else Sum(Map(i => Sum(Map(j => Sum(Map(k => Count(Filter(Range(k + 1, Length(p)), l => p[j] < p[i] && p[i] < p[l] && p[l] < p[k] || p[k] < p[j] && p[j] < p[l] && p[l] < p[i])), Range(j + 1, Length(p) - 1))), Range(i + 1, Length(p) - 2))), Range(1, Length(p) - 3)))',
  },
  {
    head: 'OccurrencesOf231',
    findstat: 'St000219',
    summary: 'Triples i < j < k with p(k) < p(i) < p(j).',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[k] < p[i] && p[i] < p[j])), Range(i + 1, Length(p)))), Range(1, Length(p))))',
  },
  {
    head: 'OccurrencesOf231Or321',
    findstat: 'St000436',
    summary: 'Triples ordered as 231 or as 321.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[k] < p[i] && p[i] < p[j] || p[k] < p[j] && p[j] < p[i])), Range(i + 1, Length(p) - 1))), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf2413',
    findstat: 'St001705',
    summary: 'Quadruples i < j < k < l ordered as 2413.',
    epsil:
      'p => 0 if Length(p) < 4 else Sum(Map(i => Sum(Map(j => Sum(Map(k => Count(Filter(Range(k + 1, Length(p)), l => p[k] < p[i] && p[i] < p[l] && p[l] < p[j])), Range(j + 1, Length(p) - 1))), Range(i + 1, Length(p) - 2))), Range(1, Length(p) - 3)))',
  },
  {
    head: 'OccurrencesOf312Or321',
    findstat: 'St000437',
    summary: 'Triples ordered as 312 or as 321.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[j] < p[k] && p[k] < p[i] || p[k] < p[j] && p[j] < p[i])), Range(i + 1, Length(p) - 1))), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf321',
    findstat: 'St000119',
    summary: 'Triples i < j < k with p(i) > p(j) > p(k).',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[i] > p[j] && p[j] > p[k])), Range(i + 1, Length(p)))), Range(1, Length(p))))',
  },
  {
    head: 'OccurrencesOf3241',
    findstat: 'St000406',
    summary: 'Quadruples i < j < k < l ordered as 3241.',
    epsil:
      'p => 0 if Length(p) < 4 else Sum(Map(i => Sum(Map(j => Sum(Map(k => Count(Filter(Range(k + 1, Length(p)), l => p[l] < p[j] && p[j] < p[i] && p[i] < p[k])), Range(j + 1, Length(p) - 1))), Range(i + 1, Length(p) - 2))), Range(1, Length(p) - 3)))',
  },
  {
    head: 'OccurrencesOf32Dash1',
    findstat: 'St000360',
    summary: 'Triples i, i+1, k with k > i+1 ordered as 321 (32-1).',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Count(Filter(Range(i + 2, Length(p)), k => p[k] < p[i + 1] && p[i + 1] < p[i])), Range(1, Length(p) - 2)))',
  },
  {
    head: 'OccurrencesOf4132Or4231',
    findstat: 'St000440',
    summary: 'Quadruples ordered as 4132 or as 4231.',
    epsil:
      'p => 0 if Length(p) < 4 else Sum(Map(i => Sum(Map(j => Sum(Map(k => Count(Filter(Range(k + 1, Length(p)), l => p[j] < p[l] && p[l] < p[k] && p[k] < p[i] || p[l] < p[j] && p[j] < p[k] && p[k] < p[i])), Range(j + 1, Length(p) - 1))), Range(i + 1, Length(p) - 2))), Range(1, Length(p) - 3)))',
  },
  {
    head: 'OccurrencesOf4213',
    findstat: 'St000750',
    summary: 'Quadruples i < j < k < l ordered as 4213.',
    epsil:
      'p => 0 if Length(p) < 4 else Sum(Map(i => Sum(Map(j => Sum(Map(k => Count(Filter(Range(k + 1, Length(p)), l => p[k] < p[j] && p[j] < p[l] && p[l] < p[i])), Range(j + 1, Length(p) - 1))), Range(i + 1, Length(p) - 2))), Range(1, Length(p) - 3)))',
  },
  {
    head: 'OccurrencesOf52341',
    findstat: 'St000623',
    summary: 'Quintuples i < j < k < l < m ordered as 52341.',
    epsil:
      'p => 0 if Length(p) < 5 else Sum(Map(i => Sum(Map(j => Sum(Map(k => Sum(Map(l => Count(Filter(Range(l + 1, Length(p)), m => p[m] < p[j] && p[j] < p[k] && p[k] < p[l] && p[l] < p[i])), Range(k + 1, Length(p) - 1))), Range(j + 1, Length(p) - 2))), Range(i + 1, Length(p) - 3))), Range(1, Length(p) - 4)))',
  },
  {
    head: 'OccurrencesOfInitial123',
    findstat: 'St000804',
    summary: 'Triples 1 < j < k ordered as 123 (|123).',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[1] < p[j] && p[j] < p[k])), Range(2, Length(p) - 1)))',
  },
  {
    head: 'OccurrencesOfInitial132',
    findstat: 'St000803',
    summary: 'Triples 1 < j < k ordered as 132 (|132).',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[1] < p[k] && p[k] < p[j])), Range(2, Length(p) - 1)))',
  },
  {
    head: 'OccurrencesOfInitial213',
    findstat: 'St000799',
    summary: 'Triples 1 < j < k ordered as 213 (|213).',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[j] < p[1] && p[1] < p[k])), Range(2, Length(p) - 1)))',
  },
  {
    head: 'OccurrencesOfInitial2Dash13',
    findstat: 'St001085',
    summary: 'Triples 1, j, j+1 ordered as 213 (|2-13).',
    epsil:
      'p => 0 if Length(p) < 3 else Count(Filter(Range(2, Length(p) - 1), j => p[j] < p[1] && p[1] < p[j + 1]))',
  },
  {
    head: 'OccurrencesOfInitial321',
    findstat: 'St000802',
    summary: 'Triples 1 < j < k ordered as 321 (|321).',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[k] < p[j] && p[j] < p[1])), Range(2, Length(p) - 1)))',
  },
  {
    head: 'OddInversions',
    findstat: 'St000539',
    summary: 'Inversions i < j with j - i odd.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Sum(Map(j => 1, Filter(Range(i + 1, Length(p)), j => p[i] > p[j] && (j - i) % 2 == 1))), Range(1, Length(p) - 1)))',
  },
  {
    head: 'OuterPeaks',
    findstat: 'St000092',
    summary:
      'Peaks of the word 0 p(1) ... p(n) 0: the interior peaks, plus one for each end that is a peak.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((w: list<integer>) => Count(Filter(Range(2, Length(w) - 1), i => w[i - 1] < w[i] && w[i] > w[i + 1])), Join(Join([0], p), [0]))',
  },
  {
    head: 'ParkingPermutationPreimageSize',
    findstat: 'St001346',
    summary: 'The parking functions whose cars park in the order p.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply((q: list<integer>) => Product(Map(j => j - Max(Join([0], Filter(Range(1, Length(p)), k => k < j && q[k] > q[j]))), Range(1, Length(p)))), Map(v => Sum(Map(j => j if p[j] == v else 0, Range(1, Length(p)))), Range(1, Length(p))))',
  },
  {
    head: 'PermutationBounce',
    findstat: 'St000133',
    summary:
      'The sum of n - b over the bounce points b: the position of 1 in p, then the greatest position among the entries up to one past the last.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((v: list<integer>) => Max(Sum(Map(t => Length(p) - Fold((w, s) => Max(Map(j => v[j], Range(1, w + 1, 1))) if w < Length(p) else Length(p), v[1], Range(1, t, 1)), Range(0, Length(p) - 1, 1))), 0), Map(m => Sum(Map(j => j if p[j] == m else 0, Range(1, Length(p)))), Range(1, Length(p))))',
  },
  {
    head: 'PermutationCosine',
    findstat: 'St000342',
    summary: 'The sum of i p(i).',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => p[i] * i, Range(1, Length(p))))',
  },
  {
    head: 'PermutationTreeHeight',
    findstat: 'St000308',
    summary:
      'The height of the rooted tree from inserting the entries one by one, the most entries on the stack of ancestors.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(Map(i => Count(Filter(Range(1, i, 1), k => p[k] == Min(Map(j => p[j], Range(k, i))))), Range(1, Length(p))))',
  },
  {
    head: 'PopStackSortingPasses',
    findstat: 'St001090',
    summary:
      'The pop-stack sorting passes, each reversing every maximal descending run, needed to sort p.',
    epsil:
      'p => 0 if Length(p) < 2 else Fold((a, b) => Apply((l: list<integer>) => Join([a[1] + (0 if Count(Filter(Range(1, Length(p) - 1), i => l[i] > l[i + 1])) == 0 else 1)], Map(i => l[1 + Max(Join([0], Filter(Range(1, Length(p) - 1), k => k < i && l[k] < l[k + 1]))) + Min(Join([Length(p)], Filter(Range(1, Length(p) - 1), k => k >= i && l[k] < l[k + 1]))) - i], Range(1, Length(p)))), Map(m => a[m + 1], Range(1, Length(p)))), Join([0], p), Range(1, Length(p)))[1]',
  },
  {
    head: 'PositionsOfLetterOneIn132',
    findstat: 'St001685',
    summary: 'Positions that start an occurrence of 132.',
    epsil:
      'p => 0 if Length(p) < 3 else Count(Filter(Range(1, Length(p) - 2), i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[i] < p[k] && p[k] < p[j])), Range(i + 1, Length(p) - 1))) > 0))',
  },
  {
    head: 'PositionsOfLetterTwoIn213',
    findstat: 'St001687',
    summary: 'Positions that start an occurrence of 213.',
    epsil:
      'p => 0 if Length(p) < 3 else Count(Filter(Range(1, Length(p) - 2), i => Sum(Map(j => Count(Filter(Range(j + 1, Length(p)), k => p[j] < p[i] && p[i] < p[k])), Range(i + 1, Length(p) - 1))) > 0))',
  },
  {
    head: 'PrefixSumProduct',
    findstat: 'St001482',
    summary: 'The product of the prefix sums p(1) + ... + p(i) for i < n.',
    epsil:
      'p => 1 if Length(p) < 2 else Product(Map(i => Sum(Map(j => p[j], Range(1, i))), Range(1, Length(p) - 1, 1)))',
  },
  {
    head: 'PrimeProductsMinusOne',
    findstat: 'St001287',
    summary: 'Positions i with i * p(i) - 1 prime.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => i * p[i] - 1 >= 2 && Count(Filter(Range(2, i * p[i] - 1), d => d < i * p[i] - 1 && (i * p[i] - 1) % d == 0)) == 0))',
  },
  {
    head: 'ProperBlocks',
    findstat: 'St001160',
    summary:
      'Windows p(i), ..., p(j) of two or more entries whose values are consecutive integers, the whole word excepted.',
    epsil:
      'p => 0 if Length(p) < 3 else Sum(Map(i => Count(Filter(Range(i + 1, Length(p)), j => Max(Map(k => p[k], Range(i, j))) - Min(Map(k => p[k], Range(i, j))) == j - i)), Range(1, Length(p) - 1))) - 1',
  },
  {
    head: 'Rafts',
    findstat: 'St000665',
    summary: 'Maximal runs of consecutive successions p(i+1) = p(i) + 1.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i + 1] == p[i] + 1 && (True if i == 1 else p[i] < p[i - 1] + 1 || p[i] > p[i - 1] + 1)))',
  },
  {
    head: 'Recoils',
    findstat: 'St000354',
    summary:
      'Values i with i + 1 to the left of i: the descents of the inverse.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => Sum(Map(j => j if p[j] == i else 0, Range(1, Length(p)))) > Sum(Map(j => j if p[j] == i + 1 else 0, Range(1, Length(p))))))',
  },
  {
    head: 'RecursiveEndMaximumCount',
    findstat: 'St000461',
    summary:
      "FindStat's rix: the number of times, peeling the word, the maximum of what is left is its last entry.",
    epsil:
      'p => 0 if Length(p) < 1 else Fold((a, b) => a if a[1] > a[2] else Apply((top: integer) => Apply((peak: integer) => [a[1], a[2] - 1, a[3] + 1] if peak == a[2] else [1, 0, a[3]] if peak == a[1] else [peak + 1, a[2], a[3]], Max(Sum(Map(j => j if p[j] == top else 0, Range(a[1], a[2], 1))), 0)), Max(Map(j => p[j], Range(a[1], a[2], 1)))), [1, Length(p), 0], Range(1, Length(p)))[3]',
  },
  {
    head: 'ReducedReflectionLength',
    findstat: 'St000809',
    summary: 'The total displacement less the inversions.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Abs(p[i] - i), Range(1, Length(p)))) - Sum(Map(i => Count(Filter(Range(i + 1, Length(p)), j => p[i] > p[j])), Range(1, Length(p))))',
  },
  {
    head: 'ReflectionLength',
    findstat: 'St000216',
    summary:
      'n minus the number of cycles \u2014 the minimum number of transpositions.',
    epsil:
      'p => 0 if Length(p) < 1 else Length(p) - Count(Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0))',
  },
  {
    head: 'RestrictedNonInversionsBetweenExcedances',
    findstat: 'St001549',
    summary: 'Pairs i < j < p(i) < p(j).',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => Count(Filter(Range(1, Length(p)), j => i < j && j < p[i] && p[i] < p[j])), Range(1, Length(p))))',
  },
  {
    head: 'RightFloats',
    findstat: 'St000663',
    summary: 'Large ascents p(i+1) > p(i) + 1 beside no raft.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1, 1), i => (p[i + 1] > p[i] + 1 if i >= 1 && i <= Length(p) - 1 else False) && (p[i - 1 + 1] < p[i - 1] + 1 || p[i - 1 + 1] > p[i - 1] + 1 if i - 1 >= 1 && i - 1 <= Length(p) - 1 else True) && (p[i + 1 + 1] < p[i + 1] + 1 || p[i + 1 + 1] > p[i + 1] + 1 if i + 1 >= 1 && i + 1 <= Length(p) - 1 else True)))',
  },
  {
    head: 'RightRopes',
    findstat: 'St000664',
    summary: 'Large ascents right after a raft.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1, 1), i => (p[i + 1] == p[i] + 1 if i >= 1 && i <= Length(p) - 1 else False) && (p[i + 1 + 1] > p[i + 1] + 1 if i + 1 >= 1 && i + 1 <= Length(p) - 1 else False)))',
  },
  {
    head: 'RightToLeftMaxima',
    findstat: 'St000007',
    summary: 'Positions larger than everything after them.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == Max(Map(j => p[j], Range(i, Length(p))))))',
  },
  {
    head: 'RunSetFiberSize',
    findstat: 'St001735',
    summary:
      'The permutations of the same size with the same set of ascending runs as p.',
    epsil:
      'p => 1 if Length(p) < 1 else Apply((f: list<integer>) => Apply((l: list<integer>) => Apply((m: integer) => Apply((t: list<integer>) => Max(Sum(Map(j => t[(2 ^ m - 2) * m + j], Range(1, m))), 0), Apply((a_init: list<integer>) => Fold((a: list<integer>, b) => Apply((a_next: list<integer>) => a_next, Join(a, Map(j => 0 if (1 if b % 2 ^ j >= 2 ^ (j - 1) else 0) == 0 else 1 if b == 2 ^ (j - 1) else Sum(Map(i => a[(b - 2 ^ (j - 1) - 1) * m + i] if l[i] > f[j] else 0, Range(1, m))), Range(1, m)))), a_init, Range(1, 2 ^ m - 1)), [])), Length(f)), Map(i => p[i], Filter(Range(1, Length(p)), i => True if i == Length(p) else p[i] > p[i + 1]))), Map(i => p[i], Filter(Range(1, Length(p)), i => True if i == 1 else p[i - 1] > p[i])))',
  },
  {
    head: 'ScaledReciprocalPositionValueSum',
    findstat: 'St001293',
    summary:
      'The sum of 1/(i + p(i)) times the least common multiple of 1 .. 2n, an integer.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((scale: integer) => Max(Sum(Map(i => scale / (i + p[i]), Range(1, Length(p)))), 0), Fold((a, b) => LCM(a, b), 1, Range(1, 2 * Length(p), 1)))',
  },
  {
    head: 'ShareshianWachsAdmissibleInversions',
    findstat: 'St000866',
    summary:
      'Pairs i < j with p(i) > p(j) and either p(j) < p(j+1) or some entry between them smaller than p(j).',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Sum(Map(j => 1, Filter(Range(i + 1, Length(p)), j => p[i] > p[j] && ((p[j] < p[j + 1] if j < Length(p) else False) || (p[j] > Min(Map(k => p[k], Range(i + 1, j - 1))) if i + 1 < j else False))))), Range(1, Length(p) - 1)))',
  },
  {
    head: 'ShortestCycleLength',
    findstat: 'St000487',
    summary: 'The size of the smallest cycle.',
    epsil:
      'p => 0 if Length(p) < 1 else Min(Map(i => Min(Filter(Range(1, Length(p), 1), k => Fold((w, j) => p[w], i, Range(1, k, 1)) == i)), Filter(Range(1, Length(p), 1), i => Fold((w, k) => w if w <= 0 else 0 if w == i else -1 if w < i else p[w], p[i], Range(1, Length(p), 1)) == 0)))',
  },
  {
    head: 'SimionSchmidtPreimageSize',
    findstat: 'St000124',
    summary:
      'The permutations sent to p by the Simion-Schmidt map onto the 321-avoiding permutations.',
    epsil:
      'p => 1 if Length(p) < 1 else Product(Map(i => Max(Map(m => p[m], Range(1, i))) - i + 1, Filter(Range(1, Length(p)), i => p[i] < Max(Map(m => p[m], Range(1, i)))))) if Sum(Map(i => Count(Filter(Range(1, Length(p)), j => j > i && p[j] < p[i])), Filter(Range(1, Length(p)), i => p[i] < Max(Map(m => p[m], Range(1, i)))))) == 0 else 0',
  },
  {
    head: 'SmallExcedances',
    findstat: 'St000237',
    summary: 'Positions with p(i) = i + 1.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == i + 1))',
  },
  {
    head: 'SmallerChildPathLeafLabel',
    findstat: 'St000724',
    summary:
      'The label of the leaf reached from the root of the increasing binary tree of p by always following the child with the smaller label.',
    epsil:
      'p => 0 if Length(p) < 1 else p[Fold((a, b) => a if a[1] >= a[2] else Apply((smallest: integer) => Apply((low: integer) => Apply((runnerUp: integer) => [a[1], low - 1] if Max(Sum(Map(j => j if p[j] == runnerUp else 0, Range(a[1], a[2], 1))), 0) < low else [low + 1, a[2]], Min(Map(j => Length(p) + 1 if p[j] == smallest else p[j], Range(a[1], a[2], 1)))), Max(Sum(Map(j => j if p[j] == smallest else 0, Range(a[1], a[2], 1))), 0)), Min(Map(j => p[j], Range(a[1], a[2], 1)))), [1, Length(p)], Range(1, Length(p)))[1]]',
  },
  {
    head: 'SmallestLeafLabel',
    findstat: 'St000725',
    summary:
      'The smallest label of a leaf of the increasing binary tree of p: the least peak, an end counting as a peak.',
    epsil:
      'p => 0 if Length(p) < 1 else Min(Map(i => p[i], Filter(Range(1, Length(p)), i => (p[i - 1] < p[i] if i > 1 else True) && (p[i] > p[i + 1] if i < Length(p) else True))))',
  },
  {
    head: 'StaircaseSizeOfCode',
    findstat: 'St000662',
    summary:
      'The largest k with a subsequence of the Lehmer code whose j-th entry from the right is at least j.',
    epsil:
      'p => 0 if Length(p) < 1 else Apply((c: list<integer>) => Fold((a, b) => a + 1 if c[b] > a else a, 0, Range(Length(p), 1, -1)), Map(i => Count(Filter(Range(i + 1, Length(p), 1), j => p[j] < p[i])), Range(1, Length(p))))',
  },
  {
    head: 'StretchingPairs',
    findstat: 'St000516',
    summary: 'Pairs i < j with p(i) < i < j < p(j).',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Sum(Map(j => 1, Filter(Range(i + 1, Length(p)), j => p[i] < i && j < p[j]))), Range(1, Length(p) - 1)))',
  },
  {
    head: 'SubsequenceMonotoneRunSum',
    findstat: 'St000484',
    summary:
      'The monotone runs of the subsequences of p with at least three entries, summed: one plus their interior peaks and valleys.',
    epsil:
      'p => 0 if Length(p) < 1 else Max(2 ^ Length(p) - 1 - Length(p) - Length(p) * (Length(p) - 1) / 2 + Sum(Map(i => Sum(Map(j => Sum(Map(k => 2 ^ (i - 1 + (Length(p) - k)) if p[i] < p[j] && p[j] > p[k] || p[i] > p[j] && p[j] < p[k] else 0, Filter(Range(1, Length(p)), k => k > j))), Filter(Range(1, Length(p)), j => j > i))), Range(1, Length(p)))), 0)',
  },
  {
    head: 'Successions',
    findstat: 'St000441',
    summary:
      'Permutation: positions i with p(i+1) = p(i) + 1. SetPartition: elements i with i + 1 in the same block.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i + 1] == p[i] + 1))',
  },
  {
    head: 'SymmetryClassSize',
    findstat: 'St000401',
    summary:
      'The permutations reachable from p by inverse, reverse and complement: 8 over the symmetries that fix p.',
    epsil:
      'p => 1 if Length(p) < 1 else 8 / (1 + (1 if Count(Filter(Range(1, Length(p)), i => p[i] != p[Length(p) + 1 - i])) == 0 else 0) + (1 if Count(Filter(Range(1, Length(p)), i => p[i] != Length(p) + 1 - p[i])) == 0 else 0) + (1 if Count(Filter(Range(1, Length(p)), i => p[Length(p) + 1 - i] != Length(p) + 1 - p[i])) == 0 else 0) + (1 if Count(Filter(Range(1, Length(p)), i => p[p[i]] != i)) == 0 else 0) + (1 if Count(Filter(Range(1, Length(p)), i => p[p[i]] != Length(p) + 1 - i)) == 0 else 0) + (1 if Count(Filter(Range(1, Length(p)), i => p[Length(p) + 1 - p[i]] != i)) == 0 else 0) + (1 if Count(Filter(Range(1, Length(p)), i => p[Length(p) + 1 - p[i]] != Length(p) + 1 - i)) == 0 else 0))',
  },
  {
    head: 'ThreeRises',
    findstat: 'St000650',
    summary: 'Positions i with p(i+1) = p(i) + 3.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i + 1] == p[i] + 3))',
  },
  {
    head: 'Tier',
    findstat: 'St000779',
    summary:
      'Positions a with a larger entry, then the value p(a) - 1, to its right.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => Sum(Map(j => j if p[j] == p[i] - 1 else 0, Range(1, Length(p)))) > i && Count(Filter(Range(i + 1, Sum(Map(j => j if p[j] == p[i] - 1 else 0, Range(1, Length(p)))) - 1, 1), b => p[b] > p[i])) > 0))',
  },
  {
    head: 'TotalSquaredDisplacement',
    findstat: 'St000828',
    summary: 'The sum of (p(i) - i)^2.',
    epsil:
      'p => 0 if Length(p) < 1 else Sum(Map(i => (p[i] - i) ^ 2, Range(1, Length(p))))',
  },
  {
    head: 'TwoExcedances',
    findstat: 'St000648',
    summary: 'Positions with p(i) = i + 2.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] == i + 2))',
  },
  {
    head: 'TwoShiftedMajorIndex',
    findstat: 'St000963',
    summary: 'The sum of the positions i with p(i) - p(i+1) > 2.',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Filter(Range(1, Length(p) - 1), i => p[i] - p[i + 1] > 2))',
  },
  {
    head: 'UpDownRuns',
    findstat: 'St000638',
    summary:
      'Maximal monotone runs, with p(1) counted alone when it is a descent.',
    epsil:
      'p => 0 if Length(p) < 1 else 1 if Length(p) < 2 else (0 if Length(p) < 3 else Apply((w: list<integer>) => Count(Filter(Range(2, Length(w) - 1), i => w[i - 1] < w[i] && w[i] > w[i + 1])), p) + Apply((w: list<integer>) => Count(Filter(Range(2, Length(w) - 1), i => w[i - 1] < w[i] && w[i] > w[i + 1])), Map(i => Length(p) + 1 - p[i], Range(1, Length(p))))) + 2 if p[1] > p[2] else (0 if Length(p) < 3 else Apply((w: list<integer>) => Count(Filter(Range(2, Length(w) - 1), i => w[i - 1] < w[i] && w[i] > w[i + 1])), p) + Apply((w: list<integer>) => Count(Filter(Range(2, Length(w) - 1), i => w[i - 1] < w[i] && w[i] > w[i + 1])), Map(i => Length(p) + 1 - p[i], Range(1, Length(p))))) + 1',
  },
  {
    head: 'Valleys',
    findstat: 'St000353',
    summary:
      'The number of valleys of $p$: interior positions $i$ with $p_{i-1} > p_i < p_{i+1}$.',
    epsil:
      'p => 0 if Length(p) < 3 else Count(Filter(Range(2, Length(p) - 1), i => p[i - 1] > p[i] && p[i] < p[i + 1]))',
  },
  {
    head: 'VerticalSeparators',
    findstat: 'St001403',
    summary: 'Interior positions i with |p(i-1) - p(i+1)| = 1.',
    epsil:
      'p => 0 if Length(p) < 3 else Count(Filter(Range(2, Length(p) - 1), i => Abs(p[i - 1] - p[i + 1]) == 1))',
  },
  {
    head: 'VeryBigDescents',
    findstat: 'St000872',
    summary: 'Positions i with p(i) - p(i+1) > 2.',
    epsil:
      'p => 0 if Length(p) < 2 else Count(Filter(Range(1, Length(p) - 1), i => p[i] - p[i + 1] > 2))',
  },
  {
    head: 'VisibleInversions',
    findstat: 'St001726',
    summary: 'Pairs i < j with p(j) <= min(i, p(i)).',
    epsil:
      'p => 0 if Length(p) < 2 else Sum(Map(i => Sum(Map(j => 1, Filter(Range(i + 1, Length(p)), j => p[j] <= i && p[j] <= p[i]))), Range(1, Length(p) - 1)))',
  },
  {
    head: 'WeakExcedanceMidPointsOfOccurrencesOf321',
    findstat: 'St000373',
    summary:
      'Positions i with p(i) >= i that are the middle of a 321 occurrence.',
    epsil:
      'p => 0 if Length(p) < 1 else Count(Filter(Range(1, Length(p)), i => p[i] >= i && p[i] < Max(Map(j => p[j], Range(1, i))) && p[i] > Min(Map(j => p[j], Range(i, Length(p))))))',
  },
];
