import { mkdir, rm, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { extractSource, validVersion } from './release-lib.mjs';

const version=process.env.MODYCREW_RELEASE_VERSION,expected=process.env.MODYCREW_SOURCE_SHA256;
if(!validVersion(version)||!/^[a-f0-9]{64}$/.test(expected||''))throw new Error('A fixed release version and SHA-256 are required');
const url=new URL(process.env.MODYCREW_SOURCE_URL||'');
if(url.protocol!=='https:'||url.hostname!=='release-assets.githubusercontent.com'||url.username||url.password)throw new Error('Only the approved GitHub source grant is accepted');
if(process.env.GITHUB_ACTIONS)console.log('::add-mask::'+url.href);
let response;try{response=await fetch(url,{redirect:'error',signal:AbortSignal.timeout(180000)});}catch{throw new Error('Source transfer failed; request a fresh one-time source grant');}
if(!response.ok)throw new Error('Source transfer failed: HTTP '+response.status);
const chunks=[];let size=0;for await(const chunk of response.body){size+=chunk.length;if(size>150*1024*1024)throw new Error('Release source is too large');chunks.push(Buffer.from(chunk));}
const repo=process.cwd(),directory=path.resolve(repo,'build/source');
if(!directory.startsWith(path.resolve(repo,'build')+path.sep))throw new Error('Invalid source staging directory');
await rm(directory,{recursive:true,force:true});await mkdir(directory,{recursive:true});
const meta=await extractSource(Buffer.concat(chunks),directory,expected,version);
if(meta.windowsSha256!==process.env.MODYCREW_WINDOWS_SHA256)throw new Error('Windows source identity mismatch');
await writeFile(path.join(directory,'release-source.json'),JSON.stringify(meta));
console.log(`Verified ${version}: ${meta.files.length} source files and all six packaged login settings`);
