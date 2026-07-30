import * as esbuild from 'esbuild';
import { fileURLToPath } from 'node:url';

const root = fileURLToPath(new URL('..', import.meta.url));

await esbuild.build({
  entryPoints: [`${root}server/index.ts`],
  bundle: true,
  platform: 'node',
  target: 'node20',
  format: 'esm',
  outfile: `${root}dist/server.js`,
  packages: 'external',
  sourcemap: true,
  banner: {
    // ws pulls in a couple of CJS-isms; keep require available inside the ESM bundle.
    js: "import { createRequire as __cr } from 'module'; const require = __cr(import.meta.url);",
  },
  alias: {
    '@shared': `${root}shared`,
  },
  logLevel: 'info',
});
