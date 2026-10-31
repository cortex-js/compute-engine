// The reserved words of GLSL and WGSL, and the identifier check against them.

const GLSL_RESERVED: ReadonlySet<string> = new Set([
  // storage/parameter qualifiers
  'attribute',
  'const',
  'uniform',
  'varying',
  'buffer',
  'shared',
  'coherent',
  'volatile',
  'restrict',
  'readonly',
  'writeonly',
  'layout',
  'centroid',
  'flat',
  'smooth',
  'noperspective',
  'patch',
  'sample',
  'in',
  'out',
  'inout',
  'precision',
  'invariant',
  'precise',
  'subroutine',
  // precision qualifiers and the aggregate keyword
  'lowp',
  'mediump',
  'highp',
  'struct',
  // control flow
  'break',
  'continue',
  'do',
  'for',
  'while',
  'switch',
  'case',
  'default',
  'if',
  'else',
  'discard',
  'return',
  // scalar/vector/matrix types
  'void',
  'bool',
  'int',
  'uint',
  'float',
  'double',
  'vec2',
  'vec3',
  'vec4',
  'dvec2',
  'dvec3',
  'dvec4',
  'bvec2',
  'bvec3',
  'bvec4',
  'ivec2',
  'ivec3',
  'ivec4',
  'uvec2',
  'uvec3',
  'uvec4',
  'mat2',
  'mat3',
  'mat4',
  'mat2x2',
  'mat2x3',
  'mat2x4',
  'mat3x2',
  'mat3x3',
  'mat3x4',
  'mat4x2',
  'mat4x3',
  'mat4x4',
  'dmat2',
  'dmat3',
  'dmat4',
  // opaque/sampler types
  'sampler2D',
  'sampler3D',
  'samplerCube',
  'sampler2DArray',
  'sampler2DShadow',
  'samplerCubeShadow',
  'isampler2D',
  'usampler2D',
  'atomic_uint',
  'image2D',
  // literals
  'true',
  'false',
  // reserved-for-future-use / common built-ins that a bare var would collide with
  'filter',
  'texture',
  'asm',
  'class',
  'union',
  'enum',
  'typedef',
  'template',
  'this',
  'packed',
  'goto',
  'inline',
  'noinline',
  'public',
  'static',
  'extern',
  'external',
  'interface',
  'long',
  'short',
  'half',
  'fixed',
  'unsigned',
  'superp',
  'input',
  'output',
  'hvec2',
  'hvec3',
  'hvec4',
  'fvec2',
  'fvec3',
  'fvec4',
  'sizeof',
  'cast',
  'namespace',
  'using',
]);

/**
 * WGSL reserved words + keywords. As with GLSL, a user variable matching one of
 * these cannot be emitted bare; the target fails closed.
 */
const WGSL_RESERVED: ReadonlySet<string> = new Set([
  // keywords
  'alias',
  'break',
  'case',
  'const',
  'const_assert',
  'continue',
  'continuing',
  'default',
  'diagnostic',
  'discard',
  'else',
  'enable',
  'false',
  'fn',
  'for',
  'if',
  'let',
  'loop',
  'override',
  'requires',
  'return',
  'struct',
  'switch',
  'true',
  'var',
  'while',
  // types / type-generators
  'bool',
  'f16',
  'f32',
  'i32',
  'u32',
  'vec2',
  'vec3',
  'vec4',
  'vec2f',
  'vec3f',
  'vec4f',
  'vec2i',
  'vec3i',
  'vec4i',
  'vec2u',
  'vec3u',
  'vec4u',
  'mat2x2',
  'mat2x3',
  'mat2x4',
  'mat3x2',
  'mat3x3',
  'mat3x4',
  'mat4x2',
  'mat4x3',
  'mat4x4',
  'array',
  'atomic',
  'ptr',
  'sampler',
  'sampler_comparison',
  'texture_1d',
  'texture_2d',
  'texture_2d_array',
  'texture_3d',
  'texture_cube',
  'texture_cube_array',
  'texture_multisampled_2d',
  // address spaces / builtins that a bare var would collide with
  'function',
  'private',
  'workgroup',
  'uniform',
  'storage',
  'read',
  'write',
  'read_write',
  'texture',
  'sample',
  'filter',
  // reserved words (subset of the WGSL reserved list)
  'as',
  'async',
  'attribute',
  'auto',
  'binding',
  'cast',
  'compile',
  'do',
  'enum',
  'extern',
  'external',
  'inline',
  'instance',
  'interface',
  'match',
  'namespace',
  'new',
  'null',
  'of',
  'operator',
  'public',
  'reference',
  'self',
  'set',
  'shared',
  'static',
  'super',
  'template',
  'this',
  'typedef',
  'union',
  'unless',
  'using',
  'virtual',
  'where',
]);

/** The reserved-word set for a GPU shader language, or an empty set. */
function gpuReservedWords(language?: string): ReadonlySet<string> {
  if (language === 'wgsl') return WGSL_RESERVED;
  if (language === 'glsl') return GLSL_RESERVED;
  return new Set();
}

/**
 * Fail closed if `id` is a reserved word in the target shader language.
 * A user variable / loop index carrying a reserved name would emit source that
 * fails to compile on the GPU — surface a clear diagnostic instead. Returns the
 * identifier unchanged when it is safe.
 */
export function gpuCheckIdentifier(id: string, language?: string): string {
  if (gpuReservedWords(language).has(id))
    throw new Error(
      `"${id}" is a reserved word in ${language ?? 'this shader language'} and cannot be used as a variable name. Rename it before compiling to a GPU target (fail closed, D6).`
    );
  return id;
}

/**
 * The built-in variables that a GLSL shader body of each stage may read with
 * no declaration: GLSL ES 3.00 (WebGL 2) and the desktop GLSL 3.30+ names of
 * the same stages. `compileShaderBody()` accepts a free symbol with one of
 * these names; any other undeclared name is refused, because the shader would
 * fail when the GPU compiles it.
 */
export const GLSL_STAGE_BUILTINS: Record<string, ReadonlySet<string>> = {
  vertex: new Set([
    'gl_VertexID',
    'gl_InstanceID',
    'gl_Position',
    'gl_PointSize',
    'gl_ClipDistance',
    'gl_DepthRange',
  ]),
  fragment: new Set([
    'gl_FragCoord',
    'gl_FrontFacing',
    'gl_PointCoord',
    'gl_FragDepth',
    'gl_PrimitiveID',
    'gl_SampleID',
    'gl_SamplePosition',
    'gl_Layer',
    'gl_ViewportIndex',
    'gl_ClipDistance',
    'gl_DepthRange',
  ]),
  compute: new Set([
    'gl_NumWorkGroups',
    'gl_WorkGroupID',
    'gl_LocalInvocationID',
    'gl_GlobalInvocationID',
    'gl_LocalInvocationIndex',
    'gl_WorkGroupSize',
  ]),
};

/**
 * The built-in OUTPUT variables that a GLSL shader body of each stage may
 * assign with no declaration, and their types: GLSL ES 3.00 §7.1 and §7.2
 * (`gl_Position` and `gl_PointSize` in a vertex shader, `gl_FragDepth` in a
 * fragment shader). The other names of `GLSL_STAGE_BUILTINS` are inputs, which
 * a shader cannot assign. `gl_ClipDistance` is not here: it is an array of the
 * desktop language only, and a body target is a whole output or components of
 * a vector output, never an array element.
 */
export const GLSL_STAGE_BUILTIN_OUTPUTS: Record<
  string,
  ReadonlyArray<{ name: string; type: string }>
> = {
  vertex: [
    { name: 'gl_Position', type: 'vec4' },
    { name: 'gl_PointSize', type: 'float' },
  ],
  fragment: [{ name: 'gl_FragDepth', type: 'float' }],
};

/**
 * The types of the built-in variables of `GLSL_STAGE_BUILTINS` that a body
 * can read as a value, for the type check of a `compileShader()` body
 * statement: GLSL ES 3.00 §7.1 and §7.2, and §7.1 of desktop GLSL 4.60 for
 * the names that GLSL ES does not have. `gl_DepthRange` is a struct, which no
 * output type accepts, and is not here.
 */
export const GLSL_STAGE_BUILTIN_TYPES: Record<
  string,
  Record<string, string>
> = {
  vertex: {
    gl_VertexID: 'int',
    gl_InstanceID: 'int',
    gl_Position: 'vec4',
    gl_PointSize: 'float',
    gl_ClipDistance: 'float[]',
  },
  fragment: {
    gl_FragCoord: 'vec4',
    gl_FrontFacing: 'bool',
    gl_PointCoord: 'vec2',
    gl_FragDepth: 'float',
    gl_PrimitiveID: 'int',
    gl_SampleID: 'int',
    gl_SamplePosition: 'vec2',
    gl_Layer: 'int',
    gl_ViewportIndex: 'int',
    gl_ClipDistance: 'float[]',
  },
};
