import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'node:path'
import { STATIC_CSS_TESTS } from './vitest.static.config.ts'

const sharedHtmlSanitizerPath = path.resolve(import.meta.dirname, '../shared/html-sanitizer.js')

const sharedHtmlSanitizerPlugin = {
  name: 'shared-html-sanitizer',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (path.normalize(id.split('?')[0]) !== path.normalize(sharedHtmlSanitizerPath)) return null

    return code.replace(
      /module\.exports = \{[^}]+\};/,
      'export { sanitizeHtmlForPdf, sanitizeHtmlForPreview, CSP_META, PREVIEW_CSP_META, isSafeDataUrl, isAllowedGoogleFontUrl };',
    )
  },
}

export default defineConfig(({ mode }) => ({
  plugins: [
    sharedHtmlSanitizerPlugin,
    react(),
    mode === 'analyze' && visualizer({ open: true, gzipSize: true, brotliSize: true }),
  ],
  resolve: {
    alias: {
      '@': path.resolve(import.meta.dirname, './src'),
    },
  },
  base: mode === 'development' ? '/' : './',
  // Electron hardcodes http://localhost:5173. If this port is taken, Vite must
  // fail (not silently move to 5174) or Electron loads the wrong app.
  server: {
    port: 5173,
    strictPort: true,
  },
  build: {
    outDir: 'dist',
    emptyOutDir: true,
    sourcemap: mode === 'development',
    minify: 'terser',
    terserOptions: {
      compress: {
        drop_console: false,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug'],
        passes: 1,
      },
      mangle: {
        safari10: true,
      },
      format: {
        comments: false,
      },
    },
    rollupOptions: {
      output: {
        // Function form + onlyExplicitManualChunks: object-form manualChunks let
        // Rollup merge shared deps (react/react-dom, vite preload helper) into
        // the first overlapping vendor (jspdf/dnd/i18n). Result: Canvas statically
        // imported ~371KB jsPDF for `__vitePreload`, and the entry modulepreloaded
        // dnd because react-dom lived inside it. See vite#16429 / rollup onlyExplicitManualChunks.
        onlyExplicitManualChunks: false,
        manualChunks(id) {
          if (id.includes('\0vite/preload-helper')) return 'vite-preload'
          const n = id.replace(/\\/g, '/')
          // framer-motion is lazy (LoginScreen / feature tabs) — keep out of vendor-react
          // so the shell entry does not preload ~100KB+ of motion code.
          if (n.includes('/node_modules/framer-motion/')) return 'vendor-framer'
          if (n.includes('/node_modules/lucide-react/')) return 'vendor-icons'
          if (
            n.includes('/node_modules/react-dom/') ||
            n.includes('/node_modules/scheduler/')
          ) {
            return 'vendor-react'
          }
          // Exact /react/ package — not react-i18next / react-dom / etc.
          if (n.includes('/node_modules/react/')) return 'vendor-react'
          if (n.includes('/node_modules/jspdf/') || n.includes('/node_modules/jspdf-')) {
            return 'vendor-jspdf'
          }
          if (n.includes('/node_modules/html-to-image/')) return 'vendor-html-to-image'
          if (n.includes('/node_modules/pdfjs-dist/')) return 'vendor-pdfjs'
          // xlsx removed: spreadsheet parsing now lives in backend (spreadsheet_parse)
          if (n.includes('/node_modules/i18next/') || n.includes('/node_modules/react-i18next/')) {
            return 'vendor-i18n'
          }
          if (n.includes('/node_modules/web-vitals/')) return 'vendor-web-vitals'
          if (n.includes('/node_modules/@fullcalendar/')) return 'vendor-fullcalendar'
          if (n.includes('/node_modules/@supabase/') || n.includes('/src/lib/supabase')) {
            // Keep createClient + our thin wrapper in the same async chunk so
            // AuthContext's dynamic import() does not statically link vendor-supabase
            // into the app shell (Rollup otherwise inlines the tiny wrapper).
            return 'vendor-supabase'
          }
          if (n.includes('/node_modules/@dnd-kit/')) return 'vendor-dnd'
          return undefined
        },
        assetFileNames: (assetInfo) => {
          const info = assetInfo.name || ''
          if (/\.(png|jpe?g|gif|svg|webp|ico)$/i.test(info)) {
            return 'assets/images/[name]-[hash][extname]'
          }
          if (/\.css$/i.test(info)) {
            return 'assets/css/[name]-[hash][extname]'
          }
          return 'assets/[name]-[hash][extname]'
        },
        chunkFileNames: 'assets/js/[name]-[hash].js',
        entryFileNames: 'assets/js/[name]-[hash].js',
      },
    },
    chunkSizeWarningLimit: 500,
    reportCompressedSize: true,
    cssCodeSplit: true,
    assetsInlineLimit: 4096,
    // Do not modulepreload lazy-route vendors (supabase/framer) just because the
    // entry's __vitePreload map lists them for Login/Settings. Shell stays lean.
    modulePreload: {
      resolveDependencies(_filename, deps) {
        return deps.filter(
          (dep) => !dep.includes('vendor-supabase') && !dep.includes('vendor-framer'),
        )
      },
    },
  },
  esbuild: {
    drop: mode === 'production' ? ['debugger'] : [],
    legalComments: 'none',
  },
  optimizeDeps: {
    // Only deps needed on the shell critical path. jspdf / html-to-image /
    // framer-motion load via dynamic import — prebundling them slows Vite cold start.
    include: [
      'react',
      'react-dom',
      'lucide-react',
      'i18next',
      'react-i18next',
    ],
    exclude: ['pdfjs-dist'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Sequential file execution avoids OOM on constrained CI (2GB RAM) but
    // allow 2 workers for within-file parallelism; full parallel (true/4)
    // caused flaky timeouts on Windows CI with 120+ jsdom suites.
    fileParallelism: false,
    maxWorkers: 1,
    // Static CSS/theme guards run under vitest.static.config.ts (node env).
    exclude: [
      '**/node_modules/**',
      '**/dist/**',
      ...STATIC_CSS_TESTS,
    ],
    coverage: {
      provider: 'v8',
      reportsDirectory: './coverage',
      reporter: ['text', 'lcov', 'html', 'json'],
      thresholds: {
        lines: 70,
        branches: 65,
        statements: 70,
        functions: 65,
      },
    },
  },
}))
