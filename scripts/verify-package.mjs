import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import assert from 'node:assert/strict';
import {createRequire} from 'node:module';
const root=path.resolve(process.argv[2]);
const manifest=JSON.parse((await fs.readFile(path.join(root,'manifest.json'),'utf8')).replace(/^\uFEFF/,''));
for(const file of manifest.files){
 assert(!/(^|\/)(auth\.json|workspace\.json|backend-session\.json|\.env|\.codex|webview|backups|drafts|\.test-data|test|playwright-core)(\/|$)/.test(file.path),file.path);
 const target=path.resolve(root,file.path);assert(target.startsWith(root+path.sep));
 const bytes=await fs.readFile(target);assert.equal(bytes.length,file.bytes,file.path);
 assert.equal(crypto.createHash('sha256').update(bytes).digest('hex'),file.sha256,file.path);
 if(/^(public|server)\/.*\.(js|mjs|html|css)$/.test(file.path))assert(!/[A-Z]:[\\/]+Users[\\/]+(?!Public\b|Default\b)[a-z0-9_.-]+/i.test(bytes.toString('utf8')),file.path);
}
const require=createRequire(path.join(root,'package.json'));
for(const name of Object.keys(require('./package.json').dependencies))assert(require.resolve(name).startsWith(root));
await fs.access(path.join(root,'dist','AtlasBrowser.exe'));
await fs.access(path.join(root,'native','page-translation.js'));
console.log(`Package verified: ${manifest.files.length} files, runtime dependencies resolve, no user profiles or development tests.`);
