import { readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

import type { Plugin, UserConfig } from 'vite-plus';

// grieg.mcpb: `dev/mcp-stdio.ts` for Claude Desktop. It carries no key and no URL; Desktop asks
// for both on install, so one public build serves every user.

const MCPB_PATH = path.dirname(fileURLToPath(import.meta.url));
const ROOT_PATH = path.join(MCPB_PATH, '../..');

function appVersion(): string {
  const properties = readFileSync(path.join(ROOT_PATH, 'gradle.properties'), 'utf8');
  const version = /^version\s*=\s*(.+)$/m.exec(properties)?.[1].trim();
  if (version == null) throw new Error('gradle.properties has no `version`');
  return version;
}

// The source manifest's `$schema` points into node_modules, which means nothing inside the bundle.
function bundleFiles(): Plugin {
  return {
    name: 'grieg-mcpb-files',
    generateBundle() {
      const source = readFileSync(path.join(MCPB_PATH, 'manifest.json'), 'utf8');
      const { $schema: _schema, ...manifest } = JSON.parse(source) as Record<string, unknown>;
      this.emitFile({
        type: 'asset',
        fileName: 'manifest.json',
        source: `${JSON.stringify({ ...manifest, version: appVersion() }, null, 2)}\n`,
      });
      this.emitFile({
        type: 'asset',
        fileName: 'server/package.json',
        source: '{ "type": "commonjs" }\n',
      });
      this.emitFile({
        type: 'asset',
        fileName: 'icon.png',
        source: readFileSync(path.join(MCPB_PATH, 'icon.png')),
      });
    },
  };
}

// One dependency-free CommonJS file, so Desktop's bundled Node, whose version is not documented,
// runs it without type stripping. `server/package.json` pins it as CommonJS wherever it unpacks.
export function mcpbConfig(outDir: string): UserConfig {
  return {
    root: MCPB_PATH,
    publicDir: false,
    plugins: [bundleFiles()],
    build: {
      outDir,
      emptyOutDir: true,
      target: 'es2022',
      minify: false,
      ssr: path.join(MCPB_PATH, '../mcp-stdio.ts'),
      rollupOptions: {
        output: { format: 'cjs', entryFileNames: 'server/index.js' },
      },
    },
  };
}
