import tailwindcss from '@tailwindcss/vite';
import { TanStackRouterVite } from '@tanstack/router-plugin/vite';
import react from '@vitejs/plugin-react';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig, type ConfigEnv, type Plugin, type UserConfig } from 'vite-plus';

import { mockApi } from './dev/mock-api';

const allowedTargets = ['js', 'css'] as const;
type BuildTarget = (typeof allowedTargets)[number];

const isBuildTarget = (target: string | undefined): target is BuildTarget =>
  allowedTargets.includes(target as BuildTarget);

const __dirname = path.dirname(fileURLToPath(import.meta.url));

const { BUILD_TARGET, NODE_ENV } = process.env;
const target = isBuildTarget(BUILD_TARGET) ? BUILD_TARGET : 'js';
const isProduction = NODE_ENV === 'production';
const isDevelopment = NODE_ENV === 'development';

const IN_PATH = path.join(__dirname, 'src/main/resources/assets');
const OUT_PATH = path.join(__dirname, 'build/resources/main/assets');
// Dev harness: the real React app served without XP, against mocked APIs. Lives outside
// src/main/resources so Gradle's processResources never ships it.
const DEV_PATH = path.join(__dirname, 'dev');
const DEV_PORT = 5275;

// Vitest also runs as `serve`, hence the guard.
const isHarness = (_config: UserConfig, env: ConfigEnv): boolean =>
  env.command === 'serve' && process.env.VITEST == null;

// `apply` rather than a conditional plugin list: Vite resolves plugins before config hooks run,
// so a config hook cannot add any.
const serveOnly = (plugins: Plugin[]): Plugin[] =>
  plugins.map((plugin) => ({ ...plugin, apply: isHarness }));

const devHarness: Plugin = {
  name: 'grieg-dev-harness',
  apply: isHarness,
  config: () => ({
    root: DEV_PATH,
    base: '/',
    server: {
      port: DEV_PORT,
      open: false,
      strictPort: true,
    },
  }),
};

const TARGET_CONFIGS: Record<BuildTarget, UserConfig> = {
  js: {
    ...(isProduction && { logLevel: 'warn' }),
    root: IN_PATH,
    base: './',
    plugins: [
      TanStackRouterVite({
        routesDirectory: path.join(IN_PATH, 'js/routes'),
        generatedRouteTree: path.join(IN_PATH, 'js/routeTree.gen.ts'),
        quoteStyle: 'single',
      }),
      react(),
      devHarness,
      ...serveOnly([mockApi(), ...tailwindcss()]),
    ],
    build: {
      outDir: OUT_PATH,
      emptyOutDir: false,
      target: 'ES2023',
      minify: isProduction,
      sourcemap: isDevelopment,
      rollupOptions: {
        input: {
          'js/bundle': path.join(IN_PATH, 'js/app.tsx'),
        },
        output: {
          format: 'es',
          entryFileNames: '[name].js',
          chunkFileNames: 'js/chunks/[name]-[hash].js',
        },
      },
    },
  },
  css: {
    ...(isProduction && { logLevel: 'warn' }),
    root: IN_PATH,
    base: './',
    plugins: [tailwindcss()],
    build: {
      outDir: OUT_PATH,
      emptyOutDir: false,
      minify: isProduction,
      sourcemap: isDevelopment,
      rollupOptions: {
        input: {
          'styles/main': path.join(IN_PATH, 'styles/main.css'),
        },
        output: {
          assetFileNames: (assetInfo) => {
            const name = assetInfo.names?.[0] ?? '';
            if (name.endsWith('.css')) return `styles/${path.basename(name)}`;
            return '[name][extname]';
          },
        },
      },
    },
  },
};

export default defineConfig({
  ...TARGET_CONFIGS[target],
  fmt: {
    singleQuote: true,
    jsxSingleQuote: false,
    sortImports: {
      newlinesBetween: true,
      customGroups: [{ groupName: 'css', elementNamePattern: ['*.css', '*.scss', '*.sass'] }],
      groups: [
        ['value-builtin', 'value-external'],
        'value-internal',
        'type-import',
        ['value-parent', 'value-sibling', 'value-index'],
        'css',
        'unknown',
      ],
    },
    sortPackageJson: false,
    sortTailwindcss: {
      functions: ['cn', 'clsx', 'twMerge'],
    },
  },
  lint: {
    plugins: ['oxc', 'typescript', 'react', 'unicorn'],
    env: {
      builtin: true,
      es2024: true,
    },
    ignorePatterns: [
      'node_modules/',
      'build/',
      'dist/',
      '.gradle/',
      'admin/',
      '**/*.d.ts',
      'src/main/resources/assets/js/routeTree.gen.ts',
    ],
    rules: {
      'no-unused-vars': [
        'error',
        {
          args: 'all',
          argsIgnorePattern: '^_',
          caughtErrors: 'all',
          caughtErrorsIgnorePattern: '^_',
          destructuredArrayIgnorePattern: '^_',
          varsIgnorePattern: '^_',
          ignoreRestSiblings: true,
        },
      ],
      'no-debugger': 'error',
      'no-var': 'error',
      'prefer-const': 'error',
      'prefer-template': 'error',
      'no-redeclare': 'error',
      'no-useless-rename': 'error',
      'no-lone-blocks': 'error',
      'no-unneeded-ternary': 'error',
      'no-array-constructor': 'error',
      'dot-notation': 'error',
      eqeqeq: ['error', 'smart'],
      'operator-assignment': ['error', 'always'],
      'valid-typeof': 'error',

      'typescript/no-explicit-any': 'error',
      'typescript/no-namespace': 'error',
      'typescript/no-require-imports': 'error',
      'typescript/no-extra-non-null-assertion': 'error',
      'typescript/no-misused-new': 'error',
      'typescript/no-unsafe-declaration-merging': 'error',
      'typescript/prefer-as-const': 'error',
      'typescript/prefer-literal-enum-member': 'error',
      'typescript/prefer-namespace-keyword': 'error',
      'typescript/prefer-optional-chain': 'error',
      'typescript/array-type': ['error', { default: 'array' }],
      'typescript/consistent-type-imports': 'error',
      'typescript/consistent-type-exports': 'error',
      'typescript/default-param-last': 'error',
      'typescript/no-unnecessary-type-constraint': 'error',

      'react/exhaustive-deps': 'error',
      'react/rules-of-hooks': 'error',
      'react/jsx-no-useless-fragment': 'error',
      'react/self-closing-comp': 'error',

      'unicorn/prefer-array-flat-map': 'error',
      'unicorn/no-new-array': 'off',
    },
  },
  staged: {
    '*.{ts,tsx,js,jsx}': 'vp lint --fix',
  },
  test: {
    root: __dirname,
    environment: 'node',
    include: ['src/test/**/*.test.{ts,tsx}'],
    // Server modules import XP libraries by absolute path; tests get stubs instead.
    alias: [
      { find: /^\/lib\/xp\/(.*)$/, replacement: path.join(__dirname, 'src/test/stubs/xp/$1.ts') },
    ],
    setupFiles: ['./src/test/setup-dom.ts', './src/test/setup-i18n.ts'],
    passWithNoTests: true,
  },
});
