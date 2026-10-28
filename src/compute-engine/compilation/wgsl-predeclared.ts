/**
 * The predeclared names of WGSL: the built-in functions, the types and the
 * type aliases, read from the function and type index of the WGSL
 * specification (W3C, 2026). A module-scope declaration with one of these
 * names hides the built-in from the whole module, and the helpers that the
 * shader targets emit call the built-ins. So a name that the compilation
 * declares at module scope (a storage buffer, a field function, its
 * parameter struct and variable) cannot be one of them.
 *
 * Used by `gpuStorageBufferOperand()` (`gpu-target.ts`) and by
 * `WGSLTarget.compileFieldFunction()` (`wgsl-field-function.ts`). This file
 * imports nothing, so both can import it with no circular dependency.
 */
export const WGSL_PREDECLARED: ReadonlySet<string> = new Set([
  ...'abs acos acosh all any arrayLength asin asinh atan atan2 atanh'.split(
    ' '
  ),
  ...(
    'atomicAdd atomicAnd atomicCompareExchangeWeak atomicExchange atomicLoad ' +
    'atomicMax atomicMin atomicOr atomicStore atomicSub atomicXor'
  ).split(' '),
  ...(
    'bitcast ceil clamp cos cosh countLeadingZeros countOneBits ' +
    'countTrailingZeros cross degrees determinant distance dot dot4I8Packed ' +
    'dot4U8Packed dpdx dpdxCoarse dpdxFine dpdy dpdyCoarse dpdyFine exp exp2 ' +
    'extractBits faceForward firstLeadingBit firstTrailingBit floor fma fract ' +
    'frexp fwidth fwidthCoarse fwidthFine insertBits inverseSqrt ldexp length ' +
    'log log2 max min mix modf normalize pack2x16float pack2x16snorm ' +
    'pack2x16unorm pack4x8snorm pack4x8unorm pack4xI8 pack4xI8Clamp pack4xU8 ' +
    'pack4xU8Clamp pow quadBroadcast quadSwapDiagonal quadSwapX quadSwapY ' +
    'quantizeToF16 radians reflect refract reverseBits round saturate select ' +
    'sign sin sinh smoothstep sqrt step storageBarrier subgroupAdd subgroupAll ' +
    'subgroupAnd subgroupAny subgroupBallot subgroupBroadcast ' +
    'subgroupBroadcastFirst subgroupElect subgroupExclusiveAdd ' +
    'subgroupExclusiveMul subgroupInclusiveAdd subgroupInclusiveMul ' +
    'subgroupMax subgroupMin subgroupMul subgroupOr subgroupShuffle ' +
    'subgroupShuffleDown subgroupShuffleUp subgroupShuffleXor subgroupXor tan ' +
    'tanh textureBarrier textureDimensions textureGather textureGatherCompare ' +
    'textureLoad textureNumLayers textureNumLevels textureNumSamples ' +
    'textureSample textureSampleBaseClampToEdge textureSampleBias ' +
    'textureSampleCompare textureSampleCompareLevel textureSampleGrad ' +
    'textureSampleLevel textureStore transpose trunc unpack2x16float ' +
    'unpack2x16snorm unpack2x16unorm unpack4x8snorm unpack4x8unorm unpack4xI8 ' +
    'unpack4xU8 workgroupBarrier workgroupUniformLoad'
  ).split(' '),
  ...(
    'bool f16 f32 i32 u32 array atomic ptr sampler sampler_comparison ' +
    'buffer_view'
  ).split(' '),
  ...[2, 3, 4].flatMap((n) =>
    ['', 'f', 'h', 'i', 'u'].map((s) => `vec${n}${s}`)
  ),
  ...[2, 3, 4].flatMap((c) =>
    [2, 3, 4].flatMap((r) => ['', 'f', 'h'].map((s) => `mat${c}x${r}${s}`))
  ),
  ...(
    'texture_1d texture_2d texture_2d_array texture_3d texture_cube ' +
    'texture_cube_array texture_depth_2d texture_depth_2d_array ' +
    'texture_depth_cube texture_depth_cube_array texture_depth_multisampled_2d ' +
    'texture_external texture_multisampled_2d texture_storage_1d ' +
    'texture_storage_2d texture_storage_2d_array texture_storage_3d'
  ).split(' '),
]);
