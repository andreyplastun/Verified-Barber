import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
export interface InviteState {
  reason: string | null;
  status: string | null;
  requestedAt: string | null;
  finishedAt: string | null;
  response: string | null;
  retryAt: string | null;
  loginAt: string | null;
}
const date = (v: string) =>
  new Date(v).toLocaleString("ru-RU", {
    timeZone: "Asia/Almaty",
    dateStyle: "short",
    timeStyle: "short",
  });
export function ClaimInvitation({
  id,
  state,
  refresh,
}: {
  id: number;
  state: InviteState;
  refresh: () => unknown;
}) {
  const request = useMutation({
    mutationFn: async () => {
      const r = await fetch(`/api/admin/claim-requests/${id}/invite`, {
        method: "POST",
      });
      if (!r.ok) {
        const d = await r.json();
        throw Error(d.message || "Не удалось отправить приглашение");
      }
    },
    onSettled: () => {
      refresh();
    },
  });
  const label: Record<string, string> = {
    queued: "В очереди",
    sending: "Отправляется",
    sent: "Отправлено",
    failed: "Отправка не подтверждена",
    skipped: "Не отправлено",
  };
  const waiting = state.status === "queued" || state.status === "sending";
  const cooldown =
    state.retryAt && new Date(state.retryAt).getTime() > Date.now();
  return (
    <div className="space-y-2 border-t pt-3 text-sm">
      <p>
        Приглашение: {label[state.status ?? ""] ?? "Не отправлялось"}
        {(state.finishedAt || state.requestedAt) &&
          ` · ${date((state.finishedAt || state.requestedAt)!)}`}
      </p>
      {state.response && (
        <p className="text-muted-foreground">{state.response}</p>
      )}
      {state.loginAt ? (
        <p>Вошёл · {date(state.loginAt)}</p>
      ) : (
        <>
          <Button
            variant="outline"
            disabled={
              !!state.reason || !!cooldown || waiting || request.isPending
            }
            onClick={() => request.mutate()}
          >
            Отправить приглашение
          </Button>
          {state.reason ? (
            <p>{state.reason}</p>
          ) : (
            !waiting &&
            cooldown && <p>Повтор возможен {date(state.retryAt!)} (Алматы)</p>
          )}
        </>
      )}
      {request.isError && (
        <p role="alert" className="text-destructive">
          {request.error.message}
        </p>
      )}
    </div>
  );
}
