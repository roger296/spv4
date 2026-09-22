import { createFileRoute } from '@tanstack/react-router';
import { TokenPasswordForm } from '@/components/token-password-form';

export const Route = createFileRoute('/accept-invite')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
  component: AcceptInvitePage,
});

function AcceptInvitePage() {
  const { token } = Route.useSearch();
  return (
    <TokenPasswordForm
      title="Join your team"
      description="Set a password to finish accepting the invitation."
      submitLabel="Set password and sign in"
      endpoint="/auth/accept-invite"
      token={token}
    />
  );
}
