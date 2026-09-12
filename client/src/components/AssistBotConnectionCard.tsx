import { useState } from "react";
import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, CheckCircle2, Clock, Info, Send } from "lucide-react";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Checkbox } from "@/components/ui/checkbox";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

type AssistBotConnectionCardProps = {
  specialistId: number;
  userId: string;
  whatsapp: string;
  savedWhatsapp: string | null | undefined;
};

type AssistBotConnectionResponse = {
  partnerConfigured: boolean;
  request: {
    id: number;
    phone: string;
    status: string;
    providerOrderId: number | null;
    errorCode: string | null;
    errorMessage: string | null;
    submittedAt: string | null;
  } | null;
};

function phoneDigits(value: string | null | undefined): string {
  return String(value || "").replace(/\D/g, "");
}

export default function AssistBotConnectionCard({
  specialistId,
  userId,
  whatsapp,
  savedWhatsapp,
}: AssistBotConnectionCardProps) {
  const { toast } = useToast();
  const [consent, setConsent] = useState(false);
  const savedPhone = String(savedWhatsapp || "").trim();
  const hasUnsavedPhone = Boolean(whatsapp.trim()) && phoneDigits(whatsapp) !== phoneDigits(savedPhone);

  const { data, isLoading, isError, error } = useQuery<AssistBotConnectionResponse>({
    queryKey: ["/api/specialists", specialistId, "assistbot-connection"],
    queryFn: async () => {
      const response = await fetch(`/api/specialists/${specialistId}/assistbot-connection`, {
        headers: { "x-user-id": userId },
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Не удалось загрузить статус AssistBot");
      return body;
    },
    enabled: Boolean(specialistId && userId && savedPhone),
  });

  const requestMutation = useMutation({
    mutationFn: async () => {
      const response = await fetch(`/api/specialists/${specialistId}/assistbot-connection-requests`, {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": userId,
        },
        body: JSON.stringify({ consent: true }),
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Не удалось сохранить заявку");
      return body;
    },
    onSuccess: (body) => {
      setConsent(false);
      queryClient.setQueryData(
        ["/api/specialists", specialistId, "assistbot-connection"],
        body,
      );
      toast({
        title: body.request?.status === "pending_provider" ? "Заявка принята AssistBot" : "Заявка сохранена",
        description: body.message,
      });
    },
    onError: (error: Error) => {
      toast({ title: "Не удалось подать заявку", description: error.message, variant: "destructive" });
    },
  });

  // The connection request belongs to the saved profile number. This avoids
  // creating a request for a number that the specialist has not saved yet.
  if (!whatsapp.trim() && !savedPhone) return null;

  const request = data?.request;
  const status = request?.status;
  const hasProviderOrder = status === "pending_provider" && request?.providerOrderId;

  return (
    <Card className="border-dashed" data-testid="card-assistbot-connection">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <Send className="h-4 w-4" />
          Подключение WhatsApp через AssistBot
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3 text-sm">
        {hasUnsavedPhone ? (
          <div className="flex gap-2 text-muted-foreground">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <p>Сначала сохраните новый номер WhatsApp выше. После изменения старая заявка автоматически становится недействительной.</p>
          </div>
        ) : isLoading ? (
          <p className="text-muted-foreground">Проверяем статус заявки...</p>
        ) : isError ? (
          <div className="flex gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>{error instanceof Error ? error.message : "Не удалось загрузить статус заявки."}</p>
          </div>
        ) : status === "pending_provider" ? (
          <div className="flex gap-2 text-amber-700 dark:text-amber-400">
            <Clock className="h-4 w-4 mt-0.5 shrink-0" />
            <p>
              Заявка №{request?.providerOrderId} принята AssistBot и ожидает обработки провайдером.
              Это ещё не означает, что номер подключён.
            </p>
          </div>
        ) : status === "submitting" ? (
          <div className="flex gap-2 text-muted-foreground">
            <Clock className="h-4 w-4 mt-0.5 shrink-0" />
            <p>Заявка отправляется провайдеру. Подключение пока не подтверждено.</p>
          </div>
        ) : status === "pending_partner_configuration" ? (
          <div className="flex gap-2 text-amber-700 dark:text-amber-400">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>Заявка сохранена, но интеграция AssistBot ещё не настроена администратором. Она будет отправлена после настройки.</p>
          </div>
        ) : status === "pending_submission" ? (
          <div className="flex gap-2 text-muted-foreground">
            <Info className="h-4 w-4 mt-0.5 shrink-0" />
            <p>{request?.errorMessage || "Заявка сохранена; отправка провайдеру пока недоступна. Подключение не подтверждено."}</p>
          </div>
        ) : status === "provider_error" ? (
          <div className="flex gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>{request?.errorMessage || "AssistBot не принял заявку. Можно повторить попытку."}</p>
          </div>
        ) : status === "submission_unknown" ? (
          <div className="flex gap-2 text-destructive">
            <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
            <p>{request?.errorMessage || "Результат отправки AssistBot неизвестен. Не повторяйте заявку без проверки администратором."}</p>
          </div>
        ) : (
          <p className="text-muted-foreground">
            Можно отправить заявку на подключение номера. AssistBot вернёт только номер заявки;
            факт подключения будет подтверждён отдельно провайдером.
          </p>
        )}

        {!hasUnsavedPhone && !isError && status !== "pending_provider" && status !== "submitting" && status !== "submission_unknown" && (
          <>
            {!data?.partnerConfigured && !request && (
              <p className="text-xs text-muted-foreground">
                Сейчас на стороне Rateus не настроен партнёрский токен AssistBot. Заявка всё равно сохранится для администратора.
              </p>
            )}
            <label className="flex items-start gap-2 cursor-pointer">
              <Checkbox
                checked={consent}
                onCheckedChange={(checked) => setConsent(checked === true)}
                disabled={requestMutation.isPending}
                data-testid="checkbox-assistbot-consent"
              />
              <span className="text-xs leading-5">
                Я разрешаю передать AssistBot для заявки моё имя, email (если указан), телефон управляющего
                и сохранённый номер WhatsApp. Эти данные используются только для запроса подключения.
              </span>
            </label>
            <Button
              type="button"
              size="sm"
              variant="outline"
              disabled={!consent || requestMutation.isPending}
              onClick={() => requestMutation.mutate()}
              data-testid="button-request-assistbot-connection"
            >
              {requestMutation.isPending ? "Сохраняем..." : status === "provider_error" ? "Повторить заявку" : "Подать заявку на подключение"}
            </Button>
          </>
        )}

        {status === "pending_provider" && (
          <div className="flex items-center gap-2 text-xs text-muted-foreground">
            <CheckCircle2 className="h-4 w-4 text-emerald-600" />
            Номер заявки сохранён; QR-код и фиктивная ссылка не создаются.
          </div>
        )}
      </CardContent>
    </Card>
  );
}