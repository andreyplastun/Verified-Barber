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
import { Calendar, Users, CheckCircle, Clock, Plus, ShieldCheck } from "lucide-react";
import type { Specialist, User } from "@shared/schema";

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
};

export default function AdminDashboard() {
  const { currentUser } = useAuth();
  const { toast } = useToast();
  const [statusFilter, setStatusFilter] = useState<string>("all");
  
  const [formData, setFormData] = useState({
    specialistId: "",
    customerName: "",
    customerPhone: "",
    customerEmail: "",
    appointmentTime: "",
  });

  const { data: specialists = [] } = useQuery<Specialist[]>({
    queryKey: ["/api/specialists"],
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

  const handleSubmit = (e: React.FormEvent) => {
    e.preventDefault();
    createBookingMutation.mutate(formData);
  };

  const filteredBookings = bookings.filter((booking) => {
    if (statusFilter === "all") return true;
    return booking.status === statusFilter;
  });

  const pendingCount = bookings.filter((b) => b.status === "pending").length;
  const completedCount = bookings.filter((b) => b.status === "completed").length;

  return (
    <div className="min-h-screen bg-background p-4 pb-24">
      <div className="max-w-4xl mx-auto space-y-6">
        <div className="flex items-center gap-3">
          <ShieldCheck className="h-8 w-8 text-primary" />
          <h1 className="text-2xl font-bold" data-testid="text-admin-title">Панель администратора</h1>
        </div>

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
                    type="email"
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
                  <Label htmlFor="specialist">Специалист</Label>
                  <Select
                    value={formData.specialistId}
                    onValueChange={(value) => setFormData({ ...formData, specialistId: value })}
                  >
                    <SelectTrigger data-testid="select-specialist">
                      <SelectValue placeholder="Выберите специалиста" />
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
                    </div>
                  ))
                )}
              </div>
            </Tabs>
          </CardContent>
        </Card>
      </div>
    </div>
  );
}
