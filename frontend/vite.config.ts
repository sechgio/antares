import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'node:path'

const sharedHtmlSanitizerPath = path.resolve(__dirname, '../shared/html-sanitizer.js')

const sharedHtmlSanitizerPlugin = {
  name: 'shared-html-sanitizer',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (path.normalize(id.split('?')[0]) !== path.normalize(sharedHtmlSanitizerPath)) return null

    return code.replace(
      /module\.exports = \{[^}]+\};/,
      'export { sanitizeHtmlForPdf, CSP_META, isSafeDataUrl };',
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
      '@': path.resolve(__dirname, './src'),
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
        drop_console: true,
        drop_debugger: true,
        pure_funcs: ['console.log', 'console.info', 'console.debug'],
        passes: 2,
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
          if (
            n.includes('/node_modules/react-dom/') ||
            n.includes('/node_modules/scheduler/') ||
            n.includes('/node_modules/framer-motion/') ||
            n.includes('/node_modules/lucide-react/')
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
          if (n.includes('/node_modules/xlsx/')) return 'vendor-data'
          if (n.includes('/node_modules/i18next/') || n.includes('/node_modules/react-i18next/')) {
            return 'vendor-i18n'
          }
          if (n.includes('/node_modules/@fullcalendar/')) return 'vendor-fullcalendar'
          if (n.includes('/node_modules/@supabase/')) return 'vendor-supabase'
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
    reportCompressedSize: false,
    cssCodeSplit: true,
    assetsInlineLimit: 4096,
  },
  esbuild: {
    drop: mode === 'production' ? ['console', 'debugger'] : [],
    legalComments: 'none',
  },
  optimizeDeps: {
    include: [
      'react',
      'react-dom',
      'framer-motion',
      'lucide-react',
      'i18next',
      'react-i18next',
      'jspdf',
      'html-to-image',
    ],
    exclude: ['pdfjs-dist'],
  },
  test: {
    globals: true,
    environment: 'jsdom',
    setupFiles: ['./src/test-setup.ts'],
    // Disables parallelism between test files. The UI suite renders the whole
    // <App /> (lazy-loading heavy modules such as jspdf, pdfjs-dist and xlsx)
    // and several `findBy*` assertions use 5s timeouts that are tight enough to
    // flake when Vitest runs many jsdom environments concurrently: the host is
    // starved while transforming/importing modules, so the awaited element does
    // not appear within 5s. Running files sequentially removes the race at its
    // root instead of bumping every timeout one by one.
    fileParallelism: false,
  },
}))
