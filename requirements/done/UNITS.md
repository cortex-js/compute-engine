# Units and Quantities

## Overview

This document specifies support for physical units and quantities in the Compute
Engine. The goals are:

1. **Parse** LaTeX expressions containing units (both ad-hoc notation and
   `siunitx`-style commands)
2. **Represent** quantities (value + unit) in MathJSON
3. **Compute** with quantities: arithmetic, simplification, conversion
4. **Validate** dimensional consistency in expressions

The design focuses on SI units for scientific use. It draws inspiration from
Mathematica's `Quantity` model (value + unit as a first-class expression) and
SymPy's separation of dimensions from units.

---

## 1. MathJSON Representation

### 1.1 The `Quantity` Expression

A quantity is a value paired with a unit:

```json
["Quantity", 3.5, "m"]
```

- First argument: numeric value (any `BoxedExpression`)
- Second argument: unit expression (string shorthand or compound unit
  expression)

Accessors:

- `QuantityMagnitude`: extract the numeric value
- `QuantityUnit`: extract the unit

```json
["QuantityMagnitude", ["Quantity", 3.5, "m"]]   → 3.5
["QuantityUnit", ["Quantity", 3.5, "m"]]         → "m"
```

### 1.2 Unit Expressions

Simple units are strings using standard SI abbreviations:

```json
"m", "kg", "s", "A", "K", "mol", "cd"
```

Compound units are built with `Multiply`, `Divide`, and `Power`:

```json
["Divide", "m", "s"]                           → m/s  (velocity)
["Divide", "m", ["Power", "s", 2]]             → m/s² (acceleration)
["Multiply", "kg", "m", ["Power", "s", -2]]    → kg⋅m⋅s⁻² (force, i.e. N)
```

Prefixed units use concatenated strings:

```json
"km", "mg", "ns", "µm", "GHz"
```

Named derived units are available as shorthand:

```json
"N"   → ["Multiply", "kg", "m", ["Power", "s", -2]]
"J"   → ["Multiply", "N", "m"]
"Pa"  → ["Divide", "N", ["Power", "m", 2]]
```

### 1.3 Dimensionless and Special Quantities

Dimensionless quantities (ratios, angles, etc.):

```json
["Quantity", 0.5, "rad"]
["Quantity", 45, "deg"]
["Quantity", 3, "mol"]
```

Percent and ppm:

```json
["Quantity", 5, "percent"]   → 0.05 dimensionless
["Quantity", 300, "ppm"]     → 3e-4 dimensionless
```

---

## 2. Unit System

### 2.1 Base SI Units

| Dimension           | Unit     | Symbol | MathJSON |
| ------------------- | -------- | ------ | -------- |
| Length              | meter    | m      | `"m"`    |
| Mass                | kilogram | kg     | `"kg"`   |
| Time                | second   | s      | `"s"`    |
| Electric current    | ampere   | A      | `"A"`    |
| Temperature         | kelvin   | K      | `"K"`    |
| Amount of substance | mole     | mol    | `"mol"`  |
| Luminous intensity  | candela  | cd     | `"cd"`   |

### 2.2 Named Derived SI Units

| Quantity            | Unit      | Symbol | In base units  |
| ------------------- | --------- | ------ | -------------- |
| Frequency           | hertz     | Hz     | s⁻¹            |
| Force               | newton    | N      | kg⋅m⋅s⁻²       |
| Pressure            | pascal    | Pa     | kg⋅m⁻¹⋅s⁻²     |
| Energy              | joule     | J      | kg⋅m²⋅s⁻²      |
| Power               | watt      | W      | kg⋅m²⋅s⁻³      |
| Electric charge     | coulomb   | C      | A⋅s            |
| Voltage             | volt      | V      | kg⋅m²⋅s⁻³⋅A⁻¹  |
| Capacitance         | farad     | F      | kg⁻¹⋅m⁻²⋅s⁴⋅A² |
| Resistance          | ohm       | Ω      | kg⋅m²⋅s⁻³⋅A⁻²  |
| Conductance         | siemens   | S      | kg⁻¹⋅m⁻²⋅s³⋅A² |
| Magnetic flux       | weber     | Wb     | kg⋅m²⋅s⁻²⋅A⁻¹  |
| Magnetic flux dens. | tesla     | T      | kg⋅s⁻²⋅A⁻¹     |
| Inductance          | henry     | H      | kg⋅m²⋅s⁻²⋅A⁻²  |
| Luminous flux       | lumen     | lm     | cd⋅sr          |
| Illuminance         | lux       | lx     | cd⋅sr⋅m⁻²      |
| Radioactivity       | becquerel | Bq     | s⁻¹            |
| Absorbed dose       | gray      | Gy     | m²⋅s⁻²         |
| Equivalent dose     | sievert   | Sv     | m²⋅s⁻²         |
| Catalytic activity  | katal     | kat    | mol⋅s⁻¹        |

### 2.3 SI Prefixes

| Prefix | Symbol | Factor | Prefix | Symbol | Factor |
| ------ | ------ | ------ | ------ | ------ | ------ |
| quetta | Q      | 10³⁰   | deci   | d      | 10⁻¹   |
| ronna  | R      | 10²⁷   | centi  | c      | 10⁻²   |
| yotta  | Y      | 10²⁴   | milli  | m      | 10⁻³   |
| zetta  | Z      | 10²¹   | micro  | µ      | 10⁻⁶   |
| exa    | E      | 10¹⁸   | nano   | n      | 10⁻⁹   |
| peta   | P      | 10¹⁵   | pico   | p      | 10⁻¹²  |
| tera   | T      | 10¹²   | femto  | f      | 10⁻¹⁵  |
| giga   | G      | 10⁹    | atto   | a      | 10⁻¹⁸  |
| mega   | M      | 10⁶    | zepto  | z      | 10⁻²¹  |
| kilo   | k      | 10³    | yocto  | y      | 10⁻²⁴  |
| hecto  | h      | 10²    | ronto  | r      | 10⁻²⁷  |
| deca   | da     | 10¹    | quecto | q      | 10⁻³⁰  |

Prefixes are applicable to all base and named derived units except `kg` (use `g`
as the base for prefixing: `mg`, `µg`, etc.).

### 2.4 Non-SI Units Accepted for Use with SI

These are commonly used in science alongside SI:

| Quantity | Unit            | Symbol | SI equivalent        |
| -------- | --------------- | ------ | -------------------- |
| Time     | minute          | min    | 60 s                 |
| Time     | hour            | h      | 3600 s               |
| Time     | day             | d      | 86400 s              |
| Angle    | degree          | °      | (π/180) rad          |
| Angle    | arcminute       | ′      | (π/10800) rad        |
| Angle    | arcsecond       | ″      | (π/648000) rad       |
| Area     | hectare         | ha     | 10⁴ m²               |
| Volume   | liter           | L      | 10⁻³ m³              |
| Mass     | tonne           | t      | 10³ kg               |
| Energy   | electronvolt    | eV     | 1.602176634e-19 J    |
| Mass     | dalton          | Da     | 1.66053906660e-27 kg |
| Length   | astronomical u. | au     | 1.495978707e11 m     |

### 2.5 Non-SI Units (Common but Discouraged)

Available but not default. Conversions to SI are provided:

| Unit             | Symbol | SI equivalent                 |
| ---------------- | ------ | ----------------------------- |
| inch             | in     | 0.0254 m                      |
| foot             | ft     | 0.3048 m                      |
| mile             | mi     | 1609.344 m                    |
| pound (mass)     | lb     | 0.45359237 kg                 |
| ounce            | oz     | 0.028349523125 kg             |
| gallon (US)      | gal    | 3.785411784e-3 m³             |
| Fahrenheit       | °F     | (value − 32) × 5/9 + 273.15 K |
| Celsius          | °C     | value + 273.15 K              |
| atmosphere       | atm    | 101325 Pa                     |
| bar              | bar    | 1e5 Pa                        |
| calorie (thermo) | cal    | 4.184 J                       |
| kilowatt-hour    | kWh    | 3.6e6 J                       |
| Ångström         | Å      | 1e-10 m                       |

> **Note**: Temperature conversions (°F, °C) are affine, not linear — they
> require special handling for differences vs. absolute values.

---

## 3. LaTeX Parsing

### 3.1 Supported Input Forms

The parser should recognize units in these LaTeX patterns:

#### Plain LaTeX (ad-hoc notation)

```latex
12\,\mathrm{cm}         → ["Quantity", 12, "cm"]
3\,\text{kg}            → ["Quantity", 3, "kg"]
9.8\,\mathrm{m/s^2}     → ["Quantity", 9.8, ["Divide", "m", ["Power", "s", 2]]]
5\,\mathrm{m\cdot s^{-1}} → ["Quantity", 5, ["Multiply", "m", ["Power", "s", -1]]]
1\,\mathrm{kN}          → ["Quantity", 1, "kN"]
```

#### Juxtaposition (number followed by unit without explicit spacing)

```latex
12\mathrm{cm}           → ["Quantity", 12, "cm"]
3\text{m}               → ["Quantity", 3, "m"]
```

#### siunitx-style commands

```latex
\qty{12}{cm}             → ["Quantity", 12, "cm"]
\qty{9.8}{\m\per\s\squared}  → ["Quantity", 9.8, ["Divide", "m", ["Power", "s", 2]]]
\SI{5}{\kilo\gram}       → ["Quantity", 5, "kg"]
\unit{\m\per\s}          → ["Divide", "m", "s"]   (unit only, no value)
\si{\mega\hertz}         → "MHz"                   (unit only, legacy)
```

#### Common shorthand

```latex
12\text{ cm}             → ["Quantity", 12, "cm"]
5\;\mathrm{m/s}          → ["Quantity", 5, ["Divide", "m", "s"]]
```

### 3.2 Unit Parsing Rules

Within `\mathrm{...}` or `\text{...}`, the parser interprets:

- `/` as division (exactly one, applies to the rest: `m/s²` = m⋅s⁻²)
- `^` and `^{...}` as exponents
- `\cdot` or `·` as multiplication
- Juxtaposed unit symbols as multiplication (`kg⋅m` = `kg` × `m`)
- SI prefix + unit as a single prefixed unit (`km`, `µs`, `MeV`)
- Parentheses for grouping: `kg/(m·s²)`

### 3.3 LaTeX Serialization

Quantities serialize using `\mathrm` by default:

```
["Quantity", 9.8, ["Divide", "m", ["Power", "s", 2]]]
→ 9.8\,\mathrm{m/s^{2}}
```

Rules:

- Thin space (`\,`) between value and unit
- Units in upright roman type (`\mathrm{...}`)
- Negative exponents or `/` notation (configurable)
- Named units use their symbol: `"N"` → `\mathrm{N}` (not
  `\mathrm{kg\cdot m/s^{2}}`)

---

## 4. Computation

### 4.1 Arithmetic on Quantities

**Addition/Subtraction**: operands must have compatible dimensions. Result is
expressed in the unit of the first operand.

```
["Add", ["Quantity", 12, "cm"], ["Quantity", 1, "m"]]
→ ["Quantity", 112, "cm"]

["Add", ["Quantity", 1, "m"], ["Quantity", 12, "cm"]]
→ ["Quantity", 1.12, "m"]
```

Adding quantities with incompatible dimensions is an error:

```
["Add", ["Quantity", 5, "m"], ["Quantity", 3, "s"]]
→ error: incompatible dimensions (length + time)
```

**Multiplication**: units multiply.

```
["Multiply", ["Quantity", 5, "m"], ["Quantity", 3, "s"]]
→ ["Quantity", 15, ["Multiply", "m", "s"]]

["Multiply", ["Quantity", 10, "N"], ["Quantity", 3, "m"]]
→ ["Quantity", 30, "J"]
```

**Division**: units divide.

```
["Divide", ["Quantity", 100, "m"], ["Quantity", 10, "s"]]
→ ["Quantity", 10, ["Divide", "m", "s"]]
```

**Exponentiation**: unit is raised to the power.

```
["Power", ["Quantity", 3, "m"], 2]
→ ["Quantity", 9, ["Power", "m", 2]]
```

**Scalar multiplication**: a dimensionless number times a quantity.

```
["Multiply", 2, ["Quantity", 5, "kg"]]
→ ["Quantity", 10, "kg"]
```

### 4.2 Unit Conversion

`UnitConvert` converts a quantity to a different (compatible) unit:

```json
["UnitConvert", ["Quantity", 1500, "m"], "km"]
→ ["Quantity", 1.5, "km"]

["UnitConvert", ["Quantity", 1, "J"], ["Multiply", "kg", ["Power", "m", 2], ["Power", "s", -2]]]
→ ["Quantity", 1, ["Multiply", "kg", ["Power", "m", 2], ["Power", "s", -2]]]
```

Converting between incompatible dimensions is an error.

### 4.3 Unit Simplification

`UnitSimplify` reduces a compound unit to the simplest named unit when possible:

```json
["UnitSimplify", ["Quantity", 100, ["Multiply", "kg", "m", ["Power", "s", -2]]]]
→ ["Quantity", 100, "N"]

["UnitSimplify", ["Quantity", 5, ["Divide", "kJ", "kg"]]]
→ ["Quantity", 5, ["Divide", "kJ", "kg"]]   (no simpler named form)
```

### 4.4 Dimensional Analysis

Each unit maps to a dimension vector over the 7 SI base dimensions:

```
[length, mass, time, current, temperature, amount, luminosity]
```

Examples:

- `m` → `[1, 0, 0, 0, 0, 0, 0]`
- `N` → `[1, 1, -2, 0, 0, 0, 0]`
- `V` → `[2, 1, -3, -1, 0, 0, 0]`

Two units are **compatible** if and only if they have the same dimension vector.
This is used to validate addition/subtraction and conversion.

The `evalDimension` handler (already defined in the type system as
`@experimental`) should be implemented for all operators:

- `Add`, `Subtract`: all operands must share the same dimension
- `Multiply`: dimensions add component-wise
- `Divide`: dimensions subtract component-wise
- `Power`: dimensions multiply by the exponent (must be rational)
- Transcendental functions (`Sin`, `Exp`, `Log`): arguments must be
  dimensionless

---

## 5. API Surface

### 5.1 New Functions/Operators

| MathJSON            | Description                           |
| ------------------- | ------------------------------------- |
| `Quantity`          | Construct a value + unit pair         |
| `QuantityMagnitude` | Extract numeric value from a quantity |
| `QuantityUnit`      | Extract unit from a quantity          |
| `UnitConvert`       | Convert to target unit                |
| `UnitSimplify`      | Reduce to simplest named unit         |
| `CompatibleUnitQ`   | Test if two units share a dimension   |
| `UnitDimension`     | Return the dimension vector of a unit |

### 5.2 ComputeEngine API

```typescript
// Parse LaTeX with units
ce.parse('12\\,\\mathrm{cm}')
// → ["Quantity", 12, "cm"]

// Create quantities programmatically
ce.box(['Quantity', 5, 'm'])

// Convert units
ce.box(['UnitConvert', ['Quantity', 1500, 'm'], 'km']).evaluate()
// → ["Quantity", 1.5, "km"]

// Arithmetic
ce.parse('12\\,\\mathrm{cm} + 1\\,\\mathrm{m}').evaluate()
// → ["Quantity", 112, "cm"]
```

### 5.3 Library Registration

Units are a new library category `"units"` (re-adding the previously removed
category):

```typescript
const ce = new ComputeEngine({ libraries: ['arithmetic', 'units'] });
```

The `units` library:

- Depends on `arithmetic`
- Defines all unit symbols (base, derived, prefixed)
- Defines `Quantity`, `UnitConvert`, `UnitSimplify`, etc.
- Registers LaTeX dictionary entries for unit parsing/serialization

The `physics` library (already exists with `Mu0`) should depend on `units` and
define physical constants as quantities:

```json
["Quantity", 299792458, ["Divide", "m", "s"]]   // speed of light
["Quantity", 6.62607015e-34, ["Multiply", "J", "s"]]  // Planck constant
```

---

## 6. Physical Constants

Physical constants should be represented as `Quantity` expressions. The existing
`Mu0` constant in the physics library should be updated to use units.

### 6.1 Defining Constants (CODATA 2018)

| Constant                  | Symbol | Value            | Unit       |
| ------------------------- | ------ | ---------------- | ---------- |
| Speed of light            | c      | 299792458        | m/s        |
| Planck constant           | h      | 6.62607015e-34   | J⋅s        |
| Elementary charge         | e      | 1.602176634e-19  | C          |
| Boltzmann constant        | kB     | 1.380649e-23     | J/K        |
| Avogadro constant         | NA     | 6.02214076e23    | mol⁻¹      |
| Vacuum permeability       | µ₀     | 1.25663706212e-6 | N/A²       |
| Vacuum permittivity       | ε₀     | 8.8541878128e-12 | F/m        |
| Gravitational constant    | G      | 6.67430e-11      | m³/(kg⋅s²) |
| Stefan-Boltzmann constant | σ      | 5.670374419e-8   | W/(m²⋅K⁴)  |
| Gas constant              | R      | 8.314462618      | J/(mol⋅K)  |
| Standard gravity          | g₀     | 9.80665          | m/s²       |

---

## 7. Design Decisions and Open Questions

### 7.1 Decisions

1. **Quantity as an expression, not a type**: `Quantity` is a MathJSON function,
   not a special numeric type. This keeps the boxed expression hierarchy simple
   and leverages existing canonicalization and evaluation infrastructure.


2. **SI-first**: The default unit system is SI. Non-SI units are available but
   conversions always go through SI base units internally.


3. **String unit symbols with DSL sugar**: Simple units are plain strings
   (`"m"`, `"kg"`). Compound units use standard MathJSON operators as the
   **canonical** internal form. However, DSL strings like `"m/s^2"` are accepted
   as input sugar in `Quantity` and parsed into structured form during
   canonicalization.

   ```json
   // Input (accepted):
   ["Quantity", 9.8, "m/s^2"]
   // Canonical form (after canonicalization):
   ["Quantity", 9.8, ["Divide", "m", ["Power", "s", 2]]]
   ```

   This keeps programmatic manipulation clean (pattern matching, dimension
   computation) while making hand-written MathJSON readable. The DSL grammar is
   a subset of the LaTeX unit parser: juxtaposition for multiply, `/` for
   divide, `^` for power, parentheses for grouping, and SI prefixes.

   Ambiguity note: `"ms"` is always parsed as the prefixed unit (millisecond),
   never as meter-second. Use `"m*s"` or the structured form for products.

4. **Prefix = part of the symbol**: `"km"` is a single token, not
   `["Kilo", "m"]`. The engine maps prefixed symbols to their base unit + scale
   factor internally.


5. **First-operand convention for addition**: `12 cm + 1 m = 112 cm`, not
   `1.12 m`. The unit of the first operand determines the result unit. This
   matches common mathematical convention and avoids surprising conversions.


6. **Named unit simplification is opt-in**: `kg⋅m⋅s⁻²` does not automatically
   become `N`. Use `UnitSimplify` explicitly. This preserves user intent and
   avoids information loss.


### 7.2 Open Questions

1. **Currency**: Should currency units be supported? They require live exchange
   rate data and are fundamentally different from physical units.
   Recommendation: out of scope for v1.


2. **Unit systems beyond SI**: Should CGS, Gaussian, or natural units be
   supported as first-class systems? Recommendation: defer to v2. All units
   convert through SI internally.


3. **Uncertainty propagation**: Should `Around` (value ± uncertainty) compose
   with `Quantity`? E.g.
   `["Quantity", ["Around", 9.81, 0.02], ["Divide", "m", ["Power", "s", 2]]]`.
   Recommendation: defer, but design `Quantity` to accept any numeric expression
   as its first argument.


4. **Mixed units**: `5\mathrm{ft}\,11\mathrm{in}` parses naturally as
   `["Add", ["Quantity", 5, "ft"], ["Quantity", 11, "in"]]` and evaluates
   correctly (both are length, so addition works). A dedicated `MixedUnit` would
   only be needed for *display* — converting `1.803 m` back to `5 ft 11 in`.
   That's a serialization concern. Defer to v2.

5. **Logarithmic units**: Decibels (dB) and nepers (Np) are parsed as valid
   unit symbols, producing `["Quantity", 30, "dB"]`. Addition of like
   logarithmic units works (30 dB + 20 dB = 50 dB, since they're already in log
   scale). Conversion between dB and linear scales (e.g. watts) is deferred to
   v2 — `UnitConvert` returns an error for dB-to-linear conversions in v1.

6. **Angular unit unification**: The engine already has `AngularUnit` (rad, deg,
   grad, turn) for trig functions. Should these be unified with the unit system
   so that `["Quantity", 45, "deg"]` works seamlessly with `Sin`?
   Recommendation: yes, unify in v1.


---

## 8. Implementation Plan

### Phase 1: Core Infrastructure

- Define dimension vector type and unit registry
- Implement `Quantity`, `QuantityMagnitude`, `QuantityUnit` operators
- Implement dimensional analysis (compatibility checking)
- Add `units` library category

### Phase 2: Arithmetic and Conversion

- Implement arithmetic on quantities (add, subtract, multiply, divide, power)
- Implement `UnitConvert` and `UnitSimplify`
- Handle temperature conversions (affine transforms)

### Phase 3: LaTeX Parsing

- Parse `\mathrm{...}` and `\text{...}` unit expressions after numbers
- Parse `siunitx` commands (`\qty`, `\SI`, `\unit`, `\si`)
- Serialize quantities back to LaTeX

### Phase 4: Physics Constants

- Update physics library to use `Quantity`
- Define CODATA constants with proper units
- Unify angular units with the quantity system

### Phase 5: Testing

- Unit arithmetic tests
- Conversion tests
- Dimensional analysis validation tests
- LaTeX round-trip tests
- Physical constant tests
