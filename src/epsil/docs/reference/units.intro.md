The **units** library holds quantities (a value with a physical unit) and
the functions that convert, compare and inspect units. This introduction
gives the concepts you need before you read the entries.

## Writing a unit

A unit is a name such as `m`, `km` or `h`, or a product, quotient or power
of names. Each unit operand of `quantity`, `unitConvert`, `isCompatibleUnit`
and `unitDimension` also accepts a string, which is read as a unit:
`"km/h"`, `"m/s^2"`, `"kg*m"`.

```epsil
unitConvert(quantity(36, "km/h"), "m/s")
// ➔ 10 m/s
```

Write a unit as a string when its name is also the name of a function, such
as `min` (minute) or `lb` (pound): a bare `min` is the function `min`, not
the unit.

```epsil
unitConvert(quantity(2, h), "min")
// ➔ 120 min
```
