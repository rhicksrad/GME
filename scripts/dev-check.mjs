/* eslint-env node */
const required = ['VITE_FINNHUB_TOKEN', 'VITE_POLYGON_KEY'];

const summary = required.map((key) => {
  const value = process.env[key];
  if (!value) {
    return `${key}: missing`;
  }
  const masked = value.length > 6 ? `${value.slice(0, 3)}***${value.slice(-2)}` : '***';
  return `${key}: loaded (${masked})`;
});

console.log('GME Radar environment check');
summary.forEach((line) => console.log(` - ${line}`));

if (summary.some((line) => line.includes('missing'))) {
  console.log('\nDemo mode will be used for missing credentials.');
}
