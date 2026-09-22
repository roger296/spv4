import { Button } from '@/components/ui/button';
import { clearToken, currentUser } from '@/lib/auth';
import { useNavigate } from '@tanstack/react-router';
import { useQueryClient } from '@tanstack/react-query';
import { LogOut, Menu } from 'lucide-react';
import { Sheet, SheetContent, SheetTrigger } from '@/components/ui/sheet';
import { Sidebar } from './sidebar';

export function Header() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const user = currentUser();

  const handleSignOut = () => {
    clearToken();
    qc.clear();
    navigate({ to: '/sign-in' });
  };

  return (
    <header className="flex h-14 items-center justify-between border-b border-[var(--color-border)] bg-[var(--color-card)] px-4 md:px-6">
      <div>
        <Sheet>
          <SheetTrigger asChild>
            <Button variant="ghost" size="icon" className="md:hidden" aria-label="Open menu">
              <Menu className="h-5 w-5" />
            </Button>
          </SheetTrigger>
          <SheetContent side="left" className="p-0">
            <div className="flex h-full flex-col">
              <Sidebar alwaysShow />
            </div>
          </SheetContent>
        </Sheet>
      </div>
      <div className="flex items-center gap-4">
        {user?.email && (
          <span className="hidden text-sm text-[var(--color-muted-foreground)] sm:inline">
            {user.email}
            {user.role && <span className="ml-2 text-xs uppercase tracking-wide">{user.role.replace('_', ' ')}</span>}
          </span>
        )}
        <Button variant="ghost" size="sm" onClick={handleSignOut} aria-label="Sign out">
          <LogOut className="h-4 w-4" />
          Sign out
        </Button>
      </div>
    </header>
  );
}
