import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import { visualizer } from 'rollup-plugin-visualizer'
import path from 'node:path'
import budgets from '../shared/budgets.json'
import { STATIC_CSS_TESTS } from './vitest.static.config.ts'

const sharedHtmlSanitizerPath = path.resolve(import.meta.dirname, '../shared/html-sanitizer.js')

const sharedHtmlSanitizerPlugin = {
  name: 'shared-html-sanitizer',
  enforce: 'pre' as const,
  transform(code: string, id: string) {
    if (path.normalize(id.split('?')[0]) !== path.normalize(sharedHtmlSanitizerPath)) return null

    const match = code.match(/module\.exports\s*=\s*\{([\s\S]*?)\}\s*;/)
    if (!match) {
      return `${code}\nexport { sanitizeHtmlForPdf, sanitizeHtmlForPreview, CSP_META, PREVIEW_CSP_META, isSafeDataUrl, isAllowedGoogleFontUrl };\n`
    }
    const raw = match[1]
    const keys = raw
      .split(',')
      .map((part) => part.split(':')[0].trim().split(/\s+/)[0].trim())
      .map((k) => k.replace(/^['"]|['"]$/g, ''))
      .filter(Boolean)
    if (keys.length === 0) {
      return code.replace(
        /module\.exports\s*=\s*\{[\s\S]*?\}\s*;/,
        'export { sanitizeHtmlForPdf, sanitizeHtmlForPreview, CSP_META, PREVIEW_CSP_META, isSafeDataUrl, isAllowedGoogleFontUrl };',
      )
    }
    return code.replace(
      /module\.exports\s*=\s*\{[\s\S]*?\}\s*;/,
      `export { ${keys.join(', ')} };`,
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
      canvg: path.resolve(import.meta.dirname, './src/empty-module.js'),
    },
  },
  base: mode === 'development' ? '/' : './',
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
        onlyExplicitManualChunks: false,
        manualChunks(id) {
          if (id.includes('\0vite/preload-helper')) return 'vite-preload'
          const n = id.replace(/\\/g, '/')
          if (n.includes('/node_modules/framer-motion/')) return 'vendor-framer'
          if (n.includes('/node_modules/lucide-react/')) return 'vendor-icons'
          if (
            n.includes('/node_modules/react-dom/') ||
            n.includes('/node_modules/scheduler/')
          ) {
            return 'vendor-react'
          }
          if (n.includes('/node_modules/react/')) return 'vendor-react'
          if (n.includes('/node_modules/jspdf/') || n.includes('/node_modules/jspdf-')) {
            return 'vendor-jspdf'
          }
          if (n.includes('/node_modules/html-to-image/')) return 'vendor-html-to-image'
          if (n.includes('/node_modules/pdfjs-dist/')) return 'vendor-pdfjs'
          if (n.includes('/node_modules/i18next/') || n.includes('/node_modules/react-i18next/')) {
            return 'vendor-i18n'
          }
          if (n.includes('/node_modules/web-vitals/')) return 'vendor-web-vitals'
          if (n.includes('/node_modules/@fullcalendar/')) return 'vendor-fullcalendar'
          if (n.includes('/node_modules/@supabase/') || n.includes('/src/lib/supabase')) {
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
    chunkSizeWarningLimit: budgets.vite?.chunkSizeWarningKb ?? 500,
    reportCompressedSize: true,
    cssCodeSplit: true,
    assetsInlineLimit: 4096,
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
    fileParallelism: false,
    maxWorkers: 1,
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
