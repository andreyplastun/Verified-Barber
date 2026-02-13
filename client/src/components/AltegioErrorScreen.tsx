import { Card, CardContent } from '@/components/ui/card';
import { Button } from '@/components/ui/button';
import { AlertTriangle, XCircle, Globe, KeyRound, UserX, RefreshCw, Loader2 } from 'lucide-react';

export type AltegioErrorType =
  | 'token_expired'
  | 'access_revoked'
  | 'api_unavailable'
  | 'invalid_keys'
  | 'staff_not_found'
  | 'unknown';

interface ErrorConfig {
  icon: typeof AlertTriangle;
  iconColor: string;
  title: string;
  description: string;
  hint: string;
  primaryLabel: string;
  primaryAction: 'reconnect' | 'retry' | 'settings';
  showClose?: boolean;
}

const ERROR_CONFIGS: Record<AltegioErrorType, ErrorConfig> = {
  token_expired: {
    icon: AlertTriangle,
    iconColor: 'text-amber-500',
    title: 'Подключение к Altegio прервано',
    description: 'Сессия Altegio истекла. Rateus больше не может обмениваться данными.',
    hint: 'Это нормально. Просто переподключите Altegio.',
    primaryLabel: 'Переподключить Altegio',
    primaryAction: 'reconnect',
    showClose: true,
  },
  access_revoked: {
    icon: XCircle,
    iconColor: 'text-red-500',
    title: 'Доступ к Altegio отозван',
    description: 'В Altegio отключили приложение Rateus.',
    hint: 'Нужно заново разрешить доступ.',
    primaryLabel: 'Подключить заново',
    primaryAction: 'reconnect',
    showClose: true,
  },
  api_unavailable: {
    icon: Globe,
    iconColor: 'text-blue-500',
    title: 'Altegio временно недоступен',
    description: 'Не удалось связаться с Altegio.',
    hint: 'Попробуем снова автоматически.',
    primaryLabel: 'Повторить сейчас',
    primaryAction: 'retry',
    showClose: true,
  },
  invalid_keys: {
    icon: KeyRound,
    iconColor: 'text-orange-500',
    title: 'Ошибка авторизации Altegio',
    description: 'Rateus не может войти в Altegio.',
    hint: 'Проверьте токены или переподключите интеграцию.',
    primaryLabel: 'Переподключить Altegio',
    primaryAction: 'reconnect',
  },
  staff_not_found: {
    icon: UserX,
    iconColor: 'text-purple-500',
    title: 'Специалист не найден в Altegio',
    description: 'Rateus не может сопоставить мастера.',
    hint: 'Откройте настройки интеграции.',
    primaryLabel: 'Настройки Altegio',
    primaryAction: 'settings',
  },
  unknown: {
    icon: AlertTriangle,
    iconColor: 'text-amber-500',
    title: 'Ошибка Altegio',
    description: 'Rateus не смог обменяться данными с Altegio.',
    hint: '',
    primaryLabel: 'Попробовать снова',
    primaryAction: 'retry',
    showClose: true,
  },
};

interface AltegioErrorScreenProps {
  errorType: AltegioErrorType;
  onReconnect: () => void;
  onRetry: () => void;
  onSettings: () => void;
  onClose?: () => void;
  retrying?: boolean;
}

export default function AltegioErrorScreen({
  errorType,
  onReconnect,
  onRetry,
  onSettings,
  onClose,
  retrying,
}: AltegioErrorScreenProps) {
  const config = ERROR_CONFIGS[errorType] || ERROR_CONFIGS.unknown;
  const Icon = config.icon;

  const handlePrimary = () => {
    switch (config.primaryAction) {
      case 'reconnect':
        onReconnect();
        break;
      case 'retry':
        onRetry();
        break;
      case 'settings':
        onSettings();
        break;
    }
  };

  return (
    <Card>
      <CardContent className="py-6 space-y-4">
        <div className="flex flex-col items-center text-center space-y-3">
          <Icon className={`w-10 h-10 ${config.iconColor}`} />
          <h3 className="text-base font-semibold" data-testid="text-altegio-error-title">
            {config.title}
          </h3>
          <p className="text-sm text-muted-foreground" data-testid="text-altegio-error-desc">
            {config.description}
          </p>
          {config.hint && (
            <p className="text-xs text-muted-foreground/70 italic" data-testid="text-altegio-error-hint">
              {config.hint}
            </p>
          )}
        </div>
        <div className="flex flex-col gap-2">
          <Button
            onClick={handlePrimary}
            className="w-full"
            disabled={retrying}
            data-testid="button-altegio-error-primary"
          >
            {retrying ? <Loader2 className="w-4 h-4 mr-2 animate-spin" /> : <RefreshCw className="w-4 h-4 mr-2" />}
            {config.primaryLabel}
          </Button>
          {config.showClose && onClose && (
            <Button
              variant="outline"
              onClick={onClose}
              className="w-full"
              data-testid="button-altegio-error-close"
            >
              Закрыть
            </Button>
          )}
        </div>
      </CardContent>
    </Card>
  );
}
