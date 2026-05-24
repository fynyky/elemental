import { defaultReporter } from '@web/test-runner'
import { playwrightLauncher } from '@web/test-runner-playwright'

function logSuite (logger, suite, depth) {
  const indent = '  '.repeat(depth)
  if (suite.name) logger.log(`${indent}${suite.name}`)
  for (const test of suite.tests ?? []) {
    const icon = test.passed ? '✓' : test.skipped ? '-' : '✗'
    logger.log(`${indent}  ${icon} ${test.name}`)
  }
  for (const sub of suite.suites ?? []) {
    logSuite(logger, sub, depth + 1)
  }
}

function verboseReporter () {
  return {
    reportTestFileResults ({ logger, sessionsForTestFile }) {
      for (const session of sessionsForTestFile) {
        if (!session.testResults) continue
        logger.log(`\n[${session.browser.name}]`)
        for (const suite of session.testResults.suites) {
          logSuite(logger, suite, 1)
        }
      }
    }
  }
}

export default {
  files: 'test/test.js',
  nodeResolve: true,
  browsers: [
    playwrightLauncher({ product: 'chromium' }),
    playwrightLauncher({ product: 'firefox' }),
    playwrightLauncher({ product: 'webkit' })
  ],
  reporters: [verboseReporter(), defaultReporter()]
}
