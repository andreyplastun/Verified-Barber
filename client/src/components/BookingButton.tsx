import { Calendar } from "lucide-react";
import { Button } from "@/components/ui/button";

interface BookingButtonProps {
  specialist: {
    id: number;
    name: string;
    phone?: string | null;
    altegioBookingUrl?: string | null;
  };
  variant?: "default" | "feed";
  className?: string;
}

const WA_TEXT = "Здравствуйте! Нашёл(а) ваш профиль на Rateus. Хочу записаться.";

function buildWaLink(phone: string): string {
  const clean = phone.replace(/\D/g, "");
  return `https://wa.me/${clean}?text=${encodeURIComponent(WA_TEXT)}`;
}

export function BookingButton({ specialist, variant = "default", className = "" }: BookingButtonProps) {
  const altegioUrl = (specialist as any).altegioBookingUrl as string | null | undefined;
  const phone = (specialist as any).phone as string | null | undefined;

  let href: string | null = null;
  let label = "";
  let testId = "";

  if (altegioUrl && altegioUrl.trim()) {
    href = altegioUrl.trim();
    label = "Записаться онлайн";
    testId = `button-book-altegio-${specialist.id}`;
  } else if (phone && phone.trim()) {
    href = buildWaLink(phone);
    label = "Записаться через WhatsApp";
    testId = `button-book-whatsapp-${specialist.id}`;
  } else {
    return null;
  }

  const stopBubble = (e: React.MouseEvent | React.PointerEvent) => {
    e.stopPropagation();
  };

  if (variant === "feed") {
    return (
      <a
        href={href}
        target="_blank"
        rel="noopener noreferrer"
        onClick={stopBubble}
        onPointerDown={stopBubble}
        className={`mt-3 flex items-center justify-center gap-2 w-full py-2.5 rounded-lg bg-primary text-primary-foreground text-sm font-semibold active:scale-[0.98] transition-transform ${className}`}
        data-testid={testId}
      >
        <Calendar size={14} />
        {label}
      </a>
    );
  }

  return (
    <a
      href={href}
      target="_blank"
      rel="noopener noreferrer"
      onClick={stopBubble}
      className={className}
      data-testid={testId}
    >
      <Button className="w-full py-6 rounded-xl font-bold text-lg">
        <Calendar className="mr-2 h-5 w-5" />
        {label}
      </Button>
    </a>
  );
}
