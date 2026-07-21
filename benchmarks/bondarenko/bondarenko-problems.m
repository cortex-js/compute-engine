(* ::Package:: *)

(* ::Title:: *)
(*Vladimir Bondarenko Integration Problems*)


(* ::Section::Closed:: *)
(*9 June 2010*)


{1/(Sqrt[2] + Sin[z] + Cos[z]), z, 1, -((1 - Sqrt[2]*Sin[z])/(Cos[z] - Sin[z]))}


{1/(Sqrt[1 + x] + Sqrt[1 - x])^2, x, 4, -(1/(2*x)) + Sqrt[1 - x^2]/(2*x) + ArcSin[x]/2}


{1/(1 + Cos[x])^2, x, 2, Sin[x]/(3*(1 + Cos[x])^2) + Sin[x]/(3*(1 + Cos[x]))}
{Sin[x]/Sqrt[1 + x], x, 5, Sqrt[2*Pi]*Cos[1]*FresnelS[Sqrt[2/Pi]*Sqrt[1 + x]] - Sqrt[2*Pi]*FresnelC[Sqrt[2/Pi]*Sqrt[1 + x]]*Sin[1]}
{1/(Cos[x] + Sin[x])^6, x, 3, -((Cos[x] - Sin[x])/(10*(Cos[x] + Sin[x])^5)) - (Cos[x] - Sin[x])/(15*(Cos[x] + Sin[x])^3) + (2*Sin[x])/(15*(Cos[x] + Sin[x]))}


{Log[x^4 + 1/x^4], x, 22, -4*x - Sqrt[2 + Sqrt[2]]*ArcTan[(Sqrt[2 - Sqrt[2]] - 2*x)/Sqrt[2 + Sqrt[2]]] - Sqrt[2 - Sqrt[2]]*ArcTan[(Sqrt[2 + Sqrt[2]] - 2*x)/Sqrt[2 - Sqrt[2]]] + Sqrt[2 + Sqrt[2]]*ArcTan[(Sqrt[2 - Sqrt[2]] + 2*x)/Sqrt[2 + Sqrt[2]]] + Sqrt[2 - Sqrt[2]]*ArcTan[(Sqrt[2 + Sqrt[2]] + 2*x)/Sqrt[2 - Sqrt[2]]] - (1/2)*Sqrt[2 - Sqrt[2]]*Log[1 - Sqrt[2 - Sqrt[2]]*x + x^2] + (1/2)*Sqrt[2 - Sqrt[2]]*Log[1 + Sqrt[2 - Sqrt[2]]*x + x^2] - (1/2)*Sqrt[2 + Sqrt[2]]*Log[1 - Sqrt[2 + Sqrt[2]]*x + x^2] + (1/2)*Sqrt[2 + Sqrt[2]]*Log[1 + Sqrt[2 + Sqrt[2]]*x + x^2] + x*Log[1/x^4 + x^4]}
{Log[1 + x]/(x*Sqrt[1 + Sqrt[1 + x]]), x, -1, -8*ArcTanh[Sqrt[1 + Sqrt[1 + x]]] - (2*Log[1 + x])/Sqrt[1 + Sqrt[1 + x]] - Sqrt[2]*ArcTanh[Sqrt[1 + Sqrt[1 + x]]/Sqrt[2]]*Log[1 + x] + 2*Sqrt[2]*ArcTanh[1/Sqrt[2]]*Log[1 - Sqrt[1 + Sqrt[1 + x]]] - 2*Sqrt[2]*ArcTanh[1/Sqrt[2]]*Log[1 + Sqrt[1 + Sqrt[1 + x]]] + Sqrt[2]*PolyLog[2, -((Sqrt[2]*(1 - Sqrt[1 + Sqrt[1 + x]]))/(2 - Sqrt[2]))] - Sqrt[2]*PolyLog[2, (Sqrt[2]*(1 - Sqrt[1 + Sqrt[1 + x]]))/(2 + Sqrt[2])] - Sqrt[2]*PolyLog[2, -((Sqrt[2]*(1 + Sqrt[1 + Sqrt[1 + x]]))/(2 - Sqrt[2]))] + Sqrt[2]*PolyLog[2, (Sqrt[2]*(1 + Sqrt[1 + Sqrt[1 + x]]))/(2 + Sqrt[2])]}
{Log[1 + x]/x*Sqrt[1 + Sqrt[1 + x]], x, -1, -16*Sqrt[1 + Sqrt[1 + x]] + 16*ArcTanh[Sqrt[1 + Sqrt[1 + x]]] + 4*Sqrt[1 + Sqrt[1 + x]]*Log[1 + x] - 2*Sqrt[2]*ArcTanh[Sqrt[1 + Sqrt[1 + x]]/Sqrt[2]]*Log[1 + x] + 4*Sqrt[2]*ArcTanh[1/Sqrt[2]]*Log[1 - Sqrt[1 + Sqrt[1 + x]]] - 4*Sqrt[2]*ArcTanh[1/Sqrt[2]]*Log[1 + Sqrt[1 + Sqrt[1 + x]]] + 2*Sqrt[2]*PolyLog[2, -((Sqrt[2]*(1 - Sqrt[1 + Sqrt[1 + x]]))/(2 - Sqrt[2]))] - 2*Sqrt[2]*PolyLog[2, (Sqrt[2]*(1 - Sqrt[1 + Sqrt[1 + x]]))/(2 + Sqrt[2])] - 2*Sqrt[2]*PolyLog[2, -((Sqrt[2]*(1 + Sqrt[1 + Sqrt[1 + x]]))/(2 - Sqrt[2]))] + 2*Sqrt[2]*PolyLog[2, (Sqrt[2]*(1 + Sqrt[1 + Sqrt[1 + x]]))/(2 + Sqrt[2])]}


(* ::Section::Closed:: *)
(*4 July 2010*)


{1/(1 + Sqrt[x + Sqrt[1 + x^2]]), x, 4, -(1/(2*(x + Sqrt[1 + x^2]))) + 1/Sqrt[x + Sqrt[1 + x^2]] + Sqrt[x + Sqrt[1 + x^2]] + (1/2)*Log[x + Sqrt[1 + x^2]] - 2*Log[1 + Sqrt[x + Sqrt[1 + x^2]]]}
{Sqrt[1 + x]/(x + Sqrt[1 + Sqrt[1 + x]]), x, 6, 2*Sqrt[1 + x] + (8*ArcTanh[(1 + 2*Sqrt[1 + Sqrt[1 + x]])/Sqrt[5]])/Sqrt[5]}
{1/(x - Sqrt[1 + Sqrt[1 + x]]), x, 5, (2/5)*(5 + Sqrt[5])*Log[1 - Sqrt[5] - 2*Sqrt[1 + Sqrt[1 + x]]] + (2/5)*(5 - Sqrt[5])*Log[1 + Sqrt[5] - 2*Sqrt[1 + Sqrt[1 + x]]]}
{x/(x + Sqrt[1 - Sqrt[1 + x]]), x, 6, 2*Sqrt[1 + x] - 4*Sqrt[1 - Sqrt[1 + x]] + (1 - Sqrt[1 + x])^2 + (8*ArcTanh[(1 + 2*Sqrt[1 - Sqrt[1 + x]])/Sqrt[5]])/Sqrt[5]}
{Sqrt[Sqrt[1 + x] + x]/((1 + x^2)*Sqrt[1 + x]), x, 20, -((I*ArcTan[(2 + Sqrt[1 - I] - (1 - 2*Sqrt[1 - I])*Sqrt[1 + x])/(2*Sqrt[I + Sqrt[1 - I]]*Sqrt[x + Sqrt[1 + x]])])/(2*Sqrt[(1 - I)/(I + Sqrt[1 - I])])) + (I*ArcTan[(2 + Sqrt[1 + I] - (1 - 2*Sqrt[1 + I])*Sqrt[1 + x])/(2*Sqrt[-I + Sqrt[1 + I]]*Sqrt[x + Sqrt[1 + x]])])/(2*Sqrt[-((1 + I)/(I - Sqrt[1 + I]))]) + (I*ArcTanh[(2 - Sqrt[1 - I] - (1 + 2*Sqrt[1 - I])*Sqrt[1 + x])/(2*Sqrt[-I + Sqrt[1 - I]]*Sqrt[x + Sqrt[1 + x]])])/(2*Sqrt[-((1 - I)/(I - Sqrt[1 - I]))]) - (I*ArcTanh[(2 - Sqrt[1 + I] - (1 + 2*Sqrt[1 + I])*Sqrt[1 + x])/(2*Sqrt[I + Sqrt[1 + I]]*Sqrt[x + Sqrt[1 + x]])])/(2*Sqrt[(1 + I)/(I + Sqrt[1 + I])])}
{Sqrt[x + Sqrt[1 + x]]/(1 + x^2), x, 22, (1/2)*I*Sqrt[I + Sqrt[1 - I]]*ArcTan[(2 + Sqrt[1 - I] - (1 - 2*Sqrt[1 - I])*Sqrt[1 + x])/(2*Sqrt[I + Sqrt[1 - I]]*Sqrt[x + Sqrt[1 + x]])] - (1/2)*I*Sqrt[-I + Sqrt[1 + I]]*ArcTan[(2 + Sqrt[1 + I] - (1 - 2*Sqrt[1 + I])*Sqrt[1 + x])/(2*Sqrt[-I + Sqrt[1 + I]]*Sqrt[x + Sqrt[1 + x]])] + (1/2)*I*Sqrt[-I + Sqrt[1 - I]]*ArcTanh[(2 - Sqrt[1 - I] - (1 + 2*Sqrt[1 - I])*Sqrt[1 + x])/(2*Sqrt[-I + Sqrt[1 - I]]*Sqrt[x + Sqrt[1 + x]])] - (1/2)*I*Sqrt[I + Sqrt[1 + I]]*ArcTanh[(2 - Sqrt[1 + I] - (1 + 2*Sqrt[1 + I])*Sqrt[1 + x])/(2*Sqrt[I + Sqrt[1 + I]]*Sqrt[x + Sqrt[1 + x]])]}
{Sqrt[1 + Sqrt[x] + Sqrt[1 + 2*Sqrt[x] + 2*x]], x, 2, (2*Sqrt[1 + Sqrt[x] + Sqrt[1 + 2*Sqrt[x] + 2*x]]*(2 + Sqrt[x] + 6*x^(3/2) - (2 - Sqrt[x])*Sqrt[1 + 2*Sqrt[x] + 2*x]))/(15*Sqrt[x])}
{Sqrt[Sqrt[2] + Sqrt[x] + Sqrt[2 + Sqrt[8]*Sqrt[x] + 2*x]], x, 3, (1/(15*Sqrt[x]))*(2*Sqrt[2]*Sqrt[Sqrt[2] + Sqrt[x] + Sqrt[2]*Sqrt[1 + Sqrt[2]*Sqrt[x] + x]]*(4 + Sqrt[2]*Sqrt[x] + 3*Sqrt[2]*x^(3/2) - Sqrt[2]*(2*Sqrt[2] - Sqrt[x])*Sqrt[1 + Sqrt[2]*Sqrt[x] + x]))}
{Sqrt[x + Sqrt[1 + x]]/x^2, x, 7, -(Sqrt[x + Sqrt[1 + x]]/x) - (1/4)*ArcTan[(3 + Sqrt[1 + x])/(2*Sqrt[x + Sqrt[1 + x]])] + (3/4)*ArcTanh[(1 - 3*Sqrt[1 + x])/(2*Sqrt[x + Sqrt[1 + x]])]}
{Sqrt[1/x + Sqrt[1 + 1/x]], x, 7, Sqrt[Sqrt[1 + 1/x] + 1/x]*x + (1/4)*ArcTan[(3 + Sqrt[1 + 1/x])/(2*Sqrt[Sqrt[1 + 1/x] + 1/x])] - (3/4)*ArcTanh[(1 - 3*Sqrt[1 + 1/x])/(2*Sqrt[Sqrt[1 + 1/x] + 1/x])]}


{Sqrt[1 + Exp[-x]]/(Exp[x] - Exp[-x]), x, 6, (-Sqrt[2])*ArcTanh[Sqrt[1 + E^(-x)]/Sqrt[2]]}
{Sqrt[1 + Exp[-x]]/Sinh[x], x, 7, -2*Sqrt[2]*ArcTanh[Sqrt[1 + E^(-x)]/Sqrt[2]]}


{1/(Cos[x] + Cos[3*x])^5, x, -45, (-(523/256))*ArcTanh[Sin[x]] + (1483*ArcTanh[Sqrt[2]*Sin[x]])/(512*Sqrt[2]) + Sin[x]/(32*(1 - 2*Sin[x]^2)^4) - (17*Sin[x])/(192*(1 - 2*Sin[x]^2)^3) + (203*Sin[x])/(768*(1 - 2*Sin[x]^2)^2) - (437*Sin[x])/(512*(1 - 2*Sin[x]^2)) - (43/256)*Sec[x]*Tan[x] - (1/128)*Sec[x]^3*Tan[x]}
{1/(Cos[x] + Sin[x] + 1)^2, x, 3, -Log[1 + Tan[x/2]] - (Cos[x] - Sin[x])/(1 + Cos[x] + Sin[x])}


{Sqrt[1 + Tanh[4*x]], x, 2, ArcTanh[Sqrt[1 + Tanh[4*x]]/Sqrt[2]]/(2*Sqrt[2])}
{Tanh[x]/Sqrt[Exp[2*x] + Exp[x]], x, -11, (2*Sqrt[E^x + E^(2*x)])/E^x - ArcTan[(I - (1 - 2*I)*E^x)/(2*Sqrt[1 + I]*Sqrt[E^x + E^(2*x)])]/Sqrt[1 + I] + ArcTan[(I + (1 + 2*I)*E^x)/(2*Sqrt[1 - I]*Sqrt[E^x + E^(2*x)])]/Sqrt[1 - I]}
{Sqrt[Sinh[2*x]/Cosh[x]], x, 5, (2*I*Sqrt[2]*EllipticE[Pi/4 - (I*x)/2, 2]*Sqrt[Sinh[x]])/Sqrt[I*Sinh[x]], (2*I*EllipticE[Pi/4 - (I*x)/2, 2]*Sqrt[Sech[x]*Sinh[2*x]])/Sqrt[I*Sinh[x]]}


{Log[x^2 + Sqrt[1 - x^2]], x, -31, -2*x - ArcSin[x] + Sqrt[(1/2)*(1 + Sqrt[5])]*ArcTan[Sqrt[2/(1 + Sqrt[5])]*x] + Sqrt[(1/2)*(1 + Sqrt[5])]*ArcTan[(Sqrt[(1/2)*(1 + Sqrt[5])]*x)/Sqrt[1 - x^2]] + Sqrt[(1/2)*(-1 + Sqrt[5])]*ArcTanh[Sqrt[2/(-1 + Sqrt[5])]*x] - Sqrt[(1/2)*(-1 + Sqrt[5])]*ArcTanh[(Sqrt[(1/2)*(-1 + Sqrt[5])]*x)/Sqrt[1 - x^2]] + x*Log[x^2 + Sqrt[1 - x^2]]}
{Log[1 + Exp[x]]/(1 + Exp[2*x]), x, 12, (-(1/2))*Log[(1/2 - I/2)*(I - E^x)]*Log[1 + E^x] - (1/2)*Log[(-(1/2) - I/2)*(I + E^x)]*Log[1 + E^x] - PolyLog[2, -E^x] - (1/2)*PolyLog[2, (1/2 - I/2)*(1 + E^x)] - (1/2)*PolyLog[2, (1/2 + I/2)*(1 + E^x)]}
{Log[1 + Cosh[x]^2]^2*Cosh[x], x, 13, -8*Sqrt[2]*ArcTan[Sinh[x]/Sqrt[2]] + 4*I*Sqrt[2]*ArcTan[Sinh[x]/Sqrt[2]]^2 + 8*Sqrt[2]*ArcTan[Sinh[x]/Sqrt[2]]*Log[(2*Sqrt[2])/(Sqrt[2] + I*Sinh[x])] + 4*Sqrt[2]*ArcTan[Sinh[x]/Sqrt[2]]*Log[2 + Sinh[x]^2] + 4*I*Sqrt[2]*PolyLog[2, 1 - (2*Sqrt[2])/(Sqrt[2] + I*Sinh[x])] + 8*Sinh[x] - 4*Log[2 + Sinh[x]^2]*Sinh[x] + Log[2 + Sinh[x]^2]^2*Sinh[x]}
{Log[Sinh[x] + Cosh[x]^2]^2*Cosh[x], x, 28, -4*Sqrt[3]*ArcTan[(1 + 2*Sinh[x])/Sqrt[3]] - (1/2)*(1 - I*Sqrt[3])*Log[1 - I*Sqrt[3] + 2*Sinh[x]]^2 - (1 + I*Sqrt[3])*Log[(I*(1 - I*Sqrt[3] + 2*Sinh[x]))/(2*Sqrt[3])]*Log[1 + I*Sqrt[3] + 2*Sinh[x]] - (1/2)*(1 + I*Sqrt[3])*Log[1 + I*Sqrt[3] + 2*Sinh[x]]^2 - (1 - I*Sqrt[3])*Log[1 - I*Sqrt[3] + 2*Sinh[x]]*Log[-((I*(1 + I*Sqrt[3] + 2*Sinh[x]))/(2*Sqrt[3]))] - 2*Log[1 + Sinh[x] + Sinh[x]^2] + (1 - I*Sqrt[3])*Log[1 - I*Sqrt[3] + 2*Sinh[x]]*Log[1 + Sinh[x] + Sinh[x]^2] + (1 + I*Sqrt[3])*Log[1 + I*Sqrt[3] + 2*Sinh[x]]*Log[1 + Sinh[x] + Sinh[x]^2] - (1 + I*Sqrt[3])*PolyLog[2, -((I - Sqrt[3] + 2*I*Sinh[x])/(2*Sqrt[3]))] - (1 - I*Sqrt[3])*PolyLog[2, (I + Sqrt[3] + 2*I*Sinh[x])/(2*Sqrt[3])] + 8*Sinh[x] - 4*Log[1 + Sinh[x] + Sinh[x]^2]*Sinh[x] + Log[1 + Sinh[x] + Sinh[x]^2]^2*Sinh[x]}
{Log[x + Sqrt[1 + x]]/(1 + x^2), x, 44, (1/2)*I*Log[Sqrt[1 - I] - Sqrt[1 + x]]*Log[x + Sqrt[1 + x]] - (1/2)*I*Log[Sqrt[1 + I] - Sqrt[1 + x]]*Log[x + Sqrt[1 + x]] + (1/2)*I*Log[Sqrt[1 - I] + Sqrt[1 + x]]*Log[x + Sqrt[1 + x]] - (1/2)*I*Log[Sqrt[1 + I] + Sqrt[1 + x]]*Log[x + Sqrt[1 + x]] - (1/2)*I*Log[Sqrt[1 - I] + Sqrt[1 + x]]*Log[(1 - Sqrt[5] + 2*Sqrt[1 + x])/(1 - 2*Sqrt[1 - I] - Sqrt[5])] - (1/2)*I*Log[Sqrt[1 - I] - Sqrt[1 + x]]*Log[(1 - Sqrt[5] + 2*Sqrt[1 + x])/(1 + 2*Sqrt[1 - I] - Sqrt[5])] + (1/2)*I*Log[Sqrt[1 + I] + Sqrt[1 + x]]*Log[(1 - Sqrt[5] + 2*Sqrt[1 + x])/(1 - 2*Sqrt[1 + I] - Sqrt[5])] + (1/2)*I*Log[Sqrt[1 + I] - Sqrt[1 + x]]*Log[(1 - Sqrt[5] + 2*Sqrt[1 + x])/(1 + 2*Sqrt[1 + I] - Sqrt[5])] - (1/2)*I*Log[Sqrt[1 - I] + Sqrt[1 + x]]*Log[(1 + Sqrt[5] + 2*Sqrt[1 + x])/(1 - 2*Sqrt[1 - I] + Sqrt[5])] - (1/2)*I*Log[Sqrt[1 - I] - Sqrt[1 + x]]*Log[(1 + Sqrt[5] + 2*Sqrt[1 + x])/(1 + 2*Sqrt[1 - I] + Sqrt[5])] + (1/2)*I*Log[Sqrt[1 + I] + Sqrt[1 + x]]*Log[(1 + Sqrt[5] + 2*Sqrt[1 + x])/(1 - 2*Sqrt[1 + I] + Sqrt[5])] + (1/2)*I*Log[Sqrt[1 + I] - Sqrt[1 + x]]*Log[(1 + Sqrt[5] + 2*Sqrt[1 + x])/(1 + 2*Sqrt[1 + I] + Sqrt[5])] - (1/2)*I*PolyLog[2, (2*(Sqrt[1 - I] - Sqrt[1 + x]))/(1 + 2*Sqrt[1 - I] - Sqrt[5])] - (1/2)*I*PolyLog[2, (2*(Sqrt[1 - I] - Sqrt[1 + x]))/(1 + 2*Sqrt[1 - I] + Sqrt[5])] + (1/2)*I*PolyLog[2, (2*(Sqrt[1 + I] - Sqrt[1 + x]))/(1 + 2*Sqrt[1 + I] - Sqrt[5])] + (1/2)*I*PolyLog[2, (2*(Sqrt[1 + I] - Sqrt[1 + x]))/(1 + 2*Sqrt[1 + I] + Sqrt[5])] - (1/2)*I*PolyLog[2, -((2*(Sqrt[1 - I] + Sqrt[1 + x]))/(1 - 2*Sqrt[1 - I] - Sqrt[5]))] - (1/2)*I*PolyLog[2, -((2*(Sqrt[1 - I] + Sqrt[1 + x]))/(1 - 2*Sqrt[1 - I] + Sqrt[5]))] + (1/2)*I*PolyLog[2, -((2*(Sqrt[1 + I] + Sqrt[1 + x]))/(1 - 2*Sqrt[1 + I] - Sqrt[5]))] + (1/2)*I*PolyLog[2, -((2*(Sqrt[1 + I] + Sqrt[1 + x]))/(1 - 2*Sqrt[1 + I] + Sqrt[5]))]}
{Log[x + Sqrt[1 + x]]^2/(1 + x)^2, x, 35, Log[1 + x] + (2*Log[x + Sqrt[1 + x]])/Sqrt[1 + x] - 6*Log[Sqrt[1 + x]]*Log[x + Sqrt[1 + x]] - Log[x + Sqrt[1 + x]]^2/(1 + x) - (1 + Sqrt[5])*Log[1 - Sqrt[5] + 2*Sqrt[1 + x]] + 6*Log[(1/2)*(-1 + Sqrt[5])]*Log[1 - Sqrt[5] + 2*Sqrt[1 + x]] + (3 + Sqrt[5])*Log[x + Sqrt[1 + x]]*Log[1 - Sqrt[5] + 2*Sqrt[1 + x]] - (1/2)*(3 + Sqrt[5])*Log[1 - Sqrt[5] + 2*Sqrt[1 + x]]^2 - (1 - Sqrt[5])*Log[1 + Sqrt[5] + 2*Sqrt[1 + x]] + (3 - Sqrt[5])*Log[x + Sqrt[1 + x]]*Log[1 + Sqrt[5] + 2*Sqrt[1 + x]] - (3 - Sqrt[5])*Log[-((1 - Sqrt[5] + 2*Sqrt[1 + x])/(2*Sqrt[5]))]*Log[1 + Sqrt[5] + 2*Sqrt[1 + x]] - (1/2)*(3 - Sqrt[5])*Log[1 + Sqrt[5] + 2*Sqrt[1 + x]]^2 - (3 + Sqrt[5])*Log[1 - Sqrt[5] + 2*Sqrt[1 + x]]*Log[(1 + Sqrt[5] + 2*Sqrt[1 + x])/(2*Sqrt[5])] + 6*Log[Sqrt[1 + x]]*Log[1 + (2*Sqrt[1 + x])/(1 + Sqrt[5])] + 6*PolyLog[2, -((2*Sqrt[1 + x])/(1 + Sqrt[5]))] - (3 + Sqrt[5])*PolyLog[2, -((1 - Sqrt[5] + 2*Sqrt[1 + x])/(2*Sqrt[5]))] - (3 - Sqrt[5])*PolyLog[2, (1 + Sqrt[5] + 2*Sqrt[1 + x])/(2*Sqrt[5])] - 6*PolyLog[2, 1 + (2*Sqrt[1 + x])/(1 - Sqrt[5])]}
{Log[x + Sqrt[1 + x]]/x, x, 21, Log[-1 + Sqrt[1 + x]]*Log[x + Sqrt[1 + x]] + Log[1 + Sqrt[1 + x]]*Log[x + Sqrt[1 + x]] - Log[-1 + Sqrt[1 + x]]*Log[(1 - Sqrt[5] + 2*Sqrt[1 + x])/(3 - Sqrt[5])] - Log[1 + Sqrt[1 + x]]*Log[-((1 - Sqrt[5] + 2*Sqrt[1 + x])/(1 + Sqrt[5]))] - Log[1 + Sqrt[1 + x]]*Log[-((1 + Sqrt[5] + 2*Sqrt[1 + x])/(1 - Sqrt[5]))] - Log[-1 + Sqrt[1 + x]]*Log[(1 + Sqrt[5] + 2*Sqrt[1 + x])/(3 + Sqrt[5])] - PolyLog[2, (2*(1 - Sqrt[1 + x]))/(3 - Sqrt[5])] - PolyLog[2, (2*(1 - Sqrt[1 + x]))/(3 + Sqrt[5])] - PolyLog[2, (2*(1 + Sqrt[1 + x]))/(1 - Sqrt[5])] - PolyLog[2, (2*(1 + Sqrt[1 + x]))/(1 + Sqrt[5])]}


{ArcTan[2*Tan[x]], x, 7, x*ArcTan[2*Tan[x]] + (1/2)*I*x*Log[1 - 3*E^(2*I*x)] - (1/2)*I*x*Log[1 - (1/3)*E^(2*I*x)] - (1/4)*PolyLog[2, (1/3)*E^(2*I*x)] + (1/4)*PolyLog[2, 3*E^(2*I*x)]}
{ArcTan[x]*Log[x]/x, x, 5, (1/2)*I*Log[x]*PolyLog[2, (-I)*x] - (1/2)*I*Log[x]*PolyLog[2, I*x] - (1/2)*I*PolyLog[3, (-I)*x] + (1/2)*I*PolyLog[3, I*x]}


(* Note: Mathematica is unable to differentiate result back to integrand! *) 
{ArcTan[x]^2*Sqrt[1 + x^2], x, 10, ArcSinh[x] - Sqrt[1 + x^2]*ArcTan[x] + (1/2)*x*Sqrt[1 + x^2]*ArcTan[x]^2 - I*ArcTan[E^(I*ArcTan[x])]*ArcTan[x]^2 + I*ArcTan[x]*PolyLog[2, (-I)*E^(I*ArcTan[x])] - I*ArcTan[x]*PolyLog[2, I*E^(I*ArcTan[x])] - PolyLog[3, (-I)*E^(I*ArcTan[x])] + PolyLog[3, I*E^(I*ArcTan[x])]}
