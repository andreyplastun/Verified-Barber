import {test} from 'node:test';
import assert from 'node:assert/strict';
import vm from 'node:vm';
import {mastersLandingHtml} from './masters-landing-html';
import {landingMetadataSchema} from '../shared/landing-analytics';

const shell='<head><link rel="stylesheet" href="/app.css"></head><body><div id="root"></div></body>';
test('only the public masters landing gets HTML and nonblocking styles',()=>{
  for(const url of ['/','/for-masters','/specialists/123','/create-profile','/review/test/1','/admin-dashboard']) assert.equal(mastersLandingHtml(shell,url),shell);
  const html=mastersLandingHtml(shell,'/specialists/?utm_source=ig&utm_term=a%26b&utm_extra=%22%3E%3Cscript%3E&placement=evil&other=drop');
  assert.match(html,/<h1>Отзывы твоих клиентов/);assert.match(html,/media="print"/);
  const url=new URL(html.match(/<a[^>]+href="([^"]+)"/)![1].replaceAll('&amp;','&'),'https://rateus.kz');
  assert.equal(url.pathname,'/create-profile');assert.deepEqual(Object.fromEntries(url.searchParams),{utm_source:'ig',utm_term:'a&b',utm_extra:'"><script>',placement:'hero'});
});
async function run(mount:boolean){
  const html=mastersLandingHtml(shell,'/specialists');const code=[...html.matchAll(/<script>(.*?)<\/script>/gs)].at(-1)![1];
  const blobs:Blob[]=[];const listeners=new Map<string,()=>void>();const add=(k:string,f:()=>void)=>listeners.set(k,f);const remove=(k:string)=>listeners.delete(k);
  const w:{__mastersLandingReady?:()=>string}={};const doc={hidden:false,addEventListener:add,removeEventListener:remove};
  vm.runInNewContext(code,{window:w,crypto,location:{search:'?utm_source=ig&utm_campaign=test'},URLSearchParams,Blob,performance:{now:()=>1234},navigator:{sendBeacon:(_url:string,b:Blob)=>{blobs.push(b);return true}},document:doc,addEventListener:add,removeEventListener:remove});
  const ready=mount?w.__mastersLandingReady?.():null; doc.hidden=true;listeners.get('visibilitychange')?.();listeners.get('pagehide')?.();
  const events=await Promise.all(blobs.map(async b=>JSON.parse(await b.text())));
  for(const e of events){landingMetadataSchema.parse(e.metadata);assert.equal(e.metadata.elapsedMs,1234);assert.equal(e.metadata.utm.campaign,'test');assert.equal(e.metadata.visitId,events[0].metadata.visitId)}
  if(mount)assert.equal(ready,events[0].metadata.visitId);
  return events.map(e=>e.eventType);
}
test('a hidden page followed by pagehide sends one early exit',async()=>assert.deepEqual(await run(false),['master_landing_html_view','master_landing_early_exit']));
test('React handoff shares visitId and disables early exits',async()=>assert.deepEqual(await run(true),['master_landing_html_view']));
