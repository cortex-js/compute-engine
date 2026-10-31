// This module re-exports the GPU compilation modules under the names it
// exported before the split, so its importers keep working. New code imports
// an item from the module that defines it.

export { GPU_OPERATORS, formatGPUNumber } from './gpu-emit.js';
export {
  assertGPUInlineElementCount,
  GPU_FUNCTIONS,
  compileGPUMatrix,
} from './gpu-functions.js';
export { gpuCheckIdentifier } from './gpu-reserved.js';
export {
  gpuAssertExpressionBody,
  gpuNeedsStatements,
} from './gpu-statements.js';
export {
  gpuUniformVectorWidth,
  assertGPUScalarComponents,
  gpuOperandShape,
  markOperandConsuming,
  gpuAbsorbedConstant,
} from './gpu-shapes.js';
export type { GPUShapeRules } from './gpu-shapes.js';
export { gpuDrawCount } from './gpu-draw-order.js';
export {
  GPU_FLOOR_MOD_PREAMBLE_GLSL,
  GPU_FLOOR_MOD_PREAMBLE_WGSL,
  gpuFloorModCall,
  GPU_TANH_PREAMBLE_WGSL,
  GPU_NAN_SAFE_PREAMBLE_GLSL,
  GPU_NAN_SAFE_PREAMBLE_WGSL,
} from './gpu-nan-safe.js';
export { gpuPointDeclaration } from './gpu-points.js';
export { gpuAtIndexGuard } from './gpu-at.js';
export {
  newGPURandomState,
  gpuRandomState,
  GPU_RANDOM_COUNTER_PREFIX,
} from './gpu-random.js';
export type { GPURandomState } from './gpu-random.js';
export {
  GPU_GAMMA_PREAMBLE_GLSL,
  GPU_GAMMA_PREAMBLE_WGSL,
  GPU_POLYGAMMA_PREAMBLE_GLSL,
  GPU_POLYGAMMA_PREAMBLE_WGSL,
  GPU_ZETA_PREAMBLE_GLSL,
  GPU_ZETA_PREAMBLE_WGSL,
  GPU_LERCH_PREAMBLE_GLSL,
  GPU_LERCH_PREAMBLE_WGSL,
  GPU_ERF_PREAMBLE_GLSL,
  GPU_ERF_PREAMBLE_WGSL,
  GPU_HEAVISIDE_PREAMBLE_GLSL,
  GPU_HEAVISIDE_PREAMBLE_WGSL,
  GPU_SINC_PREAMBLE_GLSL,
  GPU_SINC_PREAMBLE_WGSL,
  GPU_POLEVL_PREAMBLE_GLSL,
  GPU_POLEVL_PREAMBLE_WGSL,
  GPU_FRESNELC_PREAMBLE_GLSL,
  GPU_FRESNELC_PREAMBLE_WGSL,
  GPU_FRESNELS_PREAMBLE_GLSL,
  GPU_FRESNELS_PREAMBLE_WGSL,
  GPU_BESSELJ_PREAMBLE_GLSL,
  GPU_BESSELJ_PREAMBLE_WGSL,
  GPU_FRACTAL_PREAMBLE_GLSL,
  GPU_FRACTAL_PREAMBLE_WGSL,
  GPU_GCD_PREAMBLE_GLSL,
  GPU_GCD_PREAMBLE_WGSL,
  GPU_PCG3D_PREAMBLE_GLSL,
  GPU_PCG3D_PREAMBLE_WGSL,
  GPU_MEDIAN_PREAMBLE_GLSL,
  GPU_MEDIAN_PREAMBLE_WGSL,
  GPU_COLOR_PREAMBLE_GLSL,
  GPU_COLOR_PREAMBLE_WGSL,
  GPU_NAN_PREAMBLE_WGSL,
  GPU_POWI_PREAMBLE_GLSL,
  GPU_POWI_PREAMBLE_WGSL,
} from './gpu-preambles.js';
export { gpuLibrarySubset } from './gpu-library.js';
export {
  gpuPointOrPointListUnion,
  gpuTypeOfValue,
} from './gpu-declared-types.js';
export type {
  GPUShaderDeclaration,
  GPUTargetExtension,
} from './gpu-declared-types.js';
export { GPUShaderTarget } from './gpu-shader-target.js';
