import { playwrightLauncher } from '@web/test-runner-playwright'

export default {
  files: 'test/test.js',
  nodeResolve: true,
  browsers: [
    playwrightLauncher({ product: 'chromium' }),
    playwrightLauncher({ product: 'firefox' }),
    playwrightLauncher({ product: 'webkit' })
  ]
}
