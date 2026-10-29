import { readFile, writeFile, readdir } from 'node:fs/promises';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { REPOSITORY, CHANNEL_SCHEMA, targets, validVersion, selectChannel, fileRecord } from './release-lib.mjs';

const version=process.env.MODYCREW_RELEASE_VERSION,sourceHash=process.env.MODYCREW_SOURCE_SHA256,windowsHash=process.env.MODYCREW_WINDOWS_SHA256;
if(!validVersion(version)||!/^[a-f0-9]{64}$/.test(sourceHash||'')||!/^[a-f0-9]{64}$/.test(windowsHash||''))throw new Error('Release identity is invalid');
const token=process.env.GH_TOKEN;if(!token)throw new Error('Release publishing token is missing');
const api=async(route,{method='GET',body,missing=false}={})=>{const response=await fetch('https://api.github.com'+route,{method,headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json'},...(body?{body:JSON.stringify(body)}:{}),redirect:'error'});if(missing&&response.status===404)return null;if(!response.ok)throw new Error('Release API failed: '+response.status);return response.status===204?null:response.json();};
const walk=async directory=>{const files=[];for(const item of await readdir(directory,{withFileTypes:true})){const name=path.join(directory,item.name);if(item.isSymbolicLink())throw new Error('Unexpected artifact link');if(item.isDirectory())files.push(...await walk(name));else files.push(name);}return files;};
const inputs=await walk('artifacts');const platforms=[];const uploadFiles=[];
for(const target of targets){
  const recordFile=inputs.find(file=>path.basename(file)===`LATEST-${target.platform}-${target.arch}.json`);if(!recordFile)throw new Error('Missing platform record');const record=JSON.parse(await readFile(recordFile));
  if(record.version!==version||record.sourceSha256!==sourceHash||record.windowsSha256!==windowsHash)throw new Error('Platforms do not come from the same Windows release');
  const proofs=inputs.filter(file=>path.basename(file)==='verified-package.json');let proof;
  for(const file of proofs){const value=JSON.parse(await readFile(file));if(value.platform===target.platform&&value.arch===target.arch)proof=value;}
  if(!proof||proof.version!==version||proof.sourceSha256!==sourceHash||proof.windowsSha256!==windowsHash||!proof.actualInstallButton||!proof.savedCopy||!proof.controlledOfflineReopen||!proof.removedThroughUi||!proof.originalPreserved)throw new Error('Platform user-path verification is incomplete');
  const assets=[];
  for(const ext of target.extensions){const expected=record.files.find(file=>file.file===`ModyCrew-${version}-${target.platform}-${target.arch}.${ext}`);if(!expected)throw new Error('Expected release asset is missing');const source=inputs.find(file=>path.basename(file)===expected.file);if(!source)throw new Error('Expected artifact file is missing');const actual=await fileRecord(source);if(actual.bytes!==expected.sizeBytes||actual.sha256!==expected.sha256)throw new Error('Platform artifact checksum mismatch');assets.push({...actual,format:ext});uploadFiles.push(source);}
  platforms.push({id:target.id,platform:target.platform,arch:target.arch,files:assets});
}
const tag='preview-v'+version,releaseUrl=`https://github.com/${REPOSITORY}/releases/tag/${tag}`;
let channel={schema:CHANNEL_SCHEMA,channel:'preview',version,sourceSha256:sourceHash,windowsSha256:windowsHash,releaseTag:tag,releaseUrl,verifiedOn:new Intl.DateTimeFormat('en-CA',{timeZone:'Asia/Seoul',year:'numeric',month:'2-digit',day:'2-digit'}).format(new Date()),signed:false,notarized:false,customerAccountVerified:false,platforms:platforms.map(platform=>({...platform,files:platform.files.map(file=>({...file,url:`https://github.com/${REPOSITORY}/releases/download/${tag}/${file.file}`}))}))};
let release=await api(`/repos/${REPOSITORY}/releases/tags/${tag}`,{missing:true});
if(release&&!release.draft){
  const manifest=release.assets.find(asset=>asset.name==='downloads.json');if(!manifest)throw new Error('Published release is incomplete');const response=await fetch(manifest.browser_download_url);channel=await response.json();if(channel.version!==version||channel.sourceSha256!==sourceHash||channel.windowsSha256!==windowsHash)throw new Error('A different release already uses this version');
}else{
  if(!release)release=await api(`/repos/${REPOSITORY}/releases`,{method:'POST',body:{tag_name:tag,target_commitish:process.env.GITHUB_SHA,name:`ModyCrew ${version} · macOS / Linux 검증판`,draft:true,prerelease:true,body:`같은 Windows ${version} 설치본의 앱 코드와 웹 화면으로 제작한 맥·Linux 검증판입니다.\n\n세 환경의 앱 실행, PDF 선택 설치·검색·사본 저장·오프라인 재열기·제거를 확인했습니다. 계정 로그인과 OS 파일 선택 창은 실사용 검증과 구분합니다.\n\n맥 서명·공증과 실제 고객 계정·기기는 별도 확인이 필요합니다. 설치 안내는 README와 모디 사이트를 확인해 주세요.\n\nSource SHA-256: ${sourceHash}`}});
  await writeFile('downloads.json',JSON.stringify(channel,null,2)+'\n');await writeFile('CHECKSUMS-SHA256.txt',platforms.flatMap(item=>item.files.map(file=>file.sha256+'  '+file.file)).join('\n')+'\n');
  const upload=spawnSync('gh',['release','upload',tag,...uploadFiles,'downloads.json','CHECKSUMS-SHA256.txt','--repo',REPOSITORY,'--clobber'],{stdio:'inherit'});if(upload.status!==0)throw new Error('Draft release upload failed');
  release=await api(`/repos/${REPOSITORY}/releases/${release.id}`);
  for(const platform of platforms)for(const file of platform.files){const asset=release.assets.find(item=>item.name===file.file);if(!asset||asset.size!==file.bytes||asset.digest!=='sha256:'+file.sha256)throw new Error('Uploaded release checksum verification failed');}
  release=await api(`/repos/${REPOSITORY}/releases/${release.id}`,{method:'PATCH',body:{draft:false,prerelease:true}});
}
let committed=false;
for(let attempt=0;attempt<4&&!committed;attempt++){
  const existing=await api(`/repos/${REPOSITORY}/contents/channel.json?ref=main`,{missing:true});
  if(existing){const current=JSON.parse(Buffer.from(existing.content,'base64').toString());if(selectChannel(current,channel)===current){console.log('A newer verified release is already current');committed=true;break;}}
  const response=await fetch(`https://api.github.com/repos/${REPOSITORY}/contents/channel.json`,{method:'PUT',headers:{Authorization:'Bearer '+token,Accept:'application/vnd.github+json','Content-Type':'application/json'},body:JSON.stringify({message:`Publish verified native previews ${version}`,branch:'main',content:Buffer.from(JSON.stringify(channel,null,2)+'\n').toString('base64'),...(existing?{sha:existing.sha}:{})})});
  if(response.status===409)continue;if(!response.ok)throw new Error('Verified download channel update failed: '+response.status);committed=true;
}
if(!committed)throw new Error('Concurrent download channel update; retry publication');
console.log('Published verified macOS/Linux preview '+version+': '+releaseUrl);
