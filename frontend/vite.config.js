import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'
import { sentryVitePlugin } from '@sentry/vite-plugin'
import { fileURLToPath } from 'url'
import { dirname, resolve } from 'path'

const __dirname = dirname(fileURLToPath(import.meta.url))

// https://vite.dev/config/
export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '')
  // Prefer explicit env override for local dev/e2e; fall back to the historical default.
  // NOTE: backend commonly runs on 8001 in this repo's manual validation flow.
  const backendTarget =
    env.NEURA_BACKEND_URL ||
    env.VITE_API_PROXY_TARGET ||
    env.VITE_BACKEND_URL ||
    'http://127.0.0.1:8500'

  return {
  plugins: [
    react(),
    // Sentry source map upload (only when auth token is configured)
    env.SENTRY_AUTH_TOKEN && sentryVitePlugin({
      org: env.SENTRY_ORG,
      project: env.SENTRY_PROJECT,
      authToken: env.SENTRY_AUTH_TOKEN,
      sourcemaps: {
        filesToDeleteAfterUpload: ['./dist/**/*.map'],
      },
    }),
  ].filter(Boolean),
  resolve: {
    alias: {
      '@': resolve(__dirname, 'src'),
      '@mui/material/Grid2': '@mui/material/Grid',
      // React 19 compatibility: redirect react-dom/test-utils to our shim
      'react-dom/test-utils': resolve(__dirname, 'src/app/reactTestUtilsShim.js'),
    },
  },
  server: {
    proxy: {
      // Proxy backend API — pass through as-is (backend routes include /api/v1/).
      '/api': {
        target: backendTarget,
        changeOrigin: true,
      },
      // Static artifacts served by the backend.
      '/uploads': { target: backendTarget, changeOrigin: true },
      '/excel-uploads': { target: backendTarget, changeOrigin: true },
      // WebSockets (collaboration).
      '/ws': { target: backendTarget, changeOrigin: true, ws: true },
    },
  },
  optimizeDeps: {
    include: [
      '@mui/material/Grid',
      '@mui/icons-material/TaskAlt',
      '@mui/icons-material/Schema',
      '@mui/icons-material/SwapHoriz',
      '@mui/icons-material/CheckRounded',
      '@mui/icons-material/Search',
      '@mui/icons-material/RocketLaunch',
      '@mui/icons-material/OpenInNew',
      '@mui/icons-material/Download',
      '@mui/icons-material/FolderOpen',
      '@mui/icons-material/Replay',
      '@mui/x-date-pickers/LocalizationProvider',
      '@mui/x-date-pickers/DateTimePicker',
      '@mui/x-date-pickers/AdapterDayjs',
      '@xyflow/react',
      'motion/react',
      '@tanstack/react-table',
      'dagre',
      '@floating-ui/react',
      '@dnd-kit/core',
      '@dnd-kit/sortable',
      '@formkit/auto-animate',
    ],
  },
  preview: {
    proxy: {
      '/api': {
        target: backendTarget,
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/api/, ''),
      },
      '/uploads': { target: backendTarget, changeOrigin: true },
      '/excel-uploads': { target: backendTarget, changeOrigin: true },
      '/ws': { target: backendTarget, changeOrigin: true, ws: true },
    },
  },
  base: mode === 'production' ? '/neurareport/' : './',
  build: {
    chunkSizeWarningLimit: 1200,
    sourcemap: 'hidden',
    rollupOptions: {
      output: {
        manualChunks: {
          'react-flow': ['@xyflow/react', 'dagre'],
          'motion': ['motion'],
          'timeline': ['vis-timeline', 'vis-data'],
          'pdf-viewer': ['react-pdf'],
          'data-profiling': ['arquero'],
        },
      },
    },
  },
  test: {
    environment: 'jsdom',
    setupFiles: './src/app/setupTests.js',
    css: true,
    include: ['src/**/*.{test,spec}.{js,jsx,ts,tsx}'],
    exclude: ['tests/**/*'],
    // Ensure development mode for React.act
    mode: 'development',
    server: {
      deps: {
        inline: ['react', 'react-dom', '@testing-library/react'],
      },
    },
  },
  }
})
