import { Link } from "wouter";
export default function ClaimProfilePage() {
  return (
    <main className="mx-auto max-w-sm space-y-4 px-5 py-16 text-center">
      <h1 className="text-xl font-semibold">Вход мастера по WhatsApp</h1>
      <p>
        Старые ссылки больше не привязывают профиль. Используйте номер, который
        вы указали в заявке.
      </p>
      <Link
        href="/login"
        className="block rounded-lg bg-primary p-3 text-primary-foreground"
      >
        Войти по номеру телефона
      </Link>
    </main>
  );
}
