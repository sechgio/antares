import { defineConfig } from 'vitest/config'

/**
 * Static CSS / theme guards: read files from disk and assert tokens/classes.
 * Kept outside the jsdom product suite so they do not inflate coverage or
 * compete with UI tests for host resources.
 */
const STATIC_CSS_TESTS = [
  'src/__tests__/css-classes.test.ts',
  'src/components/settings/themeCoverage.test.ts',
  'src/components/reportes-campo/appearance-css.test.ts',
  'src/components/canvas/__tests__/canvasThemeAlignment.test.tsx',
  'src/components/panel-aviso-corte/panel-styles.test.ts',
  'src/components/padron/vpad-styles.test.ts',
  'src/__tests__/perfHarnessPage.test.ts',
]

export default defineConfig({
  test: {
    globals: true,
    environment: 'node',
    include: STATIC_CSS_TESTS,
    fileParallelism: true,
  },
})

export { STATIC_CSS_TESTS }
