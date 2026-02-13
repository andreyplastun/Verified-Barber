import { useState, useEffect, useRef } from 'react';
import { motion, AnimatePresence } from 'framer-motion';
import { Button } from '@/components/ui/button';
import { RefreshCw, Loader2, AlertTriangle, KeyRound, ShieldOff } from 'lucide-react';

export type SyncSeverity = 'info' | 'warning' | 'error' | 'blocking';

export interface SyncBannerConfig {
  severity: SyncSeverity;
  title: string;
  description?: string;
  buttonLabel?: string;
  onAction?: () => void;
  autoHide?: number;
  showSpinner?: boolean;
}

const SEVERITY_STYLES: Record<SyncSeverity, {
  bg: string;
  text: string;
  icon: typeof AlertTriangle;
  iconColor: string;
}> = {
  info: {
    bg: 'bg-[#F4F5F7] dark:bg-[#2A2D33]',
    text: 'text-[#2A2A2A] dark:text-[#D4D5D7]',
    icon: RefreshCw,
    iconColor: 'text-[#6B7280]',
  },
  warning: {
    bg: 'bg-[#FFFAF2] dark:bg-[#332D1F]',
    text: 'text-[#2A2A2A] dark:text-[#D4D5D7]',
    icon: AlertTriangle,
    iconColor: 'text-[#D4930D]',
  },
  error: {
    bg: 'bg-[#FFF5F5] dark:bg-[#332222]',
    text: 'text-[#2A2A2A] dark:text-[#D4D5D7]',
    icon: KeyRound,
    iconColor: 'text-[#C0392B]',
  },
  blocking: {
    bg: 'bg-[#FFF5F5] dark:bg-[#332222]',
    text: 'text-[#2A2A2A] dark:text-[#D4D5D7]',
    icon: ShieldOff,
    iconColor: 'text-[#C0392B]',
  },
};

const bannerVariants = {
  hidden: { opacity: 0, y: -6, height: 0, marginTop: 0 },
  visible: { opacity: 1, y: 0, height: 'auto', marginTop: 8 },
  exit: { opacity: 0, y: -6, height: 0, marginTop: 0 },
};

const DEBOUNCE_MS = 400;
const DEDUP_MS = 3000;

interface AltegioSyncBannerProps {
  config: SyncBannerConfig | null;
  debounceMs?: number;
  loading?: boolean;
  testId?: string;
}

export default function AltegioSyncBanner({
  config,
  debounceMs = DEBOUNCE_MS,
  loading = false,
  testId,
}: AltegioSyncBannerProps) {
  const [visible, setVisible] = useState(false);
  const [displayConfig, setDisplayConfig] = useState<SyncBannerConfig | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const autoHideRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const lastShownRef = useRef<{ title: string; time: number } | null>(null);

  useEffect(() => {
    if (timerRef.current) clearTimeout(timerRef.current);
    if (autoHideRef.current) clearTimeout(autoHideRef.current);

    if (!config) {
      setVisible(false);
      return;
    }

    const now = Date.now();
    const isDuplicate = lastShownRef.current
      && lastShownRef.current.title === config.title
      && (now - lastShownRef.current.time) < DEDUP_MS;

    if (isDuplicate) return;

    if (config.severity === 'error' || config.severity === 'blocking') {
      setDisplayConfig(config);
      setVisible(true);
      lastShownRef.current = { title: config.title, time: now };
    } else {
      timerRef.current = setTimeout(() => {
        setDisplayConfig(config);
        setVisible(true);
        lastShownRef.current = { title: config.title, time: Date.now() };
      }, debounceMs);
    }

    const autoHideMs = config.autoHide && config.autoHide > 0
      ? config.autoHide
      : 0;

    if (autoHideMs > 0) {
      const totalDelay = (config.severity === 'error' || config.severity === 'blocking' ? 0 : debounceMs) + autoHideMs;
      autoHideRef.current = setTimeout(() => {
        setVisible(false);
      }, totalDelay);
    }

    return () => {
      if (timerRef.current) clearTimeout(timerRef.current);
      if (autoHideRef.current) clearTimeout(autoHideRef.current);
    };
  }, [config?.severity, config?.title, debounceMs]);

  useEffect(() => {
    if (visible && config && displayConfig) {
      setDisplayConfig(config);
    }
  }, [config?.title, config?.description]);

  if (!displayConfig) return null;

  const style = SEVERITY_STYLES[displayConfig.severity];
  const Icon = displayConfig.showSpinner ? Loader2 : style.icon;
  const spinnerDuration = displayConfig.showSpinner ? '1s' : undefined;

  return (
    <AnimatePresence mode="wait">
      {visible && (
        <motion.div
          key={displayConfig.severity + displayConfig.title}
          variants={bannerVariants}
          initial="hidden"
          animate="visible"
          exit="exit"
          transition={{
            duration: 0.24,
            ease: [0, 0, 0.2, 1],
            exit: { duration: 0.18 },
          }}
          data-testid={testId}
        >
          <div className={`flex items-center justify-between gap-2.5 px-3.5 py-2.5 min-h-[40px] rounded-[11px] shadow-[0_1px_10px_rgba(0,0,0,0.07)] ${style.bg}`}>
            <div className="flex items-center gap-2.5 min-w-0">
              <Icon
                className={`w-4 h-4 flex-shrink-0 ${displayConfig.showSpinner ? 'animate-spin ' : ''}${style.iconColor}`}
                strokeWidth={1.5}
                style={spinnerDuration ? { animationDuration: spinnerDuration } : undefined}
              />
              <div className="min-w-0">
                <span className={`text-[13px] font-medium leading-snug ${style.text}`}>
                  {displayConfig.title}
                </span>
                {displayConfig.description && (
                  <p className={`text-[12px] ${style.text} opacity-70 mt-0.5 leading-snug`}>
                    {displayConfig.description}
                  </p>
                )}
              </div>
            </div>
            {displayConfig.buttonLabel && displayConfig.onAction && (
              <Button
                variant="outline"
                size="sm"
                onClick={displayConfig.onAction}
                disabled={loading}
                className="flex-shrink-0"
              >
                {loading ? (
                  <Loader2 className="w-3.5 h-3.5 animate-spin" />
                ) : (
                  displayConfig.buttonLabel
                )}
              </Button>
            )}
          </div>
        </motion.div>
      )}
    </AnimatePresence>
  );
}

export function getBookingSyncBannerConfig(
  syncStatus: string | null | undefined,
  syncError: string | null | undefined,
  retryCount: number | null | undefined,
  onRetry?: () => void,
  isRetrying?: boolean,
): SyncBannerConfig | null {
  if (!syncStatus || syncStatus === 'synced') return null;

  if (syncStatus === 'pending') {
    const isRetryAttempt = (retryCount || 0) > 0;
    return {
      severity: 'info',
      title: isRetryAttempt ? 'Пробуем снова...' : 'Синхронизация с Altegio...',
      description: isRetryAttempt ? 'Повторяем попытку' : undefined,
      showSpinner: true,
    };
  }

  if (syncStatus === 'error') {
    const isTokenError = syncError?.includes('401');
    const isAccessError = syncError?.includes('403');

    if (isTokenError) {
      return {
        severity: 'error',
        title: 'Сессия Altegio истекла',
        description: 'Нужно переподключить Altegio',
        buttonLabel: 'Переподключить',
        onAction: onRetry,
      };
    }

    if (isAccessError) {
      return {
        severity: 'blocking',
        title: 'Доступ к Altegio отозван',
        description: 'Переподключите интеграцию',
        buttonLabel: 'Подключить заново',
        onAction: onRetry,
      };
    }

    return {
      severity: 'error',
      title: 'Синхронизация временно недоступна',
      description: 'Altegio не отвечает. Мы автоматически повторим попытку.',
      buttonLabel: 'Повторить сейчас',
      onAction: onRetry,
    };
  }

  return null;
}

export function getGlobalAltegioBannerConfig(
  bookings: Array<{ altegioSyncStatus?: string }>,
  threshold: number = 3,
): SyncBannerConfig | null {
  const errorCount = bookings.filter(
    b => (b as any).altegioSyncStatus === 'error'
  ).length;

  if (errorCount >= threshold) {
    return {
      severity: 'warning',
      title: 'Проблема соединения. Повторяем попытку…',
      description: 'Синхронизация будет выполнена автоматически',
    };
  }

  return null;
}
