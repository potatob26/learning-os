import { chromium } from 'playwright-core';

const attempts = [
  { label: 'chrome', opts: { channel: 'chrome', headless: true } },
  { label: 'chrome-no-sandbox', opts: { channel: 'chrome', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--disable-crash-reporter'] } },
  { label: 'edge', opts: { channel: 'msedge', headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage'] } },
];

for (const a of attempts) {
  try {
    const b = await chromium.launch(a.opts);
    const p = await b.newPage();
    await p.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
    const title = await p.title();
    console.log(`SUCCESS ${a.label} -> title="${title}"`);
    await b.close();
    process.exit(0);
  } catch (e) {
    console.log(`FAIL ${a.label}: ${String(e).split('\n')[0]}`);
  }
}
process.exit(1);
