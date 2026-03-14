import { Link } from "wouter";

export function LegalFooter() {
  return (
    <footer className="py-6 px-4 pb-20" data-testid="legal-footer">
      <div className="max-w-3xl mx-auto">
        <div className="flex flex-col sm:flex-row items-center justify-center gap-2 sm:gap-0 text-xs text-muted-foreground/60">
          <Link href="/privacy" className="hover:text-muted-foreground underline" data-testid="link-footer-privacy">
            Политика конфиденциальности
          </Link>
          <span className="hidden sm:inline mx-2">|</span>
          <Link href="/terms" className="hover:text-muted-foreground underline" data-testid="link-footer-terms">
            Пользовательское соглашение
          </Link>
          <span className="hidden sm:inline mx-2">|</span>
          <Link href="/offer" className="hover:text-muted-foreground underline" data-testid="link-footer-offer">
            Оферта для специалистов
          </Link>
        </div>
      </div>
    </footer>
  );
}
