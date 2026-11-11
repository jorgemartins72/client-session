import { defineConfig } from 'tsup'

export default defineConfig({
  entry: { index: 'src/index.ts', server: 'src/server.ts' },
  format: ['esm', 'cjs'],
  dts: true,
  clean: true,
  sourcemap: false,
  // h3 é peerDependency opcional: nunca entra no bundle
  external: ['h3'],
})
