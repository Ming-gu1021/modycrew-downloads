import { createHash } from 'node:crypto';
import { readFile, writeFile, mkdir, lstat } from 'node:fs/promises';
import path from 'node:path';
import JSZip from 'jszip';

export const SOURCE_SCHEMA = 'modycrew.release-source.v1';
export const CHANNEL_SCHEMA = 'modycrew.desktop-downloads.v1';
export const REPOSITORY = 'Ming-gu1021/modycrew-downloads';
export const sha256 = value => createHash('sha256').update(value).digest('hex');
export const validVersion = value => /^\d+\.\d+\.\d+$/.test(value || '');
export const targets = [{ id: 'macos-arm64', platform: 'darwin', arch: 'arm64', extensions: ['dmg', 'zip'] }, { id: 'macos-x64', platform: 'darwin', arch: 'x64', extensions: ['dmg', 'zip'] }, { id: 'linux-x64', platform: 'linux', arch: 'x64', extensions: ['deb', 'AppImage'] }];
export const compareVersions = (left, right) => { const a=left.split('.').map(Number),b=right.split('.').map(Number);for(let i=0;i<3;i++)if(a[i]!==b[i])return a[i]-b[i];return 0; };
export function selectChannel(current,candidate) {
  if(candidate?.schema!==CHANNEL_SCHEMA||!validVersion(candidate.version)||!/^[a-f0-9]{64}$/.test(candidate.sourceSha256||''))throw new Error('Invalid verified channel');
  if(!current)return candidate;
  if(current.schema!==CHANNEL_SCHEMA||!validVersion(current.version))throw new Error('Invalid current channel');
  if(compareVersions(current.version,candidate.version)>0)return current;
  if(current.version===candidate.version&&(current.sourceSha256!==candidate.sourceSha256||current.windowsSha256!==candidate.windowsSha256))throw new Error('A published version cannot change source');
  return candidate;
}
export function safeRelative(value) {
  if (typeof value !== 'string' || !value || value.includes('\\') || value.startsWith('/') || /[\x00-\x1f:]/.test(value) || value.split('/').some(part => !part || part==='.' || part==='..' || /[. ]$/.test(part) || /^(con|prn|aux|nul|com[1-9]|lpt[1-9])(?:\.|$)/i.test(part))) throw new Error('Invalid release source path');
  return value;
}
export function validateSourceMetadata(meta, version) {
  if (meta?.schema!==SOURCE_SCHEMA || !validVersion(version) || meta.version!==version || !/^[a-f0-9]{64}$/.test(meta.windowsSha256||'') || !/^\d+\.\d+\.\d+$/.test(meta.electronVersion||'') || !Array.isArray(meta.files) || !meta.files.length || meta.files.length>12000) throw new Error('Release source identity is invalid');
  const keys=['apiKey','authDomain','projectId','storageBucket','messagingSenderId','appId'];
  if (Object.keys(meta.firebasePublic||{}).length!==6 || keys.some(key=>!String(meta.firebasePublic[key]||'').trim() || /placeholder|replace_me|your[_-]/i.test(meta.firebasePublic[key]))) throw new Error('All six packaged Firebase login settings are required');
  const seen=new Set();for(const file of meta.files){safeRelative(file.path);const key=file.path.toLowerCase();if(seen.has(key)||!/^[a-f0-9]{64}$/.test(file.sha256||'')||!Number.isSafeInteger(file.bytes)||file.bytes<0)throw new Error('Release source manifest is invalid');seen.add(key);}
  if (!seen.has('app/package.json') || !seen.has('app/package-lock.json') || !seen.has('resources/web/account/index.html')) throw new Error('Release source is incomplete');
  return meta;
}
export async function extractSource(archiveBytes, directory, expectedHash, version) {
  if (archiveBytes.length>150*1024*1024 || sha256(archiveBytes)!==expectedHash) throw new Error('Release source checksum mismatch');
  const zip=await JSZip.loadAsync(archiveBytes,{checkCRC32:true});
  const manifest=zip.file('release-source.json');if(!manifest)throw new Error('Release source manifest is missing');
  const meta=validateSourceMetadata(JSON.parse(await manifest.async('string')),version);
  const entries=Object.values(zip.files).filter(item=>!item.dir);if(entries.length!==meta.files.length+1)throw new Error('Unexpected source files');
  const declared=new Map(meta.files.map(file=>[file.path,file]));let expanded=0;
  for(const item of entries){safeRelative(item.unsafeOriginalName||item.name);if((Number(item.unixPermissions)&0o170000)===0o120000)throw new Error('Release source links are forbidden');if(item.name==='release-source.json')continue;const expected=declared.get(item.name);if(!expected||Number(item._data?.uncompressedSize)>expected.bytes)throw new Error('Unexpected source entry');const bytes=await item.async('nodebuffer');expanded+=bytes.length;if(expanded>450*1024*1024||bytes.length!==expected.bytes||sha256(bytes)!==expected.sha256)throw new Error('Release source file checksum mismatch');const file=path.join(directory,...item.name.split('/'));await mkdir(path.dirname(file),{recursive:true});await writeFile(file,bytes,{flag:'wx'});}
  const pkg=JSON.parse(await readFile(path.join(directory,'app/package.json')));if(pkg.version!==version)throw new Error('Packaged app version mismatch');
  const client=await readFile(path.join(directory,'app-extra/.env'),'utf8');const names=client.split(/\r?\n/).map(line=>line.trim()).filter(line=>line&&!line.startsWith('#')).map(line=>line.split('=')[0]);
  if(names.length!==2||!names.includes('MODYCREW_GOOGLE_SIGNIN_CLIENT_ID')||!names.includes('MODYCREW_GOOGLE_SIGNIN_CLIENT_SECRET'))throw new Error('Packaged Google login configuration is invalid');
  const js=meta.files.filter(file=>file.path.startsWith('resources/web/')&&file.path.endsWith('.js'));const values=Object.values(meta.firebasePublic);const found=new Set();for(const file of js){const content=await readFile(path.join(directory,...file.path.split('/')),'utf8');for(const value of values)if(content.includes(value))found.add(value);}if(found.size!==6)throw new Error('Packaged web login configuration does not match the six validated settings');
  return meta;
}
export async function fileRecord(file) { const bytes=await readFile(file);const info=await lstat(file);if(!info.isFile()||info.isSymbolicLink())throw new Error('Invalid release asset');return{file:path.basename(file),bytes:bytes.length,sha256:sha256(bytes)}; }
