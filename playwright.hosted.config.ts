import { defineConfig } from '@playwright/test';
export default defineConfig({
  testDir:'./tests/hosted-browser',fullyParallel:false,workers:1,timeout:45000,
  use:{baseURL:'http://127.0.0.1:5390',browserName:'chromium',channel:'chrome',viewport:{width:1440,height:1080},screenshot:'only-on-failure',trace:'retain-on-failure'},
  outputDir:'test-results-hosted',reporter:[['list']],
  webServer:{command:'npm run dev:hosted:test',url:'http://127.0.0.1:5390',reuseExistingServer:false,timeout:60000},
});
