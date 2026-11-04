// Publishes dist/ to the gh-pages branch (served by GitHub Pages).
//
// The previous deploy's hashed assets are kept alongside the new ones: a tab
// opened before the update still loads its own worker and worklet files
// instead of failing with a 404 the moment it starts one.
import { execSync } from 'node:child_process';
import { cpSync, existsSync, mkdtempSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

const remote = execSync('git remote get-url origin').toString().trim();
const sha = execSync('git rev-parse --short HEAD').toString().trim();
const run = (cmd) => execSync(cmd, { cwd: 'dist', stdio: 'inherit' });

const own = readdirSync('dist/assets');
const prev = mkdtempSync(join(tmpdir(), 'gh-pages-'));
let kept = 0;
try {
  execSync(`git clone -q --depth 1 -b gh-pages ${remote} ${prev}`, { stdio: 'ignore' });
  const manifest = join(prev, 'deploy-manifest.json');
  const theirs = existsSync(manifest) ? JSON.parse(readFileSync(manifest, 'utf8')).assets : existsSync(join(prev, 'assets')) ? readdirSync(join(prev, 'assets')) : [];
  for (const f of theirs) {
    if (own.includes(f) || !existsSync(join(prev, 'assets', f))) continue;
    cpSync(join(prev, 'assets', f), join('dist/assets', f));
    kept++;
  }
} catch {
  // First deploy, or the branch is unreachable: publish without the old files.
} finally {
  rmSync(prev, { recursive: true, force: true });
}

writeFileSync('dist/.nojekyll', '');
writeFileSync('dist/deploy-manifest.json', JSON.stringify({ sha, assets: own }, null, 2));
run('git init -q -b gh-pages');
run('git add -A');
run(`git -c user.name=deploy -c user.email=deploy@localhost commit -q -m "Deploy ${sha}"`);
run(`git push -q -f ${remote} gh-pages`);
console.log('Deployed', sha, 'to gh-pages', kept ? `(kept ${kept} files from the previous deploy for open tabs)` : '');
