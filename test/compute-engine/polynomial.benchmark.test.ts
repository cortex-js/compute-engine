import { engine } from '../utils.ts';

describe.skip(`POLYNOMIALS`, () => {
  //     #numbers (integers, floats, operators +-*/,)
  test(`3x^2 -2x + 1`, () =>
    expect(engine.parse('3x^2 -2x + 1').canonical).toMatchInlineSnapshot());
});

// # alea6
// # large coefficients, easy images
// var := [a,b,c,d,k,m]:
// sys := [5*a^2*d+37*b*d*k+32*b*d*m+21*d*m+55*k*m,
// 39*a*b*m+23*b^2*k+57*b*c*k+56*b*k^2+10*c^2+52*d*k*m,
// 33*a^2*d+51*a^2+42*a*d*m+51*b^2*k+32*b*d^2+m^3,
// 44*a*d^2+42*b*d+47*b*k^2+12*c*d+2*c*k*m+43*d*k^2,
// 49*a^2*c+11*a*b*c+39*a*d*k+44*a*d*k+54*a*d+45*b^2*k,
// 48*a*c*d+2*c^2*d+59*c^2*m+17*c+36*d^3+45*k]:

// # bayes148
// # sparse with many monomial divisions
// var := [b, c, d, k, m, n, q, r, s, t, u, v, b3, b4, b5, b6, b7, b8, b9, c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, d0, d1, d2]:
// sys := [-c3*d2+c4*d1, -c2*d2+c4*d0, -c2*d1+c3*d0, -c1*d2+c4*c9, -c1*d1+c3*c9, -c1*d0+c2*c9, -v*d2+b6*c8,  -b9*c8+c0*c7,
// -u*d1+b5*c7, -b8*c8+c0*c6, -b8*c7+b9*c6, -t*d0+b4*c6, -b7*c8+c0*c5, -b7*c7+b9*c5, -b7*c6+b8*c5, -s*c9+b3*c5, c0*r-c4*k,
// -b7*c0-b7*c4-2*b7*c8-b7*d2+b8*b9+b8*c3+2*b8*c7+b8*d1+b9*c2+b9*d0-c0*c1-c0*c9-c1*c4-c1*c8-2*c1*d2+c2*c3+c2*c7+2*c2*d1+c3*c6-c4*c5-c5*c8-c5*d2+c6*c7+c6*d1+c7*d0-c8*c9-c9*d2+d0*d1,
// b9*q-c3*d, b8*n-c*c2, -b*c1+b7*m]:

// # cyclic7
// # all-around challenge
// var := [a,b,c,d,k,m,n]:
// sys := [a+b+c+d+k+m+n,
// a*b+a*n+b*c+c*d+d*k+k*m+m*n,
// a*b*c+a*b*n+a*m*n+b*c*d+c*d*k+d*k*m+k*m*n,
// a*b*c*d+a*b*c*n+a*b*m*n+a*k*m*n+b*c*d*k+c*d*k*m+d*k*m*n,
// a*b*c*d*k+a*b*c*d*n+a*b*c*m*n+a*b*k*m*n+a*d*k*m*n+b*c*d*k*m+c*d*k*m*n,
// a*b*c*d*k*m+a*b*c*d*k*n+a*b*c*d*m*n+a*b*c*k*m*n+a*b*d*k*m*n+a*c*d*k*m*n+b*c*d*k*m*n,
// a*b*c*d*k*m*n-1]:

// # cyclic8
// # all-around challenge
// var := [a,b,c,d,k,m,n,q]:
// sys := [a+b+c+d+k+m+n+q,
// a*b+a*q+b*c+c*d+d*k+k*m+m*n+n*q,
// a*b*c+a*b*q+a*n*q+b*c*d+c*d*k+d*k*m+k*m*n+m*n*q,
// a*b*c*d+a*b*c*q+a*b*n*q+a*m*n*q+b*c*d*k+c*d*k*m+d*k*m*n+k*m*n*q,
// a*b*c*d*k+a*b*c*d*q+a*b*c*n*q+a*b*m*n*q+a*k*m*n*q+b*c*d*k*m+c*d*k*m*n+d*k*m*n*q,
// a*b*c*d*k*m+a*b*c*d*k*q+a*b*c*d*n*q+a*b*c*m*n*q+a*b*k*m*n*q+a*d*k*m*n*q+b*c*d*k*m*n+c*d*k*m*n*q,
// a*b*c*d*k*m*n+a*b*c*d*k*m*q+a*b*c*d*k*n*q+a*b*c*d*m*n*q+a*b*c*k*m*n*q+a*b*d*k*m*n*q+a*c*d*k*m*n*q+b*c*d*k*m*n*q,
// a*b*c*d*k*m*n*q-1]:

// # cyclic9
// # all-around challenge
// var := [a,b,c,d,k,m,n,q,r]:
// sys := [a+b+c+d+k+m+n+q+r,
// a*b+a*r+b*c+c*d+d*k+k*m+m*n+n*q+q*r,
// a*b*c+a*b*r+a*q*r+b*c*d+c*d*k+d*k*m+k*m*n+m*n*q+n*q*r,
// a*b*c*d+a*b*c*r+a*b*q*r+a*n*q*r+b*c*d*k+c*d*k*m+d*k*m*n+k*m*n*q+m*n*q*r,
// a*b*c*d*k+a*b*c*d*r+a*b*c*q*r+a*b*n*q*r+a*m*n*q*r+b*c*d*k*m+c*d*k*m*n+d*k*m*n*q+k*m*n*q*r,
// a*b*c*d*k*m+a*b*c*d*k*r+a*b*c*d*q*r+a*b*c*n*q*r+a*b*m*n*q*r+a*k*m*n*q*r+b*c*d*k*m*n+c*d*k*m*n*q+d*k*m*n*q*r,
// a*b*c*d*k*m*n+a*b*c*d*k*m*r+a*b*c*d*k*q*r+a*b*c*d*n*q*r+a*b*c*m*n*q*r+a*b*k*m*n*q*r+a*d*k*m*n*q*r+b*c*d*k*m*n*q+c*d*k*m*n*q*r,
// a*b*c*d*k*m*n*q+a*b*c*d*k*m*n*r+a*b*c*d*k*m*q*r+a*b*c*d*k*n*q*r+a*b*c*d*m*n*q*r+a*b*c*k*m*n*q*r+a*b*d*k*m*n*q*r+a*c*d*k*m*n*q*r+b*c*d*k*m*n*q*r,
// a*b*c*d*k*m*n*q*r-1]:

// # eco12
// # dense with modest coefficients
// var := [b,c,d,k,m,n,q,r,s,t,u,v]:
// sys := [
// b*v*c + b*v + t*u*v + t*v*s + v*c*d + v*d*k + v* k*m + v*m*n + v*n*q + v*q*r + v*r*s - 1,
// b*v*d + t*v*r + u*v*s + v*c*k + v*c + v*d*m + v* k*n + v*m*q + v*n*r + v*q*s - 2,
// b*v*k + t*v*q + u*v*r + v*c*m + v*d*n + v*d + v* k*q + v*m*r + v*n*s - 3,
// b*v*m + t*v*n + u*v*q + v*c*n + v*d*q + v*k*r + v*k + v*m*s - 4,
// b*v*n + t*v*m + u*v*n + v*c*q + v*d*r + v*k*s + v*m - 5,
// b*v*q + t*v*k + u*v*m + v*c*r + v*d*s + v*n - 6,
// b*v*r + t*v*d + u*v*k + v*c*s + v*q - 7,
// b*v*s + t*v*c + u*v*d + v*r - 8,
// b*t*v + u*v*c + v*s - 9,
// b*u*v + t*v - 10,
// u*v - 11,
// b + t + u + c + d + k + m + n + q + r + s + 1
// ]:

// # gametwo7
// # dense linear algebra
// var := [p1,p2,p3,p4,p5,p6,p7]:
// sys := [
// 3821*p2*p3*p4*p5*p6*p7-7730*p2*p3*p4*p5*p6-164*p2*p3*p4*p5*p7-2536*p2*p3*p4*p6*p7-4321*p2*p3*p5*p6*p7-2161*p2*p4*p5*p6*p7-2188*p3*p4*p5*p6*p7-486*p2*p3*p4*p5+3491*p2*p3*p4*p6+4247*p2*p3*p5*p6+3528*p2*p4*p5*p6+2616*p3*p4*p5*p6-101*p2*p3*p4*p7+1765*p2*p3*p5*p7+258*p2*p4*p5*p7-378*p3*p4*p5*p7+1246*p2*p3*p6*p7+2320*p2*p4*p6*p7+1776*p3*p4*p6*p7+1715*p2*p5*p6*p7+728*p3*p5*p6*p7+842*p4*p5*p6*p7+69*p2*p3*p4-1660*p2*p3*p5+1863*p2*p4*p5+1520*p3*p4*p5-245*p2*p3*p6-804*p2*p4*p6-2552*p3*p4*p6-3152*p2*p5*p6+40*p3*p5*p6-1213*p4*p5*p6+270*p2*p3*p7-851*p2*p4*p7+327*p3*p4*p7-1151*p2*p5*p7+1035*p3*p5*p7-161*p4*p5*p7-230*p2*p6*p7-294*p3*p6*p7-973*p4*p6*p7-264*p5*p6*p7+874*p2*p3-2212*p2*p4+168*p3*p4+511*p2*p5-918*p3*p5-2017*p4*p5-76*p2*p6+465*p3*p6+1629*p4*p6+856*p5*p6-54*p2*p7-1355*p3*p7+227*p4*p7+77*p5*p7-220*p6*p7-696*p2+458*p3+486*p4+661*p5-650*p6+671*p7-439,
// -6157*p1*p3*p4*p5*p6*p7+13318*p1*p3*p4*p5*p6+5928*p1*p3*p4*p5*p7+1904*p1*p3*p4*p6*p7+2109*p1*p3*p5*p6*p7+8475*p1*p4*p5*p6*p7+2878*p3*p4*p5*p6*p7-8339*p1*p3*p4*p5-2800*p1*p3*p4*p6-9649*p1*p3*p5*p6-10964*p1*p4*p5*p6-4481*p3*p4*p5*p6+251*p1*p3*p4*p7-4245*p1*p3*p5*p7-7707*p1*p4*p5*p7-2448*p3*p4*p5*p7+1057*p1*p3*p6*p7-3605*p1*p4*p6*p7+546*p3*p4*p6*p7-3633*p1*p5*p6*p7-699*p3*p5*p6*p7-4126*p4*p5*p6*p7-730*p1*p3*p4+5519*p1*p3*p5+8168*p1*p4*p5+4366*p3*p4*p5+2847*p1*p3*p6+2058*p1*p4*p6-1416*p3*p4*p6+8004*p1*p5*p6+4740*p3*p5*p6+5361*p4*p5*p6-677*p1*p3*p7+1755*p1*p4*p7-760*p3*p4*p7+3384*p1*p5*p7+2038*p3*p5*p7+4119*p4*p5*p7+812*p1*p6*p7+11*p3*p6*p7+2022*p4*p6*p7+2642*p5*p6*p7+1276*p1*p3-1723*p1*p4+121*p3*p4-6456*p1*p5-3710*p3*p5-4525*p4*p5-2187*p1*p6-1559*p3*p6-848*p4*p6-4041*p5*p6-83*p1*p7-12*p3*p7-1180*p4*p7-2747*p5*p7-1970*p6*p7+2575*p1-161*p3+2149*p4+4294*p5+1687*p6+958*p7-1950,
// 182*p1*p2*p4*p5*p6*p7-2824*p1*p2*p4*p5*p6-3513*p1*p2*p4*p5*p7-3386*p1*p2*p4*p6*p7-2330*p1*p2*p5*p6*p7-2838*p1*p4*p5*p6*p7+1294*p2*p4*p5*p6*p7+4764*p1*p2*p4*p5+1647*p1*p2*p4*p6+4221*p1*p2*p5*p6+814*p1*p4*p5*p6+2738*p2*p4*p5*p6+4057*p1*p2*p4*p7+2403*p1*p2*p5*p7+2552*p1*p4*p5*p7+471*p2*p4*p5*p7+448*p1*p2*p6*p7+2336*p1*p4*p6*p7+1617*p2*p4*p6*p7+2220*p1*p5*p6*p7-1543*p2*p5*p6*p7+402*p4*p5*p6*p7-5184*p1*p2*p4-3983*p1*p2*p5+44*p1*p4*p5-1327*p2*p4*p5-581*p1*p2*p6-389*p1*p4*p6-2722*p2*p4*p6+443*p1*p5*p6-2893*p2*p5*p6-154*p4*p5*p6-1277*p1*p2*p7-2018*p1*p4*p7-509*p2*p4*p7-1254*p1*p5*p7+602*p2*p5*p7-464*p4*p5*p7-647*p1*p6*p7+922*p2*p6*p7-1463*p4*p6*p7+729*p5*p6*p7+2665*p1*p2+591*p1*p4+981*p2*p4-444*p1*p5+1818*p2*p5-1985*p4*p5-1818*p1*p6+197*p2*p6+1038*p4*p6+340*p5*p6+399*p1*p7-835*p2*p7+787*p4*p7-753*p5*p7-221*p6*p7+481*p1+260*p2+1713*p4+1219*p5+794*p6+762*p7-1231,
// 2923*p1*p2*p3*p5*p6*p7-4328*p1*p2*p3*p5*p6-3674*p1*p2*p3*p5*p7-3291*p1*p2*p3*p6*p7-4955*p1*p2*p5*p6*p7-8*p1*p3*p5*p6*p7-135*p2*p3*p5*p6*p7+7784*p1*p2*p3*p5+3471*p1*p2*p3*p6+1544*p1*p2*p5*p6+1607*p1*p3*p5*p6+1710*p2*p3*p5*p6+2434*p1*p2*p3*p7+1408*p1*p2*p5*p7-215*p1*p3*p5*p7+507*p2*p3*p5*p7+2208*p1*p2*p6*p7+1920*p1*p3*p6*p7-389*p2*p3*p6*p7+1304*p1*p5*p6*p7+2480*p2*p5*p6*p7+102*p3*p5*p6*p7-2683*p1*p2*p3-3508*p1*p2*p5-3505*p1*p3*p5-2400*p2*p3*p5-2236*p1*p2*p6-1727*p1*p3*p6-1354*p2*p3*p6-1022*p1*p5*p6-2099*p2*p5*p6-918*p3*p5*p6-495*p1*p2*p7-109*p1*p3*p7+474*p2*p3*p7+268*p1*p5*p7+1084*p2*p5*p7-190*p3*p5*p7-666*p1*p6*p7-497*p2*p6*p7+615*p3*p6*p7-912*p5*p6*p7+473*p1*p2+742*p1*p3+186*p2*p3+1021*p1*p5+2556*p2*p5+2312*p3*p5+1075*p1*p6+920*p2*p6+164*p3*p6+80*p5*p6-199*p1*p7-1270*p2*p7-1050*p3*p7-724*p5*p7+136*p6*p7+740*p1-474*p2+37*p3-1056*p5+303*p6+833*p7+736,
// 4990*p1*p2*p3*p4*p6*p7-3067*p1*p2*p3*p4*p6-1661*p1*p2*p3*p4*p7-4064*p1*p2*p3*p6*p7-223*p1*p2*p4*p6*p7-5229*p1*p3*p4*p6*p7-4636*p2*p3*p4*p6*p7+5720*p1*p2*p3*p4+4872*p1*p2*p3*p6+1643*p1*p2*p4*p6+4536*p1*p3*p4*p6+2451*p2*p3*p4*p6+1264*p1*p2*p3*p7+70*p1*p2*p4*p7+2213*p1*p3*p4*p7+1734*p2*p3*p4*p7+1698*p1*p2*p6*p7+3799*p1*p3*p6*p7+1622*p2*p3*p6*p7+901*p1*p4*p6*p7-496*p2*p4*p6*p7+3782*p3*p4*p6*p7-5591*p1*p2*p3-1303*p1*p2*p4-6383*p1*p3*p4-2332*p2*p3*p4-3179*p1*p2*p6-6257*p1*p3*p6-3654*p2*p3*p6-1830*p1*p4*p6-1473*p2*p4*p6-3278*p3*p4*p6-1462*p1*p2*p7-1495*p1*p3*p7-468*p2*p3*p7-400*p1*p4*p7+431*p2*p4*p7-1907*p3*p4*p7-1547*p1*p6*p7-214*p2*p6*p7-1423*p3*p6*p7-1625*p4*p6*p7+5708*p1*p2+3809*p1*p3+2053*p2*p3+2824*p1*p4+1122*p2*p4+3653*p3*p4+3658*p1*p6+3001*p2*p6+3890*p3*p6+2371*p4*p6+602*p1*p7+185*p2*p7+899*p3*p7+963*p4*p7+560*p6*p7-4557*p1-3536*p2-1635*p3-2552*p4-2595*p6-207*p7+2740,
// -1407*p1*p2*p3*p4*p5*p7+4444*p1*p2*p3*p4*p5+2350*p1*p2*p3*p4*p7+5424*p1*p2*p3*p5*p7-2524*p1*p2*p4*p5*p7-985*p1*p3*p4*p5*p7-431*p2*p3*p4*p5*p7-2662*p1*p2*p3*p4-5342*p1*p2*p3*p5-39*p1*p2*p4*p5-2525*p1*p3*p4*p5-2650*p2*p3*p4*p5-3553*p1*p2*p3*p7-71*p1*p2*p4*p7-3268*p1*p3*p4*p7-1140*p2*p3*p4*p7-702*p1*p2*p5*p7-924*p1*p3*p5*p7-2198*p2*p3*p5*p7+4087*p1*p4*p5*p7+2709*p2*p4*p5*p7+587*p3*p4*p5*p7+968*p1*p2*p3-150*p1*p2*p4+909*p1*p3*p4+4587*p2*p3*p4+929*p1*p2*p5+1804*p1*p3*p5+2226*p2*p3*p5-916*p1*p4*p5+906*p2*p4*p5+2735*p3*p4*p5+1894*p1*p2*p7+2998*p1*p3*p7+1611*p2*p3*p7+304*p1*p4*p7-1601*p2*p4*p7+2066*p3*p4*p7-1971*p1*p5*p7-480*p2*p5*p7-500*p3*p5*p7-2617*p4*p5*p7-532*p1*p2+2016*p1*p3-2574*p2*p3+529*p1*p4-1251*p2*p4-2082*p3*p4+280*p1*p5-852*p2*p5-476*p3*p5-340*p4*p5-924*p1*p7+253*p2*p7-1090*p3*p7+170*p4*p7+1204*p5*p7-869*p1+1394*p2-264*p3+719*p4+219*p5-128*p7+506,
// -901*p1*p2*p3*p4*p5*p6+1805*p1*p2*p3*p4*p5-1103*p1*p2*p3*p4*p6-1746*p1*p2*p3*p5*p6-1968*p1*p2*p4*p5*p6+3957*p1*p3*p4*p5*p6+1293*p2*p3*p4*p5*p6-523*p1*p2*p3*p4-2498*p1*p2*p3*p5+693*p1*p2*p4*p5-2805*p1*p3*p4*p5-722*p2*p3*p4*p5-770*p1*p2*p3*p6+1088*p1*p2*p4*p6-232*p1*p3*p4*p6+2657*p2*p3*p4*p6+3281*p1*p2*p5*p6-1066*p1*p3*p5*p6+240*p2*p3*p5*p6-1174*p1*p4*p5*p6+1304*p2*p4*p5*p6-2070*p3*p4*p5*p6+2571*p1*p2*p3+115*p1*p2*p4+3899*p1*p3*p4-4641*p2*p3*p4-752*p1*p2*p5+1531*p1*p3*p5+1178*p2*p3*p5+11*p1*p4*p5-1144*p2*p4*p5-1701*p3*p4*p5+592*p1*p2*p6+1140*p1*p3*p6+130*p2*p3*p6+304*p1*p4*p6-2273*p2*p4*p6-1224*p3*p4*p6-2*p1*p5*p6-1090*p2*p5*p6+585*p3*p5*p6+670*p4*p5*p6-1867*p1*p2-4780*p1*p3+1079*p2*p3-2435*p1*p4+2901*p2*p4+2073*p3*p4+499*p1*p5+908*p2*p5+323*p3*p5+1631*p4*p5-966*p1*p6-315*p2*p6-481*p3*p6+759*p4*p6-595*p5*p6+3233*p1-1978*p2+729*p3-1184*p4-40*p5+446*p6+282
// ]:

// # jason210
// # sparse with many monomial divisions
// var := [b, c, d, k, m, n, q, r]:
// sys := [b^2*d^4+b*c*d^2*m^2+b*c*d*k*m*q+b*c*d*k*n*r+b*c*k^2*n^2+c^2*k^4, c^6, b^6]:

// # katsura7
// var := [a, b, c, d, k, m, n, q]:
// sys := [2*a*n+2*b*m+2*b*q+2*c*k+d^2-n,
// 2*a*m+2*b*k+2*b*n+2*c*d+2*c*q-m,
// 2*a*k+2*b*d+2*b*m+c^2+2*c*n+2*d*q-k,
// 2*a*d+2*b*c+2*b*k+2*c*m+2*d*n+2*k*q-d,
// 2*a*c+b^2+2*b*d+2*c*k+2*d*m+2*k*n+2*m*q-c,
// 2*a*b+2*b*c+2*c*d+2*d*k+2*k*m+2*m*n+2*n*q-b,
// a^2+2*b^2+2*c^2+2*d^2+2*k^2+2*m^2+2*n^2+2*q^2-a,
// 2*q+2*n+2*m+2*k+2*d+2*c+2*b+a-1]:

// # katsura8
// var := [a, b, c, d, k, m, n, q, r]:
// sys := [2*a*q+2*b*n+2*b*r+2*c*m+2*d*k-q,
// 2*a*n+2*b*m+2*b*q+2*c*k+2*c*r+d^2-n,
// 2*a*m+2*b*k+2*b*n+2*c*d+2*c*q+2*d*r-m,
// 2*a*k+2*b*d+2*b*m+c^2+2*c*n+2*d*q+2*k*r-k,
// 2*a*d+2*b*c+2*b*k+2*c*m+2*d*n+2*k*q+2*m*r-d,
// 2*a*c+b^2+2*b*d+2*c*k+2*d*m+2*k*n+2*m*q+2*n*r-c,
// 2*a*b+2*b*c+2*c*d+2*d*k+2*k*m+2*m*n+2*n*q+2*q*r-b,
// a^2+2*b^2+2*c^2+2*d^2+2*k^2+2*m^2+2*n^2+2*q^2+2*r^2-a,
// 2*r+2*q+2*n+2*m+2*k+2*d+2*c+2*b+a-1]:

// # katsura9
// # dense with many zero-reductions
// var := [a, b, c, d, k, m, n, q, r, s]:
// sys := [2*a*r+2*b*q+2*b*s+2*c*n+2*d*m+k^2-r,
// 2*a*q+2*b*n+2*b*r+2*c*m+2*c*s+2*d*k-q,
// 2*a*n+2*b*m+2*b*q+2*c*k+2*c*r+d^2+2*d*s-n,
// 2*a*m+2*b*k+2*b*n+2*c*d+2*c*q+2*d*r+2*k*s-m,
// 2*a*k+2*b*d+2*b*m+c^2+2*c*n+2*d*q+2*k*r+2*m*s-k,
// 2*a*d+2*b*c+2*b*k+2*c*m+2*d*n+2*k*q+2*m*r+2*n*s-d,
// 2*a*c+b^2+2*b*d+2*c*k+2*d*m+2*k*n+2*m*q+2*n*r+2*q*s-c,
// 2*a*b+2*b*c+2*c*d+2*d*k+2*k*m+2*m*n+2*n*q+2*q*r+2*r*s-b,
// a^2+2*b^2+2*c^2+2*d^2+2*k^2+2*m^2+2*n^2+2*q^2+2*r^2+2*s^2-a,
// 2*s+2*r+2*q+2*n+2*m+2*k+2*d+2*c+2*b+a-1]:

// # katsura10
// # dense with many zero-reductions
// var := [a, b, c, d, k, m, n, q, r, s, t]:
// sys := [2*a*s+2*b*t+2*b*r+2*c*q+2*d*n+2*k*m-s,
// 2*a*r+2*b*q+2*b*s+2*t*c+2*c*n+2*d*m+k^2-r,
// 2*a*q+2*b*n+2*b*r+2*t*d+2*c*m+2*c*s+2*d*k-q,
// 2*a*n+2*b*m+2*b*q+2*t*k+2*c*k+2*c*r+d^2+2*d*s-n,
// 2*a*m+2*b*k+2*b*n+2*t*m+2*c*d+2*c*q+2*d*r+2*k*s-m,
// 2*a*k+2*b*d+2*b*m+2*t*n+c^2+2*c*n+2*d*q+2*k*r+2*m*s-k,
// 2*a*d+2*b*c+2*b*k+2*t*q+2*c*m+2*d*n+2*k*q+2*m*r+2*n*s-d,
// 2*a*c+b^2+2*b*d+2*t*r+2*c*k+2*d*m+2*k*n+2*m*q+2*n*r+2*q*s-c,
// 2*a*b+2*b*c+2*t*s+2*c*d+2*d*k+2*k*m+2*m*n+2*n*q+2*q*r+2*r*s-b,
// a^2+2*b^2+2*t^2+2*c^2+2*d^2+2*k^2+2*m^2+2*n^2+2*q^2+2*r^2+2*s^2-a,
// 2*t+2*s+2*r+2*q+2*n+2*m+2*k+2*d+2*c+2*b+a-1]:

// # katsura11
// # dense with many zero-reductions
// var := [a, b, c, d, k, m, n, q, r, s, t, u]:
// sys := [2*a*t+2*b*u+2*b*s+2*c*r+2*d*q+2*k*n+m^2-t,
// 2*a*s+2*b*t+2*b*r+2*u*c+2*c*q+2*d*n+2*k*m-s,
// 2*a*r+2*b*q+2*b*s+2*t*c+2*u*d+2*c*n+2*d*m+k^2-r,
// 2*a*q+2*b*n+2*b*r+2*t*d+2*u*k+2*c*m+2*c*s+2*d*k-q,
// 2*a*n+2*b*m+2*b*q+2*t*k+2*u*m+2*c*k+2*c*r+d^2+2*d*s-n,
// 2*a*m+2*b*k+2*b*n+2*t*m+2*u*n+2*c*d+2*c*q+2*d*r+2*k*s-m,
// 2*a*k+2*b*d+2*b*m+2*t*n+2*u*q+c^2+2*c*n+2*d*q+2*k*r+2*m*s-k,
// 2*a*d+2*b*c+2*b*k+2*t*q+2*u*r+2*c*m+2*d*n+2*k*q+2*m*r+2*n*s-d,
// 2*a*c+b^2+2*b*d+2*t*r+2*u*s+2*c*k+2*d*m+2*k*n+2*m*q+2*n*r+2*q*s-c,
// 2*a*b+2*b*c+2*t*u+2*t*s+2*c*d+2*d*k+2*k*m+2*m*n+2*n*q+2*q*r+2*r*s-b,
// a^2+2*b^2+2*t^2+2*u^2+2*c^2+2*d^2+2*k^2+2*m^2+2*n^2+2*q^2+2*r^2+2*s^2-a,
// 2*u+2*t+2*s+2*r+2*q+2*n+2*m+2*k+2*d+2*c+2*b+a-1]:

// # katsura12
// # dense with many zero-reductions
// var := [a, b, c, d, k, m, n, q, r, s, t, u, v]:
// sys := [2*a*u+2*b*t+2*b*v+2*c*s+2*d*r+2*k*q+2*m*n-u,
// 2*a*t+2*b*u+2*b*s+2*v*c+2*c*r+2*d*q+2*k*n+m^2-t,
// 2*a*s+2*b*t+2*b*r+2*u*c+2*v*d+2*c*q+2*d*n+2*k*m-s,
// 2*a*r+2*b*q+2*b*s+2*t*c+2*u*d+2*v*k+2*c*n+2*d*m+k^2-r,
// 2*a*q+2*b*n+2*b*r+2*t*d+2*u*k+2*v*m+2*c*m+2*c*s+2*d*k-q,
// 2*a*n+2*b*m+2*b*q+2*t*k+2*u*m+2*v*n+2*c*k+2*c*r+d^2+2*d*s-n,
// 2*a*m+2*b*k+2*b*n+2*t*m+2*u*n+2*v*q+2*c*d+2*c*q+2*d*r+2*k*s-m,
// 2*a*k+2*b*d+2*b*m+2*t*n+2*u*q+2*v*r+c^2+2*c*n+2*d*q+2*k*r+2*m*s-k,
// 2*a*d+2*b*c+2*b*k+2*t*q+2*u*r+2*v*s+2*c*m+2*d*n+2*k*q+2*m*r+2*n*s-d,
// 2*a*c+b^2+2*b*d+2*t*v+2*t*r+2*u*s+2*c*k+2*d*m+2*k*n+2*m*q+2*n*r+2*q*s-c,
// 2*a*b+2*b*c+2*t*u+2*t*s+2*u*v+2*c*d+2*d*k+2*k*m+2*m*n+2*n*q+2*q*r+2*r*s-b,
// a^2+2*b^2+2*t^2+2*u^2+2*v^2+2*c^2+2*d^2+2*k^2+2*m^2+2*n^2+2*q^2+2*r^2+2*s^2-a,
// 2*v+2*b+2*u+a+2*t+2*s+2*c+2*r+2*d+2*q+2*k+2*n+2*m-1]:

// # mayr42
// # sparse with many pair updates
// var := [b,c,d,k,m,n,q,r,s,t,u,v,b3,b4,b5,b6,b7,b8,b9,c0,c1,c2,c3,c4,c5,c6,c7,c8,c9,d0,d1,d2,d3,d4,d5,d6,d7,d8,d9,k0,k1,k2,k3,k4,k5,k6,k7,k8,k9,m0,m1]:
// sys := [
// -t*m1+k*k9, d*k8-m1*s, c*k7-m1*r, b*k6-m1*q,
// k*k4-k9*s, d*k3-k8*r, c*k2-k7*q, b*k1-k6*n,
// d9*k-k9*s, d*d8-k8*r, c*d7-k7*q, b*d6-k6*n, d4*s-k9*s, d4*k-m*m1,
// d3*r-k8*r, d*d3-k*m1, d2*q-k7*q, c*d2-d*m1, d1*n-k6*n, b*d1-c*m1,
// b4*d9*s-c9*k4*s, b3*d8*r-c8*k3*r, v*d7*q-c7*k2*q, u*d6*n-c6*k1*n,
// c6^2*k6*n-m1^3*q, u^2*k6*n-c*m1^3, c1^2*k1*n-k6*m1^2*n, b6^2*d6*n-k6*m1^2*n,
// c4*d0*d9*m0*s-c9*k4*m0*m1*s, c3*c9*d8*k9*r-c8*k3*k9*m1*r, c2*c8*d7*k8*q-c7*k2*k8*m1*q,
// c1*c7*d6*k7*n-c6*k1*k7*m1*n, c4*c5*d9*k5*s-c9*k4*k5*m1*s, c3*c4*d8*k4*r-c8*k3*k4*m1*r,
// c2*c3*d7*k3*q-c7*k2*k3*m1*q, c1*c2*d6*k2*n-c6*k1*k2*m1*n, c0*c4*d9*k0*s-c9*k0*k4*m1*s,
// b9*c3*d8*d9*r-c8*d9*k3*m1*r, b5*c4*d5*d9*s-c9*d5*k4*m1*s, b8*c2*d7*d8*q-c7*d8*k2*m1*q,
// b4*c3*d4*d8*r-c8*d4*k3*m1*r, b7*c1*d6*d7*n-c6*d7*k1*m1*n, b3*c2*d3*d7*q-c7*d3*k2*m1*q,
// v*c1*d2*d6*n-c6*d2*k1*m1*n
// ]:

// # noon9
// # sparse all-around challenge
// var := [b,c,d,k,m,n,q,r,s]:
// sys := [
// 10*b^2*s+10*c^2*s+10*d^2*s+10*k^2*s+10*m^2*s+10*n^2*s+10*q^2*s+10*r^2*s-11*s+10,
// 10*b^2*r+10*c^2*r+10*d^2*r+10*k^2*r+10*m^2*r+10*n^2*r+10*q^2*r+10*r*s^2-11*r+10,
// 10*b^2*q+10*c^2*q+10*d^2*q+10*k^2*q+10*m^2*q+10*n^2*q+10*q*r^2+10*q*s^2-11*q+10,
// 10*b^2*n+10*c^2*n+10*d^2*n+10*k^2*n+10*m^2*n+10*n*q^2+10*n*r^2+10*n*s^2-11*n+10,
// 10*b^2*m+10*c^2*m+10*d^2*m+10*k^2*m+10*m*n^2+10*m*q^2+10*m*r^2+10*m*s^2-11*m+10,
// 10*b^2*k+10*c^2*k+10*d^2*k+10*k*m^2+10*k*n^2+10*k*q^2+10*k*r^2+10*k*s^2-11*k+10,
// 10*b^2*d+10*c^2*d+10*d*k^2+10*d*m^2+10*d*n^2+10*d*q^2+10*d*r^2+10*d*s^2-11*d+10,
// 10*b*c^2+10*b*d^2+10*b*k^2+10*b*m^2+10*b*n^2+10*b*q^2+10*b*r^2+10*b*s^2-11*b+10,
// 10*b^2*c+10*c*d^2+10*c*k^2+10*c*m^2+10*c*n^2+10*c*q^2+10*c*r^2+10*c*s^2-11*c+10
// ]:

// # reimer7
// var := [b,c,d,k,m,n,q]:
// sys := [
// 2*b^2 - 2*c^2 + 2*d^2 - 2*k^2 + 2*m^2 - 2*n^2 + 2*q^2 - 1,
// 2*b^3 - 2*c^3 + 2*d^3 - 2*k^3 + 2*m^3 - 2*n^3 + 2*q^3 - 1,
// 2*b^4 - 2*c^4 + 2*d^4 - 2*k^4 + 2*m^4 - 2*n^4 + 2*q^4 - 1,
// 2*b^5 - 2*c^5 + 2*d^5 - 2*k^5 + 2*m^5 - 2*n^5 + 2*q^5 - 1,
// 2*b^6 - 2*c^6 + 2*d^6 - 2*k^6 + 2*m^6 - 2*n^6 + 2*q^6 - 1,
// 2*b^7 - 2*c^7 + 2*d^7 - 2*k^7 + 2*m^7 - 2*n^7 + 2*q^7 - 1,
// 2*b^8 - 2*c^8 + 2*d^8 - 2*k^8 + 2*m^8 - 2*n^8 + 2*q^8 - 1
// ]:

// # reimer8
// var := [b,c,d,k,m,n,q,r]:
// sys := [
// 2*b^2 - 2*c^2 + 2*d^2 - 2*k^2 + 2*m^2 - 2*n^2 + 2*q^2 - 2*r^2 - 1,
// 2*b^3 - 2*c^3 + 2*d^3 - 2*k^3 + 2*m^3 - 2*n^3 + 2*q^3 - 2*r^3 - 1,
// 2*b^4 - 2*c^4 + 2*d^4 - 2*k^4 + 2*m^4 - 2*n^4 + 2*q^4 - 2*r^4 - 1,
// 2*b^5 - 2*c^5 + 2*d^5 - 2*k^5 + 2*m^5 - 2*n^5 + 2*q^5 - 2*r^5 - 1,
// 2*b^6 - 2*c^6 + 2*d^6 - 2*k^6 + 2*m^6 - 2*n^6 + 2*q^6 - 2*r^6 - 1,
// 2*b^7 - 2*c^7 + 2*d^7 - 2*k^7 + 2*m^7 - 2*n^7 + 2*q^7 - 2*r^7 - 1,
// 2*b^8 - 2*c^8 + 2*d^8 - 2*k^8 + 2*m^8 - 2*n^8 + 2*q^8 - 2*r^8 - 1,
// 2*b^9 - 2*c^9 + 2*d^9 - 2*k^9 + 2*m^9 - 2*n^9 + 2*q^9 - 2*r^9 - 1
// ]:

// # schwarz11
// var := [b,c,d,k,m,n,q,r,s,t,u]:
// sys := [
// n^2+2*m*q+2*k*r+2*d*s+2*c*t+2*b*u+u,
// 2*m*n+2*k*q+2*d*r+2*c*s+2*b*t+u^2+t,
// m^2+2*k*n+2*d*q+2*c*r+2*b*s+2*t*u+s,
// 2*k*m+2*d*n+2*c*q+2*b*r+t^2+2*s*u+r,
// k^2+2*d*m+2*c*n+2*b*q+2*s*t+2*r*u+q,
// 2*d*k+2*c*m+2*b*n+s^2+2*r*t+2*q*u+n,
// d^2+2*c*k+2*b*m+2*r*s+2*q*t+2*n*u+m,
// 2*c*d+2*b*k+r^2+2*q*s+2*n*t+2*m*u+k,
// c^2+2*b*d+2*q*r+2*n*s+2*m*t+2*k*u+d,
// 2*b*c+q^2+2*n*r+2*m*s+2*k*t+2*d*u+c,
// b^2+2*n*q+2*m*r+2*k*s+2*d*t+2*c*u+b
// ]:

// # yang1
// # sparse with many pair updates
// var := [b, c, d, k, m, n, q, r, s, t, u, v, b3, b4, b5, b6, b7, b8, b9, c0, c1, c2, c3, c4, c5, c6, c7, c8, c9, d0, d1, d2, d3, d4, d5, d6, d7, d8, d9, k0, k1, k2, k3, k4, k5, k6, k7, k8]:
// sys := [
// c1*k5+c2*k6+c3*k7+c4*k8, b7*k5+b8*k6+b9*k7+c0*k8, b3*k5+b4*k6+b5*k7+b6*k8, t*k6+u*k7+v*k8+k5*s, k5*m+k6*n+k7*q+k8*r, b*k5+c*k6+d*k7+k*k8, c1*k1+c2*k2+c3*k3+c4*k4,
// b7*k1+b8*k2+b9*k3+c0*k4, b3*k1+b4*k2+b5*k3+b6*k4, t*k2+u*k3+v*k4+k1*s, k1*m+k2*n+k3*q+k4*r, b*k1+c*k2+d*k3+k*k4, c1*d7+c2*d8+c3*d9+c4*k0, b7*d7+b8*d8+b9*d9+c0*k0,
// b3*d7+b4*d8+b5*d9+b6*k0, t*d8+u*d9+v*k0+d7*s, d7*m+d8*n+d9*q+k0*r, b*d7+c*d8+d*d9+k*k0, c1*d3+c2*d4+c3*d5+c4*d6, b7*d3+b8*d4+b9*d5+c0*d6, b3*d3+b4*d4+b5*d5+b6*d6,
// t*d4+u*d5+v*d6+d3*s, d3*m+d4*n+d5*q+d6*r, b*d3+c*d4+d*d5+d6*k, c1*c9+c2*d0+c3*d1+c4*d2, b7*c9+b8*d0+b9*d1+c0*d2, b3*c9+b4*d0+b5*d1+b6*d2, t*d0+u*d1+v*d2+c9*s,
// c9*m+d0*n+d1*q+d2*r, b*c9+c*d0+d*d1+d2*k, c1*c5+c2*c6+c3*c7+c4*c8, b7*c5+b8*c6+b9*c7+c0*c8, b3*c5+b4*c6+b5*c7+b6*c8, t*c6+u*c7+v*c8+c5*s, c5*m+c6*n+c7*q+c8*r, b*c5+c*c6+c7*d+c8*k,
// d3*d8*k3*k8-d3*d8*k4*k7-d3*d9*k2*k8+d3*d9*k4*k6+d3*k0*k2*k7-d3*k0*k3*k6-d4*d7*k3*k8+d4*d7*k4*k7+d4*d9*k1*k8-d4*d9*k4*k5-d4*k0*k1*k7+d4*k0*k3*k5+d5*d7*k2*k8-d5*d7*k4*k6-d5*d8*k1*k8+d5*d8*k4*k5+d5*k0*k1*k6-d5*k0*k2*k5-d6*d7*k2*k7+d6*d7*k3*k6+d6*d8*k1*k7-d6*d8*k3*k5-d6*d9*k1*k6+d6*d9*k2*k5,
// c9*d8*k3*k8-c9*d8*k4*k7-c9*d9*k2*k8+c9*d9*k4*k6+c9*k0*k2*k7-c9*k0*k3*k6-d0*d7*k3*k8+d0*d7*k4*k7+d0*d9*k1*k8-d0*d9*k4*k5-d0*k0*k1*k7+d0*k0*k3*k5+d1*d7*k2*k8-d1*d7*k4*k6-d1*d8*k1*k8+d1*d8*k4*k5+d1*k0*k1*k6-d1*k0*k2*k5-d2*d7*k2*k7+d2*d7*k3*k6+d2*d8*k1*k7-d2*d8*k3*k5-d2*d9*k1*k6+d2*d9*k2*k5,
// c5*d8*k3*k8-c5*d8*k4*k7-c5*d9*k2*k8+c5*d9*k4*k6+c5*k0*k2*k7-c5*k0*k3*k6-c6*d7*k3*k8+c6*d7*k4*k7+c6*d9*k1*k8-c6*d9*k4*k5-c6*k0*k1*k7+c6*k0*k3*k5+c7*d7*k2*k8-c7*d7*k4*k6-c7*d8*k1*k8+c7*d8*k4*k5+c7*k0*k1*k6-c7*k0*k2*k5-c8*d7*k2*k7+c8*d7*k3*k6+c8*d8*k1*k7-c8*d8*k3*k5-c8*d9*k1*k6+c8*d9*k2*k5,
// c9*d4*k3*k8-c9*d4*k4*k7-c9*d5*k2*k8+c9*d5*k4*k6+c9*d6*k2*k7-c9*d6*k3*k6-d0*d3*k3*k8+d0*d3*k4*k7+d0*d5*k1*k8-d0*d5*k4*k5-d0*d6*k1*k7+d0*d6*k3*k5+d1*d3*k2*k8-d1*d3*k4*k6-d1*d4*k1*k8+d1*d4*k4*k5+d1*d6*k1*k6-d1*d6*k2*k5-d2*d3*k2*k7+d2*d3*k3*k6+d2*d4*k1*k7-d2*d4*k3*k5-d2*d5*k1*k6+d2*d5*k2*k5,
// c5*d4*k3*k8-c5*d4*k4*k7-c5*d5*k2*k8+c5*d5*k4*k6+c5*d6*k2*k7-c5*d6*k3*k6-c6*d3*k3*k8+c6*d3*k4*k7+c6*d5*k1*k8-c6*d5*k4*k5-c6*d6*k1*k7+c6*d6*k3*k5+c7*d3*k2*k8-c7*d3*k4*k6-c7*d4*k1*k8+c7*d4*k4*k5+c7*d6*k1*k6-c7*d6*k2*k5-c8*d3*k2*k7+c8*d3*k3*k6+c8*d4*k1*k7-c8*d4*k3*k5-c8*d5*k1*k6+c8*d5*k2*k5,
// c5*d0*k3*k8-c5*d0*k4*k7-c5*d1*k2*k8+c5*d1*k4*k6+c5*d2*k2*k7-c5*d2*k3*k6-c6*c9*k3*k8+c6*c9*k4*k7+c6*d1*k1*k8-c6*d1*k4*k5-c6*d2*k1*k7+c6*d2*k3*k5+c7*c9*k2*k8-c7*c9*k4*k6-c7*d0*k1*k8+c7*d0*k4*k5+c7*d2*k1*k6-c7*d2*k2*k5-c8*c9*k2*k7+c8*c9*k3*k6+c8*d0*k1*k7-c8*d0*k3*k5-c8*d1*k1*k6+c8*d1*k2*k5,
// c9*d4*d9*k8-c9*d4*k0*k7-c9*d5*d8*k8+c9*d5*k0*k6+c9*d6*d8*k7-c9*d6*d9*k6-d0*d3*d9*k8+d0*d3*k0*k7+d0*d5*d7*k8-d0*d5*k0*k5-d0*d6*d7*k7+d0*d6*d9*k5+d1*d3*d8*k8-d1*d3*k0*k6-d1*d4*d7*k8+d1*d4*k0*k5+d1*d6*d7*k6-d1*d6*d8*k5-d2*d3*d8*k7+d2*d3*d9*k6+d2*d4*d7*k7-d2*d4*d9*k5-d2*d5*d7*k6+d2*d5*d8*k5,
// c5*d4*d9*k8-c5*d4*k0*k7-c5*d5*d8*k8+c5*d5*k0*k6+c5*d6*d8*k7-c5*d6*d9*k6-c6*d3*d9*k8+c6*d3*k0*k7+c6*d5*d7*k8-c6*d5*k0*k5-c6*d6*d7*k7+c6*d6*d9*k5+c7*d3*d8*k8-c7*d3*k0*k6-c7*d4*d7*k8+c7*d4*k0*k5+c7*d6*d7*k6-c7*d6*d8*k5-c8*d3*d8*k7+c8*d3*d9*k6+c8*d4*d7*k7-c8*d4*d9*k5-c8*d5*d7*k6+c8*d5*d8*k5,
// c5*d0*d9*k8-c5*d0*k0*k7-c5*d1*d8*k8+c5*d1*k0*k6+c5*d2*d8*k7-c5*d2*d9*k6-c6*c9*d9*k8+c6*c9*k0*k7+c6*d1*d7*k8-c6*d1*k0*k5-c6*d2*d7*k7+c6*d2*d9*k5+c7*c9*d8*k8-c7*c9*k0*k6-c7*d0*d7*k8+c7*d0*k0*k5+c7*d2*d7*k6-c7*d2*d8*k5-c8*c9*d8*k7+c8*c9*d9*k6+c8*d0*d7*k7-c8*d0*d9*k5-c8*d1*d7*k6+c8*d1*d8*k5,
// c5*d0*d5*k8-c5*d0*d6*k7-c5*d1*d4*k8+c5*d1*d6*k6+c5*d2*d4*k7-c5*d2*d5*k6-c6*c9*d5*k8+c6*c9*d6*k7+c6*d1*d3*k8-c6*d1*d6*k5-c6*d2*d3*k7+c6*d2*d5*k5+c7*c9*d4*k8-c7*c9*d6*k6-c7*d0*d3*k8+c7*d0*d6*k5+c7*d2*d3*k6-c7*d2*d4*k5-c8*c9*d4*k7+c8*c9*d5*k6+c8*d0*d3*k7-c8*d0*d5*k5-c8*d1*d3*k6+c8*d1*d4*k5,
// c9*d4*d9*k4-c9*d4*k0*k3-c9*d5*d8*k4+c9*d5*k0*k2+c9*d6*d8*k3-c9*d6*d9*k2-d0*d3*d9*k4+d0*d3*k0*k3+d0*d5*d7*k4-d0*d5*k0*k1-d0*d6*d7*k3+d0*d6*d9*k1+d1*d3*d8*k4-d1*d3*k0*k2-d1*d4*d7*k4+d1*d4*k0*k1+d1*d6*d7*k2-d1*d6*d8*k1-d2*d3*d8*k3+d2*d3*d9*k2+d2*d4*d7*k3-d2*d4*d9*k1-d2*d5*d7*k2+d2*d5*d8*k1,
// c5*d4*d9*k4-c5*d4*k0*k3-c5*d5*d8*k4+c5*d5*k0*k2+c5*d6*d8*k3-c5*d6*d9*k2-c6*d3*d9*k4+c6*d3*k0*k3+c6*d5*d7*k4-c6*d5*k0*k1-c6*d6*d7*k3+c6*d6*d9*k1+c7*d3*d8*k4-c7*d3*k0*k2-c7*d4*d7*k4+c7*d4*k0*k1+c7*d6*d7*k2-c7*d6*d8*k1-c8*d3*d8*k3+c8*d3*d9*k2+c8*d4*d7*k3-c8*d4*d9*k1-c8*d5*d7*k2+c8*d5*d8*k1,
// c5*d0*d9*k4-c5*d0*k0*k3-c5*d1*d8*k4+c5*d1*k0*k2+c5*d2*d8*k3-c5*d2*d9*k2-c6*c9*d9*k4+c6*c9*k0*k3+c6*d1*d7*k4-c6*d1*k0*k1-c6*d2*d7*k3+c6*d2*d9*k1+c7*c9*d8*k4-c7*c9*k0*k2-c7*d0*d7*k4+c7*d0*k0*k1+c7*d2*d7*k2-c7*d2*d8*k1-c8*c9*d8*k3+c8*c9*d9*k2+c8*d0*d7*k3-c8*d0*d9*k1-c8*d1*d7*k2+c8*d1*d8*k1,
// c5*d0*d5*k4-c5*d0*d6*k3-c5*d1*d4*k4+c5*d1*d6*k2+c5*d2*d4*k3-c5*d2*d5*k2-c6*c9*d5*k4+c6*c9*d6*k3+c6*d1*d3*k4-c6*d1*d6*k1-c6*d2*d3*k3+c6*d2*d5*k1+c7*c9*d4*k4-c7*c9*d6*k2-c7*d0*d3*k4+c7*d0*d6*k1+c7*d2*d3*k2-c7*d2*d4*k1-c8*c9*d4*k3+c8*c9*d5*k2+c8*d0*d3*k3-c8*d0*d5*k1-c8*d1*d3*k2+c8*d1*d4*k1,
// c5*d0*d5*k0-c5*d0*d6*d9-c5*d1*d4*k0+c5*d1*d6*d8+c5*d2*d4*d9-c5*d2*d5*d8-c6*c9*d5*k0+c6*c9*d6*d9+c6*d1*d3*k0-c6*d1*d6*d7-c6*d2*d3*d9+c6*d2*d5*d7+c7*c9*d4*k0-c7*c9*d6*d8-c7*d0*d3*k0+c7*d0*d6*d7+c7*d2*d3*d8-c7*d2*d4*d7-c8*c9*d4*d9+c8*c9*d5*d8+c8*d0*d3*d9-c8*d0*d5*d7-c8*d1*d3*d8+c8*d1*d4*d7,
// -t*b3*b9*c4+t*b3*c0*c3+t*b5*b7*c4-t*b5*c0*c1-t*b6*b7*c3+t*b6*b9*c1+u*b3*b8*c4-u*b3*c0*c2-u*b4*b7*c4+u*b4*c0*c1+u*b6*b7*c2-u*b6*b8*c1-v*b3*b8*c3+v*b3*b9*c2+v*b4*b7*c3-v*b4*b9*c1-v*b5*b7*c2+v*b5*b8*c1+b4*b9*c4*s-b4*c0*c3*s-b5*b8*c4*s+b5*c0*c2*s+b6*b8*c3*s-b6*b9*c2*s,
// -b3*b8*c3*r+b3*b8*c4*q+b3*b9*c2*r-b3*b9*c4*n-b3*c0*c2*q+b3*c0*c3*n+b4*b7*c3*r-b4*b7*c4*q-b4*b9*c1*r+b4*b9*c4*m+b4*c0*c1*q-b4*c0*c3*m-b5*b7*c2*r+b5*b7*c4*n+b5*b8*c1*r-b5*b8*c4*m-b5*c0*c1*n+b5*c0*c2*m+b6*b7*c2*q-b6*b7*c3*n-b6*b8*c1*q+b6*b8*c3*m+b6*b9*c1*n-b6*b9*c2*m,
// b*b4*b9*c4-b*b4*c0*c3-b*b5*b8*c4+b*b5*c0*c2+b*b6*b8*c3-b*b6*b9*c2-b3*b8*c3*k+b3*b8*c4*d-b3*b9*c*c4+b3*b9*c2*k+b3*c*c0*c3-b3*c0*c2*d+b4*b7*c3*k-b4*b7*c4*d-b4*b9*c1*k+b4*c0*c1*d+b5*b7*c*c4-b5*b7*c2*k+b5*b8*c1*k-b5*c*c0*c1-b6*b7*c*c3+b6*b7*c2*d-b6*b8*c1*d+b6*b9*c*c1,
// t*b7*c3*r-t*b7*c4*q-t*b9*c1*r+t*b9*c4*m+t*c0*c1*q-t*c0*c3*m-u*b7*c2*r+u*b7*c4*n+u*b8*c1*r-u*b8*c4*m-u*c0*c1*n+u*c0*c2*m+v*b7*c2*q-v*b7*c3*n-v*b8*c1*q+v*b8*c3*m+v*b9*c1*n-v*b9*c2*m-b8*c3*r*s+b8*c4*q*s+b9*c2*r*s-b9*c4*n*s-c0*c2*q*s+c0*c3*n*s,
// b*t*b9*c4-b*t*c0*c3-b*u*b8*c4+b*u*c0*c2+b*v*b8*c3-b*v*b9*c2+t*b7*c3*k-t*b7*c4*d-t*b9*c1*k+t*c0*c1*d+u*b7*c*c4-u*b7*c2*k+u*b8*c1*k-u*c*c0*c1-v*b7*c*c3+v*b7*c2*d-v*b8*c1*d+v*b9*c*c1-b8*c3*k*s+b8*c4*d*s-b9*c*c4*s+b9*c2*k*s+c*c0*c3*s-c0*c2*d*s,
// b*b8*c3*r-b*b8*c4*q-b*b9*c2*r+b*b9*c4*n+b*c0*c2*q-b*c0*c3*n-b7*c*c3*r+b7*c*c4*q+b7*c2*d*r-b7*c2*k*q+b7*c3*k*n-b7*c4*d*n-b8*c1*d*r+b8*c1*k*q-b8*c3*k*m+b8*c4*d*m+b9*c*c1*r-b9*c*c4*m-b9*c1*k*n+b9*c2*k*m-c*c0*c1*q+c*c0*c3*m+c0*c1*d*n-c0*c2*d*m,
// t*b3*c3*r-t*b3*c4*q-t*b5*c1*r+t*b5*c4*m+t*b6*c1*q-t*b6*c3*m-u*b3*c2*r+u*b3*c4*n+u*b4*c1*r-u*b4*c4*m-u*b6*c1*n+u*b6*c2*m+v*b3*c2*q-v*b3*c3*n-v*b4*c1*q+v*b4*c3*m+v*b5*c1*n-v*b5*c2*m-b4*c3*r*s+b4*c4*q*s+b5*c2*r*s-b5*c4*n*s-b6*c2*q*s+b6*c3*n*s,
// b*t*b5*c4-b*t*b6*c3-b*u*b4*c4+b*u*b6*c2+b*v*b4*c3-b*v*b5*c2+t*b3*c3*k-t*b3*c4*d-t*b5*c1*k+t*b6*c1*d+u*b3*c*c4-u*b3*c2*k+u*b4*c1*k-u*b6*c*c1-v*b3*c*c3+v*b3*c2*d-v*b4*c1*d+v*b5*c*c1-b4*c3*k*s+b4*c4*d*s-b5*c*c4*s+b5*c2*k*s+b6*c*c3*s-b6*c2*d*s,
// b*b4*c3*r-b*b4*c4*q-b*b5*c2*r+b*b5*c4*n+b*b6*c2*q-b*b6*c3*n-b3*c*c3*r+b3*c*c4*q+b3*c2*d*r-b3*c2*k*q+b3*c3*k*n-b3*c4*d*n-b4*c1*d*r+b4*c1*k*q-b4*c3*k*m+b4*c4*d*m+b5*c*c1*r-b5*c*c4*m-b5*c1*k*n+b5*c2*k*m-b6*c*c1*q+b6*c*c3*m+b6*c1*d*n-b6*c2*d*m,
// b*t*c3*r-b*t*c4*q-b*u*c2*r+b*u*c4*n+b*v*c2*q-b*v*c3*n-t*c1*d*r+t*c1*k*q-t*c3*k*m+t*c4*d*m+u*c*c1*r-u*c*c4*m-u*c1*k*n+u*c2*k*m-v*c*c1*q+v*c*c3*m+v*c1*d*n-v*c2*d*m-c*c3*r*s+c*c4*q*s+c2*d*r*s-c2*k*q*s+c3*k*n*s-c4*d*n*s,
// t*b3*b9*r-t*b3*c0*q-t*b5*b7*r+t*b5*c0*m+t*b6*b7*q-t*b6*b9*m-u*b3*b8*r+u*b3*c0*n+u*b4*b7*r-u*b4*c0*m-u*b6*b7*n+u*b6*b8*m+v*b3*b8*q-v*b3*b9*n-v*b4*b7*q+v*b4*b9*m+v*b5*b7*n-v*b5*b8*m-b4*b9*r*s+b4*c0*q*s+b5*b8*r*s-b5*c0*n*s-b6*b8*q*s+b6*b9*n*s,
// b*t*b5*c0-b*t*b6*b9-b*u*b4*c0+b*u*b6*b8+b*v*b4*b9-b*v*b5*b8+t*b3*b9*k-t*b3*c0*d-t*b5*b7*k+t*b6*b7*d-u*b3*b8*k+u*b3*c*c0+u*b4*b7*k-u*b6*b7*c+v*b3*b8*d-v*b3*b9*c-v*b4*b7*d+v*b5*b7*c-b4*b9*k*s+b4*c0*d*s+b5*b8*k*s-b5*c*c0*s-b6*b8*d*s+b6*b9*c*s,
// b*b4*b9*r-b*b4*c0*q-b*b5*b8*r+b*b5*c0*n+b*b6*b8*q-b*b6*b9*n+b3*b8*d*r-b3*b8*k*q-b3*b9*c*r+b3*b9*k*n+b3*c*c0*q-b3*c0*d*n-b4*b7*d*r+b4*b7*k*q-b4*b9*k*m+b4*c0*d*m+b5*b7*c*r-b5*b7*k*n+b5*b8*k*m-b5*c*c0*m-b6*b7*c*q+b6*b7*d*n-b6*b8*d*m+b6*b9*c*m,
// b*t*b9*r-b*t*c0*q-b*u*b8*r+b*u*c0*n+b*v*b8*q-b*v*b9*n-t*b7*d*r+t*b7*k*q-t*b9*k*m+t*c0*d*m+u*b7*c*r-u*b7*k*n+u*b8*k*m-u*c*c0*m-v*b7*c*q+v*b7*d*n-v*b8*d*m+v*b9*c*m+b8*d*r*s-b8*k*q*s-b9*c*r*s+b9*k*n*s+c*c0*q*s-c0*d*n*s,
// b*t*b5*r-b*t*b6*q-b*u*b4*r+b*u*b6*n+b*v*b4*q-b*v*b5*n-t*b3*d*r+t*b3*k*q-t*b5*k*m+t*b6*d*m+u*b3*c*r-u*b3*k*n+u*b4*k*m-u*b6*c*m-v*b3*c*q+v*b3*d*n-v*b4*d*m+v*b5*c*m+b4*d*r*s-b4*k*q*s-b5*c*r*s+b5*k*n*s+b6*c*q*s-b6*d*n*s
