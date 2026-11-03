// Publishes dist/ to the gh-pages branch (served by GitHub Pages).
import { execSync } from 'node:child_process';
import { writeFileSync } from 'node:fs';

const remote = execSync('git remote get-url origin').toString().trim();
const sha = execSync('git rev-parse --short HEAD').toString().trim();
const run = (cmd) => execSync(cmd, { cwd: 'dist', stdio: 'inherit' });

writeFileSync('dist/.nojekyll', '');
run('git init -q -b gh-pages');
run('git add -A');
run(`git -c user.name=deploy -c user.email=deploy@localhost commit -q -m "Deploy ${sha}"`);
run(`git push -q -f ${remote} gh-pages`);
console.log('Deployed', sha, 'to gh-pages');
