import { createHash } from 'node:crypto';
import { lstat, readdir, readFile, writeFile } from 'node:fs/promises';
import { resolve, relative, join, extname } from 'node:path';

const [directory, version] = process.argv.slice(2);
if (!directory || !version || !/^\d+\.\d+\.\d+(?:[-+][\w.-]+)?$/.test(version)) {
  throw new Error('Usage: bun script/release-manifest.ts <release-directory> <version>');
}
const root = resolve(directory);
const files: { path: string; bytes: number; sha256: string; type: string }[] = [];
async function scan(dir: string) {
  for (const entry of await readdir(dir, {withFileTypes:true})) {
    const path = join(dir,entry.name);
    const info = await lstat(path);
    if (info.isSymbolicLink()) throw new Error('Release directories may not contain symbolic links');
    if (info.isDirectory()) { await scan(path); continue; }
    const type = extname(path).slice(1).toLowerCase();
    if (!['exe','msi','dll'].includes(type)) continue;
    files.push({path:relative(root,path).replaceAll('\\','/'),bytes:info.size,sha256:createHash('sha256').update(await readFile(path)).digest('hex'),type});
  }
}
await scan(root);
if (!files.some(f => f.type === 'exe') || !files.some(f => f.type === 'msi')) {
  throw new Error('Release must include both installer MSI and installed executable payloads');
}
files.sort((a,b) => a.path.localeCompare(b.path,'en'));
await writeFile(join(root,'sha256-manifest.json'),JSON.stringify({product:'Managed OpenCode',version,algorithm:'SHA-256',files},null,2)+'\n');
console.log(`Wrote hashes for ${files.length} installer and payload files. Approve updated executable hashes before deployment.`);
