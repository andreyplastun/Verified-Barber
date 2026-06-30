import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Star, Calendar as CalendarIcon, MessageSquare, User, Camera, Image, Trash2, Upload, Banknote, UserPlus, Copy, AlertTriangle, CheckCircle2, Clock, Link2, Unlink, RefreshCw, CircleCheck, Loader2, Info, Plus, CalendarDays, MapPin, Navigation, MessageCircle, X, Trophy } from 'lucide-react';
import { Calendar } from '@/components/ui/calendar';
import { Popover, PopoverContent, PopoverTrigger } from '@/components/ui/popover';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import { useRef, useState, useEffect } from 'react';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import type { Specialist, Booking, Review, SpecialistPhoto } from '@shared/schema';
import AltegioErrorScreen, { type AltegioErrorType } from '@/components/AltegioErrorScreen';
import AltegioSyncBanner, { getBookingSyncBannerConfig, getGlobalAltegioBannerConfig } from '@/components/AltegioSyncBanner';
import AltegioStatusCard from '@/components/AltegioStatusCard';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import ActivationProgress from '@/components/ActivationProgress';
import OnboardingPathModal from '@/components/OnboardingPathModal';
import AddressPicker from '@/components/AddressPicker';
import { BarberCelebrationOverlay, type CelebrationEvent } from '@/components/celebrations/BarberCelebration';
import { useMemo } from 'react';

type AchievementBadge = { id: string; emoji: string; title: string; desc: string };
type SpecialistAchievements = {
  rank: number | null;
  reviewCount: number;
  totalRanked: number;
  top10Streak: number;
  firstStreak: number;
  reviewsToNextRank: number | null;
  badges: AchievementBadge[];
  nudge: { title: string; message: string } | null;
  leaderboard: { rank: number; specialistId: number; name: string; reviewCount: number; isYou: boolean }[];
};

export default function SpecialistDashboard() {
  const { currentUser } = useAuth();
  const specialistId = currentUser?.specialistId;
  const { toast } = useToast();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const workInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<'avatar' | 'work' | null>(null);
  const [bio, setBio] = useState('');
  const [subcategory, setSubcategory] = useState('');
  const [city, setCity] = useState('Алматы');
  const [country, setCountry] = useState('KZ');
  const [savingBio, setSavingBio] = useState(false);
  const [workAddress, setWorkAddress] = useState('');
  const [workLat, setWorkLat] = useState<number | null>(null);
  const [workLng, setWorkLng] = useState<number | null>(null);
  const [locationCooldownOpen, setLocationCooldownOpen] = useState(false);
  const [kaspiPhone, setKaspiPhone] = useState('');
  const [tipsEnabled, setTipsEnabled] = useState(false);
  const [savingTips, setSavingTips] = useState(false);
  const [baseServiceName, setBaseServiceName] = useState('');
  const [baseServicePrice, setBaseServicePrice] = useState('');
  const [savingBaseService, setSavingBaseService] = useState(false);
  const [bookingUrl, setBookingUrl] = useState('');
  const [whatsapp, setWhatsapp] = useState('');
  const [instagram, setInstagram] = useState('');
  const [altegioModalOpen, setAltegioModalOpen] = useState(false);
  const [altegioConnecting, setAltegioConnecting] = useState(false);
  const [altegioCompanyInput, setAltegioCompanyInput] = useState('');
  const [showNewBookingForm, setShowNewBookingForm] = useState(false);
  const [newBookingName, setNewBookingName] = useState('');
  const [newBookingPhone, setNewBookingPhone] = useState('');
  const [newBookingDate, setNewBookingDate] = useState('');
  const [newBookingTime, setNewBookingTime] = useState('');
  const [rateLimitWarningOpen, setRateLimitWarningOpen] = useState(false);
  const [showFirstVisitSuccess, setShowFirstVisitSuccess] = useState(false);
  const [manualVisitInfoDismissed, setManualVisitInfoDismissed] = useState(false);
  const [guideMode, setGuideMode] = useState<null | 'create-visit' | 'profile'>(null);

  const { data: specialist, isLoading: loadingSpecialist } = useQuery<Specialist>({
    queryKey: ['/api/specialists', specialistId],
    enabled: !!specialistId,
  });

  const [celebrationDismissed, setCelebrationDismissed] = useState(false);

  const celebrationEvent = useMemo<CelebrationEvent | null>(() => {
    if (!specialist) return null;
    const trusted = specialist.trustedRating ?? 0;
    const trustedCount = specialist.trustedReviewsCount ?? 0;
    const reviewCount = specialist.reviewCount ?? 0;
    const seenRating = specialist.celebrationSeenRating ?? 0;
    const seenCount = specialist.celebrationSeenReviewCount ?? 0;
    const peak = specialist.celebrationPeakRating ?? 0;
    const M = 0.05; // rating margin to avoid float jitter

    // Priority order (highest first)
    if (trustedCount >= 3 && trusted > 0 && !specialist.ratingFormedCelebrated) {
      return { type: 'rating_appeared', rating: trusted };
    }
    const milestone = [100, 50, 25, 10, 5].find((t) => seenCount < t && reviewCount >= t);
    if (milestone) {
      return { type: 'count_milestone', count: milestone };
    }
    if (specialist.ratingFormedCelebrated && peak > 0 && trusted > peak + M) {
      return { type: 'new_record', rating: trusted };
    }
    if (reviewCount >= 1 && !specialist.firstReviewCelebrated && trustedCount < 3) {
      return { type: 'first_review' };
    }
    if (specialist.ratingFormedCelebrated && seenRating > 0 && trusted < seenRating - M) {
      return { type: 'rating_dropped', rating: trusted };
    }
    return null;
  }, [specialist]);

  const { data: achievements } = useQuery<SpecialistAchievements>({
    queryKey: ['/api/specialists', specialistId, 'achievements'],
    queryFn: async () => {
      const res = await fetch(`/api/specialists/${specialistId}/achievements`);
      if (!res.ok) throw new Error('Failed to fetch achievements');
      return res.json();
    },
    enabled: !!specialistId,
  });

  const freshBadge = useMemo<AchievementBadge | null>(() => {
    if (!achievements || !specialistId) return null;
    const badges = achievements.badges ?? [];
    if (badges.length === 0) return null;
    let seen: string[] = [];
    try {
      seen = JSON.parse(localStorage.getItem(`achievements_seen_${specialistId}`) || '[]');
    } catch {}
    return badges.find((b) => !seen.includes(b.id)) ?? null;
  }, [achievements, specialistId]);

  const newAchievement = useMemo<CelebrationEvent | null>(() => {
    if (!freshBadge) return null;
    return { type: 'achievement', title: `${freshBadge.emoji} ${freshBadge.title}`, message: freshBadge.desc };
  }, [freshBadge]);

  const activeCelebration = celebrationDismissed ? null : (newAchievement ?? celebrationEvent);

  const dismissCelebration = () => {
    setCelebrationDismissed(true);
    // Mark ONLY the badge we just showed as seen, so any other newly-earned
    // badge still pops (once) on a subsequent open.
    if (specialistId && freshBadge) {
      try {
        const key = `achievements_seen_${specialistId}`;
        let seen: string[] = [];
        try {
          seen = JSON.parse(localStorage.getItem(key) || '[]');
        } catch {}
        if (!seen.includes(freshBadge.id)) {
          localStorage.setItem(key, JSON.stringify([...seen, freshBadge.id]));
        }
      } catch {}
    }
    if (!specialistId || !currentUser?.id) return;
    // When an achievement popup overrode the built-in celebration, don't consume
    // the built-in celebration state — let it surface on the next open.
    if (newAchievement) return;
    fetch(`/api/specialists/${specialistId}/celebrations-seen`, {
      method: 'POST',
      headers: { 'x-user-id': currentUser.id },
    })
      .then(() => queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId] }))
      .catch((err) => console.error('Failed to sync celebration state:', err));
  };

  const { data: bookings, isLoading: loadingBookings } = useQuery<Booking[]>({
    queryKey: ['/api/specialists', specialistId, 'bookings'],
    queryFn: async () => {
      const res = await fetch(`/api/specialists/${specialistId}/bookings`);
      if (!res.ok) throw new Error('Failed to fetch bookings');
      return res.json();
    },
    enabled: !!specialistId,
  });

  const { data: reviews, isLoading: loadingReviews } = useQuery<Review[]>({
    queryKey: ['/api/reviews', specialistId, currentUser?.id],
    queryFn: async () => {
      const headers: Record<string, string> = {};
      if (currentUser?.id) {
        headers["x-user-id"] = currentUser.id;
      }
      const res = await fetch(`/api/reviews?specialistId=${specialistId}`, { headers });
      if (!res.ok) throw new Error('Failed to fetch reviews');
      return res.json();
    },
    enabled: !!specialistId,
  });

  const { data: photos = [], isLoading: loadingPhotos } = useQuery<SpecialistPhoto[]>({
    queryKey: ['/api/specialists', specialistId, 'photos'],
    queryFn: async () => {
      const res = await fetch(`/api/specialists/${specialistId}/photos`);
      if (!res.ok) throw new Error('Failed to fetch photos');
      return res.json();
    },
    enabled: !!specialistId,
  });

  const { data: altegioStatus } = useQuery<{ configured: boolean }>({
    queryKey: ['/api/altegio/status'],
    enabled: !!specialistId,
  });

  const isAltegioConnected = !!(specialist as any)?.altegioStaffId ||
    (!!(specialist as any)?.altegioCompanyId && (specialist as any)?.altegioConnectionStatus === 'connected');

  const isNewSpecialist =
    !loadingBookings &&
    !loadingSpecialist &&
    !isAltegioConnected &&
    (bookings?.length ?? 0) === 0 &&
    ((specialist as any)?.reviewCount ?? 0) === 0;

  const prefillVisitNow = () => {
    const now = new Date();
    const pad = (n: number) => String(n).padStart(2, '0');
    setNewBookingDate((d) => d || `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`);
    setNewBookingTime((t) => t || `${pad(now.getHours())}:${pad(now.getMinutes())}`);
  };

  useEffect(() => {
    const guide = new URLSearchParams(window.location.search).get('guide');
    if (guide === 'create-visit') {
      setShowNewBookingForm(true);
      prefillVisitNow();
      setGuideMode('create-visit');
      setTimeout(() => {
        document.getElementById('bookings-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
        (document.getElementById('new-booking-name') as HTMLInputElement | null)?.focus();
      }, 400);
    } else if (guide === 'profile') {
      setGuideMode('profile');
      setTimeout(() => {
        document.getElementById('bio-section')?.scrollIntoView({ behavior: 'smooth', block: 'start' });
      }, 400);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [altegioErrorDismissed, setAltegioErrorDismissed] = useState(false);
  const [altegioRetrying, setAltegioRetrying] = useState(false);

  const { data: altegioHealth, refetch: refetchAltegioHealth } = useQuery<{
    ok: boolean;
    errorType?: AltegioErrorType;
    errorDetail?: string;
  }>({
    queryKey: ['/api/altegio/health'],
    queryFn: async () => {
      if (!currentUser?.id) throw new Error('Not authorized');
      const res = await fetch('/api/altegio/health', {
        headers: { 'x-user-id': currentUser.id },
      });
      if (!res.ok) {
        return { ok: false, errorType: 'api_unavailable' as AltegioErrorType, errorDetail: `HTTP ${res.status}` };
      }
      return res.json();
    },
    enabled: !!specialistId && !!altegioStatus?.configured && isAltegioConnected,
    staleTime: 60000,
    retry: 2,
    retryDelay: (attempt) => Math.min(1000 * 2 ** attempt, 10000),
  });

  const altegioRetryTimerRef = useRef<number>(0);
  useEffect(() => {
    if (altegioHealth && !altegioHealth.ok && altegioHealth.errorType === 'api_unavailable') {
      altegioRetryTimerRef.current++;
      const attempt = altegioRetryTimerRef.current;
      const delays = [30000, 120000, 600000];
      const delay = delays[Math.min(attempt - 1, delays.length - 1)];
      const timer = setTimeout(() => refetchAltegioHealth(), delay);
      return () => clearTimeout(timer);
    } else if (altegioHealth?.ok) {
      altegioRetryTimerRef.current = 0;
    }
  }, [altegioHealth?.ok, altegioHealth?.errorType]);

  useEffect(() => {
    if (altegioHealth?.ok) {
      setAltegioErrorDismissed(false);
    }
  }, [altegioHealth?.ok]);

  const handleAltegioConnect = async () => {
    setAltegioModalOpen(true);
    setAltegioCompanyInput('');
  };

  const handleAltegioConnectCompany = async () => {
    if (!currentUser?.id) return;
    const raw = altegioCompanyInput.trim();
    if (!raw) {
      toast({ title: 'Введите ссылку или ID компании', variant: 'destructive' });
      return;
    }
    setAltegioConnecting(true);
    try {
      const res = await fetch('/api/altegio/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
        body: JSON.stringify({ altegioLink: raw }),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Попробуйте ещё раз');
      }
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId] });
      setAltegioModalOpen(false);
      toast({ title: 'Altegio подключён', description: 'Синхронизация визитов активна' });
    } catch (err: any) {
      toast({ title: 'Не удалось подключить Altegio', description: err.message, variant: 'destructive' });
    } finally {
      setAltegioConnecting(false);
    }
  };

  const handleAltegioDisconnect = async () => {
    if (!currentUser?.id) return;
    try {
      const res = await fetch('/api/altegio/disconnect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
      });
      if (!res.ok) throw new Error('Попробуйте ещё раз');
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId] });
      toast({ title: 'Altegio отключён' });
    } catch (err: any) {
      toast({ title: 'Не удалось отключить Altegio', description: err.message, variant: 'destructive' });
    }
  };

  const uploadPhoto = async (file: File, photoType: 'avatar' | 'work') => {
    if (!specialistId || !currentUser?.id) return;

    const formData = new FormData();
    formData.append('photo', file);
    formData.append('photoType', photoType);

    const res = await fetch(`/api/specialists/${specialistId}/photos`, {
      method: 'POST',
      headers: {
        'x-user-id': currentUser.id,
      },
      body: formData,
    });

    if (!res.ok) {
      const error = await res.json();
      throw new Error(error.message || 'Upload failed');
    }

    return res.json();
  };

  const deletePhotoMutation = useMutation({
    mutationFn: async (photoId: number) => {
      if (!specialistId || !currentUser?.id) throw new Error('Not authorized');
      
      const res = await fetch(`/api/specialists/${specialistId}/photos/${photoId}`, {
        method: 'DELETE',
        headers: {
          'x-user-id': currentUser.id,
        },
      });

      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Delete failed');
      }

      return res.json();
    },
    onSuccess: () => {
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId, 'photos'] });
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId] });
      toast({ title: 'Фото удалено' });
    },
    onError: (err: Error) => {
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    },
  });

  const handleFileSelect = async (e: React.ChangeEvent<HTMLInputElement>, photoType: 'avatar' | 'work') => {
    const file = e.target.files?.[0];
    if (!file) return;

    if (file.size > 5 * 1024 * 1024) {
      toast({ title: 'Ошибка', description: 'Файл слишком большой (макс. 5MB)', variant: 'destructive' });
      return;
    }

    if (!['image/jpeg', 'image/png'].includes(file.type)) {
      toast({ title: 'Ошибка', description: 'Только JPG и PNG', variant: 'destructive' });
      return;
    }

    setUploading(photoType);
    try {
      await uploadPhoto(file, photoType);
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId, 'photos'] });
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId] });
      toast({ title: photoType === 'avatar' ? 'Аватар обновлён' : 'Фото добавлено' });
    } catch (err: any) {
      toast({ title: 'Ошибка загрузки', description: err.message, variant: 'destructive' });
    } finally {
      setUploading(null);
      e.target.value = '';
    }
  };

  if (!specialistId) {
    return (
      <div className="p-6" data-testid="specialist-dashboard">
        <p className="text-muted-foreground">К вашему аккаунту не привязан профиль барбера.</p>
      </div>
    );
  }

  const [completingBookingId, setCompletingBookingId] = useState<number | null>(null);
  const [retryingSyncId, setRetryingSyncId] = useState<number | null>(null);

  const retrySyncMutation = useMutation({
    mutationFn: async (bookingId: number) => {
      if (!currentUser?.id) throw new Error('Not authorized');
      setRetryingSyncId(bookingId);
      const res = await fetch(`/api/altegio/retry-sync/${bookingId}`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'x-user-id': currentUser.id },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Retry failed');
      }
      return res.json();
    },
    onSuccess: () => {
      setRetryingSyncId(null);
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId, 'bookings'] });
    },
    onError: (err: Error) => {
      setRetryingSyncId(null);
      toast({ title: 'Не удалось повторить синхронизацию', description: err.message, variant: 'destructive' });
    },
  });

  const [cancellingBookingId, setCancellingBookingId] = useState<number | null>(null);

  const [priceDialogBookingId, setPriceDialogBookingId] = useState<number | null>(null);
  const [priceInputValue, setPriceInputValue] = useState<string>('');
  const [confirmPaymentBooking, setConfirmPaymentBooking] = useState<{ id: number; price: number | null } | null>(null);

  const completeRequestPaymentMutation = useMutation({
    mutationFn: async ({ bookingId, price }: { bookingId: number; price: number }) => {
      if (!currentUser?.id) throw new Error('Not authorized');
      setCompletingBookingId(bookingId);
      const res = await fetch(`/api/specialist/bookings/${bookingId}/complete-request-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
        body: JSON.stringify({ price }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Ошибка');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setCompletingBookingId(null);
      setPriceDialogBookingId(null);
      setPriceInputValue('');
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId, 'bookings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId] });
      if (data?.waSent) {
        toast({ title: 'Запрос оплаты отправлен клиенту в WhatsApp' });
      } else {
        toast({ title: 'Запрос оплаты создан', description: 'Сообщение в WhatsApp не отправлено — проверьте номер телефона клиента' });
      }
    },
    onError: (err: Error) => {
      setCompletingBookingId(null);
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    },
  });

  const markPaidMutation = useMutation({
    mutationFn: async (bookingId: number) => {
      if (!currentUser?.id) throw new Error('Not authorized');
      setCompletingBookingId(bookingId);
      const res = await fetch(`/api/specialist/bookings/${bookingId}/mark-paid`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Ошибка');
      }
      return res.json();
    },
    onSuccess: () => {
      setCompletingBookingId(null);
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId, 'bookings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId] });
      toast({ title: 'Оплата подтверждена, визит завершён' });
    },
    onError: (err: Error) => {
      setCompletingBookingId(null);
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    },
  });

  const completeSendReviewMutation = useMutation({
    mutationFn: async (bookingId: number) => {
      if (!currentUser?.id) throw new Error('Not authorized');
      setCompletingBookingId(bookingId);
      const res = await fetch(`/api/specialist/bookings/${bookingId}/complete-send-review`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Ошибка');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setCompletingBookingId(null);
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId, 'bookings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId] });
      const magicLinkInfo = data.magicLinkCreated
        ? '\nСсылка для отзыва создана и отправлена клиенту.'
        : '\nСсылка для отзыва не создана (нет контактных данных клиента).';
      if (data.reducedTrustNotice) {
        toast({
          title: 'Визит завершён',
          description: data.reducedTrustNotice + magicLinkInfo,
          duration: 8000,
        });
      } else {
        toast({
          title: 'Визит завершён',
          description: 'Отзыв запрошен.' + magicLinkInfo,
          duration: 6000,
        });
      }
    },
    onError: (err: Error) => {
      setCompletingBookingId(null);
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    },
  });

  const cancelBookingMutation = useMutation({
    mutationFn: async (bookingId: number) => {
      if (!currentUser?.id) throw new Error('Not authorized');
      setCancellingBookingId(bookingId);
      const res = await fetch(`/api/specialist/bookings/${bookingId}/cancel`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Ошибка');
      }
      return res.json();
    },
    onSuccess: () => {
      setCancellingBookingId(null);
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId, 'bookings'] });
      toast({ title: 'Визит отменён' });
    },
    onError: (err: Error) => {
      setCancellingBookingId(null);
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    },
  });


  const createBookingMutation = useMutation({
    mutationFn: async (opts?: { force?: boolean }) => {
      if (!currentUser?.id) throw new Error('Не авторизован');
      const dateEl = document.getElementById('new-booking-date') as HTMLInputElement;
      const timeEl = document.getElementById('new-booking-time') as HTMLInputElement;
      const actualDate = dateEl?.value || newBookingDate;
      const actualTime = timeEl?.value || newBookingTime;
      if (!actualDate || !actualTime) throw new Error('Укажите дату и время');
      const appointmentTime = new Date(`${actualDate}T${actualTime}`);
      if (isNaN(appointmentTime.getTime())) throw new Error('Неверный формат даты/времени');
      const twentyFourHoursAgo = new Date(Date.now() - 24 * 60 * 60 * 1000);
      if (appointmentTime < twentyFourHoursAgo) throw new Error('Можно выбрать только текущую дату или последние 24 часа');
      const controller = new AbortController();
      const timeoutId = setTimeout(() => controller.abort(), 15000);
      try {
        const res = await fetch('/api/specialist/bookings', {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'x-user-id': currentUser.id,
          },
          body: JSON.stringify({
            customerName: (document.getElementById('new-booking-name') as HTMLInputElement)?.value || newBookingName || '',
            customerPhone: (document.getElementById('new-booking-phone') as HTMLInputElement)?.value || newBookingPhone || '',
            appointmentTime: appointmentTime.toISOString(),
            force: opts?.force || false,
          }),
          signal: controller.signal,
        });
        clearTimeout(timeoutId);
        const text = await res.text();
        let data: any;
        try {
          data = text ? JSON.parse(text) : {};
        } catch {
          throw new Error(`Сервер вернул некорректный ответ (${res.status})`);
        }
        if (!res.ok) {
          throw new Error(data.message || `Ошибка сервера (${res.status})`);
        }
        return data;
      } catch (err: any) {
        clearTimeout(timeoutId);
        if (err.name === 'AbortError') {
          throw new Error('Превышено время ожидания (15 сек)');
        }
        throw err;
      }
    },
    onSuccess: (data) => {
      if (data.warning) {
        setRateLimitWarningOpen(true);
        return;
      }
      const wasFirstVisit = !loadingBookings && (bookings?.length ?? 0) === 0 && !isAltegioConnected;
      if (wasFirstVisit) setShowFirstVisitSuccess(true);
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId, 'bookings'] });
      queryClient.refetchQueries({ queryKey: ['/api/specialists', specialistId, 'bookings'], type: 'all' });
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId] });
      toast({ title: wasFirstVisit ? 'Клиент добавлен' : 'Запись создана', description: `${data.customerName || 'Клиент'} — ${data.id ? '#' + data.id : ''}` });
      setShowNewBookingForm(false);
      setNewBookingName('');
      setNewBookingPhone('');
      setNewBookingDate('');
      setNewBookingTime('');
    },
    onError: (err: Error) => {
      toast({ title: isNewSpecialist ? 'Не удалось добавить клиента' : 'Ошибка создания записи', description: err.message, variant: 'destructive' });
    },
  });

  const isManualBooking = (b: any) => b.bookingSource === 'specialist_manual' || (!b.altegioAppointmentId && b.bookingSource !== 'altegio');
  const activeBookings = (bookings?.filter(b => 
    b.status === 'scheduled' || b.status === 'ready_to_complete' || b.status === 'payment_pending' || b.status === 'payment_requested'
  ) || []).sort((a, b) => {
    const aManual = isManualBooking(a);
    const bManual = isManualBooking(b);
    if (aManual && !bManual) return -1;
    if (!aManual && bManual) return 1;
    return new Date(a.appointmentTime).getTime() - new Date(b.appointmentTime).getTime();
  });

  const completedBookings = bookings?.filter(b => b.status === 'completed') || [];
  const cancelledBookings = bookings?.filter(b => b.status === 'cancelled') || [];

  const allBookingsForSync = [...activeBookings, ...completedBookings];
  const globalAltegioBanner = getGlobalAltegioBannerConfig(allBookingsForSync as any, 3);
  const suppressIndividualBanners = !!globalAltegioBanner;

  const STALE_HOURS = 6;
  const staleBookings = activeBookings.filter(b => {
    const appointmentTime = new Date(b.appointmentTime).getTime();
    const hoursSince = (Date.now() - appointmentTime) / (1000 * 60 * 60);
    return hoursSince >= STALE_HOURS;
  });

  const trustedRating = (specialist as any)?.trustedRating || 0;
  const trustedReviewsCount = (specialist as any)?.trustedReviewsCount || 0;
  const averageRating = trustedRating > 0 ? trustedRating.toFixed(1) : '0.0';

  const workPhotos = photos.filter(p => p.photoType === 'work');
  const canAddWorkPhoto = workPhotos.length < 5;

  useEffect(() => {
    if (specialist?.bio) {
      setBio(specialist.bio);
    }
    if (specialist?.city) {
      setCity(specialist.city);
    }
    if ((specialist as any)?.subcategory) {
      setSubcategory((specialist as any).subcategory);
    }
  }, [specialist?.bio, specialist?.city, (specialist as any)?.subcategory]);

  useEffect(() => {
    if (specialist) {
      setKaspiPhone(specialist.kaspiPhone || '');
      setTipsEnabled(specialist.tipsEnabled || false);
      setBaseServiceName(specialist.baseServiceName || '');
      setBaseServicePrice(specialist.baseServicePrice ? String(specialist.baseServicePrice) : '');
      setWorkAddress((specialist as any).workAddress || '');
      setWorkLat((specialist as any).workLat ?? null);
      setWorkLng((specialist as any).workLng ?? null);
      setBookingUrl((specialist as any).bookingUrl || '');
      setWhatsapp((specialist as any).whatsapp || '');
      setInstagram((specialist as any).instagram || '');
      setCountry((specialist as any).country || 'KZ');
    }
  }, [specialist]);

  const buildGeocodeQuery = () => {
    const countryName = country === 'UZ' ? 'Узбекистан' : 'Казахстан';
    if (new RegExp(countryName, 'i').test(workAddress)) return workAddress;
    return `${workAddress}, ${city}, ${countryName}`;
  };

  const handleSaveBio = async () => {
    if (!specialistId || !currentUser?.id) return;
    setSavingBio(true);
    try {
      let lat = workLat;
      let lng = workLng;
      let addr = workAddress;
      let geocodeMissed = false;
      // Auto-geocode a typed address that has no coordinates yet, so the master
      // shows up correctly in "Рядом со мной" even if they didn't press the
      // geocode button. If it can't be located, we still save the typed address
      // but flag it so we can be honest with the user instead of faking success.
      if (workAddress.trim() && (lat == null || lng == null)) {
        try {
          const q = buildGeocodeQuery();
          const gr = await fetch(`https://nominatim.openstreetmap.org/search?q=${encodeURIComponent(q)}&format=json&limit=1&accept-language=ru`);
          const results = gr.ok ? await gr.json() : [];
          if (results.length > 0) {
            lat = Number(results[0].lat);
            lng = Number(results[0].lon);
            addr = results[0].display_name || workAddress;
            setWorkLat(lat);
            setWorkLng(lng);
            setWorkAddress(addr);
          } else {
            geocodeMissed = true;
          }
        } catch {
          geocodeMissed = true;
        }
      }
      const res = await fetch(`/api/specialists/${specialistId}/bio`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
        body: JSON.stringify({ bio, city, country, subcategory, workAddress: addr, workLat: lat, workLng: lng, bookingUrl, whatsapp, instagram }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to save');
      }
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId] });
      if (geocodeMissed) {
        toast({
          title: 'Адрес сохранён, но не найден на карте',
          description: 'Координаты не определились. Нажмите «Определить моё местоположение» рядом с полем адреса, чтобы клиенты видели вас в «Рядом со мной».',
          variant: 'destructive',
        });
      } else {
        toast({ title: 'Профиль сохранён' });
      }
    } catch (err: any) {
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    } finally {
      setSavingBio(false);
    }
  };

  const handleSaveTipsSettings = async () => {
    if (!specialistId || !currentUser?.id) return;
    setSavingTips(true);
    try {
      const res = await fetch(`/api/specialists/${specialistId}/tips-settings`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
        body: JSON.stringify({ kaspiPhone, tipsEnabled }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to save');
      }
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId] });
      toast({ title: 'Настройки чаевых сохранены' });
    } catch (err: any) {
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    } finally {
      setSavingTips(false);
    }
  };

  const handleSaveBaseService = async () => {
    if (!specialistId || !currentUser?.id) return;
    const name = baseServiceName.trim();
    const priceStr = baseServicePrice.trim();
    let price: number | null = null;
    if (priceStr) {
      if (!/^\d+$/.test(priceStr)) {
        toast({ title: 'Ошибка', description: 'Стоимость должна быть целым числом', variant: 'destructive' });
        return;
      }
      price = parseInt(priceStr, 10);
      if (price <= 0 || price > 10000000) {
        toast({ title: 'Ошибка', description: 'Введите корректную стоимость (от 1 до 10 000 000)', variant: 'destructive' });
        return;
      }
    }
    if ((name && !price) || (!name && price)) {
      toast({ title: 'Ошибка', description: 'Заполните оба поля или оставьте оба пустыми', variant: 'destructive' });
      return;
    }
    setSavingBaseService(true);
    try {
      const res = await fetch(`/api/specialists/${specialistId}/base-service`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
        body: JSON.stringify({ baseServiceName: name || null, baseServicePrice: price }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to save');
      }
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId] });
      toast({ title: 'Базовая услуга сохранена' });
    } catch (err: any) {
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    } finally {
      setSavingBaseService(false);
    }
  };

  const tipsSettingsChanged = 
    kaspiPhone !== (specialist?.kaspiPhone || '') || 
    tipsEnabled !== (specialist?.tipsEnabled || false);

  const baseServiceChanged =
    baseServiceName !== (specialist?.baseServiceName || '') ||
    baseServicePrice !== (specialist?.baseServicePrice ? String(specialist.baseServicePrice) : '');

  return (
    <div className="p-6 space-y-6" data-testid="specialist-dashboard">
      <BarberCelebrationOverlay event={activeCelebration} onClose={dismissCelebration} />
      <Dialog open={!!guideMode} onOpenChange={(o) => { if (!o) setGuideMode(null); }}>
        <DialogContent className="max-w-sm" data-testid="dialog-guide">
          <DialogHeader>
            <DialogTitle>
              {guideMode === 'create-visit' ? 'Создайте и завершите визит' : 'Заполните профиль'}
            </DialogTitle>
            <DialogDescription className="space-y-2 text-left pt-1">
              {guideMode === 'create-visit' ? (
                <>
                  <span className="block">1. Заполните данные клиента — имя и телефон в форме ниже.</span>
                  <span className="block">2. Нажмите «Создать запись».</span>
                  <span className="block">3. После визита нажмите «Завершить визит» — клиент получит ссылку на отзыв.</span>
                </>
              ) : (
                <span className="block">Добавьте фото, основную услугу с ценой и способ записи. Без этого клиенты не смогут вас найти и записаться.</span>
              )}
            </DialogDescription>
          </DialogHeader>
          <Button onClick={() => setGuideMode(null)} className="w-full" data-testid="button-guide-ok">Понятно</Button>
        </DialogContent>
      </Dialog>
      <ActivationProgress
        specialist={specialist}
        createdVisits={bookings?.length ?? 0}
        onAddClient={() => {
          setShowNewBookingForm(true);
          if (isNewSpecialist) prefillVisitNow();
          setTimeout(() => {
            const el = document.getElementById('bookings-section');
            el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
            (document.getElementById('new-booking-name') as HTMLInputElement | null)?.focus();
          }, 100);
        }}
        onScrollTo={(anchor) => {
          const el = document.getElementById(anchor);
          el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          if (anchor === 'avatar-section') {
            setTimeout(() => avatarInputRef.current?.click(), 350);
          }
        }}
      />

      {achievements && (achievements.rank != null || achievements.badges.length > 0) && (
        <Card data-testid="card-achievements">
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Trophy className="h-5 w-5 text-amber-500" />
              Твои награды
            </CardTitle>
          </CardHeader>
          <CardContent className="space-y-4">
            {achievements.rank != null && (
              <p className="text-sm text-muted-foreground" data-testid="text-rank">
                Ты <span className="font-bold text-foreground">№{achievements.rank}</span> по количеству отзывов
                {' '}({achievements.reviewCount}) из {achievements.totalRanked} мастеров.
              </p>
            )}

            {achievements.badges.length > 0 && (
              <div className="flex flex-wrap gap-2">
                {achievements.badges.map((b) => (
                  <div
                    key={b.id}
                    title={b.desc}
                    className="flex items-center gap-1.5 rounded-full border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 px-3 py-1.5 text-sm font-medium"
                    data-testid={`badge-${b.id}`}
                  >
                    <span className="text-base leading-none">{b.emoji}</span>
                    <span>{b.title}</span>
                  </div>
                ))}
              </div>
            )}

            {achievements.nudge && (
              <div
                className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 p-3"
                data-testid="text-nudge"
              >
                <p className="text-sm font-semibold text-foreground">{achievements.nudge.title}</p>
                <p className="mt-0.5 text-sm text-muted-foreground">{achievements.nudge.message}</p>
              </div>
            )}

            {achievements.leaderboard.length > 0 && (
              <div>
                <p className="mb-2 text-sm font-semibold text-foreground">Топ-10 по отзывам</p>
                <div className="space-y-1" data-testid="leaderboard">
                  {achievements.leaderboard.map((e) => (
                    <div
                      key={e.specialistId}
                      className={`flex items-center justify-between rounded-lg px-3 py-1.5 text-sm ${
                        e.isYou
                          ? 'bg-primary/10 font-semibold text-foreground'
                          : 'text-muted-foreground'
                      }`}
                      data-testid={`leaderboard-row-${e.specialistId}`}
                    >
                      <span className="flex items-center gap-2">
                        <span className="w-6 text-center">
                          {e.rank === 1 ? '🥇' : e.rank === 2 ? '🥈' : e.rank === 3 ? '🥉' : `${e.rank}.`}
                        </span>
                        <span>{e.name}{e.isYou ? ' (ты)' : ''}</span>
                      </span>
                      <span>{e.reviewCount}</span>
                    </div>
                  ))}
                </div>
              </div>
            )}
          </CardContent>
        </Card>
      )}

      {specialist && ((specialist as any).workLat == null || (specialist as any).workLng == null) && (
        <div
          className="rounded-xl border border-amber-200 dark:border-amber-900 bg-amber-50/70 dark:bg-amber-950/30 p-4"
          data-testid="banner-add-address"
        >
          <p className="text-sm font-semibold text-foreground">
            {(specialist as any).workAddress?.trim() ? 'Адрес не определён на карте' : 'Укажите адрес места работы'}
          </p>
          <p className="mt-1 text-sm text-muted-foreground">
            {(specialist as any).workAddress?.trim()
              ? 'Вы указали адрес, но координаты не нашлись. Определите местоположение, чтобы клиенты видели вас в «Рядом со мной».'
              : 'Клиенты смогут найти вас в списке «Рядом со мной» и увидят расстояние до вас.'}
          </p>
          <Button
            className="mt-3"
            size="sm"
            onClick={() => {
              const el = document.getElementById('bio-section');
              el?.scrollIntoView({ behavior: 'smooth', block: 'start' });
              setTimeout(() => (document.getElementById('workAddress') as HTMLInputElement | null)?.focus(), 350);
            }}
            data-testid="button-add-address"
          >
            {(specialist as any).workAddress?.trim() ? 'Определить на карте' : 'Указать адрес'}
          </Button>
        </div>
      )}

      {!loadingSpecialist && !isAltegioConnected && <OnboardingPathModal />}

      {loadingSpecialist ? (
        <Skeleton className="h-32 w-full" />
      ) : specialist ? (
        <Card>
          <CardHeader className="flex flex-row items-center gap-4">
            <img 
              src={specialist.imageUrl} 
              alt={specialist.name}
              className="w-20 h-20 rounded-full object-cover"
              data-testid="img-specialist-avatar"
            />
            <div className="flex-1">
              <CardTitle className="text-2xl" data-testid="text-specialist-name">{specialist.name}</CardTitle>
              <p className="text-muted-foreground" data-testid="text-specialty">{specialist.specialty}</p>
              <div className="flex items-center gap-4 mt-2">
                {trustedReviewsCount < 3 ? (
                  <span className="text-sm text-muted-foreground" data-testid="text-new-profile">Новый профиль</span>
                ) : trustedRating === 0 ? (
                  <span className="text-sm text-muted-foreground" data-testid="text-no-data">Недостаточно данных</span>
                ) : (
                  <div className="flex items-center gap-1">
                    <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                    <span data-testid="text-rating">{averageRating}</span>
                  </div>
                )}
                <Badge variant="secondary" data-testid="badge-review-count">
                  {specialist.reviewCount || 0} отзывов
                </Badge>
              </div>
            </div>
          </CardHeader>
        </Card>
      ) : null}

      <a
        href="https://wa.me/77773000467?text=%D0%97%D0%B4%D1%80%D0%B0%D0%B2%D1%81%D1%82%D0%B2%D1%83%D0%B9%D1%82%D0%B5!%20%D0%A3%20%D0%BC%D0%B5%D0%BD%D1%8F%20%D0%B2%D0%BE%D0%BF%D1%80%D0%BE%D1%81%20%D0%BF%D0%BE%20Rateus."
        target="_blank"
        rel="noopener noreferrer"
        className="fixed bottom-20 right-4 z-50 bg-green-500 hover:bg-green-600 text-white rounded-full w-12 h-12 flex items-center justify-center shadow-lg"
        data-testid="link-support-whatsapp"
      >
        <MessageCircle className="w-5 h-5" />
      </a>

      <Card>
        <CardHeader>
          <CardTitle>О барбере</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
            <Label htmlFor="country">Страна</Label>
            <Select value={country} onValueChange={(val) => { setCountry(val); const opts = val === 'UZ' ? ['Ташкент'] : ['Алматы', 'Астана', 'Караганда']; if (!opts.includes(city)) setCity(opts[0]); }} data-testid="select-specialist-country">
              <SelectTrigger data-testid="select-trigger-country">
                <SelectValue placeholder="Выберите страну" />
              </SelectTrigger>
              <SelectContent>
                <SelectItem value="KZ">Казахстан</SelectItem>
                <SelectItem value="UZ">Узбекистан</SelectItem>
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="city">Город</Label>
            <Select value={city} onValueChange={setCity} data-testid="select-specialist-city">
              <SelectTrigger data-testid="select-trigger-city">
                <SelectValue placeholder="Выберите город" />
              </SelectTrigger>
              <SelectContent>
                {(country === 'UZ' ? ['Ташкент'] : ['Алматы', 'Астана', 'Караганда']).map((c) => (
                  <SelectItem key={c} value={c}>{c}</SelectItem>
                ))}
              </SelectContent>
            </Select>
          </div>
          <div className="space-y-2">
            <Label htmlFor="subcategory">Специализация</Label>
            <Input
              id="subcategory"
              value={subcategory}
              onChange={(e) => setSubcategory(e.target.value)}
              placeholder="Например: тренер по плаванию, стоматолог"
              data-testid="input-specialist-subcategory"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="workAddress">Адрес места работы</Label>
            {(() => {
              const hasCoords = (specialist as any)?.workLat != null && (specialist as any)?.workLng != null;
              const updatedAt = (specialist as any)?.workLocationUpdatedAt;
              const daysSince = updatedAt ? (Date.now() - new Date(updatedAt).getTime()) / (1000 * 60 * 60 * 24) : 999;
              const locked = hasCoords && daysSince < 7;
              const daysLeft = locked ? Math.ceil(7 - daysSince) : 0;
              return (
                <>
                  {locked ? (
                    <div
                      className="p-3 bg-muted/50 rounded-lg cursor-pointer"
                      onClick={() => setLocationCooldownOpen(true)}
                      data-testid="area-location-locked"
                    >
                      <div className="flex items-center gap-2 text-sm text-muted-foreground">
                        <MapPin className="w-4 h-4 shrink-0" />
                        <span className="truncate">{workAddress || 'Адрес указан'}</span>
                      </div>
                      {workLat != null && workLng != null && (
                        <p className="text-xs text-muted-foreground mt-1">
                          {workLat.toFixed(5)}, {workLng.toFixed(5)}
                        </p>
                      )}
                      <p className="text-xs text-orange-600 mt-1">
                        Изменение через {daysLeft} дн.
                      </p>
                    </div>
                  ) : (
                    <AddressPicker
                      address={workAddress}
                      lat={workLat}
                      lng={workLng}
                      city={city}
                      country={country}
                      onChange={(addr, la, ln) => { setWorkAddress(addr); setWorkLat(la); setWorkLng(ln); }}
                    />
                  )}
                  <Dialog open={locationCooldownOpen} onOpenChange={setLocationCooldownOpen}>
                    <DialogContent className="max-w-sm">
                      <DialogHeader>
                        <DialogTitle>Адрес временно заблокирован</DialogTitle>
                        <DialogDescription>
                          Вы недавно указали адрес места работы. Изменение адреса доступно не чаще 1 раза в 7 дней — это помогает защитить достоверность отзывов.
                        </DialogDescription>
                      </DialogHeader>
                      <p className="text-sm text-center text-orange-600 font-medium" data-testid="text-cooldown-days">
                        Осталось {daysLeft} дн.
                      </p>
                      <Button onClick={() => setLocationCooldownOpen(false)} className="w-full" data-testid="button-cooldown-ok">
                        Понятно
                      </Button>
                    </DialogContent>
                  </Dialog>
                </>
              );
            })()}
          </div>
          <div className="space-y-2" id="contacts-section">
            <Label>Контакты для записи</Label>
            {isAltegioConnected ? (
              <div
                className="rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30 p-4 space-y-3"
                data-testid="card-altegio-connected"
              >
                <div className="flex items-center gap-2">
                  <CheckCircle2 className="w-5 h-5 text-emerald-500 shrink-0" />
                  <div>
                    <p className="text-sm font-semibold text-foreground">Онлайн-запись подключена</p>
                    <p className="text-xs text-muted-foreground">Источник: Altegio</p>
                  </div>
                </div>
                <p className="text-xs text-muted-foreground">
                  Мы автоматически получили ссылку на онлайн-запись из Altegio. Клиенты смогут записываться через кнопку «Записаться».
                </p>
                <div className="flex flex-wrap gap-2">
                  {((specialist as any)?.bookingUrl || (specialist as any)?.altegioCompanyId) && (
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open((specialist as any).bookingUrl || `https://n${(specialist as any).altegioCompanyId}.alteg.io/`, '_blank', 'noopener,noreferrer')}
                      data-testid="button-open-altegio-booking"
                    >
                      Открыть ссылку записи
                    </Button>
                  )}
                  <Button
                    size="sm"
                    variant="outline"
                    onClick={() => window.open(`/specialist/${specialist!.id}`, '_blank', 'noopener,noreferrer')}
                    data-testid="button-view-public-profile"
                  >
                    Посмотреть как видят клиенты
                  </Button>
                </div>
              </div>
            ) : (
              <>
                <div
                  className="rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 p-3"
                  data-testid="note-manual-booking"
                >
                  <p className="text-xs text-amber-900 dark:text-amber-200">
                    Чтобы собирать отзывы: создавайте визиты вручную ниже (кнопка «Создать запись») и завершайте их после приёма.
                  </p>
                </div>
                <p className="text-xs text-muted-foreground">
                  Кнопка «Записаться» использует первый заполненный канал по приоритету: ссылка → WhatsApp → Instagram → телефон из профиля.
                </p>
                <Input
                  type="url"
                  value={bookingUrl}
                  onChange={(e) => setBookingUrl(e.target.value)}
                  placeholder="Ссылка на онлайн-запись (Altegio, YClients и т.д.)"
                  data-testid="input-booking-url"
                />
              </>
            )}
            <Input
              type="tel"
              value={whatsapp}
              onChange={(e) => setWhatsapp(e.target.value)}
              placeholder="WhatsApp: +7 777 123 45 67"
              data-testid="input-whatsapp"
            />
            <Input
              type="text"
              value={instagram}
              onChange={(e) => setInstagram(e.target.value)}
              placeholder="Instagram: @username или ссылка"
              data-testid="input-instagram"
            />
          </div>
          <div className="space-y-2" id="bio-section">
            <Label htmlFor="bio">Краткое описание</Label>
            <Textarea
              id="bio"
              value={bio}
              onChange={(e) => setBio(e.target.value.slice(0, 180))}
              placeholder="Расскажите о своей специализации, опыте и подходе к работе"
              className="resize-none"
              rows={3}
              data-testid="input-specialist-bio"
            />
            <div className="flex items-center justify-between">
              <span className="text-xs text-muted-foreground">
                {bio.length} / 180
              </span>
              <Button
                size="sm"
                onClick={handleSaveBio}
                disabled={savingBio || (bio === specialist?.bio && city === (specialist?.city || 'Алматы') && subcategory === ((specialist as any)?.subcategory || '') && workAddress === ((specialist as any)?.workAddress || '') && workLat === ((specialist as any)?.workLat ?? null) && workLng === ((specialist as any)?.workLng ?? null) && bookingUrl === ((specialist as any)?.bookingUrl || '') && whatsapp === ((specialist as any)?.whatsapp || '') && instagram === ((specialist as any)?.instagram || ''))}
                data-testid="button-save-bio"
              >
                {savingBio ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card id="price-section">
        <CardHeader>
          <CardTitle>Базовая услуга</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <div className="space-y-2">
            <Label htmlFor="baseServiceName">Базовая услуга</Label>
            <Input
              id="baseServiceName"
              value={baseServiceName}
              onChange={(e) => setBaseServiceName(e.target.value)}
              placeholder="Наименование базовой услуги"
              className="placeholder:text-muted-foreground/40"
              maxLength={100}
              data-testid="input-base-service-name"
            />
          </div>
          <div className="space-y-2">
            <Label htmlFor="baseServicePrice">Стоимость, ₸</Label>
            <Input
              id="baseServicePrice"
              type="number"
              value={baseServicePrice}
              onChange={(e) => setBaseServicePrice(e.target.value)}
              placeholder="Цена базовой услуги"
              className="placeholder:text-muted-foreground/40"
              min={1}
              data-testid="input-base-service-price"
            />
          </div>
          <p className="text-xs text-muted-foreground">
            Это ориентир для клиентов. Итоговая стоимость может отличаться при дополнительных услугах.
          </p>
          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleSaveBaseService}
              disabled={savingBaseService || !baseServiceChanged}
              data-testid="button-save-base-service"
            >
              {savingBaseService ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </div>
        </CardContent>
      </Card>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <Banknote className="w-5 h-5" />
          <CardTitle>Чаевые через Kaspi</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Клиенты смогут оставить вам чаевые напрямую в Kaspi после отзыва. 
            Деньги поступают сразу вам, платформа не участвует в переводе.
          </p>
          
          <div className="space-y-2">
            <Label htmlFor="kaspiPhone">Номер телефона Kaspi</Label>
            <Input
              id="kaspiPhone"
              type="tel"
              value={kaspiPhone}
              onChange={(e) => setKaspiPhone(e.target.value)}
              placeholder="+7 (___) ___-__-__"
              data-testid="input-kaspi-phone"
            />
          </div>

          <div className="flex items-center justify-between">
            <div className="space-y-0.5">
              <Label htmlFor="tipsEnabled">Принимать чаевые через Kaspi</Label>
              <p className="text-xs text-muted-foreground">
                После отзыва клиент увидит кнопку чаевых
              </p>
            </div>
            <Switch
              id="tipsEnabled"
              checked={tipsEnabled}
              onCheckedChange={setTipsEnabled}
              disabled={!kaspiPhone.trim()}
              data-testid="switch-tips-enabled"
            />
          </div>

          <div className="flex justify-end">
            <Button
              size="sm"
              onClick={handleSaveTipsSettings}
              disabled={savingTips || !tipsSettingsChanged}
              data-testid="button-save-tips"
            >
              {savingTips ? 'Сохранение...' : 'Сохранить'}
            </Button>
          </div>
        </CardContent>
      </Card>

      {altegioStatus?.configured && (
        <>
          {isAltegioConnected && altegioHealth && !altegioHealth.ok && !altegioErrorDismissed && (
            <AltegioErrorScreen
              errorType={altegioHealth.errorType || 'unknown'}
              onReconnect={() => {
                handleAltegioDisconnect().then(() => {
                  handleAltegioConnect();
                });
              }}
              onRetry={async () => {
                setAltegioRetrying(true);
                await refetchAltegioHealth();
                setAltegioRetrying(false);
              }}
              onSettings={() => {
                handleAltegioDisconnect().then(() => {
                  handleAltegioConnect();
                });
              }}
              onClose={() => setAltegioErrorDismissed(true)}
              retrying={altegioRetrying}
            />
          )}

          <AltegioStatusCard
            state={
              altegioRetrying ? 'checking'
              : !isAltegioConnected ? 'error'
              : (specialist as any)?.altegioConnectionStatus === 'error' ? 'warning'
              : altegioHealth && !altegioHealth.ok ? 'warning'
              : 'connected'
            }
            onConnect={handleAltegioConnect}
            onReconnect={() => {
              handleAltegioDisconnect().then(() => handleAltegioConnect());
            }}
          />
        </>
      )}

      <Dialog open={altegioModalOpen} onOpenChange={setAltegioModalOpen}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle>Подключить Altegio</DialogTitle>
            <DialogDescription>
              Два шага: сначала разрешите приложение в Altegio, затем вставьте ссылку на вашу онлайн-запись.
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="rounded-lg border border-border bg-muted/40 p-3 space-y-2">
              <p className="text-sm font-medium">Шаг 1. Разрешите приложение в Altegio</p>
              <p className="text-xs text-muted-foreground">
                Приложение закрытое — в каталоге Altegio его не найти. Откройте ссылку ниже (нужно быть залогиненным в Altegio) и нажмите «Подключить» в открывшемся окне Altegio.
              </p>
              <a
                href="https://app.alteg.io/e/mp_1368_trustwho_reviews/"
                target="_blank"
                rel="noopener noreferrer"
                className="inline-flex items-center text-sm font-medium text-primary underline underline-offset-2 break-all"
                data-testid="link-altegio-install"
              >
                Открыть установку приложения в Altegio
              </a>
            </div>
            <div className="space-y-2">
              <Label htmlFor="altegioCompanyInput">Шаг 2. Ваша персональная ссылка записи</Label>
              <Input
                id="altegioCompanyInput"
                value={altegioCompanyInput}
                onChange={(e) => setAltegioCompanyInput(e.target.value)}
                placeholder="https://n123456.alteg.io"
                data-testid="input-altegio-company"
              />
              <p className="text-xs text-muted-foreground">
                Лучше всего вставить <span className="font-medium text-foreground">«Ссылку сотрудника»</span> — она ведёт прямо к вам, и мы привяжем отзывы именно к вам (другие мастера салона не помешают). В Altegio: «Онлайн-запись» → «Ссылки для онлайн-записи» → «Новая ссылка» → «Ссылка сотрудника». Подойдёт и общая ссылка салона, и ID компании.
              </p>
            </div>
            <Button
              className="w-full"
              onClick={handleAltegioConnectCompany}
              disabled={!altegioCompanyInput.trim() || altegioConnecting}
              data-testid="button-altegio-company-save"
            >
              {altegioConnecting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
              Подключить
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={rateLimitWarningOpen} onOpenChange={setRateLimitWarningOpen}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <AlertTriangle className="w-5 h-5 text-orange-500" />
              Внимание
            </DialogTitle>
            <DialogDescription>
              Вы создали более 3 записей за последний час. Создавайте записи по мере их появления.
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-2 mt-2">
            <Button
              className="flex-1"
              onClick={() => {
                setRateLimitWarningOpen(false);
                createBookingMutation.mutate({ force: true });
              }}
              data-testid="button-force-create-booking"
            >
              Всё равно создать
            </Button>
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setRateLimitWarningOpen(false)}
              data-testid="button-cancel-rate-limit"
            >
              Отмена
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Card>
        <CardHeader className="flex flex-row items-center gap-2">
          <UserPlus className="w-5 h-5" />
          <CardTitle>Пригласить коллегу</CardTitle>
        </CardHeader>
        <CardContent className="space-y-4">
          <p className="text-sm text-muted-foreground">
            Если у коллеги есть профиль в Rateus, клиентам проще ему доверять.
          </p>
          
          <Button
            variant="outline"
            onClick={() => {
              const inviteUrl = `${window.location.origin}/join?ref=${specialist?.id}`;
              navigator.clipboard.writeText(inviteUrl).then(() => {
                toast({ title: 'Ссылка скопирована' });
              }).catch(() => {
                toast({ title: 'Ошибка копирования', variant: 'destructive' });
              });
            }}
            className="w-full"
            data-testid="button-copy-invite-link"
          >
            <Copy className="w-4 h-4 mr-2" />
            Скопировать ссылку
          </Button>
        </CardContent>
      </Card>

      <Card id="avatar-section">
        <CardHeader className="flex flex-row items-center gap-2">
          <Camera className="w-5 h-5" />
          <CardTitle>Фото</CardTitle>
        </CardHeader>
        <CardContent className="space-y-6">
          <div>
            <h3 className="font-medium mb-3 flex items-center gap-2">
              <User className="w-4 h-4" />
              Аватар
            </h3>
            <div className="flex items-center gap-4">
              {specialist && (
                <img 
                  src={specialist.imageUrl} 
                  alt="Avatar"
                  className="w-24 h-24 rounded-full object-cover border-2 border-muted"
                  data-testid="img-avatar-preview"
                />
              )}
              <div>
                <input
                  ref={avatarInputRef}
                  type="file"
                  accept="image/jpeg,image/png"
                  className="hidden"
                  onChange={(e) => handleFileSelect(e, 'avatar')}
                  data-testid="input-avatar-upload"
                />
                <Button
                  variant="outline"
                  onClick={() => avatarInputRef.current?.click()}
                  disabled={uploading === 'avatar'}
                  data-testid="button-upload-avatar"
                >
                  <Upload className="w-4 h-4 mr-2" />
                  {uploading === 'avatar' ? 'Загрузка...' : 'Загрузить аватар'}
                </Button>
                <p className="text-xs text-muted-foreground mt-1">JPG или PNG, до 5MB</p>
              </div>
            </div>
          </div>

          <div>
            <h3 className="font-medium mb-3 flex items-center gap-2">
              <Image className="w-4 h-4" />
              Фото работ ({workPhotos.length}/5)
            </h3>
            
            {loadingPhotos ? (
              <div className="grid grid-cols-3 gap-3">
                <Skeleton className="aspect-square rounded-md" />
                <Skeleton className="aspect-square rounded-md" />
                <Skeleton className="aspect-square rounded-md" />
              </div>
            ) : (
              <div className="grid grid-cols-3 sm:grid-cols-5 gap-3">
                {workPhotos.map((photo) => (
                  <div key={photo.id} className="relative group" data-testid={`work-photo-${photo.id}`}>
                    <img
                      src={photo.photoUrl}
                      alt="Work"
                      className="aspect-square object-cover rounded-md border"
                    />
                    <Button
                      size="icon"
                      variant="destructive"
                      className="absolute top-1 right-1 opacity-0 group-hover:opacity-100 transition-opacity"
                      onClick={() => deletePhotoMutation.mutate(photo.id)}
                      disabled={deletePhotoMutation.isPending}
                      data-testid={`button-delete-photo-${photo.id}`}
                    >
                      <Trash2 className="w-4 h-4" />
                    </Button>
                  </div>
                ))}

                {canAddWorkPhoto && (
                  <div 
                    className="aspect-square border-2 border-dashed rounded-md flex items-center justify-center cursor-pointer hover:border-primary transition-colors"
                    onClick={() => workInputRef.current?.click()}
                    data-testid="button-add-work-photo"
                  >
                    <input
                      ref={workInputRef}
                      type="file"
                      accept="image/jpeg,image/png"
                      className="hidden"
                      onChange={(e) => handleFileSelect(e, 'work')}
                      data-testid="input-work-upload"
                    />
                    {uploading === 'work' ? (
                      <span className="text-xs text-muted-foreground">Загрузка...</span>
                    ) : (
                      <div className="text-center">
                        <Upload className="w-6 h-6 mx-auto text-muted-foreground" />
                        <span className="text-xs text-muted-foreground">Добавить</span>
                      </div>
                    )}
                  </div>
                )}
              </div>
            )}
            <p className="text-xs text-muted-foreground mt-2">JPG или PNG, до 5MB каждое</p>
          </div>
        </CardContent>
      </Card>

      {activeBookings.some(b => b.status === 'ready_to_complete' || b.status === 'payment_pending' || b.status === 'payment_requested') && (
        <Card className="border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/30">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200" data-testid="text-uncompleted-warning">
                  Есть незавершённые визиты
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                  Завершите визиты, чтобы клиенты могли оставить отзыв
                </p>
              </div>
            </div>
          </CardContent>
        </Card>
      )}

      {globalAltegioBanner && (
        <AltegioSyncBanner
          config={globalAltegioBanner}
          debounceMs={0}
          testId="banner-altegio-global"
        />
      )}

      <div className="grid gap-6 md:grid-cols-2">
        <Card id="bookings-section">
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <CalendarIcon className="w-5 h-5" />
              <CardTitle>{isNewSpecialist ? "Добавьте клиента для получения отзыва" : "Предстоящие записи"}</CardTitle>
            </div>
            <div className="flex items-center gap-2">
              {activeBookings.length > 0 && (
                <Badge variant="secondary" data-testid="badge-upcoming-count">
                  {activeBookings.length}
                </Badge>
              )}
              <Button
                size="sm"
                variant="outline"
                onClick={() => {
                  const next = !showNewBookingForm;
                  setShowNewBookingForm(next);
                  if (next && isNewSpecialist) prefillVisitNow();
                }}
                data-testid="button-new-booking"
              >
                <Plus className="w-4 h-4 mr-1" />
                {isNewSpecialist ? "Добавить первого клиента" : "Записать"}
              </Button>
            </div>
          </CardHeader>
          <CardContent>
            {showFirstVisitSuccess && (
              <div
                className="mb-4 rounded-lg border border-emerald-200 dark:border-emerald-900 bg-emerald-50/60 dark:bg-emerald-950/30 p-4"
                data-testid="first-visit-success"
              >
                <p className="text-sm font-semibold text-foreground">Клиент добавлен</p>
                <p className="text-sm text-muted-foreground mt-1">
                  После завершения визита клиент автоматически получит ссылку на отзыв.
                </p>
                <p className="mt-2 text-xs font-medium text-amber-700 dark:text-amber-400">
                  Важно: без завершения визита ссылка на отзыв не отправляется.
                </p>
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() => setShowFirstVisitSuccess(false)}
                  data-testid="button-first-visit-ack"
                >
                  Понятно
                </Button>
              </div>
            )}
            {showNewBookingForm && isAltegioConnected && !manualVisitInfoDismissed && (
              <div
                className="mb-4 rounded-lg border border-amber-200 dark:border-amber-900 bg-amber-50/60 dark:bg-amber-950/30 p-4 relative"
                data-testid="manual-visit-altegio-info"
              >
                <button
                  type="button"
                  onClick={() => setManualVisitInfoDismissed(true)}
                  className="absolute top-2 right-2 text-muted-foreground hover:text-foreground"
                  aria-label="Закрыть"
                  data-testid="button-close-manual-visit-info"
                >
                  <X className="w-4 h-4" />
                </button>
                <p className="text-sm font-semibold text-foreground pr-6">У вас подключён Altegio</p>
                <p className="text-sm text-muted-foreground mt-1">
                  Отзывы по вручную созданным визитам учитываются ограниченно.
                </p>
                <p className="text-sm text-muted-foreground mt-1">
                  Для максимального доверия и полного веса отзывов используйте визиты из Altegio.
                </p>
                <Button
                  size="sm"
                  className="mt-3"
                  onClick={() => setManualVisitInfoDismissed(true)}
                  data-testid="button-manual-visit-info-ack"
                >
                  Понятно
                </Button>
              </div>
            )}
            {showNewBookingForm && (
              <div className="mb-4 p-3 rounded-md bg-muted/50 space-y-3" data-testid="form-new-booking">
                <div className="space-y-2">
                  <Label htmlFor="new-booking-name">Имя клиента *</Label>
                  <Input
                    id="new-booking-name"
                    placeholder="Имя клиента"
                    value={newBookingName}
                    onChange={(e) => setNewBookingName(e.target.value)}
                    data-testid="input-new-booking-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="new-booking-phone">Телефон клиента</Label>
                  <Input
                    id="new-booking-phone"
                    type="tel"
                    inputMode="tel"
                    placeholder="+7 777 123 4567"
                    value={newBookingPhone}
                    onChange={(e) => setNewBookingPhone(e.target.value)}
                    onInput={(e) => setNewBookingPhone((e.target as HTMLInputElement).value)}
                    onBlur={(e) => setNewBookingPhone(e.target.value)}
                    data-testid="input-new-booking-phone"
                  />
                </div>
                <div className="grid grid-cols-2 gap-2">
                  <div className="space-y-2">
                    <Label>Дата *</Label>
                    <Popover>
                      <PopoverTrigger asChild>
                        <Button
                          variant="outline"
                          size="sm"
                          className="w-full justify-start text-left font-normal h-10"
                          data-testid="input-new-booking-date"
                        >
                          <CalendarDays className="mr-2 h-4 w-4" />
                          {newBookingDate ? format(new Date(newBookingDate + 'T00:00:00'), 'd MMM yyyy') : <span className="text-muted-foreground">Выберите</span>}
                        </Button>
                      </PopoverTrigger>
                      <PopoverContent className="w-auto p-0" align="start">
                        <Calendar
                          mode="single"
                          selected={newBookingDate ? new Date(newBookingDate + 'T00:00:00') : undefined}
                          onSelect={(date) => {
                            if (date) {
                              const y = date.getFullYear();
                              const m = String(date.getMonth() + 1).padStart(2, '0');
                              const d = String(date.getDate()).padStart(2, '0');
                              setNewBookingDate(`${y}-${m}-${d}`);
                            }
                          }}
                          disabled={(date) => {
                            const cutoff = new Date();
                            cutoff.setDate(cutoff.getDate() - 1);
                            cutoff.setHours(cutoff.getHours(), cutoff.getMinutes(), 0, 0);
                            const startOfDay = new Date(date.getFullYear(), date.getMonth(), date.getDate(), 23, 59, 59);
                            return startOfDay < new Date(Date.now() - 24 * 60 * 60 * 1000);
                          }}
                          initialFocus
                        />
                      </PopoverContent>
                    </Popover>
                    <input type="hidden" id="new-booking-date" value={newBookingDate} />
                  </div>
                  <div className="space-y-2">
                    <Label htmlFor="new-booking-time">Время *</Label>
                    <input
                      id="new-booking-time"
                      type="time"
                      className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background file:border-0 file:bg-transparent file:text-sm file:font-medium placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 disabled:cursor-not-allowed disabled:opacity-50"
                      value={newBookingTime}
                      onChange={(e) => setNewBookingTime(e.target.value)}
                      onInput={(e) => setNewBookingTime((e.target as HTMLInputElement).value)}
                      onBlur={(e) => setNewBookingTime(e.target.value)}
                      data-testid="input-new-booking-time"
                    />
                  </div>
                </div>
                {isNewSpecialist && (
                  <p className="text-xs text-muted-foreground" data-testid="text-visit-date-hint">
                    Уже обслужили клиента? Оставьте сегодняшнюю дату и время, затем завершите визит — клиент получит ссылку на отзыв.
                  </p>
                )}
                <div className="flex gap-2">
                  <Button
                    size="sm"
                    className="flex-1"
                    onClick={() => {
                      const nameEl = document.getElementById('new-booking-name') as HTMLInputElement;
                      const phoneEl = document.getElementById('new-booking-phone') as HTMLInputElement;
                      const dateEl = document.getElementById('new-booking-date') as HTMLInputElement;
                      const timeEl = document.getElementById('new-booking-time') as HTMLInputElement;
                      if (nameEl?.value && nameEl.value !== newBookingName) setNewBookingName(nameEl.value);
                      if (phoneEl?.value && phoneEl.value !== newBookingPhone) setNewBookingPhone(phoneEl.value);
                      if (dateEl?.value && dateEl.value !== newBookingDate) setNewBookingDate(dateEl.value);
                      if (timeEl?.value && timeEl.value !== newBookingTime) setNewBookingTime(timeEl.value);
                      const name = nameEl?.value || newBookingName;
                      const date = dateEl?.value || newBookingDate;
                      const time = timeEl?.value || newBookingTime;
                      if (!name || !date || !time) {
                        toast({ title: 'Заполните все поля', description: `Имя: ${name ? '✓' : '✗'}, Дата: ${date ? '✓' : '✗'}, Время: ${time ? '✓' : '✗'}`, variant: 'destructive' });
                        return;
                      }
                      createBookingMutation.mutate({});
                    }}
                    disabled={createBookingMutation.isPending}
                    data-testid="button-create-booking"
                  >
                    {createBookingMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-1" /> : null}
                    {isNewSpecialist ? "Добавить клиента" : "Создать запись"}
                  </Button>
                  <Button
                    size="sm"
                    variant="ghost"
                    onClick={() => setShowNewBookingForm(false)}
                    data-testid="button-cancel-new-booking"
                  >
                    Отмена
                  </Button>
                </div>
              </div>
            )}
            {loadingBookings ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : activeBookings.length === 0 && !showNewBookingForm ? (
              <p className="text-muted-foreground text-sm">
                {isNewSpecialist ? "Пока нет клиентов. Добавьте первого, чтобы получить отзыв." : "Нет предстоящих записей"}
              </p>
            ) : (
              <div className="space-y-3 max-h-[600px] overflow-y-auto pr-1">
                {activeBookings.map((booking) => {
                  const status = booking.status;
                  const isNotCompleted = (booking as any).notCompleted === true;
                  const canCancel = status === 'scheduled' || status === 'ready_to_complete';
                  const isManual = isManualBooking(booking);

                  return (
                    <div 
                      key={booking.id} 
                      className={`p-3 rounded-md space-y-2 overflow-hidden ${
                        isNotCompleted ? 'bg-muted/30 opacity-60' :
                        isManual ? 'bg-green-50/50 dark:bg-green-950/20 border border-green-200 dark:border-green-800' :
                        status === 'ready_to_complete' ? 'bg-amber-50/50 dark:bg-amber-950/20' :
                        (status === 'payment_pending' || status === 'payment_requested') ? 'bg-blue-50/50 dark:bg-blue-950/20' :
                        'bg-muted/50'
                      }`}
                      data-testid={`booking-item-${booking.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-muted-foreground" />
                          <span data-testid={`text-customer-${booking.id}`}>{booking.customerName}</span>
                          {isManual && (
                            <Badge variant="outline" className="text-[10px] px-1.5 py-0 h-4 bg-green-50 text-green-700 border-green-300 dark:bg-green-950 dark:text-green-400 dark:border-green-700" data-testid={`badge-manual-${booking.id}`}>
                              ваша
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1.5">
                          {(booking as any).bookingSource !== 'specialist_manual' && (booking as any).altegioSyncStatus === 'synced' && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <CircleCheck className="w-3.5 h-3.5 text-green-500" data-testid={`icon-sync-ok-${booking.id}`} />
                              </TooltipTrigger>
                              <TooltipContent>Синхронизировано с Altegio</TooltipContent>
                            </Tooltip>
                          )}
                          {(booking as any).bookingSource !== 'specialist_manual' && (booking as any).altegioSyncStatus === 'error' && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" data-testid={`icon-sync-error-${booking.id}`} />
                              </TooltipTrigger>
                              <TooltipContent>Не удалось синхронизировать</TooltipContent>
                            </Tooltip>
                          )}
                          {(booking as any).bookingSource !== 'specialist_manual' && (booking as any).altegioSyncStatus === 'pending' && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" data-testid={`icon-sync-pending-${booking.id}`} />
                              </TooltipTrigger>
                              <TooltipContent>Синхронизация с Altegio...</TooltipContent>
                            </Tooltip>
                          )}
                          <Badge variant="outline" data-testid={`badge-time-${booking.id}`}>
                            {format(new Date(booking.appointmentTime), 'MMM d, h:mm a')}
                          </Badge>
                        </div>
                      </div>
                      {!suppressIndividualBanners && (booking as any).bookingSource !== 'specialist_manual' && (
                        <AltegioSyncBanner
                          config={getBookingSyncBannerConfig(
                            (booking as any).altegioSyncStatus,
                            (booking as any).altegioSyncError,
                            (booking as any).altegioRetryCount,
                            () => retrySyncMutation.mutate(booking.id),
                            retryingSyncId === booking.id,
                          )}
                          loading={retryingSyncId === booking.id}
                          testId={`banner-sync-${booking.id}`}
                        />
                      )}
                      {isNotCompleted ? (
                        <Badge variant="outline" className="text-muted-foreground" data-testid={`badge-not-completed-${booking.id}`}>
                          Не состоялся
                        </Badge>
                      ) : status === 'ready_to_complete' ? (
                        <>
                          <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400" data-testid={`text-ready-to-complete-${booking.id}`}>
                            <Clock className="w-3 h-3" />
                            <span>Время визита прошло — завершите визит</span>
                          </div>
                          <div className="flex gap-2">
                            <Button
                              size="sm"
                              className="flex-1"
                              onClick={() => completeSendReviewMutation.mutate(booking.id)}
                              disabled={completingBookingId === booking.id || cancellingBookingId === booking.id}
                              data-testid={`button-send-review-${booking.id}`}
                            >
                              {completingBookingId === booking.id ? <Loader2 className="w-4 h-4 animate-spin" /> : (<><CheckCircle2 className="w-4 h-4 mr-2" />Завершить визит</>)}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                setPriceDialogBookingId(booking.id);
                                setPriceInputValue((booking as any).price ? String((booking as any).price) : '');
                              }}
                              disabled={completingBookingId === booking.id || cancellingBookingId === booking.id}
                              data-testid={`button-request-payment-${booking.id}`}
                            >
                              Запросить оплату
                            </Button>
                          </div>
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-xs text-muted-foreground"
                              onClick={() => cancelBookingMutation.mutate(booking.id)}
                              disabled={completingBookingId === booking.id || cancellingBookingId === booking.id}
                              data-testid={`button-cancel-visit-${booking.id}`}
                            >
                              {cancellingBookingId === booking.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Не состоялся'}
                            </Button>
                          </div>
                        </>
                      ) : status === 'payment_requested' ? (() => {
                        const isAltegio = (booking as any).bookingSource === 'altegio' || !!(booking as any).altegioAppointmentId;
                        return (
                        <>
                          {isAltegio ? (
                            <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400" data-testid={`text-payment-requested-${booking.id}`}>
                              <Clock className="w-3 h-3" />
                              <span>Ожидание оплаты{(booking as any).price ? ` — ${(booking as any).price} ₸` : ''}</span>
                            </div>
                          ) : (
                            <div className="space-y-1" data-testid={`text-payment-requested-${booking.id}`}>
                              <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400">
                                <Banknote className="w-3 h-3" />
                                <span>Запрос оплаты{(booking as any).price ? `: ${(booking as any).price} ₸` : ''}</span>
                              </div>
                              {(booking as any).paymentRequestedAt && (
                                <div className="text-[11px] text-muted-foreground">
                                  Отправлен: {format(new Date((booking as any).paymentRequestedAt), 'dd.MM.yyyy HH:mm')}
                                </div>
                              )}
                            </div>
                          )}
                          <div className="flex flex-wrap gap-2">
                            {isAltegio ? (
                              <Button
                                size="sm"
                                className="flex-1 min-w-0"
                                onClick={() => markPaidMutation.mutate(booking.id)}
                                disabled={completingBookingId === booking.id || cancellingBookingId === booking.id}
                                data-testid={`button-mark-paid-${booking.id}`}
                              >
                                <CheckCircle2 className="w-4 h-4 mr-1 shrink-0" />
                                <span className="truncate">{completingBookingId === booking.id ? 'Загрузка...' : 'Отметить оплату'}</span>
                              </Button>
                            ) : (
                              <Button
                                size="sm"
                                className="flex-1 min-w-0"
                                onClick={() => setConfirmPaymentBooking({ id: booking.id, price: (booking as any).price })}
                                disabled={completingBookingId === booking.id || cancellingBookingId === booking.id}
                                data-testid={`button-confirm-payment-${booking.id}`}
                              >
                                <CheckCircle2 className="w-4 h-4 mr-1 shrink-0" />
                                <span className="truncate">{completingBookingId === booking.id ? 'Загрузка...' : 'Подтвердить оплату'}</span>
                              </Button>
                            )}
                            {!isAltegio && (
                              <Button
                                size="sm"
                                variant="outline"
                                className="min-w-0"
                                onClick={() => {
                                  setPriceInputValue((booking as any).price?.toString() || '');
                                  setPriceDialogBookingId(booking.id);
                                }}
                                disabled={completeRequestPaymentMutation.isPending}
                                data-testid={`button-resend-payment-${booking.id}`}
                              >
                                <span className="truncate">Повторить</span>
                              </Button>
                            )}
                          </div>
                          <div className="flex justify-end">
                            <Button
                              size="sm"
                              variant="ghost"
                              className="text-xs text-muted-foreground"
                              onClick={() => cancelBookingMutation.mutate(booking.id)}
                              disabled={cancellingBookingId === booking.id}
                              data-testid={`button-cancel-payment-${booking.id}`}
                            >
                              {cancellingBookingId === booking.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Отменить'}
                            </Button>
                          </div>
                        </>
                        );
                      })() : status === 'payment_pending' ? (
                        <div className="flex items-center gap-1.5 text-xs text-blue-600 dark:text-blue-400" data-testid={`text-payment-pending-${booking.id}`}>
                          <Loader2 className="w-3 h-3 animate-spin" />
                          <span>Ожидание оплаты</span>
                        </div>
                      ) : status === 'scheduled' ? (
                        <div className="flex items-center justify-between gap-2">
                          <Badge variant="secondary" data-testid={`badge-scheduled-${booking.id}`}>
                            Запланирован
                          </Badge>
                          <Button
                            size="sm"
                            variant="ghost"
                            className="text-xs text-muted-foreground"
                            onClick={() => cancelBookingMutation.mutate(booking.id)}
                            disabled={cancellingBookingId === booking.id}
                            data-testid={`button-cancel-visit-${booking.id}`}
                          >
                            {cancellingBookingId === booking.id ? <Loader2 className="w-4 h-4 animate-spin" /> : 'Отменить'}
                          </Button>
                        </div>
                      ) : null}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>

        {reviews && reviews.length > 0 && specialist?.baseServicePrice && (() => {
          const priceReviewCount = reviews.filter((r: any) => r.priceMismatch).length;
          if (priceReviewCount === 0) return null;
          return (
            <Card>
              <CardContent className="py-4">
                <p className="text-sm text-muted-foreground" data-testid="text-price-discrepancy-count">
                  Отзывы с расхождением по цене — <span className="font-semibold text-foreground">{priceReviewCount}</span>
                </p>
              </CardContent>
            </Card>
          );
        })()}

        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <MessageSquare className="w-5 h-5" />
            <CardTitle>Последние отзывы</CardTitle>
          </CardHeader>
          <CardContent>
            {loadingReviews ? (
              <div className="space-y-2">
                <Skeleton className="h-20 w-full" />
                <Skeleton className="h-20 w-full" />
              </div>
            ) : !reviews || reviews.length === 0 ? (
              <p className="text-muted-foreground text-sm">Пока нет отзывов</p>
            ) : (
              <div className="space-y-3">
                {reviews.slice(0, 5).map((review) => {
                  const displayName = !review.showName 
                    ? "Аноним" 
                    : (review.customerName.includes('@') 
                        ? review.customerName.split('@')[0] 
                        : review.customerName);
                  
                  return (
                    <div 
                      key={review.id} 
                      className="p-3 rounded-md bg-muted/50"
                      data-testid={`review-item-${review.id}`}
                    >
                      <div className="flex items-center justify-between mb-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium text-sm" data-testid={`text-reviewer-${review.id}`}>
                            {displayName}
                          </span>
                          {review.hiddenName && (
                            <Badge variant="outline" className="text-muted-foreground text-[10px]">
                              Анонимно
                            </Badge>
                          )}
                        </div>
                        <div className="flex items-center gap-1">
                          <Star className="w-3 h-3 text-yellow-500 fill-yellow-500" />
                          <span className="text-sm" data-testid={`text-review-rating-${review.id}`}>
                            {review.rating}
                          </span>
                        </div>
                      </div>
                      {review.triggers && review.triggers.length > 0 && (
                        <div className="flex flex-wrap gap-1 mb-1">
                          {review.triggers.map((trigger: string, idx: number) => (
                            <span 
                              key={idx}
                              className="px-2 py-0.5 rounded-full bg-primary/10 text-primary text-[11px] font-medium"
                            >
                              {trigger}
                            </span>
                          ))}
                        </div>
                      )}
                      {review.comment && (
                        <p className="text-sm text-muted-foreground" data-testid={`text-review-comment-${review.id}`}>
                          {review.comment}
                        </p>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </CardContent>
        </Card>
      </div>

      <Card>
        <CardHeader className="flex flex-row items-center justify-between gap-2">
          <CardTitle>Завершённые визиты</CardTitle>
          {completedBookings.length > 0 && (
            <Badge variant="secondary" data-testid="badge-completed-count">
              {completedBookings.length}
            </Badge>
          )}
        </CardHeader>
        {completedBookings.length > 0 && (() => {
          const sorted = [...completedBookings].sort((a, b) => new Date(a.appointmentTime).getTime() - new Date(b.appointmentTime).getTime());
          const earliest = sorted[0];
          const latest = sorted[sorted.length - 1];
          const earliestDate = format(new Date(earliest.appointmentTime), 'd MMM');
          const latestDate = format(new Date(latest.appointmentTime), 'd MMM');
          return (
            <div className="px-6 pb-2">
              <p className="text-xs text-muted-foreground" data-testid="text-completed-period">
                {earliestDate === latestDate ? earliestDate : `${earliestDate} — ${latestDate}`}
              </p>
            </div>
          );
        })()}
        <CardContent>
          {loadingBookings ? (
            <Skeleton className="h-16 w-full" />
          ) : completedBookings.length === 0 ? (
            <p className="text-muted-foreground text-sm">Пока нет завершённых визитов</p>
          ) : (
            <div className="space-y-2 max-h-[420px] overflow-y-auto pr-1">
              {completedBookings.map((booking) => (
                <div 
                  key={booking.id}
                  className="p-3 rounded-md bg-muted/50 space-y-2"
                  data-testid={`completed-booking-${booking.id}`}
                >
                  <div className="flex items-center justify-between gap-2">
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-muted-foreground" />
                      <span>{booking.customerName}</span>
                    </div>
                    <div className="flex items-center gap-2">
                      {(booking as any).bookingSource !== 'specialist_manual' && (booking as any).altegioSyncStatus === 'synced' && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <CircleCheck className="w-3.5 h-3.5 text-green-500" />
                          </TooltipTrigger>
                          <TooltipContent>Синхронизировано с Altegio</TooltipContent>
                        </Tooltip>
                      )}
                      {(booking as any).bookingSource !== 'specialist_manual' && (booking as any).altegioSyncStatus === 'error' && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                          </TooltipTrigger>
                          <TooltipContent>Не удалось синхронизировать</TooltipContent>
                        </Tooltip>
                      )}
                      {(booking as any).bookingSource !== 'specialist_manual' && (booking as any).altegioSyncStatus === 'pending' && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <Loader2 className="w-3.5 h-3.5 text-amber-500 animate-spin" />
                          </TooltipTrigger>
                          <TooltipContent>Синхронизация с Altegio...</TooltipContent>
                        </Tooltip>
                      )}
                      <Badge variant="secondary">
                        {format(new Date(booking.appointmentTime), 'MMM d')}
                      </Badge>
                      {(booking as any).paymentStatus === 'paid' && (
                        <Badge variant="outline" className="text-green-600 dark:text-green-400">
                          Оплачено
                        </Badge>
                      )}
                      {booking.hasReview && (
                        <Badge variant="outline" className="text-green-600">
                          Есть отзыв
                        </Badge>
                      )}
                    </div>
                  </div>
                  
                  {!suppressIndividualBanners && (booking as any).bookingSource !== 'specialist_manual' && (
                    <AltegioSyncBanner
                      config={getBookingSyncBannerConfig(
                        (booking as any).altegioSyncStatus,
                        (booking as any).altegioSyncError,
                        (booking as any).altegioRetryCount,
                        () => retrySyncMutation.mutate(booking.id),
                        retryingSyncId === booking.id,
                      )}
                      loading={retryingSyncId === booking.id}
                      testId={`banner-sync-completed-${booking.id}`}
                    />
                  )}
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>

      <Dialog open={priceDialogBookingId !== null} onOpenChange={(open) => { if (!open) { setPriceDialogBookingId(null); setPriceInputValue(''); } }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Запросить оплату через Kaspi</DialogTitle>
            <DialogDescription>
              Клиент получит ссылку для оплаты через Kaspi
            </DialogDescription>
          </DialogHeader>
          <div className="space-y-4">
            <div className="space-y-2">
              <label className="text-sm font-medium">Сумма (₸)</label>
              <input
                type="number"
                min="1"
                className="flex h-10 w-full rounded-md border border-input bg-background px-3 py-2 text-sm ring-offset-background placeholder:text-muted-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                placeholder="Введите сумму"
                value={priceInputValue}
                onChange={(e) => setPriceInputValue(e.target.value)}
                data-testid="input-payment-price"
              />
            </div>
            <Button
              className="w-full"
              disabled={!priceInputValue || Number(priceInputValue) <= 0 || completeRequestPaymentMutation.isPending}
              onClick={() => {
                if (priceDialogBookingId && priceInputValue) {
                  completeRequestPaymentMutation.mutate({ bookingId: priceDialogBookingId, price: Number(priceInputValue) });
                }
              }}
              data-testid="button-confirm-request-payment"
            >
              {completeRequestPaymentMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Отправить запрос оплаты
            </Button>
          </div>
        </DialogContent>
      </Dialog>

      <Dialog open={confirmPaymentBooking !== null} onOpenChange={(open) => { if (!open) setConfirmPaymentBooking(null); }}>
        <DialogContent className="max-w-sm">
          <DialogHeader>
            <DialogTitle>Подтвердить получение оплаты</DialogTitle>
            <DialogDescription>
              {confirmPaymentBooking?.price
                ? `Подтвердить получение оплаты ${confirmPaymentBooking.price} ₸?`
                : 'Подтвердить получение оплаты?'}
            </DialogDescription>
          </DialogHeader>
          <div className="flex gap-3">
            <Button
              variant="outline"
              className="flex-1"
              onClick={() => setConfirmPaymentBooking(null)}
              data-testid="button-cancel-confirm-payment"
            >
              Отмена
            </Button>
            <Button
              className="flex-1"
              disabled={markPaidMutation.isPending}
              onClick={() => {
                if (confirmPaymentBooking) {
                  markPaidMutation.mutate(confirmPaymentBooking.id);
                  setConfirmPaymentBooking(null);
                }
              }}
              data-testid="button-do-confirm-payment"
            >
              {markPaidMutation.isPending ? <Loader2 className="w-4 h-4 animate-spin mr-2" /> : null}
              Подтвердить
            </Button>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
