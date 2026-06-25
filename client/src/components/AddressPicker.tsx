import { useEffect, useMemo, useRef, useState } from "react";
import { MapContainer, TileLayer, Marker, useMapEvents } from "react-leaflet";
import L from "leaflet";
import "leaflet/dist/leaflet.css";
import { Input } from "@/components/ui/input";
import { Button } from "@/components/ui/button";
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from "@/components/ui/dialog";
import { useToast } from "@/hooks/use-toast";
import { Loader2, Navigation, MapPin, Check } from "lucide-react";

const markerIcon = L.icon({
  iconUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon.png",
  iconRetinaUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-icon-2x.png",
  shadowUrl: "https://unpkg.com/leaflet@1.9.4/dist/images/marker-shadow.png",
  iconSize: [25, 41],
  iconAnchor: [12, 41],
  popupAnchor: [1, -34],
  shadowSize: [41, 41],
});

const CITY_CENTERS: Record<string, [number, number]> = {
  "Алматы": [43.2389, 76.8897],
  "Астана": [51.1605, 71.4704],
  "Караганда": [49.8047, 73.1094],
  "Ташкент": [41.2995, 69.2401],
};

interface Suggestion {
  display_name: string;
  lat: string;
  lon: string;
}

interface AddressPickerProps {
  address: string;
  lat: number | null;
  lng: number | null;
  city: string;
  country: string;
  onChange: (address: string, lat: number | null, lng: number | null) => void;
}

function MapClickHandler({ onPick }: { onPick: (lat: number, lng: number) => void }) {
  useMapEvents({
    click(e) {
      onPick(e.latlng.lat, e.latlng.lng);
    },
  });
  return null;
}

export default function AddressPicker({ address, lat, lng, city, country, onChange }: AddressPickerProps) {
  const { toast } = useToast();
  const [query, setQuery] = useState(address);
  const [suggestions, setSuggestions] = useState<Suggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const [open, setOpen] = useState(false);
  const [detecting, setDetecting] = useState(false);

  const [mapOpen, setMapOpen] = useState(false);
  const [tempLat, setTempLat] = useState<number | null>(null);
  const [tempLng, setTempLng] = useState<number | null>(null);
  const [tempAddr, setTempAddr] = useState("");
  const [reverseLoading, setReverseLoading] = useState(false);

  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);
  const justSelectedRef = useRef(false);

  const countryCode = country === "UZ" ? "uz" : "kz";
  const countryName = country === "UZ" ? "Узбекистан" : "Казахстан";

  useEffect(() => {
    setQuery(address);
  }, [address]);

  // Close the suggestion dropdown when clicking outside.
  useEffect(() => {
    const onDocClick = (e: MouseEvent) => {
      if (boxRef.current && !boxRef.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  useEffect(() => {
    if (justSelectedRef.current) {
      justSelectedRef.current = false;
      return;
    }
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const q = query.trim();
    if (q.length < 3) {
      setSuggestions([]);
      setSearching(false);
      return;
    }
    setSearching(true);
    const controller = new AbortController();
    debounceRef.current = setTimeout(async () => {
      try {
        const biased = new RegExp(city, "i").test(q) ? q : `${q}, ${city}`;
        const url = `https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(biased)}&format=json&limit=6&accept-language=ru&countrycodes=${countryCode}`;
        const res = await fetch(url, { signal: controller.signal });
        const data: Suggestion[] = res.ok ? await res.json() : [];
        setSuggestions(data);
        setOpen(true);
      } catch (err) {
        if ((err as any)?.name !== "AbortError") setSuggestions([]);
      } finally {
        if (!controller.signal.aborted) setSearching(false);
      }
    }, 500);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
      controller.abort();
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [query, city, countryCode]);

  const selectSuggestion = (s: Suggestion) => {
    justSelectedRef.current = true;
    setQuery(s.display_name);
    setSuggestions([]);
    setOpen(false);
    onChange(s.display_name, Number(s.lat), Number(s.lon));
  };

  const handleTyping = (v: string) => {
    setQuery(v);
    // typing invalidates any previously confirmed coordinates
    onChange(v, null, null);
  };

  const reverseGeocode = async (la: number, ln: number): Promise<string> => {
    try {
      const res = await fetch(`https://nominatim.openstreetmap.org/reverse?lat=${la}&lon=${ln}&format=json&accept-language=ru`);
      if (res.ok) {
        const d = await res.json();
        return d.display_name || "";
      }
    } catch {}
    return "";
  };

  const handleDetect = () => {
    if (!navigator.geolocation) {
      toast({ title: "Геолокация недоступна", variant: "destructive" });
      return;
    }
    setDetecting(true);
    navigator.geolocation.getCurrentPosition(
      async (pos) => {
        const la = pos.coords.latitude;
        const ln = pos.coords.longitude;
        const addr = (await reverseGeocode(la, ln)) || query;
        setQuery(addr);
        onChange(addr, la, ln);
        setDetecting(false);
        toast({ title: "Местоположение определено" });
      },
      () => {
        setDetecting(false);
        toast({ title: "Не удалось определить", description: "Разрешите доступ к геолокации или укажите на карте", variant: "destructive" });
      },
      { enableHighAccuracy: true, timeout: 10000 },
    );
  };

  const mapCenter = useMemo<[number, number]>(() => {
    if (lat != null && lng != null) return [lat, lng];
    return CITY_CENTERS[city] || CITY_CENTERS["Алматы"];
  }, [lat, lng, city]);

  const openMap = async () => {
    const c: [number, number] = lat != null && lng != null ? [lat, lng] : mapCenter;
    setTempLat(lat ?? null);
    setTempLng(lng ?? null);
    setTempAddr(query);
    setMapOpen(true);
    // if there is no pin yet, leave it empty until the user taps
    void c;
  };

  const pickOnMap = async (la: number, ln: number) => {
    setTempLat(la);
    setTempLng(ln);
    setReverseLoading(true);
    const addr = await reverseGeocode(la, ln);
    setReverseLoading(false);
    setTempAddr(addr || `${la.toFixed(5)}, ${ln.toFixed(5)}`);
  };

  const confirmMap = () => {
    if (tempLat == null || tempLng == null) {
      toast({ title: "Поставьте точку на карте", variant: "destructive" });
      return;
    }
    const addr = tempAddr || `${tempLat.toFixed(5)}, ${tempLng.toFixed(5)}`;
    setQuery(addr);
    onChange(addr, tempLat, tempLng);
    setMapOpen(false);
  };

  const hasCoords = lat != null && lng != null;

  return (
    <div className="space-y-2">
      <div className="relative" ref={boxRef}>
        <Input
          id="workAddress"
          value={query}
          onChange={(e) => handleTyping(e.target.value)}
          onFocus={() => { if (suggestions.length > 0) setOpen(true); }}
          placeholder="Начните вводить адрес: ул. Абая 150"
          autoComplete="off"
          data-testid="input-work-address"
        />
        {searching && (
          <Loader2 className="w-4 h-4 animate-spin absolute right-3 top-1/2 -translate-y-1/2 text-muted-foreground" />
        )}
        {open && suggestions.length > 0 && (
          <div
            className="absolute z-[1000] mt-1 w-full max-h-60 overflow-y-auto rounded-md border border-border bg-popover shadow-md"
            data-testid="list-address-suggestions"
          >
            {suggestions.map((s, i) => (
              <button
                key={`${s.lat}-${s.lon}-${i}`}
                type="button"
                onClick={() => selectSuggestion(s)}
                className="flex w-full items-start gap-2 px-3 py-2 text-left text-sm hover:bg-accent"
                data-testid={`suggestion-address-${i}`}
              >
                <MapPin className="w-4 h-4 mt-0.5 shrink-0 text-muted-foreground" />
                <span className="flex-1">{s.display_name}</span>
              </button>
            ))}
          </div>
        )}
      </div>

      {open && !searching && query.trim().length >= 3 && suggestions.length === 0 && (
        <p className="text-xs text-muted-foreground" data-testid="text-no-suggestions">
          Ничего не нашлось. Укажите место на карте.
        </p>
      )}

      <div className="flex gap-2">
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={handleDetect}
          disabled={detecting}
          className="flex-1"
          data-testid="button-detect-location"
        >
          {detecting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <Navigation className="w-4 h-4 mr-2" />}
          Моё местоположение
        </Button>
        <Button
          type="button"
          variant="outline"
          size="sm"
          onClick={openMap}
          className="flex-1"
          data-testid="button-open-map"
        >
          <MapPin className="w-4 h-4 mr-2" />
          Указать на карте
        </Button>
      </div>

      {hasCoords ? (
        <p className="text-xs text-emerald-600 flex items-center gap-1" data-testid="text-coords">
          <Check className="w-3 h-3" /> Адрес определён на карте ({lat!.toFixed(5)}, {lng!.toFixed(5)})
        </p>
      ) : query.trim() ? (
        <p className="text-xs text-orange-600" data-testid="text-coords-missing">
          Координаты не определены — выберите адрес из списка или укажите на карте, иначе клиенты не увидят вас в «Рядом со мной».
        </p>
      ) : null}

      <Dialog open={mapOpen} onOpenChange={setMapOpen}>
        <DialogContent className="max-w-lg" data-testid="dialog-map-picker">
          <DialogHeader>
            <DialogTitle>Укажите место на карте</DialogTitle>
            <DialogDescription>Нажмите на карту, чтобы поставить точку вашего места работы.</DialogDescription>
          </DialogHeader>
          <div className="h-72 w-full overflow-hidden rounded-md border border-border">
            {mapOpen && (
              <MapContainer center={mapCenter} zoom={hasCoords ? 16 : 12} style={{ height: "100%", width: "100%" }} scrollWheelZoom>
                <TileLayer
                  attribution='&copy; OpenStreetMap'
                  url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
                />
                <MapClickHandler onPick={pickOnMap} />
                {tempLat != null && tempLng != null && (
                  <Marker position={[tempLat, tempLng]} icon={markerIcon} />
                )}
              </MapContainer>
            )}
          </div>
          <div className="min-h-[1.25rem] text-sm text-muted-foreground" data-testid="text-map-address">
            {reverseLoading ? (
              <span className="flex items-center gap-1"><Loader2 className="w-3 h-3 animate-spin" /> Определяем адрес…</span>
            ) : tempAddr ? (
              tempAddr
            ) : (
              "Точка не выбрана"
            )}
          </div>
          <Button onClick={confirmMap} className="w-full" data-testid="button-confirm-map">
            Готово
          </Button>
        </DialogContent>
      </Dialog>
    </div>
  );
}
