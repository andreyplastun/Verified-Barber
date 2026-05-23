import { Calendar, MessageCircle, Instagram, Phone } from "lucide-react";
import { Button } from "@/components/ui/button";

type Channel = "booking_url" | "whatsapp" | "instagram" | "phone";

interface BookingButtonProps {
  specialist: {
    id: number;
    name: string;
    phone?: string | null;
    bookingUrl?: string | null;
    whatsapp?: string | null;
    instagram?: string | null;
  };
  variant?: "default" | "feed";
  className?: string;
}

const WA_TEXT = "Здравствуйте! Нашёл(а) ваш профиль на Rateus. Хочу записаться.";

function buildWaLink(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  return `https://wa.me/${clean}?text=${encodeURIComponent(WA_TEXT)}`;
}

function buildInstagramLink(raw: string): string {
  const v = raw.trim();
  if (/^https?:\/\//i.test(v)) return v;
  const handle = v.replace(/^@+/, "").replace(/^instagram\.com\//i, "");
  return `https://instagram.com/${handle}`;
}

function trackBookingClick(specialistId: number, channel: Channel) {
  try {
    fetch("/api/analytics/event", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify({
        eventType: "booking_click",
        specialistId,
        source: channel,
        userAgent: navigator.userAgent,
      }),
      keepalive: true,
    }).catch(() => {});
  } catch {
    // analytics must never break UX
  }
}

function resolveChannel(s: BookingButtonProps["specialist"]): {
  href: string;
  label: string;
  channel: Channel;
  Icon: typeof Calendar;
} | null {
  const bookingUrl = (s.bookingUrl || "").trim();
  if (bookingUrl) {
    return { href: bookingUrl, label: "Записаться онлайн", channel: "booking_url", Icon: Calendar };
  }
  const wa = (s.whatsapp || "").trim();
  if (wa) {
    return { href: buildWaLink(wa), label: "Записаться через WhatsApp", channel: "whatsapp", Icon: MessageCircle };
  }
  const ig = (s.instagram || "").trim();
  if (ig) {
    return { href: buildInstagramLink(ig), label: "Написать в Instagram", channel: "instagram", Icon: Instagram };
  }
  const phone = (s.phone || "").trim();
  if (phone) {
    return { href: `tel:${phone.replace(/\s/g, "")}`, label: "Позвонить", channel: "phone", Icon: Phone };
  }
  return null;
}

export function BookingButton({ specialist, variant = "default", className = "" }: BookingButtonProps) {
  const resolved = resolveChannel(specialist);
  if (!resolved) return null;
  const { href, label, channel, Icon } = resolved;
  const testId = `button-book-${channel}-${specialist.id}`;

  const handleClick = (e: React.MouseEvent) => {
    e.stopPropagation();
    trackBookingClick(specialist.id, channel);
  };
  const stopPointer = (e: React.PointerEvent) => e.stopPropagation();

  if (variant === "feed") {
    return (
      <a
        href={href}
        target={channel === "phone" ? undefined : "_blank"}
        rel="noopener noreferrer"
        onClick={handleClick}
        onPointerDown={stopPointer}
        className={`mt-3 flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold active:scale-[0.98] transition-transform ${className}`}
        data-testid={testId}
      >
        <Icon size={14} />
        {label}
      </a>
    );
  }

  return (
    <a
      href={href}
      target={channel === "phone" ? undefined : "_blank"}
      rel="noopener noreferrer"
      onClick={handleClick}
      className={className}
      data-testid={testId}
    >
      <Button className="w-full py-6 rounded-xl font-bold text-lg">
        <Icon className="mr-2 h-5 w-5" />
        {label}
      </Button>
    </a>
  );
}
