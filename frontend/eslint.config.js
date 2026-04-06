import js from '@eslint/js'
import globals from 'globals'
import boundaries from 'eslint-plugin-boundaries'
import reactHooks from 'eslint-plugin-react-hooks'
import reactRefresh from 'eslint-plugin-react-refresh'
import { defineConfig, globalIgnores } from 'eslint/config'

const boundaryElements = [
  { type: 'app', pattern: 'src/app/**' },
  { type: 'pages', pattern: 'src/pages/**' },
  { type: 'features', pattern: 'src/features/**' },
  { type: 'layouts', pattern: 'src/layouts/**' },
  { type: 'navigation', pattern: 'src/navigation/**' },
  { type: 'components', pattern: 'src/components/**' },
  { type: 'ui', pattern: 'src/ui/**' },
  { type: 'hooks', pattern: 'src/hooks/**' },
  { type: 'stores', pattern: 'src/stores/**' },
  { type: 'api', pattern: 'src/api/**' },
  { type: 'utils', pattern: 'src/utils/**' },
  { type: 'content', pattern: 'src/content/**' },
  { type: 'assets', pattern: 'src/assets/**' },
]

const boundaryRules = [
  {
    from: 'app',
    allow: [
      'app',
      'pages',
      'features',
      'layouts',
      'navigation',
      'components',
      'ui',
      'hooks',
      'stores',
      'api',
      'utils',
      'content',
      'assets',
    ],
  },
  {
    from: 'pages',
    allow: [
      'features',
      'layouts',
      'navigation',
      'components',
      'ui',
      'hooks',
      'stores',
      'api',
      'utils',
      'content',
      'assets',
    ],
  },
  {
    from: 'features',
    allow: ['features', 'components', 'ui', 'hooks', 'stores', 'api', 'utils', 'content', 'assets'],
  },
  {
    from: 'layouts',
    allow: [
      'layouts',
      'navigation',
      'components',
      'ui',
      'hooks',
      'stores',
      'api',
      'utils',
      'content',
      'assets',
    ],
  },
  {
    from: 'navigation',
    allow: [
      'navigation',
      'components',
      'ui',
      'hooks',
      'stores',
      'api',
      'utils',
      'content',
      'assets',
    ],
  },
  { from: 'components', allow: ['components', 'ui', 'hooks', 'utils', 'content', 'assets'] },
  { from: 'ui', allow: ['ui', 'utils', 'assets'] },
  { from: 'hooks', allow: ['hooks', 'stores', 'api', 'utils'] },
  { from: 'stores', allow: ['stores', 'api', 'utils'] },
  { from: 'api', allow: ['api', 'utils'] },
  { from: 'utils', allow: ['utils', 'api'] },
  { from: 'content', allow: ['content', 'assets', 'utils'] },
  { from: 'assets', allow: ['assets'] },
]

export default defineConfig([
  globalIgnores(['dist', '_backup_*']),
  {
    files: ['**/*.{js,jsx}'],
    extends: [
      js.configs.recommended,
      reactHooks.configs['recommended-latest'],
      reactRefresh.configs.vite,
    ],
    languageOptions: {
      ecmaVersion: 2020,
      globals: globals.browser,
      parserOptions: {
        ecmaVersion: 'latest',
        ecmaFeatures: { jsx: true },
        sourceType: 'module',
      },
    },
    rules: {
      'no-unused-vars': ['warn', { varsIgnorePattern: '^[A-Z_]', argsIgnorePattern: '^_' }],
      'react-refresh/only-export-components': 'off',
    },
  },
  {
    files: ['src/**/*.{js,jsx}'],
    plugins: {
      boundaries,
    },
    settings: {
      'boundaries/elements': boundaryElements,
    },
    rules: {
      'boundaries/element-types': ['error', { default: 'disallow', rules: boundaryRules }],
      'boundaries/no-unknown': 'error',
      'boundaries/no-unknown-files': 'error',
    },
  },
  {
    files: ['**/__tests__/**/*.{js,jsx}', '**/*.test.{js,jsx}', '**/*.spec.{js,jsx}'],
    languageOptions: {
      globals: {
        ...globals.node,
        ...globals.jest,
      },
    },
  },
  {
    files: [
      'vite.config.js',
      'run-audit.cjs',
      'scripts/**/*.{js,cjs,mjs}',
      'tests/**/*.{js,cjs,mjs}',
    ],
    languageOptions: {
      globals: {
        ...globals.node,
      },
    },
  },
])
