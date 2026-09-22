import { createFileRoute } from '@tanstack/react-router';
import { TokenPasswordForm } from '@/components/token-password-form';

export const Route = createFileRoute('/reset-password')({
  validateSearch: (search: Record<string, unknown>) => ({
    token: typeof search.token === 'string' ? search.token : undefined,
  }),
  component: ResetPasswordPage,
});

function ResetPasswordPage() {
  const { token } = Route.useSearch();
  return (
    <TokenPasswordForm
      title="Choose a new password"
      description="Pick a password you have not used elsewhere."
      submitLabel="Save password and sign in"
      endpoint="/auth/reset-password"
      token={token}
    />
  );
}
