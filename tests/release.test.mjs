import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import os from 'node:os';
import path from 'node:path';
import JSZip from 'jszip';
import { sha256, extractSource, SOURCE_SCHEMA, CHANNEL_SCHEMA, selectChannel } from '../scripts/release-lib.mjs';

async function fixture(transform=()=>{}) {
  const values={apiKey:'api-fixture-value',authDomain:'auth-fixture.invalid',projectId:'project-fixture-id',storageBucket:'bucket-fixture.invalid',messagingSenderId:'1234567890',appId:'1:123:app:fixture'};
  const files={'app/package.json':JSON.stringify({name:'fixture',version:'1.2.3'}),'app/package-lock.json':'{}','resources/web/account/index.html':'<h1>Account</h1>','resources/web/app.js':JSON.stringify(values),'app-extra/.env':'MODYCREW_GOOGLE_SIGNIN_CLIENT_ID=fixture-client\nMODYCREW_GOOGLE_SIGNIN_CLIENT_SECRET=fixture-only\n'};
  const meta={schema:SOURCE_SCHEMA,version:'1.2.3',windowsSha256:'a'.repeat(64),electronVersion:'44.7.2',firebasePublic:values,files:Object.entries(files).map(([path,bytes])=>({path,bytes:Buffer.byteLength(bytes),sha256:sha256(bytes)}))};
  const zip=new JSZip();for(const [file,bytes]of Object.entries(files))zip.file(file,bytes,{createFolders:false});transform(zip,meta);zip.file('release-source.json',JSON.stringify(meta),{createFolders:false});return zip.generateAsync({type:'nodebuffer'});
}
test('a fixed source bundle preserves its version and all six packaged login values',async t=>{const root=await mkdtemp(path.join(os.tmpdir(),'mody-release-'));t.after(()=>rm(root,{recursive:true,force:true}));const bytes=await fixture();const meta=await extractSource(bytes,root,sha256(bytes),'1.2.3');assert.equal(meta.version,'1.2.3');assert.match(await readFile(path.join(root,'resources/web/account/index.html'),'utf8'),/Account/);});
test('source checksums, version substitution, private environment keys and path escape are rejected',async t=>{
  for(const mode of ['hash','version','environment','traversal','firebase'])await t.test(mode,async sub=>{
    const root=await mkdtemp(path.join(os.tmpdir(),'mody-release-'));sub.after(()=>rm(root,{recursive:true,force:true}));
    const bytes=await fixture((zip,meta)=>{if(mode==='environment'){const value='OPENAI_API_KEY=do-not-publish\n';zip.file('app-extra/.env',value);const file=meta.files.find(item=>item.path==='app-extra/.env');file.bytes=Buffer.byteLength(value);file.sha256=sha256(value);}if(mode==='traversal'){zip.file('../escape.txt','x');meta.files.push({path:'../escape.txt',bytes:1,sha256:sha256('x')});}if(mode==='firebase')delete meta.firebasePublic.appId;});
    await assert.rejects(extractSource(bytes,root,mode==='hash'?'0'.repeat(64):sha256(bytes),mode==='version'?'9.9.9':'1.2.3'));
  });
});
test('an older build finishing late cannot roll the public download channel back',()=>{const base={schema:CHANNEL_SCHEMA,windowsSha256:'b'.repeat(64),sourceSha256:'a'.repeat(64)};const current={...base,version:'1.2.4'},older={...base,version:'1.2.3'};assert.equal(selectChannel(current,older),current);assert.equal(selectChannel(older,current),current);assert.throws(()=>selectChannel(current,{...current,sourceSha256:'c'.repeat(64)}));});
