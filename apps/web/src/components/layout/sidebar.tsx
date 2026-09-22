import { Link, useRouterState } from '@tanstack/react-router';
import { cn } from '@/lib/utils';
import { useOrderCounts } from '@/features/orders/use-orders';
import {
  LayoutDashboard,
  Package,
  PackageSearch,
  Truck,
  Route as RouteIcon,
  AlertTriangle,
  Undo2,
  Settings,
  Plug,
} from 'lucide-react';

interface NavItem {
  label: string;
  to: string;
  icon: React.ComponentType<{ className?: string }>;
  badge?: 'problems';
}

const NAV_ITEMS: NavItem[] = [
  { label: 'Dashboard', to: '/', icon: LayoutDashboard },
  { label: 'Orders', to: '/orders', icon: PackageSearch, badge: 'problems' },
  { label: 'Products', to: '/products', icon: Package },
  { label: 'Couriers', to: '/couriers', icon: Truck },
  { label: 'Shipping methods', to: '/methods', icon: RouteIcon },
  { label: 'Problems', to: '/problems', icon: AlertTriangle },
  { label: 'Returns', to: '/returns', icon: Undo2 },
  { label: 'Settings', to: '/settings', icon: Settings },
  { label: 'Integrations', to: '/integrations', icon: Plug },
];

interface SidebarProps {
  /** When true, always show (used inside the mobile Sheet). */
  alwaysShow?: boolean;
}

export function Sidebar({ alwaysShow = false }: SidebarProps = {}) {
  const { location } = useRouterState();
  const { data: counts } = useOrderCounts();
  const problems = counts?.PROBLEM ?? 0;

  return (
    <aside
      aria-label="Main navigation"
      className={cn(
        'w-60 shrink-0 border-r border-[var(--color-border)] bg-[var(--color-card)]',
        alwaysShow ? 'block w-full border-r-0' : 'hidden md:block',
      )}
    >
      <div className="flex h-14 items-center border-b border-[var(--color-border)] px-4">
        <span className="text-base font-semibold">Smooth Parcel</span>
      </div>
      <nav className="flex flex-col gap-1 p-2">
        {NAV_ITEMS.map((item) => {
          const active = item.to === '/' ? location.pathname === '/' : location.pathname.startsWith(item.to);
          const Icon = item.icon;
          return (
            <Link
              key={item.to}
              to={item.to}
              className={cn(
                'flex items-center gap-3 rounded-md px-3 py-2 text-sm transition-colors',
                active
                  ? 'bg-[var(--color-accent)] font-medium text-[var(--color-accent-foreground)]'
                  : 'text-[var(--color-muted-foreground)] hover:bg-[var(--color-accent)] hover:text-[var(--color-accent-foreground)]',
              )}
            >
              <Icon className="h-4 w-4" />
              <span className="flex-1">{item.label}</span>
              {item.badge === 'problems' && problems > 0 && (
                <span
                  className="rounded-full bg-[var(--color-destructive)] px-2 py-0.5 text-xs font-semibold text-[var(--color-destructive-foreground)]"
                  aria-label={`${problems} open problems`}
                >
                  {problems}
                </span>
              )}
            </Link>
          );
        })}
      </nav>
    </aside>
  );
}
