import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, realpath } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import path from 'node:path';
import os from 'node:os';
import PDFDocument from 'pdfkit';
import { _electron } from '@playwright/test';

const output=path.resolve('proof');await mkdir(output,{recursive:true});
const profile=await mkdtemp(path.join(os.tmpdir(),'mody-native-release-'));
const original=path.join(output,'original.pdf'),saved=path.join(output,'review-copy.pdf');
const bytes=await new Promise((resolve,reject)=>{const doc=new PDFDocument(),chunks=[];doc.on('data',chunk=>chunks.push(chunk));doc.on('end',()=>resolve(Buffer.concat(chunks)));doc.on('error',reject);doc.fontSize(24).text('ModyCrew native release acceptance');doc.fontSize(14).text('Searchable evidence in the packaged application.');doc.addPage().text('Offline second page.');doc.end();});
await writeFile(original,bytes);const originalHash=createHash('sha256').update(bytes).digest('hex');
const build=path.resolve('build/output');
const executable=process.env.MODYCREW_TEST_EXECUTABLE||(process.platform==='darwin'?path.join(build,process.arch==='arm64'?'mac-arm64':'mac','ModyCrew.app/Contents/MacOS/ModyCrew'):path.join(build,'linux-unpacked/ModyCrew'));
const environment={...process.env};for(const key of ['MODYCREW_SOURCE_URL','GH_TOKEN','GITHUB_TOKEN'])delete environment[key];
const app=await _electron.launch({executablePath:executable,args:[...(process.platform==='linux'?['--no-sandbox']:[]),'--user-data-dir='+profile],env:environment,timeout:60000});
const pageErrors=[];let inspectedPage;
async function savedPdf(){const deadline=Date.now()+30000;while(Date.now()<deadline){try{const value=await readFile(saved);if(value.subarray(0,5).toString()==='%PDF-')return;}catch{}await new Promise(resolve=>setTimeout(resolve,100));}throw new Error('The PDF copy was not saved');}
try{
  assert.equal(await realpath(await app.evaluate(({app})=>app.getPath('userData'))),await realpath(profile));
  assert.equal(await app.evaluate(({app})=>app.getVersion()),process.env.MODYCREW_RELEASE_VERSION);
  const page=await app.firstWindow();inspectedPage=page;page.on('pageerror',error=>pageErrors.push(error.message));await page.locator('input[type=password]').waitFor({state:'visible',timeout:30000});assert.match(page.url(),/^modycrew:\/\/app\/account/);
  await page.screenshot({path:path.join(output,'account.png')});
  await app.evaluate(({dialog},fixtures)=>{
    globalThis.__nativeReleaseRequests=[];globalThis.__nativeReleaseOffline=false;const originalFetch=globalThis.fetch;
    globalThis.fetch=(...args)=>{if(String(args[0]).startsWith('https://mody.ai.kr/resources/modycrew/modules/')){if(globalThis.__nativeReleaseOffline)throw new Error('Controlled offline acceptance');globalThis.__nativeReleaseRequests.push(String(args[0]));}return originalFetch(...args);};
    dialog.showOpenDialog=async()=>({canceled:false,filePaths:[fixtures.original]});dialog.showSaveDialog=async()=>({canceled:false,filePath:fixtures.saved});
  },{original,saved});
  await page.goto('modycrew://app/documents/?preview=workbench');
  const install=page.getByRole('button',{name:'모디 자료실에서 설치 · 6.3MB',exact:true});await install.waitFor({state:'visible',timeout:30000});await install.click();
  const open=page.getByRole('button',{name:'PDF 열기',exact:true});await open.waitFor({state:'visible',timeout:150000});
  assert.deepEqual(await app.evaluate(()=>globalThis.__nativeReleaseRequests),['https://mody.ai.kr/resources/modycrew/modules/catalog.json','https://mody.ai.kr/resources/modycrew/modules/pdfjs-6.4.299-dist.zip']);
  await page.screenshot({path:path.join(output,'installed.png')});
  let windowEvent=app.waitForEvent('window');await open.click();let viewer=await windowEvent;
  await viewer.waitForFunction(()=>globalThis.PDFViewerApplication?.pdfDocument?.numPages===2,null,{timeout:60000});await viewer.locator('#viewer .page canvas').first().waitFor({state:'visible'});
  await viewer.locator('#viewFindButton').click();await viewer.locator('#findInput').fill('Searchable evidence');await viewer.locator('#findInput').press('Enter');await viewer.waitForFunction(()=>PDFViewerApplication.findController.pageMatches.some(matches=>matches?.length>0));
  await viewer.screenshot({path:path.join(output,'first-pdf.png')});await viewer.locator('#downloadButton').click();await savedPdf();await viewer.close();
  await app.evaluate(()=>{globalThis.__nativeReleaseOffline=true;});windowEvent=app.waitForEvent('window');await open.click();viewer=await windowEvent;await viewer.waitForFunction(()=>globalThis.PDFViewerApplication?.pdfDocument?.numPages===2,null,{timeout:60000});await viewer.close();
  await page.getByRole('button',{name:'뷰어 제거',exact:true}).click();await page.getByRole('button',{name:'제거 확인',exact:true}).click();await install.waitFor({state:'visible',timeout:30000});
  assert.equal(createHash('sha256').update(await readFile(original)).digest('hex'),originalHash);
  const proof={schema:'modycrew.packaged-release-proof.v1',version:process.env.MODYCREW_RELEASE_VERSION,platform:process.platform,arch:process.arch,actualPackagedApplication:true,accountScreen:true,actualInstallButton:true,pdfPages:2,textSearch:true,savedCopy:true,controlledOfflineReopen:true,removedThroughUi:true,originalPreserved:true,accountMode:'existing local workbench preview; customer login not exercised',nativeDialogs:'fixture selections; no OS dialog interaction',customerAccountVerified:false,sourceSha256:process.env.MODYCREW_SOURCE_SHA256,windowsSha256:process.env.MODYCREW_WINDOWS_SHA256};
  await writeFile(path.join(output,'verified-package.json'),JSON.stringify(proof,null,2));console.log('Packaged application, installation and PDF user paths passed');
}catch(error){
  if(inspectedPage&&!inspectedPage.isClosed()){await inspectedPage.screenshot({path:path.join(output,'failed-state.png')}).catch(()=>{});const state={url:inspectedPage.url(),body:(await inspectedPage.locator('body').innerText().catch(()=>'' )).slice(0,7000),pageErrors,message:error.message};await writeFile(path.join(output,'failed-state.json'),JSON.stringify(state,null,2));console.error(JSON.stringify(state));}
  throw error;
}finally{await app.close();}
