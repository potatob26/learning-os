/**
 * 发布 GitHub Release（用本机 git 凭据，不打印 token）
 * ──────────────────────────────────────────────────────────────
 * 用法：
 *   node scripts/publish-github-release.mjs 1.4.4
 *
 * 做三件事：
 *   1. 创建/获取 tag 对应的 Release（draft=false）；
 *   2. 上传 release/v<版本>/ 下的 APK、source.zip、web.zip、SHA256SUMS.txt、下载说明.md；
 *   3. 打印 Release 链接与资产清单。
 *
 * 凭据来源：`git credential fill`（本机推送 GitHub 时存下的凭据）。
 * 没有凭据会明确报错，不会退化成匿名请求。
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import https from 'node:https';

const version = process.argv[2];
if (!version) {
  console.error('用法：node scripts/publish-github-release.mjs <版本号，例如 1.4.4>');
  process.exit(1);
}
const tag = `v${version}`;
const repo = process.env.GITHUB_REPO ?? 'potatob26/learning-os';
const dir = join('release', tag);
const notesFile = join('docs', `UPDATE-${tag}.md`);
if (!existsSync(notesFile)) {
  console.error(`缺少发布说明：${notesFile}`);
  process.exit(1);
}
if (!existsSync(join(dir, `LearningOS-${tag}.apk`))) {
  console.error(`缺少 APK：${dir}/LearningOS-${tag}.apk`);
  process.exit(1);
}

/** 从 git credential helper 取 token（不输出） */
function getToken() {
  try {
    const out = execFileSync('git', ['credential', 'fill'], {
      input: 'protocol=https\nhost=github.com\n\n',
      encoding: 'utf8',
      env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
    });
    const password = out.split(/\r?\n/).find((line) => line.startsWith('password='))?.slice(9);
    if (password) return password;
  } catch {
    /* 下面统一报错 */
  }
  console.error(
    '没有可用的 GitHub 凭据。请先在终端执行一次 `git push` 完成登录，或安装 gh 后 `gh auth login`。',
  );
  process.exit(1);
}

const token = getToken();

function request(method, path, { headers = {}, body } = {}) {
  return new Promise((resolve, reject) => {
    const req = https.request(
      {
        hostname: path.startsWith('uploads.') ? 'uploads.github.com' : 'api.github.com',
        path: path.replace(/^uploads\.github\.com/, ''),
        method,
        headers: {
          Authorization: `Bearer ${token}`,
          'User-Agent': 'LearningOS-release',
          Accept: 'application/vnd.github+json',
          ...headers,
        },
      },
      (res) => {
        const chunks = [];
        res.on('data', (c) => chunks.push(c));
        res.on('end', () => {
          const text = Buffer.concat(chunks).toString('utf8');
          let data;
          try {
            data = JSON.parse(text);
          } catch {
            data = text;
          }
          if (res.statusCode >= 200 && res.statusCode < 300) resolve(data);
          else reject(new Error(`HTTP ${res.statusCode}: ${typeof data === 'string' ? data : data.message}`));
        });
      },
    );
    req.on('error', reject);
    if (body) req.write(body);
    req.end();
  });
}

const notes = readFileSync(notesFile, 'utf8');
console.log(`创建 Release ${tag} …`);
const release = await request('POST', `/repos/${repo}/releases`, {
  headers: { 'Content-Type': 'application/json' },
  body: JSON.stringify({
    tag_name: tag,
    target_commitish: 'main',
    name: `${tag} · 设置里可以手动检查更新`,
    body: notes,
    draft: false,
    prerelease: false,
    make_latest: 'true',
  }),
});
console.log(`Release：${release.html_url}`);

const files = [
  ['LearningOS-v1.4.4.apk', 'application/vnd.android.package-archive'],
  ['LearningOS-v1.4.4-source.zip', 'application/zip'],
  ['LearningOS-v1.4.4-web.zip', 'application/zip'],
  ['SHA256SUMS.txt', 'text/plain; charset=utf-8'],
  ['下载说明.md', 'text/markdown; charset=utf-8'],
].map(([name, type]) => [name.replace(/v1\.4\.4/g, tag), type]);

for (const [name, contentType] of files) {
  const file = join(dir, name);
  if (!existsSync(file)) {
    console.log(`跳过（不存在）：${name}`);
    continue;
  }
  const data = readFileSync(file);
  const encoded = encodeURIComponent(name);
  console.log(`上传 ${name}（${(data.length / 1024 / 1024).toFixed(2)} MB）…`);
  const asset = await request('POST', `/uploads.github.com/repos/${repo}/releases/${release.id}/assets?name=${encoded}`, {
    headers: { 'Content-Type': contentType, 'Content-Length': data.length },
    body: data,
  });
  console.log(`  → ${asset.browser_download_url}`);
}

const check = await request('GET', `/repos/${repo}/releases/tags/${tag}`);
console.log(`\n完成：${check.html_url}`);
console.log(`状态：draft=${check.draft} prerelease=${check.prerelease} assets=${check.assets.length}`);
