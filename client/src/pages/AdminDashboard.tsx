import { useState } from "react";
import { useQuery, useMutation } from "@tanstack/react-query";
import { queryClient } from "@/lib/queryClient";
import { Button } from "@/components/ui/button";
import { Card, CardContent, CardHeader, CardTitle } from "@/components/ui/card";
import { Input } from "@/components/ui/input";
import { Label } from "@/components/ui/label";
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from "@/components/ui/select";
import { Tabs, TabsList, TabsTrigger } from "@/components/ui/tabs";
import { useToast } from "@/hooks/use-toast";
import { useAuth } from "@/contexts/AuthContext";
import { Calendar, Users, CheckCircle, Clock, Plus, ShieldCheck, MessageCircle, Copy, Check, UserCheck, UserX, Edit2, Trash2 } from "lucide-react";
import { Badge } from "@/components/ui/badge";
import { Dialog, DialogContent, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Sheet, SheetContent, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import type { Specialist, User } from "@shared/schema";
import { categoryLabels } from "@shared/schema";

type BookingWithDetails = {
  id: number;
  specialistId: number;
  customerName: string;
  customerPhone: string;
  appointmentTime: string;
  status: string;
  hasReview: boolean;
  specialistName: string;
  createdAt: string;
  magicLinkSent: boolean;
  magicLinkSentAt: string | null;
  followupSent: boolean;
  canSendFollowup: boolean;
  isExpired: boolean;
};

export default function AdminDashboard() {
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  const [whatsappDialog, setWhatsappDialog] = useState<{ open: boolean; bookingId: number | null; whatsappText: string; magicLink: string; isFollowup: boolean }>({
    open: false,
    bookingId: null,
    whatsappText: "",
    magicLink: "",
    isFollowup: false,
  });
  const [copied, setCopied] = useState(false);
  
  const [formData, setFormData] = useState({
    specialistId: "",
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    appointmentTime: "",
  });

  const [activeTab, setActiveTab] = useState<"bookings" | "specialists" | "claims">("bookings");
  const [specialistFormOpen, setSpecialistFormOpen] = useState(false);
  const [editingSpecialist, setEditingSpecialist] = useState<Specialist | null>(null);
  const [specialistForm, setSpecialistForm] = useState({
    name: "",
    category: "barber",
    subcategory: "",
    city: "Алматы",
    serviceLocation: "",
    phone: "",
    status: "active",
  });

  const { data: specialists = [], refetch: refetchSpecialists } = useQuery<Specialist[]>({
    queryKey: ["/api/admin/specialists"],
    queryFn: async () => {
      const res = await fetch("/api/admin/specialists", {
        headers: { "x-user-id": currentUser?.id || "" },
      });
      if (!res.ok) throw new Error("Failed to fetch specialists");
      return res.json();
    },
    enabled: !!currentUser,
  });

  const { data: bookings = [], isLoading: bookingsLoading } = useQuery<BookingWithDetails[]>({
    queryKey: ["/api/admin/bookings"],
    queryFn: async () => {
      const res = await fetch("/api/admin/bookings", {
        headers: { "x-user-id": currentUser?.id || "" },
      });
      if (!res.ok) throw new Error("Failed to fetch bookings");
      return res.json();
    },
    enabled: !!currentUser,
  });

  const createBookingMutation = useMutation({
    mutationFn: async (data: typeof formData) => {
      const res = await fetch("/api/admin/bookings", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": currentUser?.id || "",
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Запись создана" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bookings"] });
      setFormData({
        specialistId: "",
        customerName: "",
        customerPhone: "",
        customerEmail: "",
        appointmentTime: "",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const completeBookingMutation = useMutation({
    mutationFn: async (bookingId: number) => {
      const res = await fetch(`/api/admin/bookings/${bookingId}/complete`, {
        method: "PATCH",
        headers: { "x-user-id": currentUser?.id || "" },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Визит завершён" });
      queryClient.invalidateQueries({ queryKey: ["/api/admin/bookings"] });
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const createMagicLinkMutation = useMutation({
    mutationFn: async (bookingId: number) => {
      const res = await fetch(`/api/admin/bookings/${bookingId}/create-magic-link`, {
        method: "POST",
        headers: { "x-user-id": currentUser?.id || "" },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: (data, bookingId) => {
      setWhatsappDialog({
        open: true,
        bookingId,
        whatsappText: data.whatsappText,
        magicLink: data.magicLink,
        isFollowup: false,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const createFollowupMutation = useMutation({
    mutationFn: async (bookingId: number) => {
      const res = await fetch(`/api/admin/bookings/${bookingId}/create-followup-magic-link`, {
        method: "POST",
        headers: { "x-user-id": currentUser?.id || "" },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: (data, bookingId) => {
      setWhatsappDialog({
        open: true,
        bookingId,
        whatsappText: data.whatsappText,
        magicLink: data.magicLink,
        isFollowup: true,
      });
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const createSpecialistMutation = useMutation({
    mutationFn: async (data: typeof specialistForm) => {
      const res = await fetch("/api/admin/specialists", {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": currentUser?.id || "",
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Специалист создан" });
      refetchSpecialists();
      setSpecialistFormOpen(false);
      setSpecialistForm({
        name: "", category: "barber", subcategory: "", city: "Алматы",
        serviceLocation: "", phone: "", status: "active",
      });
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const updateSpecialistMutation = useMutation({
    mutationFn: async ({ id, data }: { id: number; data: Partial<Specialist> }) => {
      const res = await fetch(`/api/admin/specialists/${id}`, {
        method: "PATCH",
        headers: {
          "Content-Type": "application/json",
          "x-user-id": currentUser?.id || "",
        },
        body: JSON.stringify(data),
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Специалист обновлён" });
      refetchSpecialists();
      setEditingSpecialist(null);
      setSpecialistFormOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const deleteSpecialistMutation = useMutation({
    mutationFn: async (id: number) => {
      const res = await fetch(`/api/admin/specialists/${id}`, {
        method: "DELETE",
        headers: {
          "x-user-id": currentUser?.id || "",
        },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Специалист удалён" });
      refetchSpecialists();
      setEditingSpecialist(null);
      setSpecialistFormOpen(false);
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const handleCopyWhatsapp = async () => {
    await navigator.clipboard.writeText(whatsappDialog.whatsappText);
    setCopied(true);
    toast({ title: "Скопировано!" });
    setTimeout(() => setCopied(false), 2000);
  };

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createBookingMutation.mutate(formData);
  };

  type ClaimRequestWithName = {
    id: number;
    specialistId: number;
    phone: string;
    status: string;
    claimToken: string | null;
    tokenExpiresAt: string | null;
    tokenUsedAt: string | null;
    createdAt: string;
    resolvedAt: string | null;
    specialistName: string;
  };

  const [claimCopied, setClaimCopied] = useState<number | null>(null);

  const { data: claimRequests = [], refetch: refetchClaims } = useQuery<ClaimRequestWithName[]>({
    queryKey: ["/api/admin/claim-requests"],
    queryFn: async () => {
      const res = await fetch("/api/admin/claim-requests", {
        headers: { "x-user-id": currentUser?.id || "" },
      });
      if (!res.ok) throw new Error("Failed to fetch claims");
      return res.json();
    },
    enabled: !!currentUser && activeTab === "claims",
  });

  const approveClaimMutation = useMutation({
    mutationFn: async (claimId: number) => {
      const res = await fetch(`/api/admin/claim-requests/${claimId}/approve`, {
        method: "POST",
        headers: { "x-user-id": currentUser?.id || "" },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: (data) => {
      toast({ title: "Запрос одобрен" });
      refetchClaims();
      if (data.claimLink) {
        navigator.clipboard.writeText(data.claimLink);
        toast({ title: "Ссылка скопирована", description: "Отправьте её заявителю" });
      }
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const rejectClaimMutation = useMutation({
    mutationFn: async (claimId: number) => {
      const res = await fetch(`/api/admin/claim-requests/${claimId}/reject`, {
        method: "POST",
        headers: { "x-user-id": currentUser?.id || "" },
      });
      if (!res.ok) {
        const err = await res.json();
        throw new Error(err.message);
      }
      return res.json();
    },
    onSuccess: () => {
      toast({ title: "Запрос отклонён" });
      refetchClaims();
    },
    onError: (err: Error) => {
      toast({ title: "Ошибка", description: err.message, variant: "destructive" });
    },
  });

  const pendingClaimsCount = claimRequests.filter(c => c.status === "pending").length;

  const filteredBookings = bookings.filter((booking) => {
    if (statusFilter === "all") return true;
    return booking.status === statusFilter;
  });

  const pendingCount = bookings.filter((b) => b.status === "pending").length;
  const completedCount = bookings.filter((b) => b.status === "completed").length;

  return (
    <div className="min-h-screen bg-background p-4 pb-24">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center justify-between">
          <div className="flex items-center gap-3">
            <ShieldCheck className="h-8 w-8 text-primary" />
            <h1 className="text-2xl font-bold" data-testid="text-admin-title">Панель администратора</h1>
          </div>
        </div>

        <Tabs value={activeTab} onValueChange={(v) => setActiveTab(v as "bookings" | "specialists" | "claims")}>
          <TabsList className="grid w-full grid-cols-3 mb-4">
            <TabsTrigger value="bookings" data-testid="tab-bookings-main">
              <Calendar className="h-4 w-4 mr-2" />
              Записи
            </TabsTrigger>
            <TabsTrigger value="specialists" data-testid="tab-specialists-main">
              <Users className="h-4 w-4 mr-2" />
              Специалисты
            </TabsTrigger>
            <TabsTrigger value="claims" data-testid="tab-claims-main" className="relative">
              <UserCheck className="h-4 w-4 mr-2" />
              Заявки
              {pendingClaimsCount > 0 && (
                <span className="absolute -top-1 -right-1 bg-red-500 text-white text-[10px] font-bold rounded-full w-4 h-4 flex items-center justify-center">
                  {pendingClaimsCount}
                </span>
              )}
            </TabsTrigger>
          </TabsList>
        </Tabs>

        {activeTab === "bookings" && (
          <>
        <div className="grid grid-cols-3 gap-4">
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Calendar className="h-8 w-8 text-muted-foreground" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-total-bookings">{bookings.length}</p>
                <p className="text-xs text-muted-foreground">Всего записей</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <Clock className="h-8 w-8 text-yellow-500" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-pending-count">{pendingCount}</p>
                <p className="text-xs text-muted-foreground">Ожидают</p>
              </div>
            </CardContent>
          </Card>
          <Card>
            <CardContent className="p-4 flex items-center gap-3">
              <CheckCircle className="h-8 w-8 text-green-500" />
              <div>
                <p className="text-2xl font-bold" data-testid="text-completed-count">{completedCount}</p>
                <p className="text-xs text-muted-foreground">Завершено</p>
              </div>
            </CardContent>
          </Card>
        </div>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Plus size={20} />
              Создать запись
            </CardTitle>
          </CardHeader>
          <CardContent>
            <form onSubmit={handleSubmit} className="space-y-4">
              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="customerName">Имя клиента</Label>
                  <Input
                    id="customerName"
                    placeholder="Введите имя"
                    value={formData.customerName}
                    onChange={(e) => setFormData({ ...formData, customerName: e.target.value })}
                    required
                    data-testid="input-customer-name"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="customerEmail">Email клиента</Label>
                  <Input
                    id="customerEmail"
                    type="text"
                    inputMode="email"
                    autoComplete="off"
                    autoCorrect="off"
                    autoCapitalize="off"
                    spellCheck={false}
                    placeholder="client@example.com"
                    value={formData.customerEmail}
                    onChange={(e) => setFormData({ ...formData, customerEmail: e.target.value })}
                    required
                    data-testid="input-customer-email"
                  />
                </div>
              </div>

              <div className="grid grid-cols-2 gap-4">
                <div className="space-y-2">
                  <Label htmlFor="customerPhone">Телефон</Label>
                  <Input
                    id="customerPhone"
                    placeholder="Введите номер"
                    value={formData.customerPhone}
                    onChange={(e) => setFormData({ ...formData, customerPhone: e.target.value })}
                    required
                    data-testid="input-customer-phone"
                  />
                </div>
                <div className="space-y-2">
                  <Label htmlFor="specialist">Барбер</Label>
                  <Select
                    value={formData.specialistId}
                    onValueChange={(value) => setFormData({ ...formData, specialistId: value })}
                  >
                    <SelectTrigger data-testid="select-specialist">
                      <SelectValue placeholder="Выберите барбера" />
                    </SelectTrigger>
                    <SelectContent>
                      {specialists.map((s) => (
                        <SelectItem key={s.id} value={String(s.id)} data-testid={`select-specialist-${s.id}`}>
                          {s.name}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                </div>
              </div>

              <div className="space-y-2">
                <Label htmlFor="appointmentTime">Дата и время</Label>
                <Input
                  id="appointmentTime"
                  type="datetime-local"
                  value={formData.appointmentTime}
                  onChange={(e) => setFormData({ ...formData, appointmentTime: e.target.value })}
                  required
                  data-testid="input-appointment-time"
                />
              </div>

              <Button 
                type="submit" 
                className="w-full" 
                disabled={createBookingMutation.isPending}
                data-testid="button-create-booking"
              >
                {createBookingMutation.isPending ? "Создание..." : "Создать запись"}
              </Button>
            </form>
          </CardContent>
        </Card>

        <Card>
          <CardHeader>
            <CardTitle className="flex items-center gap-2">
              <Users size={20} />
              Все записи
            </CardTitle>
          </CardHeader>
          <CardContent>
            <Tabs value={statusFilter} onValueChange={setStatusFilter}>
              <TabsList className="grid w-full grid-cols-3 mb-4">
                <TabsTrigger value="all" data-testid="tab-all">
                  Все ({bookings.length})
                </TabsTrigger>
                <TabsTrigger value="pending" data-testid="tab-pending">
                  Ожидают ({pendingCount})
                </TabsTrigger>
                <TabsTrigger value="completed" data-testid="tab-completed">
                  Завершены ({completedCount})
                </TabsTrigger>
              </TabsList>

              <div className="space-y-3">
                {bookingsLoading ? (
                  <div className="text-center py-8 text-muted-foreground">Загрузка...</div>
                ) : filteredBookings.length === 0 ? (
                  <div className="text-center py-8 text-muted-foreground">
                    Записи не найдены
                  </div>
                ) : (
                  filteredBookings.map((booking) => (
                    <div
                      key={booking.id}
                      className="flex items-center justify-between p-4 bg-muted/30 rounded-lg border"
                      data-testid={`booking-row-${booking.id}`}
                    >
                      <div className="flex-1">
                        <div className="flex items-center gap-2">
                          <span className="font-medium" data-testid={`text-booking-customer-${booking.id}`}>
                            {booking.customerName}
                          </span>
                          <span className={`px-2 py-0.5 text-[10px] rounded-full font-bold ${
                            booking.status === "completed" 
                              ? "bg-green-500/10 text-green-500" 
                              : "bg-yellow-500/10 text-yellow-500"
                          }`}>
                            {booking.status}
                          </span>
                          {booking.hasReview && (
                            <span className="px-2 py-0.5 text-[10px] rounded-full font-bold bg-blue-500/10 text-blue-500">
                              Есть отзыв
                            </span>
                          )}
                        </div>
                        <div className="text-sm text-muted-foreground mt-1">
                          <span data-testid={`text-booking-specialist-${booking.id}`}>
                            {booking.specialistName}
                          </span>
                          <span className="mx-2">•</span>
                          <span data-testid={`text-booking-time-${booking.id}`}>
                            {new Date(booking.appointmentTime).toLocaleString()}
                          </span>
                        </div>
                        <div className="text-xs text-muted-foreground mt-1">
                          ID: {booking.id} • Тел: {booking.customerPhone}
                        </div>
                      </div>
                      <div className="flex gap-2">
                        {booking.status === "pending" && (
                          <Button
                            size="sm"
                            onClick={() => completeBookingMutation.mutate(booking.id)}
                            disabled={completeBookingMutation.isPending}
                            data-testid={`button-complete-${booking.id}`}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Завершить
                          </Button>
                        )}
                        {booking.status === "completed" && !booking.hasReview && (
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              if (!booking.magicLinkSent) {
                                createMagicLinkMutation.mutate(booking.id);
                              } else if (booking.canSendFollowup) {
                                createFollowupMutation.mutate(booking.id);
                              } else if (booking.isExpired) {
                                toast({ 
                                  title: "Время для отзыва истекло (48ч)",
                                  variant: "destructive" 
                                });
                              } else {
                                toast({ 
                                  title: booking.followupSent 
                                    ? "Повторное сообщение уже отправлено" 
                                    : "Подождите 20 часов для повторной отправки",
                                  variant: "destructive" 
                                });
                              }
                            }}
                            disabled={createMagicLinkMutation.isPending || createFollowupMutation.isPending || (booking.magicLinkSent && !booking.canSendFollowup)}
                            data-testid={`button-whatsapp-${booking.id}`}
                            title={
                              booking.isExpired 
                                ? "Время истекло (48ч)" 
                                : booking.magicLinkSent && !booking.canSendFollowup 
                                  ? (booking.followupSent ? "Повторное уже отправлено" : "Повторная отправка через 20ч") 
                                  : undefined
                            }
                          >
                            <MessageCircle className="h-4 w-4 mr-1" />
                            WhatsApp
                            {booking.canSendFollowup && (
                              <Badge variant="secondary" className="ml-1 h-5 w-5 p-0 flex items-center justify-center text-xs">
                                2
                              </Badge>
                            )}
                          </Button>
                        )}
                      </div>
                    </div>
                  ))
                )}
              </div>
            </Tabs>
          </CardContent>
        </Card>
          </>
        )}

        {activeTab === "specialists" && (
          <Card>
            <CardHeader className="flex flex-row items-center justify-between">
              <CardTitle className="flex items-center gap-2">
                <Users size={20} />
                Все специалисты
              </CardTitle>
              <Button
                size="sm"
                onClick={() => {
                  setEditingSpecialist(null);
                  setSpecialistForm({
                    name: "", category: "barber", subcategory: "", city: "Алматы",
                    serviceLocation: "", phone: "", status: "active",
                  });
                  setSpecialistFormOpen(true);
                }}
                data-testid="button-add-specialist"
              >
                <Plus className="h-4 w-4 mr-2" />
                Добавить
              </Button>
            </CardHeader>
            <CardContent>
              <div className="space-y-3">
                {specialists.filter(s => s.status === 'pending').length > 0 && (
                  <div className="mb-4">
                    <h3 className="text-sm font-medium text-muted-foreground mb-2">
                      Ожидают активации ({specialists.filter(s => s.status === 'pending').length})
                    </h3>
                    {specialists.filter(s => s.status === 'pending').map((s) => (
                      <div key={s.id} className="flex items-center justify-between p-3 border rounded-lg mb-2 bg-yellow-50 dark:bg-yellow-900/20">
                        <div className="flex items-center gap-3">
                          <UserX className="h-5 w-5 text-yellow-500" />
                          <div>
                            <p className="font-medium">{s.name}</p>
                            <p className="text-xs text-muted-foreground">
                              {categoryLabels[s.category as keyof typeof categoryLabels] || s.category} • {s.city}
                              {s.phone && ` • ${s.phone}`}
                            </p>
                          </div>
                        </div>
                        <div className="flex gap-2">
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => {
                              setEditingSpecialist(s);
                              setSpecialistForm({
                                name: s.name,
                                category: s.category,
                                subcategory: s.subcategory || "",
                                city: s.city || "Алматы",
                                serviceLocation: s.serviceLocation || "",
                                phone: s.phone || "",
                                status: s.status || "pending",
                              });
                              setSpecialistFormOpen(true);
                            }}
                            data-testid={`button-edit-specialist-${s.id}`}
                          >
                            <Edit2 className="h-4 w-4" />
                          </Button>
                          <Button
                            size="sm"
                            onClick={() => {
                              updateSpecialistMutation.mutate({
                                id: s.id,
                                data: { status: 'active', isActive: true }
                              });
                            }}
                            data-testid={`button-activate-specialist-${s.id}`}
                          >
                            <UserCheck className="h-4 w-4 mr-1" />
                            Активировать
                          </Button>
                        </div>
                      </div>
                    ))}
                  </div>
                )}

                <h3 className="text-sm font-medium text-muted-foreground mb-2">
                  Активные ({specialists.filter(s => s.status === 'active').length})
                </h3>
                {specialists.filter(s => s.status === 'active').map((s) => (
                  <div key={s.id} className="flex items-center justify-between p-3 border rounded-lg">
                    <div className="flex items-center gap-3">
                      <UserCheck className="h-5 w-5 text-green-500" />
                      <div>
                        <p className="font-medium">{s.name}</p>
                        <p className="text-xs text-muted-foreground">
                          {categoryLabels[s.category as keyof typeof categoryLabels] || s.category} • {s.city}
                          {s.phone && ` • ${s.phone}`}
                        </p>
                      </div>
                    </div>
                    <div className="flex gap-2">
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          setEditingSpecialist(s);
                          setSpecialistForm({
                            name: s.name,
                            category: s.category,
                            subcategory: s.subcategory || "",
                            city: s.city || "Алматы",
                            serviceLocation: s.serviceLocation || "",
                            phone: s.phone || "",
                            status: s.status || "active",
                          });
                          setSpecialistFormOpen(true);
                        }}
                        data-testid={`button-edit-specialist-${s.id}`}
                      >
                        <Edit2 className="h-4 w-4" />
                      </Button>
                      <Button
                        size="sm"
                        variant="outline"
                        onClick={() => {
                          updateSpecialistMutation.mutate({
                            id: s.id,
                            data: { status: 'pending', isActive: false }
                          });
                        }}
                        data-testid={`button-deactivate-specialist-${s.id}`}
                      >
                        <UserX className="h-4 w-4" />
                      </Button>
                    </div>
                  </div>
                ))}
              </div>
            </CardContent>
          </Card>
        )}

        {activeTab === "claims" && (
          <Card>
            <CardHeader>
              <CardTitle className="flex items-center gap-2">
                <UserCheck size={20} />
                Заявки на профили
              </CardTitle>
            </CardHeader>
            <CardContent>
              {claimRequests.length === 0 ? (
                <p className="text-sm text-muted-foreground text-center py-8" data-testid="text-no-claims">
                  Заявок пока нет
                </p>
              ) : (
                <div className="space-y-3">
                  {claimRequests.map((claim) => (
                    <div
                      key={claim.id}
                      className="p-4 border rounded-lg space-y-2"
                      data-testid={`claim-card-${claim.id}`}
                    >
                      <div className="flex items-center justify-between gap-2 flex-wrap">
                        <div>
                          <p className="font-medium text-sm">{claim.specialistName}</p>
                          <p className="text-xs text-muted-foreground">{claim.phone}</p>
                        </div>
                        <Badge
                          variant={
                            claim.status === "pending" ? "secondary" :
                            claim.status === "approved" ? "default" : "destructive"
                          }
                          data-testid={`badge-claim-status-${claim.id}`}
                        >
                          {claim.status === "pending" ? "Ожидает" :
                           claim.status === "approved" ? "Одобрено" : "Отклонено"}
                        </Badge>
                      </div>
                      <p className="text-xs text-muted-foreground">
                        {new Date(claim.createdAt).toLocaleString("ru-RU")}
                      </p>

                      {claim.status === "pending" && (
                        <div className="flex gap-2 pt-1">
                          <Button
                            size="sm"
                            onClick={() => approveClaimMutation.mutate(claim.id)}
                            disabled={approveClaimMutation.isPending}
                            data-testid={`button-approve-claim-${claim.id}`}
                          >
                            <CheckCircle className="h-4 w-4 mr-1" />
                            Одобрить
                          </Button>
                          <Button
                            size="sm"
                            variant="outline"
                            onClick={() => rejectClaimMutation.mutate(claim.id)}
                            disabled={rejectClaimMutation.isPending}
                            data-testid={`button-reject-claim-${claim.id}`}
                          >
                            <UserX className="h-4 w-4 mr-1" />
                            Отклонить
                          </Button>
                        </div>
                      )}

                      {claim.status === "approved" && claim.claimToken && (
                        <div className="pt-1">
                          <div className="flex items-center gap-2">
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const baseUrl = window.location.origin;
                                const link = `${baseUrl}/claim/${claim.claimToken}`;
                                navigator.clipboard.writeText(link);
                                setClaimCopied(claim.id);
                                setTimeout(() => setClaimCopied(null), 2000);
                              }}
                              data-testid={`button-copy-claim-link-${claim.id}`}
                            >
                              {claimCopied === claim.id ? (
                                <><Check className="h-4 w-4 mr-1" /> Скопировано</>
                              ) : (
                                <><Copy className="h-4 w-4 mr-1" /> Копировать ссылку</>
                              )}
                            </Button>
                            <Button
                              size="sm"
                              variant="outline"
                              onClick={() => {
                                const baseUrl = window.location.origin;
                                const link = `${baseUrl}/claim/${claim.claimToken}`;
                                const text = `Здравствуйте! Ваш запрос на профиль «${claim.specialistName}» на WHO одобрен. Перейдите по ссылке для привязки: ${link}`;
                                window.open(`https://wa.me/${claim.phone.replace(/\D/g, '')}?text=${encodeURIComponent(text)}`, "_blank");
                              }}
                              data-testid={`button-whatsapp-claim-${claim.id}`}
                            >
                              <MessageCircle className="h-4 w-4 mr-1" />
                              WhatsApp
                            </Button>
                          </div>
                          {claim.tokenUsedAt && (
                            <p className="text-xs text-green-600 mt-1">
                              Привязано {new Date(claim.tokenUsedAt).toLocaleString("ru-RU")}
                            </p>
                          )}
                          {!claim.tokenUsedAt && claim.tokenExpiresAt && (
                            <p className="text-xs text-muted-foreground mt-1">
                              Срок: до {new Date(claim.tokenExpiresAt).toLocaleDateString("ru-RU")}
                            </p>
                          )}
                        </div>
                      )}
                    </div>
                  ))}
                </div>
              )}
            </CardContent>
          </Card>
        )}
      </div>

      <Sheet open={specialistFormOpen} onOpenChange={setSpecialistFormOpen}>
        <SheetContent side="bottom" className="max-h-[85vh] overflow-y-auto rounded-t-xl">
          <SheetHeader>
            <SheetTitle>
              {editingSpecialist ? "Редактировать специалиста" : "Добавить специалиста"}
            </SheetTitle>
          </SheetHeader>
          <form
            onSubmit={(e) => {
              e.preventDefault();
              if (editingSpecialist) {
                updateSpecialistMutation.mutate({
                  id: editingSpecialist.id,
                  data: {
                    name: specialistForm.name,
                    category: specialistForm.category as "barber" | "manicure" | "cosmetology" | "doctor" | "trainer" | "auto_service",
                    subcategory: specialistForm.subcategory || null,
                    city: specialistForm.city,
                    serviceLocation: specialistForm.serviceLocation || null,
                    phone: specialistForm.phone || null,
                    status: specialistForm.status as "pending" | "active",
                    isActive: specialistForm.status === "active",
                  },
                });
              } else {
                createSpecialistMutation.mutate(specialistForm);
              }
            }}
            className="space-y-4"
          >
            <div className="space-y-2">
              <Label>Имя</Label>
              <Input
                value={specialistForm.name}
                onChange={(e) => setSpecialistForm({ ...specialistForm, name: e.target.value })}
                required
                data-testid="input-specialist-name"
              />
            </div>
            <div className="grid grid-cols-1 sm:grid-cols-2 gap-4">
              <div className="space-y-2">
                <Label>Категория</Label>
                <Select
                  value={specialistForm.category}
                  onValueChange={(v) => setSpecialistForm({ ...specialistForm, category: v })}
                >
                  <SelectTrigger data-testid="select-specialist-category">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {Object.entries(categoryLabels).map(([value, label]) => (
                      <SelectItem key={value} value={value}>{label}</SelectItem>
                    ))}
                  </SelectContent>
                </Select>
              </div>
              <div className="space-y-2">
                <Label>Город</Label>
                <Select
                  value={specialistForm.city}
                  onValueChange={(v) => setSpecialistForm({ ...specialistForm, city: v })}
                >
                  <SelectTrigger data-testid="select-specialist-city">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    <SelectItem value="Алматы">Алматы</SelectItem>
                    <SelectItem value="Астана">Астана</SelectItem>
                  </SelectContent>
                </Select>
              </div>
            </div>
            <div className="space-y-2">
              <Label>Телефон</Label>
              <Input
                value={specialistForm.phone}
                onChange={(e) => setSpecialistForm({ ...specialistForm, phone: e.target.value })}
                placeholder="+7 777 123 4567"
                data-testid="input-specialist-phone"
              />
            </div>
            <div className="space-y-2">
              <Label>Статус</Label>
              <Select
                value={specialistForm.status}
                onValueChange={(v) => setSpecialistForm({ ...specialistForm, status: v })}
              >
                <SelectTrigger data-testid="select-specialist-status">
                  <SelectValue />
                </SelectTrigger>
                <SelectContent>
                  <SelectItem value="active">Активен</SelectItem>
                  <SelectItem value="pending">Ожидает</SelectItem>
                </SelectContent>
              </Select>
            </div>
            <Button
              type="submit"
              className="w-full"
              disabled={createSpecialistMutation.isPending || updateSpecialistMutation.isPending}
              data-testid="button-save-specialist"
            >
              {(createSpecialistMutation.isPending || updateSpecialistMutation.isPending)
                ? "Сохранение..."
                : editingSpecialist ? "Сохранить" : "Создать"}
            </Button>
            {editingSpecialist && (
              <Button
                type="button"
                variant="destructive"
                className="w-full mt-2"
                disabled={deleteSpecialistMutation.isPending}
                onClick={() => {
                  if (confirm("Удалить специалиста? Это действие нельзя отменить.")) {
                    deleteSpecialistMutation.mutate(editingSpecialist.id);
                  }
                }}
                data-testid="button-delete-specialist"
              >
                <Trash2 className="h-4 w-4 mr-2" />
                {deleteSpecialistMutation.isPending ? "Удаление..." : "Удалить специалиста"}
              </Button>
            )}
          </form>
        </SheetContent>
      </Sheet>

      <Dialog open={whatsappDialog.open} onOpenChange={(open) => setWhatsappDialog(prev => ({ ...prev, open }))}>
        <DialogContent className="max-w-md">
          <DialogHeader>
            <DialogTitle className="flex items-center gap-2">
              <MessageCircle className="h-5 w-5 text-green-500" />
              Отправить в WhatsApp
              {whatsappDialog.isFollowup && (
                <Badge variant="secondary" className="ml-2">
                  2
                </Badge>
              )}
            </DialogTitle>
          </DialogHeader>
          <div className="space-y-4">
            <div className="bg-muted p-4 rounded-lg whitespace-pre-wrap text-sm">
              {whatsappDialog.whatsappText}
            </div>
            <div className="flex gap-2">
              <Button
                variant="outline"
                className="flex-1"
                onClick={handleCopyWhatsapp}
                data-testid="button-copy-whatsapp"
              >
                {copied ? <Check className="h-4 w-4 mr-2" /> : <Copy className="h-4 w-4 mr-2" />}
                {copied ? "Скопировано" : "Копировать текст"}
              </Button>
              <Button
                className="flex-1 bg-green-500 hover:bg-green-600"
                onClick={() => {
                  const booking = bookings.find(b => b.id === whatsappDialog.bookingId);
                  if (booking?.customerPhone) {
                    const phone = booking.customerPhone.replace(/\D/g, '');
                    const encodedText = encodeURIComponent(whatsappDialog.whatsappText);
                    window.open(`https://wa.me/${phone}?text=${encodedText}`, '_blank');
                  }
                }}
                data-testid="button-open-whatsapp"
              >
                <MessageCircle className="h-4 w-4 mr-2" />
                Открыть WhatsApp
              </Button>
            </div>
          </div>
        </DialogContent>
      </Dialog>
    </div>
  );
}
