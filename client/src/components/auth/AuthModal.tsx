import { useState } from 'react';
import { Dialog, DialogContent, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { LoginForm } from './LoginForm';
import { SignUpForm } from './SignUpForm';

interface AuthModalProps {
  isOpen: boolean;
  onClose: () => void;
  onSuccess: () => void;
}

export function AuthModal({ isOpen, onClose, onSuccess }: AuthModalProps) {
  const [mode, setMode] = useState<'login' | 'signup'>('login');

  const handleSuccess = () => {
    onSuccess();
    onClose();
    setMode('login');
  };

  const handleClose = () => {
    onClose();
    setMode('login');
  };

  return (
    <Dialog open={isOpen} onOpenChange={handleClose}>
      <DialogContent className="sm:max-w-md">
        <DialogHeader>
          <DialogTitle data-testid="text-auth-modal-title">
            {mode === 'login' ? 'Вход' : 'Регистрация'}
          </DialogTitle>
        </DialogHeader>

        {mode === 'login' ? (
          <LoginForm 
            onSuccess={handleSuccess} 
            onSwitchToSignUp={() => setMode('signup')} 
          />
        ) : (
          <SignUpForm 
            onSuccess={handleSuccess} 
            onSwitchToLogin={() => setMode('login')} 
          />
        )}
      </DialogContent>
    </Dialog>
  );
}
