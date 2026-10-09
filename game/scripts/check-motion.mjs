// Use the bundler installed by Vite to run the diagnostic against the actual TS modules.
import { build } from 'rolldown';
const result = await build({
  input: new URL('./check-motion.ts', import.meta.url).pathname,
  platform: 'node', write: false,
  external: ['node:fs', 'node:assert/strict'],
  output: { format: 'esm' },
});
try {
  await import(`data:text/javascript;base64,${Buffer.from(result.output[0].code).toString('base64')}`);
} catch (error) {
  // Data-URL stack traces otherwise print the entire bundled Three.js source.
  console.error(error.message);
  process.exitCode = 1;
}
