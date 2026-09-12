import { useMutation, useQuery } from "@tanstack/react-query";
import { AlertTriangle, Clock, RefreshCw } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { useToast } from "@/hooks/use-toast";
import { queryClient } from "@/lib/queryClient";

type ConnectionRequest = {
  id: number;
  specialistId: number;
  specialistName: string;
  ownerEmail: string | null;
  phone: string;
  status: string;
  providerOrderId: number | null;
  errorCode: string | null;
  errorMessage: string | null;
  consentedAt: string;
  updatedAt: string;
};

type RequestsResponse = {
  partnerConfigured: boolean;
  provisioningEnabled: boolean;
  productionSubmissionEnabled: boolean;
  submissionEnabled: boolean;
  requests: ConnectionRequest[];
};

function statusLabel(status: string): string {
  switch (status) {
    case "pending_partner_configuration": return "Ждёт настройки партнёра";
    case "pending_submission": return "Ждёт отправки";
    case "submitting": return "Отправляется";
    case "pending_provider": return "Ждёт AssistBot";
    case "provider_error": return "Ошибка провайдера";
    case "submission_unknown": return "Результат не подтверждён";
    case "superseded": return "Устарела";
    default: return status;
  }
}

function statusVariant(status: string): "default" | "secondary" | "destructive" | "outline" {
  if (status === "provider_error") return "destructive";
  if (status === "pending_provider") return "secondary";
  if (status === "superseded") return "outline";
  return "default";
}

export function AssistBotConnectionRequests({ userId }: { userId: string }) {
  const { toast } = useToast();
  const { data, isLoading, isError } = useQuery<RequestsResponse>({
    queryKey: ["/api/admin/assistbot-connection-requests"],
    queryFn: async () => {
      const response = await fetch("/api/admin/assistbot-connection-requests", {
        headers: { "x-user-id": userId },
        cache: "no-store",
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Не удалось загрузить заявки");
      return body;
    },
    enabled: Boolean(userId),
  });

  const submitMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/admin/assistbot-connection-requests/${id}/submit`, {
        method: "POST",
        headers: { "x-user-id": userId },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Не удалось отправить заявку");
      return body;
    },
    onSuccess: (body) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/assistbot-connection-requests"] });
      toast({ title: "Статус заявки обновлён", description: body.message || "Готово" });
    },
    onError: (error: Error) => {
      toast({ title: "Не удалось отправить заявку", description: error.message, variant: "destructive" });
    },
  });

  const reconcileMutation = useMutation({
    mutationFn: async (id: number) => {
      const response = await fetch(`/api/admin/assistbot-connection-requests/${id}/reconcile`, {
        method: "POST",
        headers: { "x-user-id": userId },
      });
      const body = await response.json();
      if (!response.ok) throw new Error(body.message || "Не удалось сохранить ручную проверку");
      return body;
    },
    onSuccess: (body) => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/assistbot-connection-requests"] });
      toast({ title: "Ручная проверка отмечена", description: body.message });
    },
    onError: (error: Error) => {
      toast({ title: "Не удалось сохранить отметку", description: error.message, variant: "destructive" });
    },
  });

  return (
    <Card data-testid="card-assistbot-connection-requests">
      <CardHeader className="pb-3">
        <CardTitle className="text-base flex items-center gap-2">
          <RefreshCw className="h-4 w-4" />
          Заявки на подключение AssistBot
        </CardTitle>
      </CardHeader>
      <CardContent className="space-y-3">
        {!data?.partnerConfigured && (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
            Партнёрский токен AssistBot не настроен: заявки сохраняются, но провайдеру не отправляются.
            Нужен отдельный <code>ASSISTBOT_PARTNER_TOKEN</code>; <code>ASSISTBOT_TOKEN</code> аккаунта для этого не подходит.
          </div>
        )}
        {data?.partnerConfigured && !data.provisioningEnabled && (
          <div className="rounded border border-amber-300 bg-amber-50 p-3 text-sm text-amber-800 dark:bg-amber-950/20 dark:text-amber-300">
            Партнёрский токен найден, но provisioning выключен. Для отправки нужен отдельный runtime-флаг <code>ASSISTBOT_PROVISIONING_ENABLED=true</code>.
          </div>
        )}
        {data?.partnerConfigured && data.provisioningEnabled && !data.productionSubmissionEnabled && (
          <div className="rounded border border-blue-300 bg-blue-50 p-3 text-sm text-blue-800 dark:bg-blue-950/20 dark:text-blue-300">
            В текущем окружении внешняя отправка заблокирована. Это защита от изменения данных провайдера во время тестов.
          </div>
        )}
        {isLoading ? (
          <p className="text-sm text-muted-foreground">Загрузка заявок...</p>
        ) : isError ? (
          <p className="text-sm text-destructive">Не удалось загрузить заявки AssistBot.</p>
        ) : !data?.requests.length ? (
          <p className="text-sm text-muted-foreground">Заявок пока нет.</p>
        ) : (
          data.requests.map((item) => {
            const canSubmit = item.status === "pending_partner_configuration" ||
              item.status === "pending_submission" ||
              item.status === "provider_error";
            return (
              <div key={item.id} className="rounded border p-3 space-y-2 text-sm" data-testid={`assistbot-request-${item.id}`}>
                <div className="flex flex-wrap items-center gap-2">
                  <span className="font-medium">#{item.id} · {item.specialistName}</span>
                  <Badge variant={statusVariant(item.status)}>{statusLabel(item.status)}</Badge>
                </div>
                <p className="text-muted-foreground">
                  WhatsApp: {item.phone}{item.ownerEmail ? ` · ${item.ownerEmail}` : ""}
                </p>
                {item.providerOrderId && <p>Номер заявки AssistBot: {item.providerOrderId}</p>}
                {item.errorMessage && (
                  <p className="flex items-start gap-1 text-destructive">
                    <AlertTriangle className="h-4 w-4 mt-0.5 shrink-0" />
                    {item.errorMessage}
                  </p>
                )}
                {item.status === "pending_provider" && (
                  <p className="flex items-start gap-1 text-muted-foreground">
                    <Clock className="h-4 w-4 mt-0.5 shrink-0" />
                    Номер заявки получен; подключение номера ещё не подтверждено AssistBot.
                  </p>
                )}
                {item.status === "submission_unknown" && (
                  <p className="text-sm text-destructive">
                    Повторная отправка заблокирована, чтобы не создать дубль. Проверьте заявку вручную у AssistBot.
                  </p>
                )}
                {canSubmit && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={!data.submissionEnabled || submitMutation.isPending}
                    onClick={() => submitMutation.mutate(item.id)}
                    data-testid={`button-submit-assistbot-request-${item.id}`}
                  >
                    {submitMutation.isPending ? "Отправляем..." : "Отправить AssistBot"}
                  </Button>
                )}
                {item.status === "submission_unknown" && (
                  <Button
                    type="button"
                    size="sm"
                    variant="outline"
                    disabled={reconcileMutation.isPending}
                    onClick={() => reconcileMutation.mutate(item.id)}
                    data-testid={`button-reconcile-assistbot-request-${item.id}`}
                  >
                    {reconcileMutation.isPending ? "Сохраняем..." : "Отметить ручную проверку"}
                  </Button>
                )}
              </div>
            );
          })
        )}
      </CardContent>
    </Card>
  );
}