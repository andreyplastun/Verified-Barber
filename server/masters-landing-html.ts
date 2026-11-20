import {createElement} from 'react';
import {renderToStaticMarkup} from 'react-dom/server';
import {MastersHero,heroHref} from '../shared/masters-hero';

// Kept constant: no request strings are interpolated into executable HTML.
const early = `<script>(function(){try{
var visitId=crypto.randomUUID(),q=new URLSearchParams(location.search),utm={},anonId,done=false,exited=false;
['source','medium','campaign','content'].forEach(function(k){var v=q.get('utm_'+k)||(k==='source'&&q.get('utm'));if(v)utm[k]=v.slice(0,200)});
try{if(!Object.keys(utm).length)utm=JSON.parse(sessionStorage.getItem('rateus_landing_attribution')||'{}')}catch(e){}
try{anonId=localStorage.getItem('rateus_anon_id')||crypto.randomUUID();localStorage.setItem('rateus_anon_id',anonId)}catch(e){}
function send(type,reason,placement){try{var payload={eventType:type,source:utm.source||'direct',anonId:anonId,userAgent:navigator.userAgent,sentAt:new Date().toISOString(),metadata:{page:'/specialists',visitId:visitId,utm:utm,elapsedMs:Math.round(performance.now()),exitReason:reason,placement:placement}};var body=new Blob([JSON.stringify(payload)],{type:'application/json'});if(!navigator.sendBeacon||!navigator.sendBeacon('/api/analytics/event',body))fetch('/api/analytics/event',{method:'POST',body:body,keepalive:true}).catch(function(){})}catch(e){}}
function exit(reason){if(!done&&!exited){exited=true;send('master_landing_early_exit',reason)}}
function click(e){if(!done&&e.target.closest&&e.target.closest('#root>.rm-hero .rm-link'))send('create_profile_click',undefined,'hero')}
function hide(){exit('pagehide')}function visibility(){if(document.hidden)exit('hidden')}
window.__mastersLandingReady=function(){done=true;document.removeEventListener('click',click);removeEventListener('pagehide',hide);document.removeEventListener('visibilitychange',visibility);delete window.__mastersLandingReady;return visitId};
document.addEventListener('click',click);addEventListener('pagehide',hide);document.addEventListener('visibilitychange',visibility);send('master_landing_html_view');
}catch(e){}})()</script>`;

export function isMastersLanding(url: string) { return /^\/specialists\/?$/.test(url.split('?')[0]); }
export function mastersLandingHtml(template:string,url:string) {
  if (!isMastersLanding(url)) return template;
  const hero=renderToStaticMarkup(createElement(MastersHero,{href:heroHref(new URL(url,'https://rateus.kz').search)}));
  // Neither the application sheet nor Google Fonts should block painting the HTML hero.
  return template.replace(/<link\b[^>]*\brel="stylesheet"[^>]*>/gi, tag=>tag.replace('rel="stylesheet"','rel="stylesheet" media="print" onload="this.media=\'all\'"'))
    .replace('</head>',`<style>html:has(#root>.rm-hero){background:hsl(220 16% 97%);-webkit-text-size-adjust:100%;scrollbar-gutter:stable}body:has(#root>.rm-hero){margin:0}html.dark:has(#root>.rm-hero){background:hsl(225 20% 7%);--foreground:210 20% 98%;--primary:220 13% 91%;--primary-foreground:225 20% 7%;--muted-foreground:220 9% 64%}</style><script>try{var t=localStorage.getItem('rateus-theme');if(t==='dark'||(t!=='light'&&matchMedia('(prefers-color-scheme:dark)').matches))document.documentElement.classList.add('dark')}catch(e){}</script></head>`)
    .replace('<div id="root"></div>',()=>`<div id="root">${hero}</div>${early}`);
}
