# Census: which features of the language Tycho uses

**Status:** measurement, 2026-11-01. Written by `census.mts` in this directory; its header gives the command. Compute Engine 0.176.0 (the version installed in Tycho's `node_modules`), interpreter side only: no production build. Run time 204 s.

This is the census of section 7 of `docs/plans/2026-11-01-language-axes-survey.md`. The bigint compile mode is not counted.

## Corpora and totals

- **compile**: the expressions that Tycho's product pipeline hands to `compile()` (classify, normalize, resolve, and the deferred GLSL compile of `<math-plot>`), over the documents of `tycho/scripts/audit-ce-codegen.mts --all`. One expression is one distinct MathJSON tree per document; the targets and options of its compile calls are merged.
- **rows**: every equation row with LaTeX of the Desmos states, boxed as `tycho/scripts/ce-round-trip-audit.mts` boxes it (a strict `ce.parse` inside `withRowParamScope`, with the document's declarations, slider ranges, angle unit, complex mode and dimension). Every row counts, with no deduplication. A definition row `f(x)=...` boxes as `Equal(f(x), ...)`; a top-level `Equal` is therefore not counted as a comparison, in both corpora.

| Total | compile | rows |
| --- | ---: | ---: |
| Documents (Desmos states + showcase entries) | 757 (showcase, art, neyret) | 688 |
| Documents whose setup failed (convert or manager) | 0 | 0 |
| Expressions (compile: distinct per document; rows: equation rows) | 10414 | 6612 |
| ... by source | showcase 233, art 1363, neyret 8818 | art 1298, neyret 5314 |
| `compile()` calls | 22497 | |
| `compile()` calls that threw | 0 | |
| Rows whose box threw (failed to box) | | 0 |
| Expressions that hold an `Error` node (boxed, but invalid) | 23 (0.2%) | 217 (3.3%) |
| Expressions on which this census's own analysis threw | 0 | 0 |

**Counted by**: `syntax` reads the MathJSON structure of the boxed, canonical expression; `type` reads the static `.type` of a node (in the scope the product pushed: for the compile corpus, the scope of the compile call); `option` reads the compile options; `result` reads the compile result (`freeSymbolTypes`, `mode`, `promoted`, `escalation`, `success`). Each column counts expressions that have the feature at least once, and the documents that have at least one such expression.

## What the census cannot measure, and the proxies used

- **A value that crosses the real/complex lane at run time** is not static. The nearest proxies are a call to a document function (or a `Function` application) with an argument whose static type is `complex` or `imaginary`, and the compile results with `mode: "complex"`, `promoted` or `escalation` (section "Real/complex lane").
- **`Nothing` and `Indeterminate` as results** of an evaluation are not computed: the census does not evaluate. It counts the symbols in the boxed expression and the nodes whose static type is `nothing` (statements of a block are excluded).
- **A read before the first assignment on some path** is approximated by statement order in a `Block` (a symbol read in a statement before the statement that first assigns it); no control-flow analysis is done.
- **Partial application** is a call with fewer arguments than the required parameters of the operator's signature. The hits that were inspected are a list index written on a name that is also a document function (`F[2]` boxed as a call `F(2)`), not partial application.
- **Currying**: the hits that were inspected are derivatives, `f'(x)`, which box as `Apply(Derivative(f), x)`; none is a function that returns a function.
- **Rectangular lists** are judged on `List` literals only. A list built by a comprehension, a `Range` or `join` has no literal shape; its static type is counted instead ("a list of lists whose element types differ" is a regular expression on the type string).
- **The types of row parameters** in the rows corpus are those Tycho declares in `withRowParamScope`: the parameters of a definition row are declared `broadcastable<number | tuple>`, which is why "a union of shapes" is frequent there. In the compile corpus the types are those of the scope of the compile call, and the `freeSymbolTypes` rows are the compiler's own report.
- The rows corpus counts hidden rows too, so it has more rows than the 5,337 visible equation rows that `audit-ce-codegen.mts --all` reports.
- The Compute Engine is the version installed in Tycho, not the source tree of this repo.

## Selection, comparisons and connectives

| Feature | Counted by | compile: expressions | compile: documents | rows: expressions | rows: documents | Examples |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Which: used | syntax | 630 | 87 | 300 | 124 | `` \begin{cases}P(x, y)&P(x, y)\ge0\end{cases} ``<br>`` C(x)=\begin{cases}x&x\gt0\\0&\top\end{cases} ``<br>`` M_{x}(x)=\begin{cases}1&K_{x}(x)\gt0\\0&\top\end{cases} `` |
| Which: an operand whose static type is a list (element-wise use) | type | 46 | 13 | 34 | 23 | `` d_2=\sum_{n=d}^{d}\begin{cases}10^9&d=m\\d&\top\end{cases} ``<br>`` c=\begin{cases}1+0.05n&\vert x\vert\lt R^{\frac{2}{3}}\\0&\top\end{cases} ``<br>`` h_2(i,n)=\begin{cases}h(i,0)&i\lt n\\H(i+e\times(1..400))&\top\end{cases} `` |
| Which: an operand whose static type admits a list but is not one (`broadcastable<T>`, a union with a list) | type | 17 | 4 | 133 | 74 | `` \begin{cases}G&1\le T\le5\end{cases} ``<br>`` C(x)=\begin{cases}x&x\gt0\\0&\top\end{cases} ``<br>`` C(x)=\begin{cases}0&x\lt0\\1&x\gt1\\x&\top\end{cases} `` |
| Which: an operand whose static type contains `missing` (a cell can be absent) | type | 4 | 2 | 4 | 4 | `` \begin{cases}\begin{cases}F(x, N)&\vert F(x_0, N)-f(x_0,o)\vert\lt0.1\end{cases}&x\gt x_0\end{cases} ``<br>`` D_0(i)=\frac{1}{N}(\sum_{j=1}^{N}\begin{cases}\operatorname{PointList}(0, 0)&j=i\\\frac{P[i]-P[j]}{(d(P[i]-P[j]))^2}&\top\end{cases}) ``<br>`` f_{b2full50}(x)=\begin{cases}\operatorname{join}(\mathrm{Repeat}(0, \begin{cases}51&(f_{b2}(x))[1]=0\\50&\top\end{cases}-\mathrm{Length}(f_{ … `` |
| If: used | syntax | 34 | 34 | 0 | 0 | `` \mathrm{Declare}(\mathrm{base}, \mathrm{integer}); \mathrm{Assign}(\mathrm{base}, \mathrm{ci}\mathrm{cs}+\mathrm{cj}\mathrm{ct}+\mathrm{ck}+ … `` |
| If: an operand whose static type is a list (element-wise use) | type | 0 | 0 | 0 | 0 |  |
| If: an operand whose static type admits a list but is not one (`broadcastable<T>`, a union with a list) | type | 0 | 0 | 0 | 0 |  |
| If: an operand whose static type contains `missing` (a cell can be absent) | type | 0 | 0 | 0 | 0 |  |
| When: used | syntax | 522 | 95 | 752 | 214 | `` 0\lt1\left\{x=x\right\} ``<br>`` (x)^2+(y)^2\lt9\left\{z=-5.5\right\} ``<br>`` 1\gt0\left\{(x+2)^2+y^2\le(0..0.2..1.6)^2\right\} `` |
| When: an operand whose static type is a list (element-wise use) | type | 6 | 3 | 82 | 46 | `` y=y_{r}\left\{x\lt-5\right\} ``<br>`` y=y_{r}\left\{x\lt-0.5\right\} ``<br>`` 0\le y\le100(r(1.01,x,R))\left\{0\le x\right\} `` |
| When: an operand whose static type admits a list but is not one (`broadcastable<T>`, a union with a list) | type | 1 | 1 | 167 | 85 | `` H(x)=3x^2-2x^3\left\{0\le x\le1\right\} ``<br>`` S(x)=3x^2-2x^3\left\{0\le x\le1\right\} ``<br>`` s(x)=2x^3-3x^2+1\left\{0\le x\le1\right\} `` |
| When: an operand whose static type contains `missing` (a cell can be absent) | type | 7 | 7 | 8 | 7 | `` \begin{cases}-0.3-2(x+0.475)&x+0.475\lt0\\-0.3+2(x+0.475)&x+0.475\gt0\end{cases}\left\{\vert x+0.475\vert\lt0.05\right\} ``<br>`` v(T,l)=\begin{cases}(v_1(T,l))^{ns}&u=1\\v_{1c}(T,l)&ns=1\\(v_1(T,l))^{ns-2}(v_{1c}(T,l))^2&\top\end{cases}\begin{cases}(v_2(T,l))^2&u=1\\(v … ``<br>`` \begin{cases}-0.3-2(x+0.6-\frac{1}{8})&x+0.6-\frac{1}{8}\lt0\\-0.3+2(x+0.6-\frac{1}{8})&x+0.6-\frac{1}{8}\gt0\end{cases}\left\{\vert x+0.6-\ … `` |
| comparison: used | syntax | 2046 | 255 | 1332 | 394 | `` y\ln(y)-y\ge-x^2 ``<br>`` r\le\sin(e\theta) ``<br>`` r\le\theta\bmod a `` |
| comparison: an operand whose static type is a list (element-wise use) | type | 49 | 14 | 135 | 61 | `` x^2+y^2\le1-L ``<br>`` r\lt a\cos(\theta^2) ``<br>`` \vert x\vert\gt-(0..10) `` |
| comparison: an operand whose static type admits a list but is not one (`broadcastable<T>`, a union with a list) | type | 3 | 2 | 281 | 146 | `` H(x)=3x^2-2x^3\left\{0\le x\le1\right\} ``<br>`` S(x)=3x^2-2x^3\left\{0\le x\le1\right\} ``<br>`` f_1(z)=2+\sin(2z\left\{-20\lt z\lt0\right\}) `` |
| comparison: an operand whose static type contains `missing` (a cell can be absent) | type | 24 | 1 | 31 | 5 | `` 1.5\le Y\left\{Y\le1.5-\sin(a)\right\} ``<br>`` 0\le y\le100(r(1.01,x,R))\left\{0\le x\right\} ``<br>`` T[\lfloor Nx\rfloor+N\lfloor Ny\rfloor]\lt(3..9)\left\{0\le x\le1\right\} `` |
| connective: used | syntax | 269 | 56 | 84 | 42 | `` X^2+Y^2\ge1\left\{Y\ge0\right\}\left\{Y\le1.5\right\} ``<br>`` \sin(x)-1\left\{\sin(lx)\gt0\lor\sin(4lx)\gt0.9\right\} ``<br>`` \vert y\vert\le0.2\left\{x\gt0\right\}\left\{x\lt4\right\} `` |
| connective: an operand whose static type is a list (element-wise use) | type | 1 | 1 | 6 | 4 | `` \operatorname{PointList}(M(P, P+1, t\bmod1), \lfloor t\rfloor\left\{P\lt5\right\}\left\{M_{ode}=1\right\}) ``<br>`` -1.1\lt x\lt1.1\left\{\vert z+\bigl\lbrack-1, 1\bigr\rbrack2.05\vert\lt0.05\right\}\left\{-0.9\lt y\lt0.9\right\} ``<br>`` S=\frac{5\times40}{2\,000}(\sum_{n=1}^{2\,000}\begin{cases}1&\frac{X-\frac{1}{2}}{10}\le g(n)\lt\frac{X+\frac{1}{2}}{10}\\0&\top\end{cases}) `` |
| connective: an operand whose static type admits a list but is not one (`broadcastable<T>`, a union with a list) | type | 0 | 0 | 14 | 10 | `` I(x)=\begin{cases}1&0\le x\lt n-1\\0&\top\end{cases} ``<br>`` s(t)=(1-t)^2(1+2t)\left\{t\ge0\right\}\left\{t\le1\right\} ``<br>`` v_0(T,l)=T^{l}\left\{0\le T\le1\right\}\left\{0\le l\le s\right\} `` |
| connective: an operand whose static type contains `missing` (a cell can be absent) | type | 0 | 0 | 0 | 0 |  |

## Types of inputs and parameters

| Feature | Counted by | compile: expressions | compile: documents | rows: expressions | rows: documents | Examples |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| A symbol of the expression (input or parameter) whose type contains `missing` | type | 25 | 2 | 40 | 6 | `` P=P_0[P_1\lt1] ``<br>`` B_{lackpos}=\left[\begin{cases}n&P_{iecepos}[n]=1\end{cases} \operatorname{for} n = C_{licklist}+1\right] ``<br>`` Z\coloneq(\left[\operatorname{PointList}(x_0, 30-y_0)\left\{\begin{cases}1&d_1[40(y_0-1)+x_0]=1\\0&\top\end{cases}+\begin{cases}1&d_2[40(y_0 … `` |
| A symbol of the expression (input or parameter) whose type contains `any` | type | 18 | 4 | 26 | 7 | `` m(P,1,1) ``<br>`` r=R^{\frac{2}{3}} ``<br>`` p=\operatorname{join}(p_0, p_1, p_2, p_3, p_4, p_5) `` |
| A symbol of the expression (input or parameter) whose type contains `value` | type | 4 | 1 | 3 | 3 | `` M_{1o}=\min(M_{1tmp}, M_{sat}(T_1)) ``<br>`` a\coloneq\sin(\mathrm{Dot}(\operatorname{PointList}(16.234+0.123\,65w, 35.423\,5+0.212\,3w), \operatorname{PointList}(x, y)))\times4\,358.54 … ``<br>`` c=\mathrm{Map}(Q\mapsto\min(N, Q), \mathrm{Map}(Z\mapsto\sum_{i=1}^{Z}C[i], 1..N))-\operatorname{join}(0, \mathrm{Map}(P\mapsto\min(N, P), \ … `` |
| A symbol of the expression (input or parameter) whose type contains `unknown` | type | 178 | 82 | 313 | 137 | `` z=0 ``<br>`` z\le0 ``<br>`` r\le1 `` |
| A symbol of the expression (input or parameter) whose type is a union of shapes (`broadcastable<T>`, or `\|` with a collection member) | type | 877 | 208 | 2108 | 455 | `` f(z)=z ``<br>`` f(a,b)=a+b ``<br>`` f(x)=\sin(x) `` |
| A symbol of the expression (input or parameter) whose type contains `complex` or `imaginary` | type | 4 | 4 | 20 | 7 | `` Z=2.1+1.21i ``<br>`` f_0(z)=\exp(a\ln(z)+b) ``<br>`` J(n, z)=J(n-1, z)^2+z_0 `` |
| A symbol of the expression (input or parameter) whose type contains `number` (admits a complex value) | type | 159 | 61 | 2778 | 537 | `` 0^{x+y-z}=0 ``<br>`` f(x)=\sin(x) ``<br>`` r\le\sin(e\theta) `` |
| A symbol whose type is inferred, not declared (`inferredType`) | type | 300 | 118 | 783 | 239 | `` z=0 ``<br>`` \tan(xy)=z ``<br>`` 0^{x+y-z}=0 `` |
| A free symbol of the compiled code (`freeSymbolTypes`) whose type contains `missing` | result | 0 | 0 | 0 | 0 |  |
| A free symbol of the compiled code (`freeSymbolTypes`) whose type contains `any` | result | 1 | 1 | 0 | 0 | `` \bigl\lbrack\frac{1}{255}R_{T}\mathtip{\error{n}}{\in \text{(x: unknown, y: unknown, z: unknown) -> any}\notin \text{number}}, \frac{1}{255} … `` |
| A free symbol of the compiled code (`freeSymbolTypes`) whose type contains `value` | result | 0 | 0 | 0 | 0 |  |
| A free symbol of the compiled code (`freeSymbolTypes`) whose type contains `unknown` | result | 10 | 10 | 0 | 0 | `` \operatorname{asOklab}(G_2) ``<br>`` \operatorname{asOklab}(c_{p}) ``<br>`` \frac{\mathrm{d}F(x)}{\mathrm{d}x} `` |
| A free symbol of the compiled code (`freeSymbolTypes`) whose type is a union of shapes (`broadcastable<T>`, or `\|` with a collection member) | result | 868 | 207 | 0 | 0 | `` a ``<br>`` L ``<br>`` X `` |
| A free symbol of the compiled code (`freeSymbolTypes`) whose type contains `complex` or `imaginary` | result | 4 | 4 | 0 | 0 | `` z^{a} ``<br>`` \mathrm{sgn}(t)\vert t\vert\left\{0\le\vert t\vert\right\}\left\{\vert t\vert\le1\right\}(1-\vert t\vert)^2 ``<br>`` z\times(1-M)+M\times(\cos(\sin(z))\exp(\frac{1}{3}\imaginaryI\pi)+\tan(\cot(z))\exp(\frac{2}{3}\imaginaryI\pi)+\sec(\csc(z))\exp(\frac{4}{3} … `` |
| A free symbol of the compiled code (`freeSymbolTypes`) whose type contains `number` (admits a complex value) | result | 54 | 32 | 0 | 0 | `` \tanh(kx) ``<br>`` \phi\theta ``<br>`` \tan(8\phi) `` |
| A free symbol of the compiled code whose type was inferred (`provenance`) | result | 78 | 45 | 0 | 0 | `` f(x, A) ``<br>`` \phi\theta ``<br>`` \tan(8\phi) `` |
| A function symbol whose signature contains `unknown` or `any` | type | 110 | 47 | 347 | 94 | `` d=\frac{1}{x^2+y^2} ``<br>`` \sin(dx)\le\sin(dy) ``<br>`` c=\operatorname{hsv}(xy, 1, 1) `` |
| A function symbol whose signature has a parameter default (`= v`) | type | 0 | 0 | 0 | 0 |  |
| A function symbol whose signature returns a function | type | 0 | 0 | 0 | 0 |  |

## List shapes

| Feature | Counted by | compile: expressions | compile: documents | rows: expressions | rows: documents | Examples |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| A `List` literal | syntax | 232 | 92 | 529 | 163 | `` \pm=\left[1,-1\right] ``<br>`` a=\bigl\lbrack2, 3\bigr\rbrack ``<br>`` A=\bigl\lbrack1, 2, 3\bigr\rbrack `` |
| A `List` literal nested to depth 2 (a list of lists) | syntax | 0 | 0 | 0 | 0 |  |
| A `List` literal nested to depth 3 or more | syntax | 0 | 0 | 0 | 0 |  |
| A `List` literal of lists of different lengths (not rectangular) | syntax | 0 | 0 | 0 | 0 |  |
| A `List` literal whose elements are all points (`Pair`, `Tuple`, `PointList`) or tuples by type | syntax | 53 | 25 | 96 | 35 | `` \bigl\lbrack P_0, P_1\bigr\rbrack ``<br>`` X=\bigl\lbrack A, B, C, D\bigr\rbrack ``<br>`` P_0=\bigl\lbrack A, B, C, A\bigr\rbrack `` |
| A `Range` | syntax | 193 | 70 | 467 | 204 | `` X=0..8 ``<br>`` L=1..100 ``<br>`` r_{ange}=1..29 `` |
| A node whose static type is a list | type | 1198 | 264 | 1925 | 308 | `` C_{c} ``<br>`` p_5=f_5(o) ``<br>`` G_{ridline}=(-7)..7 `` |
| A node whose static type is a list of lists or a matrix | type | 32 | 13 | 118 | 47 | `` m(P,1,1) ``<br>`` p_1=m(p_0) ``<br>`` r=R^{\frac{2}{3}} `` |
| A node whose static type is a list of tuples (points) | type | 256 | 80 | 664 | 171 | `` C_{c} ``<br>`` p_5=f_5(o) ``<br>`` \operatorname{PointList}(a, a, -1) `` |
| A node whose static type is a list of lists whose element types differ (a union of list types inside a list) | type | 16 | 2 | 58 | 25 | `` p_1=m(p_0) ``<br>`` L(n)=\frac{0..n}{n} ``<br>`` d(x)=1+((0..(N^2-1))+x)\bmod N^2 `` |
| The expression's own static type is a list (its value is broadcast) | type | 904 | 216 | 617 | 226 | `` C_{c} ``<br>`` x=c(y,10,E) ``<br>`` r\lt a\cos(\theta^2) `` |

## No-value results and their readers

| Feature | Counted by | compile: expressions | compile: documents | rows: expressions | rows: documents | Examples |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `Nothing` appears in the boxed expression | syntax | 0 | 0 | 0 | 0 |  |
| `Indeterminate` appears in the boxed expression | syntax | 0 | 0 | 0 | 0 |  |
| `Missing` appears in the boxed expression | syntax | 0 | 0 | 0 | 0 |  |
| `NaN` appears in the boxed expression | syntax | 92 | 39 | 7 | 4 | `` 0\lt\begin{cases}1&S_1(x,y)\gt Z\\\operatorname{NaN}&\top\end{cases} ``<br>`` M_{issingTexture}(u,v)=\operatorname{join}((\left[1 \operatorname{for} x = 1..6\right]), (\left[\begin{cases}1&(\lfloor\mathrm{PointX}(M_{is … ``<br>`` C_{ubeCut}(p,x,y,z)=\begin{cases}1&\begin{cases}\begin{cases}\begin{cases}2&\vert\mathrm{PointX}(p)-x\vert\lt0.5\\1&\top\end{cases}&\vert\ma … `` |
| `Undefined` appears in the boxed expression | syntax | 0 | 0 | 0 | 0 |  |
| An `Error` node in the boxed expression | syntax | 23 | 7 | 217 | 77 | `` tcc\| ``<br>`` m=\min(d) ``<br>`` x_1=s(y,x_0) `` |
| A node whose static type is `nothing` | type | 0 | 0 | 13 | 4 | `` t=P\to\operatorname{join}(\sum_{i=1}^{N}P[i]B(i), P[1..(N-1)]),T\to\operatorname{join}(\sum_{i=1}^{N}P[i], T[1..(N-1)]) ``<br>`` B(X, Y, Z, N)=j\to\operatorname{join}(j, X),k\to\operatorname{join}(k, Y),l\to\operatorname{join}(l, Z),r_1\to\operatorname{join}(r_1, c_{R} … ``<br>`` c_{ustomPreset}=(s_{ize}\to c_{ustomPresetSize}),(a_{mplitude}\to c_{ustomPresetAmplitude}),(s_{eed}\to c_{ustomPresetSeed}),(l_{ayerBaseLev … `` |
| `IsMissing` is used | syntax | 0 | 0 | 0 | 0 |  |
| `Coalesce` is used | syntax | 0 | 0 | 0 | 0 |  |
| `AssertPresent` is used | syntax | 0 | 0 | 0 | 0 |  |

## Function values

| Feature | Counted by | compile: expressions | compile: documents | rows: expressions | rows: documents | Examples |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| `Sort` is used | syntax | 1 | 1 | 1 | 1 | `` A=\mathrm{Sort}(2\pi\mathrm{WithRandomSeed}(s, \mathrm{RandomChoice}(\lbrack0, 1\rparen, n_0))) ``<br>`` \mathrm{Sort}(2\pi\mathrm{WithRandomSeed}(s, \mathrm{RandomChoice}(\lbrack0, 1\rparen, n_0))) `` |
| `Sort` with an operand that is a function (a `Function` literal or a symbol of function type) | type | 0 | 0 | 0 | 0 |  |
| `Map` is used | syntax | 27 | 15 | 27 | 18 | `` X=\mathrm{Map}(Z\mapsto\sum_{i=1}^{Z}D[i], 1..N) ``<br>`` F=\mathrm{Map}(Z\mapsto f(Z[1], Z[2]), \mathrm{Zip}(A, B)) ``<br>`` F=\mathrm{Map}(Z\mapsto f(Z[1], Z[2]), \mathrm{Zip}(X(I), Y(I))) `` |
| `Map` with an operand that is a function (a `Function` literal or a symbol of function type) | type | 27 | 15 | 27 | 18 | `` X=\mathrm{Map}(Z\mapsto\sum_{i=1}^{Z}D[i], 1..N) ``<br>`` F=\mathrm{Map}(Z\mapsto f(Z[1], Z[2]), \mathrm{Zip}(A, B)) ``<br>`` F=\mathrm{Map}(Z\mapsto f(Z[1], Z[2]), \mathrm{Zip}(X(I), Y(I))) `` |
| `Iterate` is used | syntax | 0 | 0 | 0 | 0 |  |
| `Iterate` with an operand that is a function (a `Function` literal or a symbol of function type) | type | 0 | 0 | 0 | 0 |  |
| `Pipe` is used | syntax | 0 | 0 | 0 | 0 |  |
| `Pipe` with an operand that is a function (a `Function` literal or a symbol of function type) | type | 0 | 0 | 0 | 0 |  |
| `Filter` is used | syntax | 0 | 0 | 2 | 1 | `` I_0(l,r)=\mathrm{Map}(W\mapsto(1..\mathrm{Length}(l))[W], \mathrm{Filter}(1..\mathrm{Length}(l), W\mapsto l[W]=r[1])) `` |
| `Filter` with an operand that is a function (a `Function` literal or a symbol of function type) | type | 0 | 0 | 2 | 1 | `` I_0(l,r)=\mathrm{Map}(W\mapsto(1..\mathrm{Length}(l))[W], \mathrm{Filter}(1..\mathrm{Length}(l), W\mapsto l[W]=r[1])) `` |
| `Fold` is used | syntax | 0 | 0 | 0 | 0 |  |
| `Fold` with an operand that is a function (a `Function` literal or a symbol of function type) | type | 0 | 0 | 0 | 0 |  |
| `Reduce` is used | syntax | 0 | 0 | 0 | 0 |  |
| `Reduce` with an operand that is a function (a `Function` literal or a symbol of function type) | type | 0 | 0 | 0 | 0 |  |
| `Apply` is used | syntax | 47 | 16 | 18 | 8 | `` f^{\prime}(x) ``<br>`` A_1(x)=l_1^{-1}(x) ``<br>`` \frac{1}{4}f^{\prime}(x) `` |
| `Apply` with an operand that is a function (a `Function` literal or a symbol of function type) | type | 44 | 14 | 0 | 0 | `` \frac{1}{\sin(1)}((x, n)\mapsto\begin{cases}\sin(x)&n=1\\\sin(s(x, n-1))&\top\end{cases})(x, 2)-2 ``<br>`` ((\mathrm{ceArg_0}, \mathrm{ceArg_1})\mapsto\max(0, (\mathrm{ceArg_0}^2+\mathrm{ceArg_1}^2)^{1/2}-1))(x, y_{r}) ``<br>`` \int_{-10}^{10}\!((\mathrm{ceArg_0}, \mathrm{ceArg_1}, \mathrm{ceArg_2})\mapsto\frac{\begin{cases}\begin{cases}1&\mathrm{ceArg_0}\lt-(1-\mat … `` |
| `Tabulate` is used | syntax | 0 | 0 | 0 | 0 |  |
| `Tabulate` with an operand that is a function (a `Function` literal or a symbol of function type) | type | 0 | 0 | 0 | 0 |  |
| `Find` is used | syntax | 0 | 0 | 0 | 0 |  |
| `Find` with an operand that is a function (a `Function` literal or a symbol of function type) | type | 0 | 0 | 0 | 0 |  |
| `Count` is used | syntax | 0 | 0 | 0 | 0 |  |
| `Count` with an operand that is a function (a `Function` literal or a symbol of function type) | type | 0 | 0 | 0 | 0 |  |
| A `Function` literal (lambda) | syntax | 142 | 52 | 85 | 52 | `` \int_{0}^{x}\!f(y)\, \mathrm{d}y+4 ``<br>`` y\lt\int_{-x}^{x}\!\cos(x)\, \mathrm{d}n ``<br>`` \int_{-30}^{30}\!(f(x)-g(x))^2\, \mathrm{d}x `` |
| A call to a document-defined function (`isDocumentFn`) | syntax | 1447 | 366 | 3377 | 447 | `` f(z)=z ``<br>`` f(a,b)=a+b ``<br>`` f(x)=\sin(x) `` |
| A call to a document function with an argument that is a function | type | 2 | 1 | 3 | 3 | `` d(P)\le0.0 ``<br>`` m(s_0,s_1,a(x))-0.2 ``<br>`` f_{x}\coloneq s_{s}(s_{x}); f_{y}\coloneq s_{s}(s_{y}); c_2(x,y)=I(I(d_{00}, d_{10}, f_{x}), I(d_{01}, d_{11}, f_{x}), f_{y}) `` |
| Currying: a `Function` whose body is a `Function`, or an `Apply` of a call | syntax | 3 | 2 | 18 | 8 | `` f^{\prime}(x) ``<br>`` A_1(x)=l_1^{-1}(x) ``<br>`` \frac{1}{4}f^{\prime}(x) `` |
| Partial application: a call with fewer arguments than the required parameters of the function's signature | type | 0 | 0 | 8 | 2 | `` \max(F[2]^2, F[1]^2)\le0.1 ``<br>`` x_4=\frac{1}{2}(x+x_3\bigl\lbrack1, -1\bigr\rbrack) `` |

## Block locals and effects

| Feature | Counted by | compile: expressions | compile: documents | rows: expressions | rows: documents | Examples |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| A `Block` | syntax | 219 | 96 | 141 | 63 | `` b\coloneq1; g(x) ``<br>`` y\lt\int_{-x}^{x}\!\cos(x)\, \mathrm{d}n ``<br>`` \int_{-30}^{30}\!(f(x)-g(x))^2\, \mathrm{d}x `` |
| A `Declare` | syntax | 77 | 44 | 56 | 12 | `` b\coloneq1; g(x) ``<br>`` \phi\coloneq\frac{1+\sqrt{5}}{2}; a=2\tau\phi i-((\phi i-T)\bmod1)^{\frac{3}{2}}\tau ``<br>`` a\coloneq R_{ec}(x+y,z); c_{lavinga}=\operatorname{hsv}(12+10a, 0.87+\frac{a}{5}, 0.8-0.4a) `` |
| An `Assign` | syntax | 77 | 44 | 56 | 12 | `` b\coloneq1; g(x) ``<br>`` \phi\coloneq\frac{1+\sqrt{5}}{2}; a=2\tau\phi i-((\phi i-T)\bmod1)^{\frac{3}{2}}\tau ``<br>`` a\coloneq R_{ec}(x+y,z); c_{lavinga}=\operatorname{hsv}(12+10a, 0.87+\frac{a}{5}, 0.8-0.4a) `` |
| An `Assign` inside an `If`, `Which` or `When` inside a `Block` | syntax | 0 | 0 | 0 | 0 |  |
| In a `Block`, a symbol read in a statement before the statement that first assigns it | syntax | 0 | 0 | 0 | 0 |  |
| A loop (`Loop`, `For`, `While`) | syntax | 0 | 0 | 0 | 0 |  |
| A loop whose value is used (not a statement of a `Block` other than its last one) | syntax | 0 | 0 | 0 | 0 |  |
| A `vars` entry of the compile options that is code, not a name or a member access (`_.x`) | option | 0 | 0 | 0 | 0 |  |

## Compile options and targets

| Feature | Counted by | compile: expressions | compile: documents | rows: expressions | rows: documents | Examples |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| Compiled to `javascript` | option | 9579 | 735 | 0 | 0 | `` z^{a} ``<br>`` \sin(x) ``<br>`` x^2-y^2 `` |
| Compiled to `interval-js` | option | 5307 | 542 | 0 | 0 | `` 28 ``<br>`` \sin(x) ``<br>`` x^2-y^2 `` |
| Compiled to `glsl` | option | 4233 | 417 | 0 | 0 | `` z^{a} ``<br>`` d(x, y) ``<br>`` x^2+y^2-1 `` |
| Compiled to `wgsl` | option | 0 | 0 | 0 | 0 |  |
| Compiled to `python` | option | 0 | 0 | 0 | 0 |  |
| Compiled to another target | option | 0 | 0 | 0 | 0 |  |
| Compiled to two or more targets | option | 6399 | 631 | 0 | 0 | `` z^{a} ``<br>`` \sin(x) ``<br>`` x^2-y^2 `` |
| At least one compile of the expression declined or threw | result | 173 | 63 | 0 | 0 | `` S(t, 0) ``<br>`` c_{g}(x)+B(x) ``<br>`` f^{\prime}(x) `` |
| Compile option `broadcast` is passed | option | 2884 | 314 | 0 | 0 | `` 28 ``<br>`` x^2-y^2 ``<br>`` d(x, y) `` |
| Compile option `broadcast: false` | option | 14 | 10 | 0 | 0 | `` 0^{x+y-z} ``<br>`` Q(x, y, z)+0.2 ``<br>`` z-\sin(\frac{y}{z^{1.7}}) `` |
| Compile option `broadcast: true` | option | 2870 | 314 | 0 | 0 | `` 28 ``<br>`` x^2-y^2 ``<br>`` d(x, y) `` |
| Compile option `mode` is passed | option | 9541 | 733 | 0 | 0 | `` \sin(x) ``<br>`` x^2-y^2 ``<br>`` x^3+y^3-3xy `` |
| Compile option `mode: auto` | option | 507 | 109 | 0 | 0 | `` \vert y+2\vert x^2+y^2-1 ``<br>`` \operatorname{asOklab}(c) ``<br>`` \operatorname{asOklab}(w) `` |
| Compile option `mode: strict` | option | 9034 | 698 | 0 | 0 | `` \sin(x) ``<br>`` x^2-y^2 ``<br>`` x^3+y^3-3xy `` |
| Compile option `vars` is passed | option | 152 | 42 | 0 | 0 | `` 28 ``<br>`` d(x, y) ``<br>`` x^2+y^2-1 `` |

## Real/complex lane

| Feature | Counted by | compile: expressions | compile: documents | rows: expressions | rows: documents | Examples |
| --- | --- | ---: | ---: | ---: | ---: | --- |
| A node whose static type contains `complex` or `imaginary` | type | 508 | 88 | 185 | 87 | `` t^{i} ``<br>`` ui^{4v} ``<br>`` f(i,0)=1 `` |
| `ImaginaryUnit` or a complex number literal | syntax | 295 | 24 | 56 | 29 | `` t^{i} ``<br>`` ui^{4v} ``<br>`` f(i,0)=1 `` |
| A call to a document function, or a `Function` application, with an argument typed `complex` or `imaginary` (proxy for a complex value that reaches a parameter) | type | 6 | 4 | 16 | 10 | `` f(i,0)=1 ``<br>`` J(0, Z)=Z ``<br>`` R(\sqrt{x}) `` |
| A compile result with `mode: "complex"` | result | 11 | 9 | 0 | 0 | `` F(0) ``<br>`` 2-\sqrt{1-z^2} ``<br>`` \sin(\Re(Z(x, y))) `` |
| A compile result with `promoted: true` (an unknown-sign `Sqrt`, `Ln`, `Log` or `Power` lowered through the complex kernel) | result | 11 | 9 | 0 | 0 | `` F(0) ``<br>`` 2-\sqrt{1-z^2} ``<br>`` \sin(\Re(Z(x, y))) `` |
| A compile result with an `escalation` (the strict attempt declined on a lane mismatch and the compile was redone in complex mode) | result | 0 | 0 | 0 | 0 |  |
| The document is in complex mode (`complexMode`) | option | 337 | 32 | 148 | 32 | `` t^{i} ``<br>`` f(z)=z ``<br>`` ui^{4v} `` |

## Operators

Every operator of the boxed expressions, by the number of expressions that use it (syntax). Sorted by rows, then compile.

| Operator | compile: expressions | compile: documents | rows: expressions | rows: documents | Examples |
| --- | ---: | ---: | ---: | ---: | --- |
| `Equal` | 255 | 32 | 3863 | 607 | `` A=x^2+y^2 ``<br>`` Z=x^2+y^2 ``<br>`` 0^{x+y-z}=0 `` |
| `Add` | 7679 | 636 | 3621 | 628 | `` A=x^2+y^2 ``<br>`` 0^{x+y-z}=0 ``<br>`` y\ln(y)-y\ge-x^2 `` |
| `Multiply` | 5577 | 636 | 3402 | 637 | `` ui^{4v} ``<br>`` r\le\sin(e\theta) ``<br>`` \sin(dx)\le\sin(dy) `` |
| `PointList` | 1561 | 208 | 1773 | 329 | `` \operatorname{PointList}(a, a, -1) ``<br>`` F_1(x,y,z)=\operatorname{PointList}(-y, z, x) ``<br>`` a_{position}=\operatorname{PointList}(0, 0, 0) `` |
| `Negate` | 2671 | 438 | 1564 | 462 | `` -(f(t)) ``<br>`` 0^{x+y-z}=0 ``<br>`` y\ln(y)-y\ge-x^2 `` |
| `Power` | 3103 | 405 | 1379 | 485 | `` t^{i} ``<br>`` ui^{4v} ``<br>`` A=x^2+y^2 `` |
| `Divide` | 2028 | 368 | 1191 | 422 | `` d=\frac{1}{x^2+y^2} ``<br>`` ui^{\frac{158}{2.5}v} ``<br>`` \sin(xy)\le\frac{9}{x^2-y^2} `` |
| `Sin` | 2614 | 330 | 1036 | 386 | `` f(x)=\sin(x) ``<br>`` z=\sin(r\theta) ``<br>`` r\le\sin(e\theta) `` |
| `Cos` | 2203 | 266 | 824 | 296 | `` r\lt a\cos(\theta^2) ``<br>`` (\cos(t)+i\sin(at))^3 ``<br>`` (x\sin(x)+y\cos(y))^2\lt2 `` |
| `LessEqual` | 898 | 154 | 760 | 273 | `` y\ln(y)-y\ge-x^2 ``<br>`` r\le\sin(e\theta) ``<br>`` r\le\theta\bmod a `` |
| `When` | 522 | 95 | 752 | 214 | `` 0\lt1\left\{x=x\right\} ``<br>`` (x)^2+(y)^2\lt9\left\{z=-5.5\right\} ``<br>`` 1\gt0\left\{(x+2)^2+y^2\le(0..0.2..1.6)^2\right\} `` |
| `List` | 232 | 92 | 529 | 163 | `` \pm=\left[1,-1\right] ``<br>`` a=\bigl\lbrack2, 3\bigr\rbrack ``<br>`` A=\bigl\lbrack1, 2, 3\bigr\rbrack `` |
| `Less` | 1172 | 141 | 519 | 205 | `` z\lt0 ``<br>`` y\gt-9! ``<br>`` r\lt a\cos(\theta^2) `` |
| `Mod` | 801 | 162 | 478 | 250 | `` s_{x}=x\bmod1 ``<br>`` r\le\theta\bmod a ``<br>`` r\le k\theta\bmod\pi `` |
| `Abs` | 1117 | 153 | 475 | 201 | `` x^2\vert y+2\vert+y^2\le1 ``<br>`` (\vert x\vert-1)^2+y^4\gt0.1 ``<br>`` \vert\tan(\tan(x+iy))\vert\lt1 `` |
| `Range` | 193 | 70 | 467 | 204 | `` X=0..8 ``<br>`` L=1..100 ``<br>`` r_{ange}=1..29 `` |
| `At` | 354 | 115 | 393 | 109 | `` P=P_0[P_1\lt1] ``<br>`` h_0(i,x)=H_0[i+1] ``<br>`` 0\le y\le S[x+21.5] `` |
| `Sqrt` | 873 | 144 | 359 | 199 | `` r_0=\sqrt{x^2+y^2} ``<br>`` l(P)=\sqrt{P[1]^2+P[2]^2} ``<br>`` L_0=-B_0+\sqrt{B_0^2-C_0} `` |
| `Floor` | 714 | 129 | 310 | 150 | `` \lfloor x\rfloor\bmod2+2 ``<br>`` f(t)=\lfloor\frac{t}{L}\rfloor ``<br>`` \rho=\lfloor3\theta\rfloor\bmod9 `` |
| `Which` | 630 | 87 | 300 | 124 | `` \begin{cases}P(x, y)&P(x, y)\ge0\end{cases} ``<br>`` C(x)=\begin{cases}x&x\gt0\\0&\top\end{cases} ``<br>`` M_{x}(x)=\begin{cases}1&K_{x}(x)\gt0\\0&\top\end{cases} `` |
| `Limits` | 290 | 109 | 283 | 151 | `` \sum_{n=0}^{x}n\sin(an) ``<br>`` a(n)=\sum_{k=1}^{n}r(k) ``<br>`` \sum_{i=1}^4C(t)[i]P[d(i)] `` |
| `Sum` | 250 | 90 | 262 | 121 | `` T=A+\sum B ``<br>`` \sum_{n=0}^{x}n\sin(an) ``<br>`` a(n)=\sum_{k=1}^{n}r(k) `` |
| `String` | 50 | 22 | 244 | 94 | `` tcc\| ``<br>`` m=\min(d) ``<br>`` x_1=s(y,x_0) `` |
| `Error` | 23 | 7 | 217 | 77 | `` tcc\| ``<br>`` m=\min(d) ``<br>`` x_1=s(y,x_0) `` |
| `ErrorCode` | 23 | 7 | 208 | 71 | `` m=\min(d) ``<br>`` l(X-3,Y)=1 ``<br>`` x_1=s(y,x_0) `` |
| `Triangle` | 0 | 0 | 202 | 14 | `` \operatorname{triangle}(A_3, A_{2B}, A_{2C}) ``<br>`` \operatorname{triangle}(p_5[N-1], p_5[N], p_6[N]) ``<br>`` \operatorname{triangle}(T_{riZPos}, T_{riZPos}+\operatorname{PointList}(2, 1, 1), T_{riZPos}+\operatorname{PointList}(-1, 1, 1)) `` |
| `PointX` | 184 | 38 | 192 | 60 | `` X=\mathrm{PointX}(P(x, y, N)) ``<br>`` d=(x-\mathrm{PointX}(P))^2+(y-\mathrm{PointY}(P))^2 ``<br>`` d(P)=\sqrt{\mathrm{PointX}(P)^2+\mathrm{PointY}(P)^2} `` |
| `PointY` | 191 | 38 | 189 | 58 | `` Y=\mathrm{PointY}(P(x, y, N)) ``<br>`` \mathrm{PointY}(l_1)\lt v_{MAXSAFEINT} ``<br>`` d=(x-\mathrm{PointX}(P))^2+(y-\mathrm{PointY}(P))^2 `` |
| `Max` | 199 | 69 | 177 | 97 | `` S(x)=S_0(\max(\min(x, 1), -1)) ``<br>`` d(x,r)=\max(0, \sqrt{x^2+r^2}-1) ``<br>`` f_0(x)=\max(0, 1-\vert\sin(x)\vert) `` |
| `Hsv` | 0 | 0 | 173 | 62 | `` c=\operatorname{hsv}(xy, 1, 1) ``<br>`` c=\operatorname{hsv}(-3z, 1, 1) ``<br>`` c=\operatorname{hsv}(38, 1, 0.4) `` |
| `Comprehension` | 111 | 35 | 158 | 54 | `` \min(\left[U(i, x) \operatorname{for} i = I\right]) ``<br>`` \left[P(i, P_0) \operatorname{for} i = 0..40\right] ``<br>`` K=\left[A[i]+B[i] \operatorname{for} i = 1..3\right] `` |
| `Element` | 111 | 35 | 158 | 54 | `` \min(\left[U(i, x) \operatorname{for} i = I\right]) ``<br>`` \left[P(i, P_0) \operatorname{for} i = 0..40\right] ``<br>`` K=\left[A[i]+B[i] \operatorname{for} i = 1..3\right] `` |
| `Block` | 219 | 96 | 141 | 63 | `` b\coloneq1; g(x) ``<br>`` y\lt\int_{-x}^{x}\!\cos(x)\, \mathrm{d}n ``<br>`` \int_{-30}^{30}\!(f(x)-g(x))^2\, \mathrm{d}x `` |
| `Min` | 120 | 35 | 137 | 60 | `` m=\min(d) ``<br>`` U_{nion}(a,b)=\min(a, b) ``<br>`` \min(x\bmod2, 2-x\bmod2)+2 `` |
| `Function` | 142 | 52 | 85 | 52 | `` \int_{0}^{x}\!f(y)\, \mathrm{d}y+4 ``<br>`` y\lt\int_{-x}^{x}\!\cos(x)\, \mathrm{d}n ``<br>`` \int_{-30}^{30}\!(f(x)-g(x))^2\, \mathrm{d}x `` |
| `WithRandomSeed` | 46 | 28 | 81 | 45 | `` R_1(i)=\mathrm{WithRandomSeed}(537\,911, \mathrm{Random}()) ``<br>`` L_1=\mathrm{WithRandomSeed}(70\,132, \mathrm{RandomShuffle}(L)) ``<br>`` L_1=\mathrm{WithRandomSeed}(339\,040, \mathrm{RandomShuffle}(L)) `` |
| `PointZ` | 70 | 12 | 80 | 16 | `` F_{s}(\mathrm{PointX}(G(L, 5)),\mathrm{PointY}(G(L, 5)),\mathrm{PointZ}(G(L, 5)),s) ``<br>`` W(p, x, y, z)=\operatorname{PointList}(x\mathrm{PointX}(p), y\mathrm{PointY}(p), z\mathrm{PointZ}(p)) ``<br>`` \vert\operatorname{PointList}(x, y, z-1)-P(\mathrm{PointX}(A), \mathrm{PointY}(A), \mathrm{PointZ}(A))\vert^2=0.01 `` |
| `And` | 265 | 55 | 79 | 41 | `` X^2+Y^2\ge1\left\{Y\ge0\right\}\left\{Y\le1.5\right\} ``<br>`` \vert y\vert\le0.2\left\{x\gt0\right\}\left\{x\lt4\right\} ``<br>`` 0\lt1\left\{-1\lt x\lt11\right\}\left\{-0.7\lt y\lt3\right\} `` |
| `Length` | 81 | 28 | 72 | 31 | `` \mathrm{Length}(L) ``<br>`` l=\mathrm{Length}(L) ``<br>`` L=A+\mathrm{Length}(B) `` |
| `Rgb` | 0 | 0 | 67 | 29 | `` b=\operatorname{rgb}(\frac{0}{255}, \frac{0}{255}, \frac{0}{255}) ``<br>`` c=\operatorname{rgb}(\frac{x}{255}, \frac{y}{255}, \frac{z}{255}) ``<br>`` c=\operatorname{rgb}(\frac{0}{255}, \frac{0}{255}, \frac{0}{255}) `` |
| `Tuple` | 1634 | 145 | 66 | 30 | `` \sin(6N\sqrt{m})=0 ``<br>`` (x^2+Y^2-1)(Y-x)^2\le0 ``<br>`` 0.1\sin(f\times(x)x)-0.6 `` |
| `Interval` | 32 | 21 | 63 | 37 | `` H=\mathrm{WithRandomSeed}(479\,712, \mathrm{RandomChoice}(\lbrack0, 1\rparen, N)) ``<br>`` H=\mathrm{WithRandomSeed}(139\,128, \mathrm{RandomChoice}(\lbrack0, 1\rparen, 4N)) ``<br>`` R_2(i)=\mathrm{WithRandomSeed}(i, \mathrm{RandomChoice}(\lbrack0, 1\rparen, 1))[1] `` |
| `Open` | 32 | 21 | 63 | 37 | `` H=\mathrm{WithRandomSeed}(479\,712, \mathrm{RandomChoice}(\lbrack0, 1\rparen, N)) ``<br>`` H=\mathrm{WithRandomSeed}(139\,128, \mathrm{RandomChoice}(\lbrack0, 1\rparen, 4N)) ``<br>`` R_2(i)=\mathrm{WithRandomSeed}(i, \mathrm{RandomChoice}(\lbrack0, 1\rparen, 1))[1] `` |
| `RandomChoice` | 32 | 21 | 63 | 37 | `` H=\mathrm{WithRandomSeed}(479\,712, \mathrm{RandomChoice}(\lbrack0, 1\rparen, N)) ``<br>`` H=\mathrm{WithRandomSeed}(139\,128, \mathrm{RandomChoice}(\lbrack0, 1\rparen, 4N)) ``<br>`` R_2(i)=\mathrm{WithRandomSeed}(i, \mathrm{RandomChoice}(\lbrack0, 1\rparen, 1))[1] `` |
| `Assign` | 77 | 44 | 56 | 12 | `` b\coloneq1; g(x) ``<br>`` \phi\coloneq\frac{1+\sqrt{5}}{2}; a=2\tau\phi i-((\phi i-T)\bmod1)^{\frac{3}{2}}\tau ``<br>`` a\coloneq R_{ec}(x+y,z); c_{lavinga}=\operatorname{hsv}(12+10a, 0.87+\frac{a}{5}, 0.8-0.4a) `` |
| `Declare` | 77 | 44 | 56 | 12 | `` b\coloneq1; g(x) ``<br>`` \phi\coloneq\frac{1+\sqrt{5}}{2}; a=2\tau\phi i-((\phi i-T)\bmod1)^{\frac{3}{2}}\tau ``<br>`` a\coloneq R_{ec}(x+y,z); c_{lavinga}=\operatorname{hsv}(12+10a, 0.87+\frac{a}{5}, 0.8-0.4a) `` |
| `Integrate` | 74 | 24 | 56 | 32 | `` \int_{0}^{x}\!f(y)\, \mathrm{d}y+4 ``<br>`` \int_{0}^{1}\!f_{A}(x)\, \mathrm{d}x ``<br>`` F(x)=\int_{0}^{x}\!f(y)\, \mathrm{d}y `` |
| `Ln` | 55 | 14 | 53 | 28 | `` 10\ln(A[x]) ``<br>`` y\ln(y)-y\ge-x^2 ``<br>`` f_0(z)=\exp(a\ln(z)+b) `` |
| `Arctan2` | 257 | 13 | 52 | 29 | `` t=\arctan(y, x) ``<br>`` A=\arctan(Y, X) ``<br>`` a(y,x)=\arctan(y, x) `` |
| `ListJoin` | 41 | 10 | 51 | 17 | `` J=\operatorname{join}(A, B) ``<br>`` S=\operatorname{join}(S_1, S_2, S_3, S_4) ``<br>`` p=\operatorname{join}(p_0, p_1, p_2, p_3, p_4, p_5) `` |
| `Polygon` | 0 | 0 | 46 | 21 | `` \operatorname{polygon}(A, B, E, C) ``<br>`` \operatorname{polygon}(X(L_1), Y(L_1)) ``<br>`` \operatorname{polygon}(O, A, O, B, O, C) `` |
| `Sign` | 80 | 48 | 43 | 25 | `` s_0(x)=\mathrm{sgn}(x\bmod2)-1 ``<br>`` T(x)=\mathrm{sgn}(x)d(\vert x\vert) ``<br>`` \mathrm{sgn}(x)\sqrt{1-\exp(-ax^2)} `` |
| `D` | 14 | 9 | 43 | 22 | `` \frac{\mathrm{d}(f(x))}{\mathrm{d}x} ``<br>`` \frac{\mathrm{d}(w(x))}{\mathrm{d}x} ``<br>`` \frac{\mathrm{d}Z(x)}{\mathrm{d}x}=0 `` |
| `Tan` | 35 | 19 | 40 | 27 | `` \tan(xy)=z ``<br>`` Y=y-x\tan(a) ``<br>`` \rho=\tan(8\phi) `` |
| `Sphere` | 0 | 0 | 34 | 9 | `` \operatorname{sphere}(E_{yePos}, 3) ``<br>`` \operatorname{sphere}(m_{oonPos}, 1) ``<br>`` \operatorname{sphere}(\operatorname{PointList}(0, 0, 0), 1) `` |
| `Log` | 84 | 16 | 30 | 18 | `` \log(x) ``<br>`` f_1(x)=\log(1.1+x) ``<br>`` -\log(\vert e_{rr}\vert) `` |
| `Map` | 27 | 15 | 27 | 18 | `` X=\mathrm{Map}(Z\mapsto\sum_{i=1}^{Z}D[i], 1..N) ``<br>`` F=\mathrm{Map}(Z\mapsto f(Z[1], Z[2]), \mathrm{Zip}(A, B)) ``<br>`` F=\mathrm{Map}(Z\mapsto f(Z[1], Z[2]), \mathrm{Zip}(X(I), Y(I))) `` |
| `Typed` | 27 | 15 | 27 | 18 | `` X=\mathrm{Map}(Z\mapsto\sum_{i=1}^{Z}D[i], 1..N) ``<br>`` F=\mathrm{Map}(Z\mapsto f(Z[1], Z[2]), \mathrm{Zip}(A, B)) ``<br>`` F=\mathrm{Map}(Z\mapsto f(Z[1], Z[2]), \mathrm{Zip}(X(I), Y(I))) `` |
| `Root` | 89 | 14 | 23 | 17 | `` x=4^{-\frac{1}{7}} ``<br>`` (f(x))^{\frac{1}{30}} ``<br>`` \sin(x)^{\frac{1}{51}} `` |
| `Ceil` | 36 | 13 | 23 | 16 | `` \rho=\lceil\theta\phi\rceil ``<br>`` f_{s}(x)=\lceil x\rceil+s(x\bmod1) ``<br>`` (c(t+1-\lceil t\rceil))[\lceil t\rceil] `` |
| `Arcsin` | 16 | 5 | 21 | 9 | `` m(x)=\arcsin(\sin(x)) ``<br>`` a=\arcsin(\frac{1}{d}) ``<br>`` (-1+0.5\sin(4\arcsin(x))) `` |
| `Tanh` | 34 | 12 | 20 | 15 | `` \tanh(x) ``<br>`` \tanh(kx) ``<br>`` \tanh(1.15x) `` |
| `Factorial` | 162 | 9 | 19 | 17 | `` y\gt-9! ``<br>`` G(x)=(x-1)! ``<br>`` \gamma(x)=(x-1)! `` |
| `Arctan` | 68 | 9 | 19 | 17 | `` a=\arctan(x) ``<br>`` \arctan(a\sin(x)) ``<br>`` f(x)=\arctan(n\sin(x)) `` |
| `Apply` | 47 | 16 | 18 | 8 | `` f^{\prime}(x) ``<br>`` A_1(x)=l_1^{-1}(x) ``<br>`` \frac{1}{4}f^{\prime}(x) `` |
| `Derivative` | 3 | 2 | 18 | 8 | `` f^{\prime}(x) ``<br>`` \frac{1}{4}f^{\prime}(x) ``<br>`` A^{\prime}(x)-T^{\prime}(x) `` |
| `RandomShuffle` | 14 | 8 | 16 | 8 | `` L_1=\mathrm{WithRandomSeed}(70\,132, \mathrm{RandomShuffle}(L)) ``<br>`` L_1=\mathrm{WithRandomSeed}(339\,040, \mathrm{RandomShuffle}(L)) ``<br>`` L=\mathrm{WithRandomSeed}(t, \mathrm{RandomShuffle}(0..(N^2-1))) `` |
| `Product` | 8 | 4 | 16 | 14 | `` p(x,n)=\prod_{j=1}^{n}a(2^{j}x,j) ``<br>`` 0=\prod_{i=0}^{N}(f(x,y)-\frac{i}{N}t) ``<br>`` F_{ull}(j)=\begin{cases}j&\prod_{i=1}^{10}(T[i+10j])\gt0\\100&\top\end{cases} `` |
| `Zip` | 18 | 8 | 15 | 10 | `` F=\mathrm{Map}(Z\mapsto f(Z[1], Z[2]), \mathrm{Zip}(A, B)) ``<br>`` F=\mathrm{Map}(Z\mapsto f(Z[1], Z[2]), \mathrm{Zip}(X(I), Y(I))) ``<br>`` g=\operatorname{hsv}(0, 0, \mathrm{Map}(Z\mapsto f(Z[1], Z[2]), \mathrm{Zip}(X, Y))) `` |
| `Real` | 273 | 13 | 14 | 9 | `` y=\Re(G) ``<br>`` \sin(\Re(Z))=0 ``<br>`` \Re(\cos(x+iy))=1 `` |
| `Round` | 11 | 8 | 14 | 8 | `` \gcd(\mathrm{round}(dx), \mathrm{round}(dy))\le2 ``<br>`` \rho=\frac{\gcd(\mathrm{round}(\theta\phi), 4)}{2} ``<br>`` r\le\gcd(\mathrm{round}(e\theta), \mathrm{round}(a+\theta)) `` |
| `Arccos` | 55 | 7 | 13 | 9 | `` y=2\arccos(x) ``<br>`` y=\cos(\arccos(x)+a) ``<br>`` 2(\frac{\arccos(-x)}{\pi}-0.5) `` |
| `To` | 0 | 0 | 13 | 4 | `` t=P\to\operatorname{join}(\sum_{i=1}^{N}P[i]B(i), P[1..(N-1)]),T\to\operatorname{join}(\sum_{i=1}^{N}P[i], T[1..(N-1)]) ``<br>`` B(X, Y, Z, N)=j\to\operatorname{join}(j, X),k\to\operatorname{join}(k, Y),l\to\operatorname{join}(l, Z),r_1\to\operatorname{join}(r_1, c_{R} … ``<br>`` c_{ustomPreset}=(s_{ize}\to c_{ustomPresetSize}),(a_{mplitude}\to c_{ustomPresetAmplitude}),(s_{eed}\to c_{ustomPresetSeed}),(l_{ayerBaseLev … `` |
| `Sec` | 8 | 6 | 10 | 8 | `` \rho=\sec(\phi\theta) ``<br>`` (\sec(x)+y^2)\bmod2\lt1 ``<br>`` \sin(xy)\ge\frac{2\sin(x)}{\sec(y)} `` |
| `GeometricVector` | 3 | 1 | 10 | 5 | `` \operatorname{vector}(a, a+c_{orr}v_{a}) ``<br>`` \operatorname{vector}(A_{xisPos}, A_{xisPos}+\operatorname{PointList}(2, 0, 0)) ``<br>`` \operatorname{vector}(S-\operatorname{PointList}(0, 0, 1), S+\operatorname{PointList}(0, 0, 2+\mathrm{WithRandomSeed}(290\,336, \mathrm{Rand … `` |
| `LatexString` | 0 | 0 | 9 | 8 | `` tcc\| ``<br>`` f\left(x-2,y-2,.\ 5\right)\le1 ``<br>`` \operatorname{triangle}\left((-3.3,1,1.2),(-2,1.9,1.3),(-1.65,1.2,1.2\right)) `` |
| `Histogram` | 0 | 0 | 8 | 4 | `` \mathrm{Histogram}(L, 0.05) ``<br>`` \mathrm{Histogram}(P_0, \frac{1}{100}) ``<br>`` \mathrm{Histogram}(h(1..N), \frac{1}{100}) `` |
| `Distance` | 9 | 3 | 7 | 4 | `` p(c,b)=\frac{b-c}{\operatorname{distance}(c, b)^3} ``<br>`` \operatorname{distance}(X, A)=\operatorname{distance}(A, B) ``<br>`` \bigl\lbrack\operatorname{PointList}(8v\sin(360u), 8v\cos(360u), 0.05\cos(3\,600v+36a)+0.05\cos(360v+6a))\left\{\operatorname{distance}(p-\o … `` |
| `Dot` | 3 | 1 | 7 | 2 | `` d_{00}=\mathrm{Dot}(p(x,y), (S+\operatorname{PointList}(0, 0))) ``<br>`` a\coloneq\sin(\mathrm{Dot}(\operatorname{PointList}(16.234+0.123\,65w, 35.423\,5+0.212\,3w), \operatorname{PointList}(x, y)))\times4\,358.54 … ``<br>`` P_{01}+\operatorname{PointList}(\left(a\coloneq4\,358.545\,312\,3\sin(\mathrm{Dot}(P_{01}+\operatorname{PointList}(60, 0, 0), \operatorname{ … `` |
| `Segment` | 0 | 0 | 7 | 2 | `` \operatorname{segment}(\operatorname{PointList}(G_{ridline}, -7, 2), \operatorname{PointList}(G_{ridline}, 7, 2)) ``<br>`` \operatorname{segment}(\operatorname{PointList}(\cos(72n), \sin(72n), n-0.3), \operatorname{PointList}(2\cos(72n), 2\sin(72n), n)) `` |
| `Imaginary` | 271 | 12 | 6 | 5 | `` y=\Im(G) ``<br>`` \sin(\Im(Z))=0 ``<br>`` w=\operatorname{hsv}(p+u\arctan(\Im(f(x+yi)), \Re(f(x+iy))), \frac{1}{\vert f(x+yi)\vert}, \vert f(x+yi)\vert) `` |
| `Or` | 6 | 2 | 6 | 2 | `` \sin(x)-1\left\{\sin(lx)\gt0\lor\sin(4lx)\gt0.9\right\} ``<br>`` \vert y+1\vert\le0.2\left\{x\gt4\lor x\lt0\lor\vert x-2\vert\lt0.5\right\} ``<br>`` 4\lt x\lor x\lt0\lor\vert x-2\vert\lt0.5 `` |
| `Random` | 3 | 1 | 6 | 3 | `` \frac{1}{1\,000}(\sum_{n=1}^{1\,000}\mathrm{Random}()) ``<br>`` a=\mathrm{WithRandomSeed}(753\,345, \mathrm{RandomShuffle}(R_{adius}\sin((1..n)+o\mathrm{WithRandomSeed}(530\,981, \mathrm{Random}())+(n+0.5 … ``<br>`` s_{tep}=\begin{cases}(X\to X+d,Y\to Y-T\frac{100\vert d\vert}{12},T\to T+\vert d\vert)&Y\gt Y_0\\(Y_0\to\begin{cases}Y_0-1&Y_0\gt3\\0&\top\e … `` |
| `Median` | 1 | 1 | 6 | 3 | `` \operatorname{PointList}(4.5, \mathrm{median}(Y)) ``<br>`` L_{ightning}(x)=\mathrm{median}(0, 1, 1.3-0.4(x\bmod10)-0.3(x\bmod1)) ``<br>`` s_{kinFade}(x)=\mathrm{median}(1, 0, e^{-(5+\mathrm{sgn}(x))(x)^2}-0.9-0.02\mathrm{sgn}(x)) `` |
| `Erf` | 4 | 4 | 5 | 5 | `` \mathrm{Erf}(x) ``<br>`` f_{bump}(x,y)=(1-\mathrm{Erf}(x^4))(1-\mathrm{Erf}(y^4)) ``<br>`` \begin{cases}\begin{cases}0&x\lt m\\1&\top\end{cases}&s=0\\\frac{1+\mathrm{Erf}(\frac{x-m}{\vert s\vert\times2^{1/2}})}{2}&\top\end{cases}\s … `` |
| `Choose` | 3 | 2 | 5 | 4 | `` B(x)=\mathrm{Choose}(n, x)p^{x}(1-p)^{n-x} ``<br>`` f_{B}(p,n,k)=\mathrm{Choose}(n, k)p^{k}(1-p)^{n-k} ``<br>`` \mathrm{Choose}(N, \lfloor x\rfloor)v^{\lfloor x\rfloor} `` |
| `Sequence` | 0 | 0 | 5 | 5 | `` tcc\| ``<br>`` f\left(x-2,y-2,.\ 5\right)\le1 ``<br>`` \operatorname{triangle}\left((-3.3,1,1.2),(-2,1.9,1.3),(-1.65,1.2,1.2\right)) `` |
| `GCD` | 4 | 4 | 4 | 4 | `` \gcd(\mathrm{round}(dx), \mathrm{round}(dy))\le2 ``<br>`` \rho=\frac{\gcd(\mathrm{round}(\theta\phi), 4)}{2} ``<br>`` r\le\gcd(\mathrm{round}(e\theta), \mathrm{round}(a+\theta)) `` |
| `Unique` | 1 | 1 | 3 | 2 | `` \mathrm{Unique}(P) ``<br>`` U=\mathrm{Unique}(C) ``<br>`` \mathrm{Unique}(C) `` |
| `Variance` | 0 | 0 | 3 | 3 | `` \mathrm{Variance}(\vert x\vert, y, 0)\le1 `` |
| `RotateLeft` | 4 | 3 | 2 | 2 | `` H_1(t)P+H_2(t)\mathrm{RotateLeft}(P, 1)+H_3(t)\mathrm{RotateLeft}(P, 2)+H_4(t)\mathrm{RotateLeft}(P, 3) ``<br>`` n=\mathrm{RotateLeft}(S, 29)+\mathrm{RotateLeft}(S, 30)+\mathrm{RotateLeft}(S, 31)+\mathrm{RotateLeft}(S, -1)+\mathrm{RotateLeft}(S, 1)+\mat … ``<br>`` \mathrm{RotateLeft}(S, N)+\mathrm{RotateLeft}(S, -N)+\mathrm{RotateLeft}(S, N-1)+\mathrm{RotateLeft}(S, N+1)+\mathrm{RotateLeft}(S, -N-1)+\m … `` |
| `Csc` | 3 | 2 | 2 | 2 | `` \frac{\sin(x)}{\csc(y)}\ge\frac{99}{x^2+0.1y^3} ``<br>`` f(x)=e^{\frac{0i\pi}{3}}\sin(\cos(x))+e^{\frac{1i\pi}{3}}\cos(\sin(x))+e^{\frac{2i\pi}{3}}\tan(\cot(x))+e^{\frac{3i\pi}{3}}\cot(\tan(x))+e^{ … ``<br>`` \frac{99}{0.1y^3+x^2}-\frac{\sin(x)}{\csc(y)} `` |
| `Argument` | 2 | 1 | 2 | 2 | `` A_{rg}(p)=\operatorname{PointList}(\arg(\mathrm{PointX}(p)+\mathrm{PointY}(p)i), \arccos(2\mathrm{PointZ}(p)-1)) ``<br>`` k\coloneq(1-M)(x+iy)+Mf(x+iy); c=\operatorname{hsv}(\frac{180}{\pi}\arg(k), \vert k\vert, \vert\frac{1}{100\Re(k)}\vert+\vert\frac{1}{100\Im … ``<br>`` \operatorname{Tuple}(\frac{1}{\pi}\times180\mathrm{PointX}(\operatorname{PointList}(\arg(\imaginaryI\mathrm{PointY}(C_{c})+\mathrm{PointX}(C … `` |
| `Conjugate` | 1 | 1 | 2 | 1 | `` N_2(p)=\begin{cases}\overline{\frac{\mathrm{PointZ}(p)}{\mathrm{PointX}(p)+\mathrm{PointY}(p)i}}&\vert\mathrm{PointX}(p)\vert+\vert\mathrm{P … ``<br>`` \begin{cases}\operatorname{PointList}(\Re(\frac{\begin{cases}\overline{\mathrm{PointZ}(C_{c})/(\imaginaryI\mathrm{PointY}(C_{c})+\mathrm{Poi … `` |
| `ErfInv` | 1 | 1 | 2 | 2 | `` \mathrm{Histogram}(\left[m+\vert s\vert\sqrt{2}\mathrm{ErfInv}(2\max(u, 1.110\,223\,024\,625\,156\,5\cdot10^{-16})-1) \operatorname{for} u = … ``<br>`` \operatorname{PointList}(-\frac{1..200}{10}, 0.01\left[10+\vert2\vert\sqrt{2}\mathrm{ErfInv}(2\max(u, 1.110\,223\,024\,625\,156\,5\cdot10^{- … ``<br>`` \left[m+\sqrt{2}\vert s\vert\mathrm{ErfInv}(2\mathrm{ElementMax}(u, 1.110\,223\,024\,625\,156\,5\cdot10^{-16})-1) \operatorname{for} u = \ma … `` |
| `Filter` | 0 | 0 | 2 | 1 | `` I_0(l,r)=\mathrm{Map}(W\mapsto(1..\mathrm{Length}(l))[W], \mathrm{Filter}(1..\mathrm{Length}(l), W\mapsto l[W]=r[1])) `` |
| `InvisibleOperator` | 0 | 0 | 2 | 2 | `` f\left(x-2,y-2,.\ 5\right)\le1 ``<br>`` \operatorname{triangle}\left((-3.3,1,1.2),(-2,1.9,1.3),(-1.65,1.2,1.2\right)) `` |
| `Measurement` | 0 | 0 | 2 | 1 | `` \pm=\left[1,-1\right] `` |
| `Repeat` | 12 | 1 | 1 | 1 | `` f_{b2full50}(x)=\begin{cases}\operatorname{join}(\mathrm{Repeat}(0, \begin{cases}51&(f_{b2}(x))[1]=0\\50&\top\end{cases}-\mathrm{Length}(f_{ … ``<br>`` \operatorname{join}(\begin{cases}\operatorname{join}(\mathrm{Repeat}(0, \begin{cases}51&(\lfloor\mathrm{PointY}(l_1[t_0])/2^{\lfloor\log_{2} … `` |
| `Cosh` | 3 | 1 | 1 | 1 | `` I=\operatorname{PointList}(\cosh(\mathrm{PointX}(E)), \cosh(\mathrm{PointY}(E))) ``<br>`` \operatorname{PointList}(\cosh(\mathrm{PointX}(E)), \cosh(\mathrm{PointY}(E))) `` |
| `Condition` | 1 | 1 | 1 | 1 | `` z\lt\infty\left\{\lbrace equation\mid1\land0\rbrace=1\right\} ``<br>`` \lbrace\imaginaryI\exponentialE anoqtu\mid1\land0\rbrace=1 `` |
| `Cot` | 1 | 1 | 1 | 1 | `` f(x)=e^{\frac{0i\pi}{3}}\sin(\cos(x))+e^{\frac{1i\pi}{3}}\cos(\sin(x))+e^{\frac{2i\pi}{3}}\tan(\cot(x))+e^{\frac{3i\pi}{3}}\cot(\tan(x))+e^{ … ``<br>`` z\times(1-M)+M\times(\cos(\sin(z))\exp(\frac{1}{3}\imaginaryI\pi)+\tan(\cot(z))\exp(\frac{2}{3}\imaginaryI\pi)+\sec(\csc(z))\exp(\frac{4}{3} … `` |
| `Gamma` | 1 | 1 | 1 | 1 | `` \frac{\Gamma(\frac{1+1}{2})}{\sqrt{1\pi}\Gamma(\frac{1}{2})}(1+\frac{x^2}{1})^{-\frac{1+1}{2}} ``<br>`` \frac{\Gamma(1)}{(x^2+1)\Gamma(\frac{1}{2})\sqrt{\pi}} `` |
| `Mean` | 1 | 1 | 1 | 1 | `` \operatorname{PointList}(4.3, \mathrm{mean}(Y)) ``<br>`` \mathrm{mean}(Y) `` |
| `Ordering` | 1 | 1 | 1 | 1 | `` I=L[\mathrm{Ordering}(L_1)] ``<br>`` L[\mathrm{Ordering}(L_1)] `` |
| `Set` | 1 | 1 | 1 | 1 | `` z\lt\infty\left\{\lbrace equation\mid1\land0\rbrace=1\right\} ``<br>`` \lbrace\imaginaryI\exponentialE anoqtu\mid1\land0\rbrace=1 `` |
| `Sort` | 1 | 1 | 1 | 1 | `` A=\mathrm{Sort}(2\pi\mathrm{WithRandomSeed}(s, \mathrm{RandomChoice}(\lbrack0, 1\rparen, n_0))) ``<br>`` \mathrm{Sort}(2\pi\mathrm{WithRandomSeed}(s, \mathrm{RandomChoice}(\lbrack0, 1\rparen, n_0))) `` |
| `Cross` | 0 | 0 | 1 | 1 | `` F_2(t)=\mathrm{Cross}(F_0(t), F_1(t)) `` |
| `Delimiter` | 0 | 0 | 1 | 1 | `` \operatorname{triangle}\left((-3.3,1,1.2),(-2,1.9,1.3),(-1.65,1.2,1.2\right)) `` |
| `InverseFunction` | 0 | 0 | 1 | 1 | `` A_1(x)=l_1^{-1}(x) `` |
| `Oklab` | 0 | 0 | 1 | 1 | `` c_1=\operatorname{oklab}(\frac{z}{1.4}+0.7, (\frac{0.8}{1+e^{-0.4x}}-0.4), (\frac{0.8}{1+e^{-0.4y}}-0.4)) `` |
| `tone` | 0 | 0 | 1 | 1 | `` \mathrm{tone}(440\times2^{(-3)..4},\frac{3}{b^{0..8}}) `` |
| `ElementMax` | 770 | 34 | 0 | 0 | `` \mathrm{ElementMax}(0, \sqrt{x^2}-1) ``<br>`` \mathrm{ElementMax}(x\bmod1, y\bmod1)-1 ``<br>`` \mathrm{ElementMax}(\vert x+10\vert, \vert y+10\vert)-1 `` |
| `TychoCertificate<n>` | 418 | 38 | 0 | 0 | `` \mathrm{TychoCertificate77}() ``<br>`` \mathrm{TychoCertificate20}(T) ``<br>`` \mathrm{TychoCertificate30}(p) `` |
| `AsOklab` | 136 | 60 | 0 | 0 | `` \operatorname{asOklab}(c) ``<br>`` \operatorname{asOklab}(w) ``<br>`` \operatorname{asOklab}(p) `` |
| `ElementMin` | 131 | 17 | 0 | 0 | `` D_{x}+\frac{1}{d}\mathrm{Map}(Z\mapsto\mathrm{ElementMin}(1, Z), \frac{0.1}{d})(X-X_0)+0.1\sin(200T) ``<br>`` \mathrm{ElementMin}(1.833\,5, 1.833\,5^2-2)\lt y\land y\lt\mathrm{ElementMax}(1.833\,5, 1.833\,5^2-2) ``<br>`` \operatorname{PointList}(\frac{1}{4}s\lfloor\mathrm{ElementMin}(t, 1/s)\rfloor-0.6, \frac{n\times(t\bmod1)}{4}) `` |
| `If` | 34 | 34 | 0 | 0 | `` \mathrm{Declare}(\mathrm{base}, \mathrm{integer}); \mathrm{Assign}(\mathrm{base}, \mathrm{ci}\mathrm{cs}+\mathrm{cj}\mathrm{ct}+\mathrm{ck}+ … `` |
| `ErrorBroadcast` | 18 | 2 | 0 | 0 | `` \mathtip{\error{-0.845\,056\,463\,879\,427\,6}}{\in \text{-0.8450564638794276}\notin \text{dictionary \| indexed\_collection}} ``<br>`` \mathtip{\error{-0.358\,262\,616\,772\,115\,46}}{\in \text{-0.35826261677211546}\notin \text{dictionary \| indexed\_collection}} `` |
| `ErrorFrame` | 18 | 2 | 0 | 0 | `` \mathtip{\error{-0.845\,056\,463\,879\,427\,6}}{\in \text{-0.8450564638794276}\notin \text{dictionary \| indexed\_collection}} ``<br>`` \mathtip{\error{-0.358\,262\,616\,772\,115\,46}}{\in \text{-0.35826261677211546}\notin \text{dictionary \| indexed\_collection}} `` |
| `ErrorTrace` | 18 | 2 | 0 | 0 | `` \mathtip{\error{-0.845\,056\,463\,879\,427\,6}}{\in \text{-0.8450564638794276}\notin \text{dictionary \| indexed\_collection}} ``<br>`` \mathtip{\error{-0.358\,262\,616\,772\,115\,46}}{\in \text{-0.35826261677211546}\notin \text{dictionary \| indexed\_collection}} `` |
| `EvaluateAt` | 3 | 2 | 0 | 0 | `` \frac{\sin(10x)}{1\,500}+\left.\left((\frac{0.000\,037hk^3\mathrm{sech}(hk)^2}{\sqrt{0.000\,074k^3+9.81k}\sqrt{\tanh(hk)}}+\frac{0.000\,110\ … ``<br>`` \frac{1}{2}((l-x_0)^2)\left\{x_0\le l\right\}(\mathrm{ceArg_0}\mapsto\sum_{\mathrm{ceArg_1}=1}^{\mathrm{ceArg_0}}\lambda_0)(I)+((\mathrm{ceA … `` |
| `Sech` | 2 | 1 | 0 | 0 | `` \frac{\sin(10x)}{1\,500}+\left.\left((\frac{0.000\,037hk^3\mathrm{sech}(hk)^2}{\sqrt{0.000\,074k^3+9.81k}\sqrt{\tanh(hk)}}+\frac{0.000\,110\ … `` |
| `BesselJ` | 1 | 1 | 0 | 0 | `` (u\cos(v),u\sin(v),0.6(a_1\cos(2.404\,8T)\operatorname{J}_{0}(2.404\,8u)+a_2\cos(v)\cos(3.831\,7T)\operatorname{J}_{1}(3.831\,7u)+a_3\cos(2v … `` |
| `Julia` | 1 | 1 | 0 | 0 | `` \mathrm{Julia}(x+\imaginaryI y, 0.788\,5(\imaginaryI\sin(a)+\cos(a)), 256) `` |
| `Mandelbrot` | 1 | 1 | 0 | 0 | `` \mathrm{Mandelbrot}(x+\imaginaryI y, 256) `` |

