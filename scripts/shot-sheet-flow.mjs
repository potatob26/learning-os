/**
 * 打开目标页 → 点开第一张卡（编辑弹层）→ 截图 → 点删除 → 再截图（确认态）
 * 用法：node scripts/shot-sheet-flow.mjs
 */
import { chromium } from 'playwright-core';
import { existsSync } from 'node:fs';
import { SEED } from './lib-seed.mjs';

const CHROME = 'C:\\Program Files\\Google\\Chrome\\Application\\chrome.exe';
const browser = await chromium.launch({
  executablePath: existsSync(CHROME) ? CHROME : 'C:\\Program Files (x86)\\Microsoft\\Edge\\Application\\msedge.exe',
  headless: true, args: ['--no-sandbox', '--disable-dev-shm-usage', '--force-color-profile=srgb'],
});
const ctx = await browser.newContext({
  viewport: { width: 412, height: 915 }, deviceScaleFactor: 2, isMobile: true, hasTouch: true,
  locale: 'zh-CN', timezoneId: 'Asia/Shanghai',
});
const page = await ctx.newPage();

await page.goto('http://127.0.0.1:5188/', { waitUntil: 'load' });
await page.evaluate((s) => localStorage.setItem('learning-os:v1:state', JSON.stringify(s)), SEED);
await page.goto('http://127.0.0.1:5188/#/goals', { waitUntil: 'load' });
await page.reload({ waitUntil: 'load' });
await page.waitForTimeout(1200);

await page.screenshot({ path: '.preview/flow-goals-compact.png', fullPage: true });

// 点第一张没完成的目标卡（GoalItem 的文字按钮）
const cards = page.locator('button.min-h-11').filter({ hasText: '物理错题重做' });
if (await cards.count()) {
  await cards.first().click();
} else {
  // 退而求其次：点列表里第一个可点标题
  await page.getByText('物理错题重做').first().click();
}
await page.waitForTimeout(700);
await page.screenshot({ path: '.preview/flow-sheet-open.png' });

// 弹层底部删除按钮：第一下进入确认态
const del = page.getByRole('button', { name: '删除' }).last();
await del.click();
await page.waitForTimeout(400);
await page.screenshot({ path: '.preview/flow-sheet-confirm.png' });

// 再点一下应该真的删除并关闭
await page.getByRole('button', { name: '确认删除' }).click();
await page.waitForTimeout(600);
const stillThere = await page.getByText('物理错题重做').count();
const sheetGone = (await page.locator('[role="dialog"]').count()) === 0;
console.log(`删除后：目标仍在页面=${stillThere > 0}  弹层已关闭=${sheetGone}`);
await browser.close();
