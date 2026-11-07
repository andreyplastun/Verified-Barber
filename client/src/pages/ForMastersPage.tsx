import { useEffect, useMemo } from "react";
import { Link, useSearch } from "wouter";
import { motion } from "framer-motion";
import { Star, MessageCircle, Users, ShieldCheck, ArrowRight, CheckCircle } from "lucide-react";
import { useSpecialists } from "@/hooks/use-specialists";
import { trackEvent } from "@/lib/analytics";
import { LegalFooter } from "@/components/LegalFooter";
import PhotoThumbnail from "@/components/PhotoThumbnail";
import { getAttribution, registrationUrl } from "@/lib/attribution";
import { useLandingAnalytics } from "@/hooks/use-landing-analytics";
import { clarityEvent } from "@/lib/clarity";

export default function ForMastersPage() {
  const searchString = useSearch();
  const { data: specialists } = useSpecialists();

  const utm = useMemo(() => getAttribution(searchString), [searchString]);
  useLandingAnalytics(utm);

  useEffect(() => {
    window.scrollTo(0, 0);
  }, []);

  // Keep the strongest eligible Almaty example first, then rank by reviews.
  const topSpecialists = useMemo(() => {
    if (!specialists) return [];
    const ranked = [...specialists]
      .filter((s: any) => (s.reviewCount ?? 0) > 0 && s.imageUrl && (s.trustedRating ?? 0) >= 4)
      .sort((a: any, b: any) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0));
    const local = ranked.find(s => ["алматы", "almaty"].includes((s.city || "").trim().toLowerCase()));
    return (local ? [local, ...ranked.filter(s => s.id !== local.id)] : ranked).slice(0, 3);
  }, [specialists]);

  const handleCtaClick = (placement: string) => {
    if (placement === "catalog") clarityEvent("find_in_catalog_click");
    else if (placement === "hero" || placement === "bottom") clarityEvent("create_profile_click");
    const event = placement === "catalog" ? "find_in_catalog_click" : placement === "login" ? "login_click" : "create_profile_click";
    trackEvent(event, { source: utm.source || "direct", metadata: { utm, placement, page: "/specialists" } });
  };

  const benefits = [
    {
      icon: MessageCircle,
      title: "Rateus отправляет запрос на отзыв",
      text: "Подключи Altegio или добавь визит вручную. Rateus отправит клиенту ссылку в WhatsApp — тебе не нужно писать ему самому.",
    },
    {
      icon: Star,
      title: "Рейтинг, который остаётся с тобой",
      text: "Твой профиль объединяет отзывы о твоей работе. Где бы ты ни работал, клиентам доступен твой рейтинг и опыт.",
    },
    {
      icon: Users,
      title: "Клиенты находят тебя в каталоге",
      text: "Люди выбирают мастера по реальным отзывам. Твой профиль помогает им узнать о твоей работе ещё до записи.",
    },
    {
      icon: ShieldCheck,
      title: "Отзывы, которым верят",
      text: "Отзывы привязаны к визитам клиентов. Это помогает новым клиентам выбрать тебя по реальному опыту других.",
    },
  ];

  const steps = [
    "Создай профиль — 2 минуты",
    "Подключи Altegio, если есть доступ, или добавь визит и номер клиента вручную",
    "Rateus отправит запрос, а клиент сможет оставить тебе отзыв",
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <section className="px-5 pt-12 pb-8 max-w-lg mx-auto text-center">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-3">Rateus — для мастеров</p>
          <h1 className="text-3xl font-bold leading-tight mb-3">
            Отзывы твоих клиентов — твои.<br />
            Не барбершопа.
          </h1>
          <p className="text-muted-foreground text-sm mb-6">
            Клиент после визита оставляет отзыв тебе. Твой профиль, рейтинг и отзывы остаются с тобой, где бы ты ни работал.
          </p>
          <Link
            href={registrationUrl(utm)}
            onClick={() => handleCtaClick("hero")}
            className="inline-flex items-center justify-center gap-2 w-full bg-primary text-primary-foreground font-semibold rounded-xl px-6 py-4 hover:opacity-90 transition-opacity"
            data-testid="button-master-cta-hero"
          >
            Создать профиль бесплатно
            <ArrowRight size={18} />
          </Link>
          <p className="text-xs text-muted-foreground mt-2">Без оплаты и карты. 2 минуты.</p>
        </motion.div>
      </section>

      {/* Social proof */}
      {topSpecialists.length > 0 && (
        <section className="px-5 pb-8 max-w-lg mx-auto">
          <p className="text-xs font-semibold text-muted-foreground uppercase tracking-wide mb-3 text-center">
            Мастера уже собирают отзывы на Rateus
          </p>
          <div className="space-y-2">
            {topSpecialists.map((s: any) => (
              <Link
                key={s.id}
                href={`/specialist/${s.id}`}
                className="flex items-center gap-3 bg-card border border-border rounded-xl p-3 hover:bg-muted/50 transition-colors"
                data-testid={`card-master-proof-${s.id}`}
              >
                <PhotoThumbnail src={s.imageUrl} alt={s.name} loading="lazy" className="w-11 h-11 rounded-full object-cover" />
                <div className="min-w-0 flex-1">
                  <p className="text-sm font-semibold truncate">{s.name}</p>
                  <p className="text-xs text-muted-foreground truncate">{s.city || ""}</p>
                </div>
                <div className="text-right shrink-0">
                  <p className="text-sm font-semibold flex items-center gap-1 justify-end">
                    <Star size={14} className="text-yellow-500 fill-yellow-500" />
                    {Number(s.trustedRating ?? 0).toFixed(1)}
                  </p>
                  <p className="text-xs text-muted-foreground">{s.reviewCount} отзывов</p>
                </div>
              </Link>
            ))}
          </div>
        </section>
      )}

      <section className="px-5 pb-8 max-w-lg mx-auto" aria-label="Частые вопросы">
        <div className="bg-card border border-border rounded-xl p-4 space-y-4">
          <div>
            <h2 className="text-sm font-semibold mb-1">Нет доступа к записи барбершопа?</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">Добавь визит и номер клиента вручную — Rateus отправит запрос на отзыв.</p>
          </div>
          <div>
            <h2 className="text-sm font-semibold mb-1">Что получит клиент?</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">Сообщение в WhatsApp со ссылкой на отзыв.</p>
          </div>
          <div>
            <h2 className="text-sm font-semibold mb-1">Это бесплатно?</h2>
            <p className="text-xs text-muted-foreground leading-relaxed">Да, без оплаты и карты.</p>
          </div>
        </div>
      </section>

      {/* Benefits */}
      <section className="px-5 pb-8 max-w-lg mx-auto space-y-3">
        {benefits.map((b) => (
          <div key={b.title} className="bg-card border border-border rounded-xl p-4 flex gap-3">
            <b.icon size={20} className="text-primary shrink-0 mt-0.5" />
            <div>
              <p className="text-sm font-semibold mb-1">{b.title}</p>
              <p className="text-xs text-muted-foreground leading-relaxed">{b.text}</p>
            </div>
          </div>
        ))}
      </section>

      {/* How it works */}
      <section className="px-5 pb-8 max-w-lg mx-auto">
        <h2 className="text-lg font-bold mb-4 text-center">Как это работает</h2>
        <div className="space-y-3">
          {steps.map((step, i) => (
            <div key={i} className="flex items-start gap-3">
              <span className="w-6 h-6 rounded-full bg-primary/10 text-primary text-xs font-bold flex items-center justify-center shrink-0 mt-0.5">
                {i + 1}
              </span>
              <p className="text-sm text-foreground/90">{step}</p>
            </div>
          ))}
        </div>
      </section>

      {/* Already listed */}
      <section className="px-5 pb-8 max-w-lg mx-auto">
        <div className="bg-primary/5 border border-primary/20 rounded-xl p-4">
          <p className="text-sm font-semibold mb-1 flex items-center gap-2">
            <CheckCircle size={16} className="text-primary" />
            Возможно, ты уже на Rateus
          </p>
          <p className="text-xs text-muted-foreground mb-3">
            Если твой барбершоп подключён к Rateus, твой профиль с отзывами уже может быть в каталоге. Найди себя и забери профиль.
          </p>
          <Link
            href="/"
            onClick={() => handleCtaClick("catalog")}
            className="text-sm font-semibold text-primary inline-flex items-center gap-1"
            data-testid="link-master-find-self"
          >
            Найти себя в каталоге <ArrowRight size={14} />
          </Link>
        </div>
      </section>

      {/* Final CTA */}
      <section className="px-5 pb-10 max-w-lg mx-auto text-center">
        <Link
          href={registrationUrl(utm)}
          onClick={() => handleCtaClick("bottom")}
          className="inline-flex items-center justify-center gap-2 w-full bg-primary text-primary-foreground font-semibold rounded-xl px-6 py-4 hover:opacity-90 transition-opacity"
          data-testid="button-master-cta-bottom"
        >
          Создать профиль бесплатно
          <ArrowRight size={18} />
        </Link>
      </section>

      <LegalFooter />
    </div>
  );
}
