// Run a benchmark module with cache statistics on, then print the report.
const target = process.argv[2];
const { formatCacheStats } = await import('/Users/arno/dev/compute-engine/src/common/cache-stats.ts');
await import(target);
console.log(formatCacheStats());
