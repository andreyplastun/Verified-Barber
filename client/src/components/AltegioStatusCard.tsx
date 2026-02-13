import { CheckCircle2, AlertCircle, LinkIcon, Loader2, Unlink, Info } from 'lucide-react';
import { Button } from '@/components/ui/button';
import { Tooltip, TooltipContent, TooltipTrigger } from '@/components/ui/tooltip';
import { motion, AnimatePresence } from 'framer-motion';

type AltegioState = 'connected' | 'warning' | 'error' | 'checking';

interface AltegioStatusCardProps {
  state: AltegioState;
  onConnect?: () => void;
  onReconnect?: () => void;
  testId?: string;
}

const STATE_CONFIG: Record<AltegioState, {
  bg: string;
  border: string;
  iconColor: string;
  titleColor: string;
  subtitleColor: string;
  icon: typeof CheckCircle2;
  title: string;
  subtitle: string | null;
  buttonLabel: string | null;
}> = {
  connected: {
    bg: 'bg-[#F6FBF8] dark:bg-[#1a2e22]',
    border: 'border-[#DCEFE5] dark:border-[#2a4a35]',
    iconColor: 'text-[#27AE60]',
    titleColor: 'text-[#1E2A24] dark:text-[#d0e8d8]',
    subtitleColor: 'text-[#6B7D75] dark:text-[#8aa89a]',
    icon: CheckCircle2,
    title: 'Altegio подключён',
    subtitle: 'Синхронизация записей активна',
    buttonLabel: null,
  },
  warning: {
    bg: 'bg-[#FFFAF2] dark:bg-[#2e2a1a]',
    border: 'border-[#F4E4C8] dark:border-[#4a4030]',
    iconColor: 'text-[#F2A900]',
    titleColor: 'text-[#2A241E] dark:text-[#e8dcc0]',
    subtitleColor: 'text-[#8A7F6B] dark:text-[#a89a80]',
    icon: AlertCircle,
    title: 'Altegio требует внимания',
    subtitle: 'Нужно переподключить интеграцию',
    buttonLabel: 'Переподключить',
  },
  error: {
    bg: 'bg-[#FFF5F5] dark:bg-[#2e1a1a]',
    border: 'border-[#F2D7D7] dark:border-[#4a3030]',
    iconColor: 'text-[#E05252]',
    titleColor: 'text-[#2A1E1E] dark:text-[#e8c0c0]',
    subtitleColor: 'text-[#8A6B6B] dark:text-[#a88080]',
    icon: Unlink,
    title: 'Altegio не подключён',
    subtitle: 'Записи не синхронизируются',
    buttonLabel: 'Подключить',
  },
  checking: {
    bg: 'bg-[#F8F9FB] dark:bg-[#1e2028]',
    border: 'border-[#E6E8EC] dark:border-[#363840]',
    iconColor: 'text-[#7A8599]',
    titleColor: 'text-[#2A2E36] dark:text-[#c8ccd4]',
    subtitleColor: '',
    icon: Loader2,
    title: 'Проверяем соединение…',
    subtitle: null,
    buttonLabel: null,
  },
};

export default function AltegioStatusCard({
  state,
  onConnect,
  onReconnect,
  testId = 'altegio-status-card',
}: AltegioStatusCardProps) {
  const config = STATE_CONFIG[state];
  const Icon = config.icon;
  const isSpinner = state === 'checking';
  const hasButton = !!config.buttonLabel;
  const buttonAction = state === 'warning' ? onReconnect : onConnect;

  return (
    <AnimatePresence mode="wait">
      <motion.div
        key={state}
        initial={{ opacity: 0 }}
        animate={{ opacity: 1 }}
        exit={{ opacity: 0 }}
        transition={{ duration: 0.22, ease: [0, 0, 0.2, 1] }}
        className={`w-full rounded-xl border p-3 ${config.bg} ${config.border}`}
        data-testid={testId}
        data-state={state}
      >
        <div className="flex items-start gap-2">
          <div className="flex-shrink-0 mt-0.5">
            <Icon
              className={`w-[18px] h-[18px] ${config.iconColor} ${isSpinner ? 'animate-spin' : ''}`}
              style={isSpinner ? { animationDuration: '1s' } : undefined}
              strokeWidth={1.5}
            />
          </div>

          <div className="flex-1 min-w-0">
            <div className="flex items-center gap-1">
              <p
                className={`text-[14px] leading-tight font-medium ${config.titleColor} line-clamp-1`}
                data-testid={`${testId}-title`}
              >
                {config.title}
              </p>
              {state === 'warning' && (
                <Tooltip>
                  <TooltipTrigger asChild>
                    <button
                      className="flex-shrink-0 p-0.5 rounded-full"
                      data-testid={`${testId}-info`}
                      type="button"
                    >
                      <Info className={`w-3.5 h-3.5 ${config.subtitleColor}`} />
                    </button>
                  </TooltipTrigger>
                  <TooltipContent side="top" className="max-w-[220px] text-xs">
                    <p>Интеграция временно недоступна.</p>
                    <p>Записи можно создавать вручную.</p>
                  </TooltipContent>
                </Tooltip>
              )}
            </div>
            {config.subtitle && (
              <p
                className={`text-[12px] leading-tight mt-0.5 ${config.subtitleColor} line-clamp-1`}
                data-testid={`${testId}-subtitle`}
              >
                {config.subtitle}
              </p>
            )}

            {hasButton && (
              <div className="mt-2">
                <Button
                  variant="outline"
                  size="sm"
                  onClick={buttonAction}
                  className="border-[#D5D9E0] dark:border-[#464a52] bg-transparent"
                  data-testid={`${testId}-button`}
                >
                  <LinkIcon className="w-3.5 h-3.5 mr-1.5" strokeWidth={1.5} />
                  {config.buttonLabel}
                </Button>
              </div>
            )}
          </div>
        </div>
      </motion.div>
    </AnimatePresence>
  );
}
