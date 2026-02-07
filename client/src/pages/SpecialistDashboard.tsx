import { useAuth } from '@/contexts/AuthContext';
import { useQuery, useMutation } from '@tanstack/react-query';
import { Card, CardContent, CardHeader, CardTitle } from '@/components/ui/card';
import { Badge } from '@/components/ui/badge';
import { Button } from '@/components/ui/button';
import { Skeleton } from '@/components/ui/skeleton';
import { Star, Calendar, MessageSquare, User, Camera, Image, Trash2, Upload, Banknote, UserPlus, Copy } from 'lucide-react';
import { Switch } from '@/components/ui/switch';
import { Input } from '@/components/ui/input';
import { format } from 'date-fns';
import { useRef, useState, useEffect } from 'react';
import { queryClient } from '@/lib/queryClient';
import { useToast } from '@/hooks/use-toast';
import { Textarea } from '@/components/ui/textarea';
import { Label } from '@/components/ui/label';
import type { Specialist, Booking, Review, SpecialistPhoto } from '@shared/schema';

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

  const upcomingBookings = bookings?.filter(b => 
    b.status !== 'completed' && b.status !== 'cancelled'
  ) || [];

  const completedBookings = bookings?.filter(b => b.status === 'completed') || [];

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

      <div className="grid gap-6 md:grid-cols-2">
        <Card>
          <CardHeader className="flex flex-row items-center gap-2">
            <Calendar className="w-5 h-5" />
            <CardTitle>Предстоящие записи</CardTitle>
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
              <div className="space-y-3">
                {upcomingBookings.map((booking) => (
                  <div 
                    key={booking.id} 
                    className="p-3 rounded-md bg-muted/50 flex items-center justify-between gap-2"
                    data-testid={`booking-item-${booking.id}`}
                  >
                    <div className="flex items-center gap-2">
                      <User className="w-4 h-4 text-muted-foreground" />
                      <span data-testid={`text-customer-${booking.id}`}>{booking.customerName}</span>
                    </div>
                    <Badge variant="outline" data-testid={`badge-time-${booking.id}`}>
                      {format(new Date(booking.appointmentTime), 'MMM d, h:mm a')}
                    </Badge>
                  </div>
                ))}
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
        <CardHeader>
          <CardTitle>Завершённые визиты</CardTitle>
        </CardHeader>
        <CardContent>
          {loadingBookings ? (
            <Skeleton className="h-16 w-full" />
          ) : completedBookings.length === 0 ? (
            <p className="text-muted-foreground text-sm">Пока нет завершённых визитов</p>
          ) : (
            <div className="space-y-2">
              {completedBookings.slice(0, 10).map((booking) => (
                <div 
                  key={booking.id}
                  className="p-3 rounded-md bg-muted/50 flex items-center justify-between gap-2"
                  data-testid={`completed-booking-${booking.id}`}
                >
                  <div className="flex items-center gap-2">
                    <User className="w-4 h-4 text-muted-foreground" />
                    <span>{booking.customerName}</span>
                  </div>
                  <div className="flex items-center gap-2">
                    <Badge variant="secondary">
                      {format(new Date(booking.appointmentTime), 'MMM d')}
                    </Badge>
                    {booking.hasReview && (
                      <Badge variant="outline" className="text-green-600">
                        Есть отзыв
                      </Badge>
                    )}
                  </div>
                </div>
              ))}
            </div>
          )}
        </CardContent>
      </Card>
    </div>
  );
}
