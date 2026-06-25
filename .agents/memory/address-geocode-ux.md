---
name: Specialist work-address geocoding UX
description: Why coords must come from explicit user choice, never auto-snap; how the picker is structured
---

# Work-address geocoding must be explicit, never auto-snap

Coordinates for a specialist's `workAddress`/`workLat`/`workLng` are only set when the
user **explicitly** confirms a point: picks a Nominatim autocomplete suggestion, taps
"Моё местоположение" (GPS), or drops a pin via the Leaflet "Указать на карте" map.
Typing into the field clears coords until confirmed.

**Why:** The old single-button geocode used Nominatim `limit=1`, which returned the
single best match regardless of distance — typing "Кунаева 2" with no exact match
snapped to "Кунаева 14/2" elsewhere in the city. Users had no way to see/choose, and
the trigger (a bare MapPin icon) was undiscoverable. Admin complaint: "через жопу".

**How to apply:** Keep the suggestions LIST (limit≈6, city/country biased) as the
primary path; keep the map-tap fallback for "не нашлось". Do NOT reintroduce a
limit=1 auto-geocode-on-save that silently assigns coords — `buildGeocodeQuery` is
only a best-effort save-time fallback for free-typed text and may legitimately set
nothing (honest "координаты не определены" message). Component:
`client/src/components/AddressPicker.tsx`.

# Onboarding "Как вы работаете?" modal gating

`OnboardingPathModal` must be hidden for Altegio-connected specialists AND gated on
`!loadingSpecialist`, because `isAltegioConnected` derives from specialist query data
— without the loading guard the modal flashes for connected users before data arrives.
