import { useEffect, useRef } from "react";
import { Card } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { LifeBuoy, MessageCircle, ListChecks } from "lucide-react";
import { trackEvent } from "@/lib/analytics";
import type { Specialist } from "@shared/schema";

const SUPPORT_PHONE = "77773000467";
const SUPPORT_TEXT =
  "Здравствуйте. Я зарегистрировался(ась) в Rateus и не понимаю что делать дальше. Помогите, пожалуйста.";

interface Props {
  specialist: Specialist | undefined;
  onFillProfile?: (anchor: string) => void;
}

function deriveStatus(specialist: Specialist) {
  const s = specialist as any;
  return {
    hasPhoto: !!s.imageUrl && !String(s.imageUrl).includes("placeholder"),
    hasPrice: !!s.baseServicePrice && Number(s.baseServicePrice) > 0,
    hasContact: !!(s.bookingUrl || s.whatsapp || s.instagram),
    hasReview: (s.reviewCount || 0) >= 1,
  };
}

export default function HelpBanner({ specialist, onFillProfile }: Props) {
  const shownRef = useRef(false);

  const status = specialist ? deriveStatus(specialist) : null;
  const incomplete = status
    ? !(status.hasPhoto && status.hasPrice && status.hasContact && status.hasReview)
    : false;

  useEffect(() => {
    if (specialist && incomplete && !shownRef.current) {
      shownRef.current = true;
      trackEvent("help_banner_shown", { specialistId: specialist.id });
    }
  }, [specialist, incomplete]);

  if (!specialist || !status || !incomplete) return null;

  // Scroll to the first unfilled profile section; if only the first review is
  // missing (profile complete), route to the create-visit form instead.
  const firstAnchor = !status.hasPhoto
    ? "avatar-section"
    : !status.hasPrice
    ? "price-section"
    : !status.hasContact
    ? "contacts-section"
    : "new-booking-name";

  const supportHref = `https://wa.me/${SUPPORT_PHONE}?text=${encodeURIComponent(SUPPORT_TEXT)}`;

  const handleFill = () => {
    trackEvent("help_banner_profile_click", { specialistId: specialist.id });
    onFillProfile?.(firstAnchor);
  };

  const handleSupport = () => {
    trackEvent("help_banner_support_click", { specialistId: specialist.id });
  };

  return (
    <Card
      className="border-primary/30 bg-primary/5"
      data-testid="help-banner"
    >
      <div className="p-5">
        <div className="flex items-start gap-3">
          <LifeBuoy className="w-5 h-5 text-primary shrink-0 mt-0.5" />
          <div className="flex-1 min-w-0">
            <h3 className="text-base font-semibold text-foreground" data-testid="text-help-banner-title">
              Что делать дальше?
            </h3>
            <p className="text-sm text-muted-foreground mt-1.5 leading-relaxed">
              Rateus помогает специалистам собирать отзывы и формировать профессиональную репутацию.
            </p>
            <p className="text-sm text-muted-foreground mt-3 font-medium">Для начала:</p>
            <ol className="mt-1.5 space-y-1.5 text-sm text-foreground">
              <li className="flex gap-2">
                <span className="text-muted-foreground tabular-nums">1.</span>
                <span>Добавьте фото профиля.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-muted-foreground tabular-nums">2.</span>
                <span>Укажите основную услугу и её стоимость.</span>
              </li>
              <li className="flex gap-2">
                <span className="text-muted-foreground tabular-nums">3.</span>
                <span>Добавьте способ записи (онлайн-запись, WhatsApp или Instagram).</span>
              </li>
              <li className="flex gap-2">
                <span className="text-muted-foreground tabular-nums">4.</span>
                <span>Получите первый отзыв от клиента.</span>
              </li>
            </ol>
          </div>
        </div>

        <div className="flex flex-col sm:flex-row gap-2 mt-4">
          <Button
            size="sm"
            onClick={handleFill}
            className="gap-1.5"
            data-testid="button-help-fill-profile"
          >
            <ListChecks className="w-4 h-4" />
            Заполнить профиль
          </Button>
          <a
            href={supportHref}
            target="_blank"
            rel="noopener noreferrer"
            onClick={handleSupport}
            data-testid="link-help-support"
          >
            <Button size="sm" variant="outline" className="gap-1.5 w-full sm:w-auto">
              <MessageCircle className="w-4 h-4" />
              Нужна помощь?
            </Button>
          </a>
        </div>
      </div>
    </Card>
  );
}
