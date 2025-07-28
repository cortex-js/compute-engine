import { parseType } from './src/common/type/parse';

// Test cases covering different complexity levels
const testCases = [
  { name: 'Simple primitives', types: ['boolean', 'integer', 'string', 'number'] },
  { name: 'Collections', types: ['list<integer>', 'tuple<string, number>', 'record<name: string>'] },
  { name: 'Function signatures', types: ['(number) -> number', '(x: number, y: number) -> number', '(number+) -> number'] },
  { name: 'Union types', types: ['string | number', 'boolean | integer | string', 'list<string> | record<name: string>'] },
  { name: 'Intersection types', types: ['list<string> & record<length: integer>', '(string | number) & (boolean | integer)'] },
  { name: 'Complex nested', types: [
    'list<tuple<string, record<id: integer, data: list<number>>>>',
    'record<users: list<record<name: string, posts: list<record<title: string, content: string>>>>>'
  ]}
];

function benchmarkTypeCategory(categoryName: string, types: string[], iterations = 1000) {
  console.log(`\n📊 Testing ${categoryName}:`);
  console.log('-'.repeat(80));
  
  const results = [];
  
  for (const typeString of types) {
    const start = process.hrtime.bigint();
    
    for (let i = 0; i < iterations; i++) {
      try {
        parseType(typeString);
      } catch (e) {
        // Ignore parse errors for benchmarking
      }
    }
    
    const end = process.hrtime.bigint();
    const timeMs = Number(end - start) / 1_000_000;
    const avgTimeMs = timeMs / iterations;
    
    results.push({
      type: typeString,
      totalTime: timeMs,
      avgTime: avgTimeMs,
      iterations
    });
    
    const truncatedType = typeString.length > 60 ? typeString.substring(0, 57) + '...' : typeString;
    console.log(`  ${truncatedType.padEnd(60)} ${avgTimeMs.toFixed(4)}ms`);
  }
  
  const avgForCategory = results.reduce((sum, r) => sum + r.avgTime, 0) / results.length;
  console.log(`  ${'AVERAGE'.padEnd(60)} ${avgForCategory.toFixed(4)}ms`);
  
  return results;
}

function main() {
  console.log('🚀 Type Parser Performance Analysis\n');
  console.log('Measuring performance of the current modular parser implementation');
  
  const iterations = 1000;
  console.log(`Running ${iterations} iterations per test case...\n`);
  
  const allResults = [];
  
  for (const category of testCases) {
    const results = benchmarkTypeCategory(category.name, category.types, iterations);
    allResults.push(...results);
  }
  
  // Overall summary
  console.log('\n' + '='.repeat(80));
  console.log('📈 OVERALL PERFORMANCE SUMMARY');
  console.log('='.repeat(80));
  
  const totalAvgTime = allResults.reduce((sum, r) => sum + r.avgTime, 0) / allResults.length;
  const fastest = allResults.reduce((min, r) => r.avgTime < min.avgTime ? r : min);
  const slowest = allResults.reduce((max, r) => r.avgTime > max.avgTime ? r : max);
  
  console.log(`Average parse time across all types: ${totalAvgTime.toFixed(4)}ms`);
  console.log(`Fastest: ${fastest.type} (${fastest.avgTime.toFixed(4)}ms)`);
  console.log(`Slowest: ${slowest.type} (${slowest.avgTime.toFixed(4)}ms)`);
  console.log(`Performance ratio (slowest/fastest): ${(slowest.avgTime / fastest.avgTime).toFixed(2)}x`);
  
  // Performance characteristics
  console.log('\n🔍 Performance Characteristics:');
  const primitiveTime = allResults.filter(r => ['boolean', 'integer', 'string', 'number'].includes(r.type))
    .reduce((sum, r) => sum + r.avgTime, 0) / 4;
  const complexTime = allResults.filter(r => r.type.includes('record<users:'))
    .reduce((sum, r) => sum + r.avgTime, 0) || allResults[allResults.length - 1].avgTime;
  
  console.log(`• Simple primitives average: ${primitiveTime.toFixed(4)}ms`);
  console.log(`• Complex nested types: ${complexTime.toFixed(4)}ms`);
  console.log(`• Complexity overhead: ${(complexTime / primitiveTime).toFixed(2)}x`);
  
  console.log('\n✅ Performance analysis complete!');
}

main();