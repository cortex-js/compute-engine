(* Extracted from https://math.unm.edu/~wester/demos/Programming/Math.problems
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Programming and Miscellaneous ---------- *)

(* How easy is it to substitute x for a + b in the following 
expression?
   => (x + c)^2 + (d - x)^2 *)

expr = (a + b + c)^2 + (d - a - b)^2

expr /. a + b -> x

expr /. b -> x - a

Clear[expr]

(* How easy is it to substitute r for sqrt(x^2 + y^2) in the 
following
   expression? => x/r *)

x/Sqrt[x^2 + y^2]

% /. Sqrt[x^2 + y^2] -> r

1/(1/% /. Sqrt[x^2 + y^2] -> r)

(* Change variables so that the following transcendental expression 
is
   converted into a rational expression   [Vernor Vinge]
   => (r - 1)^4 (u^4 - r u^3 - r^3 u + r u + r^4)/[u^4 (2 r - 1)^2] *)

q = (1/r^4 + 1/(r^2 - 2*r*Cos[t] + 1)^2
           - 2*(r - Cos[t])/(r^2 * (r^2 - 2*r*Cos[t] + 1)^(3/2))) /
    (1/r^4 + 1/(r - 1)^4 - 2*(r - 1)/(r^2 * (r^2 - 2*r + 1)^(3/2)))

q /. {r^2 - 2*r*Cos[t] + 1 -> u^2, Cos[t] -> (r^2 - u^2 + 1)/(2*r)}

Factor[PowerExpand[Simplify[%]]]

(* Establish a rule to symmetrize a differential operator:   [Stanly 
Steinberg]
   f g'' + f' g' -> (f g')' *)

symmetrize = f_[x_]*D[g_[x_], {x_, 2}] + D[f_[x_], x_]*D[g_[x_], x_] 
->
             HoldForm[D[f[x]*D[g[x], x], x]]

q = f[x]*D[g[x], {x, 2}] + D[f[x], x]*D[g[x], x]

q //. symmetrize

(* => 2 (f g')' + f g *)

2*q + f[x]*g[x] //. symmetrize

Clear[q]

(* Infinite lists: [1 2 3 4 5 ...] * [1 3 5 7 9 ...]
   => [1 6 15 28 45 66 91 ...] *)

l1 = {1, 2, 3, 4, 5};

l2 = {1, 3, 5, 7, 9};

l1 * l2

Clear[l1, l2]

(* Write a simple program to compute Legendre polynomials *)

p[n_Integer /; n >= 0, x_]:= Simplify[1/(2^n*n!) * D[(x^2 - 1)^n, 
{x, n}]]

(* p[0](x) = 1,   p[1](x) = x,   p[2](x) = (3 x^2 - 1)/2,
   p[3](x) = (5 x^3 - 3 x)/2,   p[4](x) = (35 x^4 - 30 x^2 + 3)/8 *)

Do[Print[StringForm["p[``, x] = ``", i, p[i, x]]], {i, 0, 4}]
p[0, x] = 1
p[1, x] = x
                  2
          -1 + 3 x
p[2, x] = ---------
              2
                     2
          x (-3 + 5 x )
p[3, x] = -------------
                2
                  2       4
          3 - 30 x  + 35 x
p[4, x] = -----------------
                  8

(* p[4](1) = 1 *)

p[4, x] /. x -> 1

p[n_Integer /; n >= 0, x_]:= Simplify[1/(2^n*n!) * D[(y^2 - 1)^n, 
{y, n}]] /.
                             y -> x

Do[Print[StringForm["p[``, x] = ``", i, p[i, x]]], {i, 0, 4}]
p[0, x] = 1
p[1, x] = x
                  2
          -1 + 3 x
p[2, x] = ---------
              2
                     2
          x (-3 + 5 x )
p[3, x] = -------------
                2
                  2       4
          3 - 30 x  + 35 x
p[4, x] = -----------------
                  8

p[4, 1]

(* Now, perform the same computation using a recursive definition *)

pp[0, x_] = 1;

pp[1, x_] = x;

pp[n_Integer /; n >= 0, x_]:= pp[n, x] =
   ((2*n - 1)*x*pp[n - 1, x] - (n - 1)*pp[n - 2, x])/n

Do[Print[StringForm["pp[``, x] = ``", i, Simplify[pp[i, x]]]], {i, 
0, 4}]
pp[0, x] = 1
pp[1, x] = x
                   2
           -1 + 3 x
pp[2, x] = ---------
               2
                      2
           x (-3 + 5 x )
pp[3, x] = -------------
                 2
                   2       4
           3 - 30 x  + 35 x
pp[4, x] = -----------------
                   8

pp[4, 1]

Clear[p. pp]

(* Iterative computation of Fibonacci numbers *)

myfib[n_]:= Module[{i, j, k, f},
            If[n < 0,
               Return["undefined"],
               If[n < 2,
                  n,
                  j = 0;   k = 1;
                  Do[f = j + k;   j = k;   k = f,
                     {i, 2, n}];
                  f]]];

(* Convert the function into FORTRAN syntax *)

FortranForm[myfib[n]]

(* Create a list of the first 11 values of the function. *)

Table[myfib[i], {i, 0, 10}]

Clear[myfib]

(* Define the function p(x) = x^2 - 4 x + 7 such that p(lambda) = 0 
for
   lambda = 2 +- i sqrt(3) and p(A) = [[0 0], [0 0]] for A = [[1 -2], [2 3]]
   (the lambda are the eigenvalues and p(x) is the characteristic polynomial 
of
   A)   [Johnson and Reiss, p. 184] *)

p[x_]:= x^2 - 4*x + 7

Simplify[p[2 + I*Sqrt[3]]]

p[{{1, -2}, {2, 3}}]

Clear[p]

(* Define a function to be the result of a calculation *)

( -Log[x^2 - 2^(1/3)*x + 2^(2/3)]/(6 * 2^(2/3))
   + ArcTan[(2*x - 2^(1/3))/(2^(1/3) * Sqrt[3])] / (2^(2/3) * Sqrt[3])
   + Log[x + 2^(1/3)]/(3 * 2^(2/3)) )

f[x_] = %

expr = f[y]

(* Display the top-level structure of a nasty expression, hiding the
   lower-level details. *)

TreeForm[expr]

Short[expr, 1]

{Head[expr], Length[expr]}

Map[{Head[#], Length[#]} &, Level[expr, 1]]

Map[{Head[#], Length[#]} &, Level[expr, 2]]

Clear[expr, f]

(* Convert the following expression into TeX or LaTeX *)

y == Sqrt[(Exp[x^2] + Exp[-x^2])/(Sqrt[3]*x - Sqrt[2])]

% // TeXForm

(* ---------- Quit ---------- *)
