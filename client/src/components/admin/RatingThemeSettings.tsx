import { useEffect, useRef, useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Switch } from "@/components/ui/switch";
import { useToast } from "@/hooks/use-toast";
import { Upload, Loader2 } from "lucide-react";

type RatingThemeConfig = {
  id: number;
  enabled: boolean;
  iconType: "emoji" | "image";
  emoji: string | null;
  imageUrl: string | null;
  color: string | null;
  label: string | null;
  startDate: string | null;
  endDate: string | null;
};

function toLocalInput(iso: string | null): string {
  if (!iso) return "";
  const d = new Date(iso);
  if (isNaN(d.getTime())) return "";
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function RatingThemeSettings({ userId }: { userId: string }) {
  const { toast } = useToast();
  const fileRef = useRef<HTMLInputElement>(null);

  const [enabled, setEnabled] = useState(false);
  const [iconType, setIconType] = useState<"emoji" | "image">("emoji");
  const [emoji, setEmoji] = useState("");
  const [imageUrl, setImageUrl] = useState<string | null>(null);
  const [label, setLabel] = useState("");
  const [startDate, setStartDate] = useState("");
  const [endDate, setEndDate] = useState("");

  const { data, isLoading } = useQuery<RatingThemeConfig | null>({
    queryKey: ["/api/admin/rating-theme"],
    queryFn: async () => {
      const res = await fetch("/api/admin/rating-theme", {
        headers: { "x-user-id": userId },
      });
      if (!res.ok) throw new Error("Failed");
      return res.json();
    },
    enabled: !!userId,
  });

  useEffect(() => {
    if (data) {
      setEnabled(!!data.enabled);
      setIconType(data.iconType === "image" ? "image" : "emoji");
      setEmoji(data.emoji || "");
      setImageUrl(data.imageUrl || null);
      setLabel(data.label || "");
      setStartDate(toLocalInput(data.startDate));
      setEndDate(toLocalInput(data.endDate));
    }
  }, [data]);

  const saveMutation = useMutation({
    mutationFn: async () => {
      const res = await fetch("/api/admin/rating-theme", {
        method: "POST",
        headers: { "Content-Type": "application/json", "x-user-id": userId },
        body: JSON.stringify({
          enabled,
          iconType,
          emoji,
          label,
          startDate: startDate ? new Date(startDate).toISOString() : null,
          endDate: endDate ? new Date(endDate).toISOString() : null,
        }),
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${text}`);
      }
      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ["/api/admin/rating-theme"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rating-theme"] });
      toast({ title: "Сохранено", description: "Тема значка оценки обновлена." });
    },
    onError: (e: any) => {
      toast({ title: "Ошибка", description: String(e.message || e), variant: "destructive" });
    },
  });

  const uploadMutation = useMutation({
    mutationFn: async (file: File) => {
      const fd = new FormData();
      fd.append("icon", file);
      const res = await fetch("/api/admin/rating-theme/icon", {
        method: "POST",
        headers: { "x-user-id": userId },
        body: fd,
      });
      if (!res.ok) {
        const text = await res.text().catch(() => "");
        throw new Error(`${res.status} ${text}`);
      }
      return res.json() as Promise<RatingThemeConfig>;
    },
    onSuccess: (cfg) => {
      setImageUrl(cfg.imageUrl || null);
      setIconType("image");
      queryClient.invalidateQueries({ queryKey: ["/api/admin/rating-theme"] });
      queryClient.invalidateQueries({ queryKey: ["/api/rating-theme"] });
      toast({ title: "Картинка загружена", description: "Не забудьте нажать «Сохранить»." });
    },
    onError: (e: any) => {
      toast({ title: "Ошибка загрузки", description: String(e.message || e), variant: "destructive" });
    },
  });

  const previewValue = iconType === "image" ? imageUrl : emoji;

  return (
    <div className="space-y-4">
      <Card>
        <CardHeader>
          <CardTitle className="text-base">Значок оценки (сезонная тема)</CardTitle>
          <p className="text-sm text-muted-foreground">
            Меняет символ <b>только на экране выставления оценки</b> (когда клиент ставит оценку).
            В ленте мастеров, в рейтинге и в карточках всегда остаются звёзды.
          </p>
        </CardHeader>
        <CardContent className="space-y-5">
          {isLoading ? (
            <div className="flex items-center gap-2 text-muted-foreground text-sm">
              <Loader2 className="h-4 w-4 animate-spin" /> Загрузка…
            </div>
          ) : (
            <>
              <div className="flex items-center justify-between rounded-lg border p-3">
                <div>
                  <Label className="font-medium">Включить тему</Label>
                  <p className="text-xs text-muted-foreground">
                    Если выключено — везде звёзды.
                  </p>
                </div>
                <Switch
                  checked={enabled}
                  onCheckedChange={setEnabled}
                  data-testid="switch-rating-theme-enabled"
                />
              </div>

              <div className="space-y-2">
                <Label>Тип значка</Label>
                <div className="flex gap-2">
                  <Button
                    type="button"
                    variant={iconType === "emoji" ? "default" : "outline"}
                    onClick={() => setIconType("emoji")}
                    data-testid="button-icontype-emoji"
                  >
                    Эмодзи
                  </Button>
                  <Button
                    type="button"
                    variant={iconType === "image" ? "default" : "outline"}
                    onClick={() => setIconType("image")}
                    data-testid="button-icontype-image"
                  >
                    Картинка
                  </Button>
                </div>
              </div>

              {iconType === "emoji" ? (
                <div className="space-y-2">
                  <Label htmlFor="theme-emoji">Эмодзи</Label>
                  <Input
                    id="theme-emoji"
                    value={emoji}
                    onChange={(e) => setEmoji(e.target.value)}
                    placeholder="Напр. ⚽ или 💈"
                    className="text-2xl w-28"
                    data-testid="input-theme-emoji"
                  />
                  <p className="text-xs text-muted-foreground">
                    Вставьте любой эмодзи: ⚽ мяч, 💈 барбер, 🎄 ёлка, ❤️ сердце и т.д.
                  </p>
                </div>
              ) : (
                <div className="space-y-2">
                  <Label>Картинка значка (PNG/SVG)</Label>
                  <input
                    ref={fileRef}
                    type="file"
                    accept="image/png,image/svg+xml,image/webp,image/jpeg"
                    className="hidden"
                    onChange={(e) => {
                      const f = e.target.files?.[0];
                      if (f) uploadMutation.mutate(f);
                    }}
                    data-testid="input-theme-image"
                  />
                  <div className="flex items-center gap-3">
                    <Button
                      type="button"
                      variant="outline"
                      onClick={() => fileRef.current?.click()}
                      disabled={uploadMutation.isPending}
                      data-testid="button-upload-icon"
                    >
                      {uploadMutation.isPending ? (
                        <Loader2 className="h-4 w-4 animate-spin mr-2" />
                      ) : (
                        <Upload className="h-4 w-4 mr-2" />
                      )}
                      Загрузить
                    </Button>
                    {imageUrl && (
                      <img src={imageUrl} alt="" className="h-10 w-10 object-contain" />
                    )}
                  </div>
                </div>
              )}

              <div className="grid grid-cols-1 sm:grid-cols-2 gap-3">
                <div className="space-y-2">
                  <Label htmlFor="theme-start">Начало (необязательно)</Label>
                  <Input
                    id="theme-start"
                    type="datetime-local"
                    value={startDate}
                    onChange={(e) => setStartDate(e.target.value)}
                    data-testid="input-theme-start"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="theme-end">Конец (необязательно)</Label>
                  <Input
                    id="theme-end"
                    type="datetime-local"
                    value={endDate}
                    onChange={(e) => setEndDate(e.target.value)}
                    data-testid="input-theme-end"
                  />
                </div>
              </div>
              <p className="text-xs text-muted-foreground -mt-2">
                Если даты заданы — значок показывается только в этот период и сам возвращается на звёзды.
                Если оставить пустыми — работает, пока включён переключатель.
              </p>

              <div className="space-y-2">
                <Label htmlFor="theme-label">Название (для себя)</Label>
                <Input
                  id="theme-label"
                  value={label}
                  onChange={(e) => setLabel(e.target.value)}
                  placeholder="Напр. Чемпионат мира 2026"
                  data-testid="input-theme-label"
                />
              </div>

              <div className="rounded-lg border p-4">
                <p className="text-xs text-muted-foreground mb-2">Предпросмотр (экран оценки):</p>
                <div className="flex gap-2" data-testid="preview-rating-theme">
                  {[1, 2, 3, 4, 5].map((i) => {
                    const filled = i <= 4;
                    if (!previewValue) {
                      return (
                        <span
                          key={i}
                          className={filled ? "text-yellow-400" : "text-muted-foreground/30"}
                          style={{ fontSize: 32, lineHeight: 1 }}
                        >
                          ★
                        </span>
                      );
                    }
                    return iconType === "image" ? (
                      <img
                        key={i}
                        src={previewValue}
                        alt=""
                        style={{ width: 32, height: 32, objectFit: "contain" }}
                        className={filled ? "" : "grayscale opacity-30"}
                      />
                    ) : (
                      <span
                        key={i}
                        style={{ fontSize: 32, lineHeight: 1, filter: filled ? undefined : "grayscale(1)" }}
                        className={filled ? "" : "opacity-30"}
                      >
                        {previewValue}
                      </span>
                    );
                  })}
                </div>
              </div>

              <Button
                onClick={() => saveMutation.mutate()}
                disabled={saveMutation.isPending}
                data-testid="button-save-rating-theme"
              >
                {saveMutation.isPending && <Loader2 className="h-4 w-4 animate-spin mr-2" />}
                Сохранить
              </Button>
            </>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
