import { useEffect, useMemo } from "react";
import { Link, useSearch } from "wouter";
import { motion } from "framer-motion";
import { Star, MessageCircle, Users, ShieldCheck, ArrowRight, CheckCircle } from "lucide-react";
import { useSpecialists } from "@/hooks/use-specialists";
import { trackEvent } from "@/lib/analytics";
import { LegalFooter } from "@/components/LegalFooter";

export default function ForMastersPage() {
  const searchString = useSearch();
  const { data: specialists } = useSpecialists();

  const utmSource = useMemo(() => {
    const params = new URLSearchParams(searchString);
    return params.get("utm_source") || params.get("utm") || undefined;
  }, [searchString]);

  useEffect(() => {
    trackEvent("master_landing_view", { source: utmSource || "direct" });
    window.scrollTo(0, 0);
  }, [utmSource]);

  // Social proof: top specialists with the most reviews
  const topSpecialists = useMemo(() => {
    if (!specialists) return [];
    return [...specialists]
      .filter((s: any) => (s.reviewCount ?? 0) > 0 && s.imageUrl && (s.trustedRating ?? 0) >= 4)
      .sort((a: any, b: any) => (b.reviewCount ?? 0) - (a.reviewCount ?? 0))
      .slice(0, 3);
  }, [specialists]);

  const handleCtaClick = (_place: string) => {
    trackEvent("master_landing_cta_click", { source: utmSource || "direct" });
  };

  const benefits = [
    {
      icon: MessageCircle,
      title: "Отзывы собираются сами",
      text: "После каждого визита клиент получает ссылку в WhatsApp. Вам ничего не нужно просить — отзывы копятся автоматически.",
    },
    {
      icon: Star,
      title: "Рейтинг, который остаётся с вами",
      text: "Смените салон, город или уйдёте на себя — профиль, отзывы и рейтинг никуда не денутся. Это ваша репутация, а не салона.",
    },
    {
      icon: Users,
      title: "Клиенты находят вас в каталоге",
      text: "Люди выбирают мастера по реальным отзывам. Высокий рейтинг — вас видят первым.",
    },
    {
      icon: ShieldCheck,
      title: "Отзывы, которым верят",
      text: "Оставить отзыв может только реальный клиент после визита. Накрутить нельзя — поэтому вашему рейтингу доверяют.",
    },
  ];

  const steps = [
    "Создайте профиль — 2 минуты",
    "Подключите свою запись (Altegio) или добавляйте визиты вручную",
    "Клиенты оценивают визиты — рейтинг растёт сам",
  ];

  return (
    <div className="min-h-screen bg-background text-foreground">
      {/* Hero */}
      <section className="px-5 pt-12 pb-8 max-w-lg mx-auto text-center">
        <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }}>
          <p className="text-xs font-semibold tracking-widest uppercase text-primary mb-3">Rateus — для мастеров</p>
          <h1 className="text-3xl font-bold leading-tight mb-3">
            Ты растишь базу клиентов.<br />
            Теперь отзывы — твои.
          </h1>
          <p className="text-muted-foreground text-sm mb-6">
            Уходишь из салона — репутация уходит с тобой. Профиль, рейтинг и каждый отзыв принадлежат вам, а не месту работы.
          </p>
          <Link
            href="/create-profile"
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
                <img src={s.imageUrl} alt={s.name} className="w-11 h-11 rounded-full object-cover" />
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
            Возможно, вы уже на Rateus
          </p>
          <p className="text-xs text-muted-foreground mb-3">
            Если ваш салон подключён к Rateus, ваш профиль с отзывами уже существует. Найдите себя в каталоге и заберите его.
          </p>
          <Link
            href="/"
            onClick={() => handleCtaClick("find_self")}
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
          href="/create-profile"
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
