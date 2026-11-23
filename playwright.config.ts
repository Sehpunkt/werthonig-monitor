import { defineConfig, devices } from '@playwright/test';

const SITE_URL = (process.env.SITE_URL || 'https://werthonig.de').replace(/\/$/, '');

export default defineConfig({
  testDir: './tests',
  timeout: 90_000,
  expect: {
    timeout: 15_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.02,
      animations: 'disabled',
      caret: 'hide',
    },
  },
  fullyParallel: false,
  workers: 1,
  retries: process.env.CI ? 1 : 0,
  outputDir: 'test-results',
  snapshotPathTemplate: '{testDir}/__screenshots__/{projectName}/{arg}{ext}',
  reporter: [
    ['list'],
    ['html', { open: 'never', outputFolder: 'playwright-report' }],
    ['json', { outputFile: 'results/results.json' }],
  ],
  use: {
    baseURL: SITE_URL,
    locale: 'de-DE',
    timezoneId: 'Europe/Berlin',
    trace: 'retain-on-failure',
    screenshot: 'only-on-failure',
    // Kennung, damit Zugriffe in Server-Logs erkennbar sind.
    userAgent: undefined,
    extraHTTPHeaders: { 'X-Update-Monitor': '1' },
  },
  projects: [
    {
      name: 'desktop',
      use: { ...devices['Desktop Chrome'], viewport: { width: 1366, height: 900 } },
    },
    {
      name: 'mobile',
      testMatch: /visual\.spec\.ts/,
      use: { ...devices['Pixel 7'] },
    },
  ],
});
