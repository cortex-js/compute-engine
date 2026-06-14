(* Extracted from https://math.unm.edu/~wester/demos/Programming/Math.dif
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Programming and Miscellaneous ---------- *)

(* Define a simple differentiation operator.  This is most easily 
done with
   pattern matching.  Here is an expression that we ultimately hope to be 
able
   to differentiate. *)

expr = a + b*u + c*u^2 + d*(e*u + f)^3 + g*u*Exp[h*u]

(* Start by making the derivative of a sum to be the sum of the 
derivatives. *)

dif[y_ + z_, x_] := dif[y, x] + dif[z, x]

(* Add the product rule. *)

dif[y_ * z_, x_] := dif[y, x]*z + y*dif[z, x]

(* Now, make the derivative of a constant (with respect to x) zero. 
*)

dif[a_, x_] := 0 /; FreeQ[a, x]

(* Define the derivative of x with respect to x to be one. *)

dif[x_, x_] := 1

(* Enter the generalized power rule. *)

dif[w_^n_, x_] := n*w^(n - 1)*dif[w, x] /; ! FreeQ[w, x]

(* To get that last term, add in the exponential rule. *)

dif[Exp[n_], x_] := Exp[n]*dif[n, x]

(* Now, try it out! => b + 2 c u + 3 d e (e u + f)^2 + g exp(h u) (1 
+ h u) *)

dif[expr, u]

Clear[dif]

(* Do the same sort of thing, but using a rule set. *)

difrules = {dif[y_ + z_, x_] -> dif[y, x] + dif[z, x],
            dif[y_ * z_, x_] -> dif[y, x]*z + y*dif[z, x],
            dif[a_ , x_] /; FreeQ[a, x] -> 0,
            dif[x_, x_] -> 1,
            dif[w_^n_, x_] /; ! FreeQ[w, x] -> n*w^(n - 1)*dif[w, x],
            dif[Exp[n_], x_] -> Exp[n]*dif[n, x]}

dif[expr, u] //. difrules

(* ---------- Quit ---------- *)
