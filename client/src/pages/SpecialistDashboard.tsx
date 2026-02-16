import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Star, Calendar, MessageSquare, User, Camera, Image, Trash2, Upload, Banknote, UserPlus, Copy, AlertTriangle, CheckCircle2, Clock, Link2, Unlink, RefreshCw, CircleCheck, Loader2, Info } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import { useRef, useState, useEffect } from 'react';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import { Dialog, DialogContent, DialogHeader, DialogTitle, DialogDescription } from '@/components/ui/dialog';
import { Avatar, AvatarImage, AvatarFallback } from '@/components/ui/avatar';
import type { Specialist, Booking, Review, SpecialistPhoto } from '@shared/schema';
import AltegioErrorScreen, { type AltegioErrorType } from '@/components/AltegioErrorScreen';
import AltegioSyncBanner, { getBookingSyncBannerConfig, getGlobalAltegioBannerConfig } from '@/components/AltegioSyncBanner';
import AltegioStatusCard from '@/components/AltegioStatusCard';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';

export default function SpecialistDashboard() {
  const { currentUser } = useAuth();
  const specialistId = currentUser?.specialistId;
  const { toast } = useToast();
  const avatarInputRef = useRef<HTMLInputElement>(null);
  const workInputRef = useRef<HTMLInputElement>(null);
  const [uploading, setUploading] = useState<'avatar' | 'work' | null>(null);
  const [bio, setBio] = useState('');
  const [savingBio, setSavingBio] = useState(false);
  const [kaspiPhone, setKaspiPhone] = useState('');
  const [tipsEnabled, setTipsEnabled] = useState(false);
  const [savingTips, setSavingTips] = useState(false);
  const [baseServiceName, setBaseServiceName] = useState('');
  const [baseServicePrice, setBaseServicePrice] = useState('');
  const [savingBaseService, setSavingBaseService] = useState(false);
  const [altegioModalOpen, setAltegioModalOpen] = useState(false);
  const [altegioManualMode, setAltegioManualMode] = useState(false);
  const [altegioManualId, setAltegioManualId] = useState('');
  const [selectedStaffId, setSelectedStaffId] = useState<number | null>(null);
  const [altegioConnecting, setAltegioConnecting] = useState(false);

  const { data: specialist, isLoading: loadingSpecialist } = useQuery<Specialist>({
    queryKey: ['/api/specialists', specialistId],
    enabled: !!specialistId,
  });

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

  const isAltegioConnected = !!(specialist as any)?.altegioStaffId;

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

  const { data: altegioStaffData, isLoading: loadingAltegioStaff, error: altegioStaffError, refetch: refetchStaff } = useQuery<{ staff: Array<{ id: number; name: string; avatar: string | null; specialization: string | null }>; companyId: number }>({
    queryKey: ['/api/altegio/staff'],
    queryFn: async () => {
      if (!currentUser?.id) throw new Error('Not authorized');
      const res = await fetch('/api/altegio/staff', {
        headers: { 'x-user-id': currentUser.id },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message || 'Не удалось загрузить сотрудников');
      }
      return res.json();
    },
    enabled: false,
  });

  const handleAltegioConnect = async () => {
    setAltegioModalOpen(true);
    setSelectedStaffId(null);
    setAltegioManualMode(false);
    setAltegioManualId('');
    refetchStaff();
  };

  const handleAltegioSelectStaff = async (staffId: number, companyId: number) => {
    if (!currentUser?.id) return;
    setAltegioConnecting(true);
    try {
      const res = await fetch('/api/altegio/connect', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
        body: JSON.stringify({ altegioStaffId: staffId, altegioCompanyId: companyId }),
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

  const handleAltegioManualSave = async () => {
    const id = parseInt(altegioManualId, 10);
    if (!id || isNaN(id)) {
      toast({ title: 'Введите корректный ID', variant: 'destructive' });
      return;
    }
    if (!altegioStaffData?.companyId) {
      toast({ title: 'Не удалось определить компанию Altegio', description: 'Попробуйте ещё раз', variant: 'destructive' });
      return;
    }
    await handleAltegioSelectStaff(id, altegioStaffData.companyId);
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

  const altegioAutoSelectedRef = useRef(false);
  useEffect(() => {
    if (altegioStaffData?.staff && altegioStaffData.staff.length === 1 && altegioModalOpen && !altegioAutoSelectedRef.current && !altegioConnecting) {
      altegioAutoSelectedRef.current = true;
      const single = altegioStaffData.staff[0];
      handleAltegioSelectStaff(single.id, altegioStaffData.companyId);
      console.log('[ALTEGIO] Auto-selected single staff');
    }
  }, [altegioStaffData, altegioModalOpen]);

  useEffect(() => {
    if (!altegioModalOpen) {
      altegioAutoSelectedRef.current = false;
    }
  }, [altegioModalOpen]);

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

  const completeVisitMutation = useMutation({
    mutationFn: async (bookingId: number) => {
      if (!currentUser?.id) throw new Error('Not authorized');
      setCompletingBookingId(bookingId);
      const res = await fetch(`/api/specialist/bookings/${bookingId}/complete-visit`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to complete visit');
      }
      return res.json();
    },
    onSuccess: () => {
      setCompletingBookingId(null);
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId, 'bookings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId] });
      toast({ title: 'Визит завершён' });
    },
    onError: (err: Error) => {
      setCompletingBookingId(null);
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    },
  });

  const [confirmingPaymentId, setConfirmingPaymentId] = useState<number | null>(null);
  const confirmPaymentMutation = useMutation({
    mutationFn: async (bookingId: number) => {
      if (!currentUser) throw new Error('Not logged in');
      setConfirmingPaymentId(bookingId);
      const res = await fetch(`/api/specialist/bookings/${bookingId}/confirm-payment`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to confirm payment');
      }
      return res.json();
    },
    onSuccess: (data) => {
      setConfirmingPaymentId(null);
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId, 'bookings'] });
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId] });

      if (data.magicLink) {
        const whatsappUrl = `https://wa.me/?text=${encodeURIComponent(data.magicLink.whatsappText)}`;
        toast({ title: 'Оплата подтверждена. Ссылка на отзыв готова' });
        window.open(whatsappUrl, '_blank');
      } else if (data.eligibility && !data.eligibility.eligible) {
        toast({ title: 'Оплата подтверждена', description: 'Запрос отзыва не отправлен (ограничение частоты)' });
      } else {
        toast({ title: 'Оплата подтверждена' });
      }
    },
    onError: (err: Error) => {
      setConfirmingPaymentId(null);
      toast({ title: 'Ошибка', description: err.message, variant: 'destructive' });
    },
  });

  const upcomingBookings = (bookings?.filter(b => 
    b.status !== 'completed' && b.status !== 'cancelled'
  ) || []).sort((a, b) => new Date(a.appointmentTime).getTime() - new Date(b.appointmentTime).getTime());

  const completedBookings = bookings?.filter(b => b.status === 'completed') || [];

  const allBookingsForSync = [...upcomingBookings, ...completedBookings];
  const globalAltegioBanner = getGlobalAltegioBannerConfig(allBookingsForSync as any, 3);
  const suppressIndividualBanners = !!globalAltegioBanner;

  const STALE_HOURS = 6;
  const staleBookings = upcomingBookings.filter(b => {
    const appointmentTime = new Date(b.appointmentTime).getTime();
    const hoursSince = (Date.now() - appointmentTime) / (1000 * 60 * 60);
    return hoursSince >= STALE_HOURS;
  });

  const averageRating = specialist?.averageRating ? (specialist.averageRating / 10).toFixed(1) : '0.0';

  const workPhotos = photos.filter(p => p.photoType === 'work');
  const canAddWorkPhoto = workPhotos.length < 5;

  useEffect(() => {
    if (specialist?.bio) {
      setBio(specialist.bio);
    }
  }, [specialist?.bio]);

  useEffect(() => {
    if (specialist) {
      setKaspiPhone(specialist.kaspiPhone || '');
      setTipsEnabled(specialist.tipsEnabled || false);
      setBaseServiceName(specialist.baseServiceName || '');
      setBaseServicePrice(specialist.baseServicePrice ? String(specialist.baseServicePrice) : '');
    }
  }, [specialist]);

  const handleSaveBio = async () => {
    if (!specialistId || !currentUser?.id) return;
    setSavingBio(true);
    try {
      const res = await fetch(`/api/specialists/${specialistId}/bio`, {
        method: 'PATCH',
        headers: {
          'Content-Type': 'application/json',
          'x-user-id': currentUser.id,
        },
        body: JSON.stringify({ bio }),
      });
      if (!res.ok) {
        const error = await res.json();
        throw new Error(error.message || 'Failed to save');
      }
      queryClient.invalidateQueries({ queryKey: ['/api/specialists', specialistId] });
      toast({ title: 'Описание сохранено' });
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
                <div className="flex items-center gap-1">
                  <Star className="w-4 h-4 text-yellow-500 fill-yellow-500" />
                  <span data-testid="text-rating">{averageRating}</span>
                </div>
                <Badge variant="secondary" data-testid="badge-review-count">
                  {specialist.reviewCount || 0} отзывов
                </Badge>
              </div>
            </div>
          </CardHeader>
        </Card>
      ) : null}

      <Card>
        <CardHeader>
          <CardTitle>О барбере</CardTitle>
        </CardHeader>
        <CardContent className="space-y-3">
          <div className="space-y-2">
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
                disabled={savingBio || bio === specialist?.bio}
                data-testid="button-save-bio"
              >
                {savingBio ? 'Сохранение...' : 'Сохранить'}
              </Button>
            </div>
          </div>
        </CardContent>
      </Card>

      <Card>
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
          {altegioManualMode ? (
            <>
              <DialogHeader>
                <DialogTitle>Указать ID сотрудника</DialogTitle>
                <DialogDescription>
                  Введите ваш ID сотрудника из Altegio вручную
                </DialogDescription>
              </DialogHeader>
              <div className="space-y-4">
                <div className="space-y-2">
                  <Label htmlFor="altegioManualId">altegio_staff_id</Label>
                  <Input
                    id="altegioManualId"
                    type="number"
                    value={altegioManualId}
                    onChange={(e) => setAltegioManualId(e.target.value)}
                    placeholder="Например: 12345"
                    data-testid="input-altegio-manual-id"
                  />
                </div>
                <div className="flex gap-2">
                  <Button
                    className="flex-1"
                    onClick={handleAltegioManualSave}
                    disabled={!altegioManualId.trim() || altegioConnecting}
                    data-testid="button-altegio-manual-save"
                  >
                    {altegioConnecting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Сохранить
                  </Button>
                  <Button
                    variant="outline"
                    onClick={() => setAltegioManualMode(false)}
                    data-testid="button-altegio-manual-cancel"
                  >
                    Назад
                  </Button>
                </div>
              </div>
            </>
          ) : (
            <>
              <DialogHeader>
                <DialogTitle>Кто вы в Altegio?</DialogTitle>
                <DialogDescription>
                  Выберите себя из списка сотрудников
                </DialogDescription>
              </DialogHeader>
              {loadingAltegioStaff ? (
                <div className="flex items-center justify-center py-8">
                  <Loader2 className="w-6 h-6 animate-spin text-muted-foreground" />
                </div>
              ) : altegioStaffError ? (
                <div className="text-center py-6 space-y-3">
                  <AlertTriangle className="w-8 h-8 text-amber-500 mx-auto" />
                  <p className="text-sm font-medium">Не удалось загрузить сотрудников</p>
                  <p className="text-xs text-muted-foreground">{(altegioStaffError as Error).message}</p>
                  <Button variant="outline" size="sm" onClick={() => refetchStaff()} data-testid="button-altegio-retry">
                    Повторить
                  </Button>
                </div>
              ) : altegioStaffData?.staff && altegioStaffData.staff.length === 0 ? (
                <div className="text-center py-6 space-y-2">
                  <p className="text-sm font-medium">В Altegio нет сотрудников</p>
                  <p className="text-xs text-muted-foreground">Добавьте сотрудника в Altegio и повторите подключение</p>
                </div>
              ) : (
                <div className="space-y-4">
                  <div className="space-y-2 max-h-64 overflow-y-auto">
                    {altegioStaffData?.staff?.map((staff) => (
                      <div
                        key={staff.id}
                        className={`flex items-center gap-3 p-3 rounded-md cursor-pointer transition-colors ${
                          selectedStaffId === staff.id
                            ? 'bg-primary/10 ring-1 ring-primary'
                            : 'bg-muted/50 hover-elevate'
                        }`}
                        onClick={() => setSelectedStaffId(staff.id)}
                        data-testid={`staff-item-${staff.id}`}
                      >
                        <Avatar className="h-10 w-10">
                          {staff.avatar ? (
                            <AvatarImage src={staff.avatar} alt={staff.name} />
                          ) : null}
                          <AvatarFallback>{staff.name.slice(0, 2).toUpperCase()}</AvatarFallback>
                        </Avatar>
                        <div className="flex-1">
                          <p className="text-sm font-medium">{staff.name}</p>
                          {staff.specialization && (
                            <p className="text-xs text-muted-foreground">{staff.specialization}</p>
                          )}
                        </div>
                        {selectedStaffId === staff.id && (
                          <CircleCheck className="w-5 h-5 text-primary" />
                        )}
                      </div>
                    ))}
                  </div>
                  <Button
                    className="w-full"
                    onClick={() => {
                      if (selectedStaffId && altegioStaffData?.companyId) {
                        handleAltegioSelectStaff(selectedStaffId, altegioStaffData.companyId);
                      }
                    }}
                    disabled={!selectedStaffId || altegioConnecting}
                    data-testid="button-altegio-select-confirm"
                  >
                    {altegioConnecting ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : null}
                    Выбрать
                  </Button>
                  <button
                    className="text-sm text-muted-foreground underline w-full text-center"
                    onClick={() => setAltegioManualMode(true)}
                    data-testid="button-altegio-not-found"
                  >
                    Не нашли себя?
                  </button>
                </div>
              )}
            </>
          )}
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

      <Card>
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

      {upcomingBookings.length > 0 && (
        <Card className="border-amber-200 dark:border-amber-800/50 bg-amber-50/50 dark:bg-amber-950/30">
          <CardContent className="py-4">
            <div className="flex items-start gap-3">
              <AlertTriangle className="w-5 h-5 text-amber-500 flex-shrink-0 mt-0.5" />
              <div>
                <p className="text-sm font-medium text-amber-800 dark:text-amber-200" data-testid="text-uncompleted-warning">
                  Есть незавершённые визиты
                </p>
                <p className="text-xs text-amber-600 dark:text-amber-400 mt-0.5">
                  Отзывы и чаевые недоступны до завершения визита
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
        <Card>
          <CardHeader className="flex flex-row items-center justify-between gap-2">
            <div className="flex items-center gap-2">
              <Calendar className="w-5 h-5" />
              <CardTitle>Предстоящие записи</CardTitle>
            </div>
            {upcomingBookings.length > 0 && (
              <Badge variant="secondary" data-testid="badge-upcoming-count">
                {upcomingBookings.length}
              </Badge>
            )}
          </CardHeader>
          <CardContent>
            {loadingBookings ? (
              <div className="space-y-2">
                <Skeleton className="h-16 w-full" />
                <Skeleton className="h-16 w-full" />
              </div>
            ) : upcomingBookings.length === 0 ? (
              <p className="text-muted-foreground text-sm">Нет предстоящих записей</p>
            ) : (
              <div className="space-y-3 max-h-[420px] overflow-y-auto pr-1">
                {upcomingBookings.map((booking) => {
                  const appointmentTime = new Date(booking.appointmentTime).getTime();
                  const hoursSince = (Date.now() - appointmentTime) / (1000 * 60 * 60);
                  const isStale = hoursSince >= STALE_HOURS;

                  return (
                    <div 
                      key={booking.id} 
                      className="p-3 rounded-md bg-muted/50 space-y-2"
                      data-testid={`booking-item-${booking.id}`}
                    >
                      <div className="flex items-center justify-between gap-2">
                        <div className="flex items-center gap-2">
                          <User className="w-4 h-4 text-muted-foreground" />
                          <span data-testid={`text-customer-${booking.id}`}>{booking.customerName}</span>
                        </div>
                        <div className="flex items-center gap-1.5">
                          {(booking as any).altegioSyncStatus === 'synced' && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <CircleCheck className="w-3.5 h-3.5 text-green-500" data-testid={`icon-sync-ok-${booking.id}`} />
                              </TooltipTrigger>
                              <TooltipContent>Синхронизировано с Altegio</TooltipContent>
                            </Tooltip>
                          )}
                          {(booking as any).altegioSyncStatus === 'error' && (
                            <Tooltip>
                              <TooltipTrigger asChild>
                                <AlertTriangle className="w-3.5 h-3.5 text-amber-500" data-testid={`icon-sync-error-${booking.id}`} />
                              </TooltipTrigger>
                              <TooltipContent>Не удалось синхронизировать</TooltipContent>
                            </Tooltip>
                          )}
                          {(booking as any).altegioSyncStatus === 'pending' && (
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
                      {!suppressIndividualBanners && (
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
                      {isStale && (
                        <div className="flex items-center gap-1.5 text-xs text-amber-600 dark:text-amber-400" data-testid={`text-stale-hint-${booking.id}`}>
                          <Clock className="w-3 h-3" />
                          <span>Клиент был сегодня. Завершите визит</span>
                        </div>
                      )}
                      {booking.status !== 'completed' ? (
                        <Button
                          size="sm"
                          className="w-full"
                          onClick={() => completeVisitMutation.mutate(booking.id)}
                          disabled={completingBookingId === booking.id}
                          data-testid={`button-complete-visit-${booking.id}`}
                        >
                          <CheckCircle2 className="w-4 h-4 mr-2" />
                          {completingBookingId === booking.id ? 'Завершение...' : 'Завершить визит'}
                        </Button>
                      ) : (booking as any).paymentStatus !== 'paid' ? (
                        <Button
                          size="sm"
                          className="w-full"
                          onClick={() => confirmPaymentMutation.mutate(booking.id)}
                          disabled={confirmingPaymentId === booking.id}
                          data-testid={`button-confirm-payment-${booking.id}`}
                        >
                          <Banknote className="w-4 h-4 mr-2" />
                          {confirmingPaymentId === booking.id ? 'Подтверждение...' : 'Оплата получена → запросить отзыв'}
                        </Button>
                      ) : (
                        <Badge variant="secondary" className="text-green-600 dark:text-green-400" data-testid={`badge-paid-${booking.id}`}>
                          Оплачено
                        </Badge>
                      )}
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
                      {(booking as any).altegioSyncStatus === 'synced' && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <CircleCheck className="w-3.5 h-3.5 text-green-500" />
                          </TooltipTrigger>
                          <TooltipContent>Синхронизировано с Altegio</TooltipContent>
                        </Tooltip>
                      )}
                      {(booking as any).altegioSyncStatus === 'error' && (
                        <Tooltip>
                          <TooltipTrigger asChild>
                            <AlertTriangle className="w-3.5 h-3.5 text-amber-500" />
                          </TooltipTrigger>
                          <TooltipContent>Не удалось синхронизировать</TooltipContent>
                        </Tooltip>
                      )}
                      {(booking as any).altegioSyncStatus === 'pending' && (
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
                  {(booking as any).paymentStatus !== 'paid' && (
                    <Button
                      size="sm"
                      className="w-full"
                      onClick={() => confirmPaymentMutation.mutate(booking.id)}
                      disabled={confirmingPaymentId === booking.id}
                      data-testid={`button-confirm-payment-completed-${booking.id}`}
                    >
                      <Banknote className="w-4 h-4 mr-2" />
                      {confirmingPaymentId === booking.id ? 'Подтверждение...' : 'Оплата получена → запросить отзыв'}
                    </Button>
                  )}
                  {!suppressIndividualBanners && (
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
    </div>
  );
}
