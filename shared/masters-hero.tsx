import React from 'react';

// Shared by the HTML response and React, including the critical geometry. No webfont swap.
const styles = `
.rm-hero{box-sizing:border-box;width:100%;max-width:512px;margin:0 auto;padding:48px 20px 32px;text-align:center;color:hsl(var(--foreground,222 47% 11%));font:400 16px/24px system-ui,-apple-system,sans-serif;-webkit-font-smoothing:antialiased}
.rm-hero .rm-label{margin:0 0 12px;color:hsl(var(--primary,216 12% 19%));font:600 12px/16px system-ui,sans-serif;letter-spacing:.1em;text-transform:uppercase}
.rm-hero h1{margin:0 0 12px;color:inherit;font:700 30px/1.25 system-ui,sans-serif;letter-spacing:-.025em}
.rm-hero .rm-sub,.rm-hero .rm-note{color:hsl(var(--muted-foreground,220 9% 46%));font:400 14px/20px system-ui,sans-serif;margin:0 0 24px}
.rm-hero .rm-note{font-size:12px;line-height:16px;margin:8px 0 0}
.rm-hero .rm-link{box-sizing:border-box;display:flex;align-items:center;justify-content:center;gap:8px;width:100%;padding:16px 24px;border-radius:12px;text-decoration:none;color:hsl(var(--primary-foreground,0 0% 100%));background:hsl(var(--primary,216 12% 19%));font:600 16px/24px system-ui,sans-serif}
.rm-hero .rm-link:hover{opacity:.9}`;

export function heroHref(search: string, fallback: Record<string,string | undefined> = {}) {
  const q = new URLSearchParams();
  for (const [key,value] of new URLSearchParams(search)) if (key.startsWith('utm_') || key === 'utm') q.append(key,value);
  for (const [field,value] of Object.entries(fallback)) if (value && !q.has(`utm_${field}`)) q.set(`utm_${field}`,value);
  q.set('placement','hero');
  return '/create-profile?' + q;
}

export function MastersHero({href,onClick}: {href:string;onClick?:React.MouseEventHandler<HTMLAnchorElement>}) {
  return <section className="rm-hero"><style>{styles}</style>
    <p className="rm-label">Rateus — для мастеров</p>
    <h1>Отзывы твоих клиентов — твои.<br/>Не барбершопа.</h1>
    <p className="rm-sub">Клиент после визита оставляет отзыв тебе. Твой профиль, рейтинг и отзывы остаются с тобой, где бы ты ни работал.</p>
    <a className="rm-link" href={href} onClick={onClick} data-testid="button-master-cta-hero">Создать профиль бесплатно<svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round"><path d="M5 12h14m-7-7 7 7-7 7"/></svg></a>
    <p className="rm-note">Без оплаты и карты. 2 минуты.</p>
  </section>;
}
