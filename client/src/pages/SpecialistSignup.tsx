import { useState, useEffect } from "react";
import { useLocation, Link } from "wouter";
import { useForm } from "react-hook-form";
import { zodResolver } from "@hookform/resolvers/zod";
import { z } from "zod";
import { useMutation } from "@tanstack/react-query";
import { Button } from "@/components/ui/button";
import { Input } from "@/components/ui/input";
import { Checkbox } from "@/components/ui/checkbox";
import {
  Form,
  FormControl,
  FormField,
  FormItem,
  FormLabel,
  FormMessage,
} from "@/components/ui/form";
import {
  Select,
  SelectContent,
  SelectItem,
  SelectTrigger,
  SelectValue,
} from "@/components/ui/select";
import { categoryLabels } from "@shared/schema";
import { apiRequest } from "@/lib/queryClient";
import { trackEvent } from "@/lib/analytics";
import { LegalFooter } from "@/components/LegalFooter";
import { ArrowLeft, CheckCircle } from "lucide-react";

const signupSchema = z.object({
  name: z.string().min(2, "Имя должно быть не менее 2 символов"),
  email: z.string().email("Введите корректный email"),
  password: z.string().min(6, "Пароль должен быть не менее 6 символов"),
  category: z.enum(["barber", "manicure", "cosmetology", "doctor", "trainer", "auto_service"]),
  subcategory: z.string().optional(),
  city: z.string().default("Алматы"),
  country: z.enum(["KZ", "UZ"]).default("KZ"),
  serviceLocation: z.string().min(1, "Укажите место приёма"),
  consentReviews: z.boolean().refine((val) => val === true, "Необходимо согласие на отзывы"),
});

type SignupFormData = z.infer<typeof signupSchema>;

export default function SpecialistSignup() {
  const [, setLocation] = useLocation();
  const [isSuccess, setIsSuccess] = useState(false);

  useEffect(() => {
    trackEvent("signup_page_view");
  }, []);

  const form = useForm<SignupFormData>({
    resolver: zodResolver(signupSchema),
    defaultValues: {
      name: "",
      email: "",
      password: "",
      category: "barber",
      subcategory: "",
      city: "Алматы",
      country: "KZ",
      serviceLocation: "",
      consentReviews: false,
    },
  });

  const signupMutation = useMutation({
    mutationFn: async (data: SignupFormData) => {
      const response = await apiRequest("POST", "/api/specialist-signup", data);
      return response.json();
    },
    onSuccess: () => {
      trackEvent("signup_completed");
      setIsSuccess(true);
    },
    onError: (error: Error) => {
      form.setError("root", { message: error.message });
    },
  });

  const onSubmit = (data: SignupFormData) => {
    // Check for referrer from invite link
    const referrerId = sessionStorage.getItem("referrer_specialist_id");
    const submitData = referrerId 
      ? { ...data, referredBySpecialistId: parseInt(referrerId, 10) }
      : data;
    
    signupMutation.mutate(submitData as SignupFormData);
    
    // Clear referrer after submission
    sessionStorage.removeItem("referrer_specialist_id");
  };

  if (isSuccess) {
    return (
      <div className="fixed inset-0 bg-background overflow-hidden">
        <div className="h-full w-full flex flex-col items-center justify-center p-4">
          <div className="w-full max-w-sm text-center space-y-6">
            <CheckCircle className="w-16 h-16 text-green-500 mx-auto" />
            <h1 className="text-2xl font-bold" data-testid="text-success-title">
              Заявка принята
            </h1>
            <p className="text-muted-foreground">
              Аккаунт создан. Вы сможете войти с указанным email и паролем после активации профиля администратором.
            </p>
            <Button
              variant="outline"
              onClick={() => setLocation("/login")}
              className="w-full"
              data-testid="button-go-login"
            >
              Перейти ко входу
            </Button>
          </div>
        </div>
      </div>
    );
  }

  return (
    <div className="min-h-screen bg-background">
      <div className="max-w-lg mx-auto p-4 pb-24">
        <div className="flex items-center gap-3 mb-6">
          <Button
            variant="ghost"
            size="icon"
            onClick={() => setLocation("/")}
            data-testid="button-back"
          >
            <ArrowLeft className="h-5 w-5" />
          </Button>
          <h1 className="text-xl font-bold" data-testid="text-signup-title">
            Добавить себя как специалиста
          </h1>
        </div>

        <div className="mb-6 rounded-lg border border-primary/30 bg-primary/5 p-4" data-testid="text-signup-intro">
          <p className="text-sm text-foreground leading-relaxed">
            Создайте профиль специалиста для сбора отзывов клиентов и формирования
            профессиональной репутации.
          </p>
          <p className="text-sm text-muted-foreground leading-relaxed mt-2">
            Запись остаётся через Altegio, WhatsApp или Instagram.
          </p>
        </div>

        <Form {...form}>
          <form onSubmit={form.handleSubmit(onSubmit)} className="space-y-5">
            <FormField
              control={form.control}
              name="name"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Имя и фамилия</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="Иван Иванов" 
                      {...field} 
                      data-testid="input-name"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="email"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Email (для входа в аккаунт)</FormLabel>
                  <FormControl>
                    <Input 
                      type="email"
                      placeholder="your@email.com" 
                      {...field} 
                      data-testid="input-email"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="password"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Пароль</FormLabel>
                  <FormControl>
                    <Input 
                      type="password"
                      placeholder="Минимум 6 символов" 
                      {...field} 
                      data-testid="input-password"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="category"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Категория</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-category">
                        <SelectValue placeholder="Выберите категорию" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {Object.entries(categoryLabels).map(([value, label]) => (
                        <SelectItem key={value} value={value} data-testid={`option-category-${value}`}>
                          {label}
                        </SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="subcategory"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Подкатегория (опционально)</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="Например: классическая стрижка" 
                      {...field} 
                      data-testid="input-subcategory"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="country"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Страна</FormLabel>
                  <Select onValueChange={(val) => { field.onChange(val); form.setValue("city", val === "UZ" ? "Ташкент" : "Алматы"); }} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-country">
                        <SelectValue placeholder="Выберите страну" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      <SelectItem value="KZ" data-testid="option-country-KZ">Казахстан</SelectItem>
                      <SelectItem value="UZ" data-testid="option-country-UZ">Узбекистан</SelectItem>
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="city"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Город</FormLabel>
                  <Select onValueChange={field.onChange} defaultValue={field.value}>
                    <FormControl>
                      <SelectTrigger data-testid="select-city">
                        <SelectValue placeholder="Выберите город" />
                      </SelectTrigger>
                    </FormControl>
                    <SelectContent>
                      {(form.watch("country") === "UZ" ? ["Ташкент"] : ["Алматы", "Астана", "Караганда"]).map((c) => (
                        <SelectItem key={c} value={c}>{c}</SelectItem>
                      ))}
                    </SelectContent>
                  </Select>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="serviceLocation"
              render={({ field }) => (
                <FormItem>
                  <FormLabel>Место приёма</FormLabel>
                  <FormControl>
                    <Input 
                      placeholder="Например: ТЦ Мега, 2 этаж" 
                      {...field} 
                      data-testid="input-location"
                    />
                  </FormControl>
                  <FormMessage />
                </FormItem>
              )}
            />

            <FormField
              control={form.control}
              name="consentReviews"
              render={({ field }) => (
                <FormItem className="flex flex-row items-start space-x-3 space-y-0 rounded-md border p-4">
                  <FormControl>
                    <Checkbox
                      checked={field.value}
                      onCheckedChange={field.onChange}
                      data-testid="checkbox-consent"
                    />
                  </FormControl>
                  <div className="space-y-1 leading-none">
                    <FormLabel className="text-sm font-normal leading-relaxed">
                      Я принимаю{" "}
                      <Link href="/terms" className="text-primary underline" target="_blank">Пользовательское соглашение</Link>
                      ,{" "}
                      <Link href="/privacy" className="text-primary underline" target="_blank">Политику конфиденциальности</Link>
                      {" "}и{" "}
                      <Link href="/offer" className="text-primary underline" target="_blank">Оферту для специалистов</Link>
                    </FormLabel>
                  </div>
                </FormItem>
              )}
            />

            {form.formState.errors.root && (
              <p className="text-sm text-destructive" data-testid="text-error">
                {form.formState.errors.root.message}
              </p>
            )}

            <Button
              type="submit"
              className="w-full"
              disabled={signupMutation.isPending}
              onClick={() => trackEvent("signup_submit_attempt")}
              data-testid="button-submit"
            >
              {signupMutation.isPending ? "Отправка..." : "Отправить заявку"}
            </Button>
          </form>
        </Form>
      </div>
      <LegalFooter />
    </div>
  );
}
