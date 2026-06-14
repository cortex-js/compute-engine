(* Extracted from https://math.unm.edu/~wester/demos/PDEs/Math.heat
   Source index: https://math.unm.edu/~wester/cas_review.html *)

(* ----------[ M a t h e m a t i c a ]---------- *)

(* ---------- Initialization ---------- *)

(* ---------- Partial Differential Equations ---------- *)

(* This is the heat equation *)

heat = D[u[x, t], t] - D[u[x, t], {x, 2}] == 0

(* This is the similarity form of the proposed solution *)

s = f[x/Sqrt[t]]/Sqrt[t]

(* Substitute s into the heat equation *)

heat /. u -> Apply[Function, {{x, t}, s}]

( (* Change to the similarity variable z = x/sqrt(t) *)
% /. x -> z*Sqrt[t] )

( (* Combine over a common denominator *)
Map[Together, %] )

( (* Eliminate the denominator *)
%[[1]] * Denominator[%[[1]]] == 0 )

( (* Now, solve the ordinary differential equation *)
sol = DSolve[%, f[z], z] )

(* Finally, transform back to the original variables *)

Clear[s]

s -> sol[[1,1,2]]/Sqrt[t] /. z -> x/Sqrt[t]

( (* If we set C[1] = 1/(2 sqrt(pi)) and C[2] = 0 in the previous 
expression,
     we will obtain the usual fundamental solution of the heat equation *)
% /. {C[1] -> 1/(2*Sqrt[Pi]), C[2] -> 0} )

(* ---------- Quit ---------- *)
