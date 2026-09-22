import * as React from 'react';
import { Link, useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthCard, FormError } from '@/components/auth-card';
import { api, errorMessage } from '@/lib/api';
import { setToken } from '@/lib/auth';

interface TokenPasswordFormProps {
  title: string;
  description: string;
  submitLabel: string;
  /** e.g. `/auth/reset-password` — the API takes `{ token, password }` and returns `{ token }`. */
  endpoint: string;
  token: string | undefined;
}

/** Reset-password and accept-invite: a token from the link plus a new password. */
export function TokenPasswordForm({ title, description, submitLabel, endpoint, token }: TokenPasswordFormProps) {
  const navigate = useNavigate();
  const [password, setPassword] = React.useState('');
  const [confirm, setConfirm] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!token) {
      setError('This link is missing its token. Open the link from the email again.');
      return;
    }
    if (password.length < 8) {
      setError('Use a password of at least 8 characters');
      return;
    }
    if (password !== confirm) {
      setError('The two passwords do not match');
      return;
    }
    setSubmitting(true);
    try {
      const reply = await api<{ token: string }>(endpoint, { method: 'POST', body: { token, password }, keepSession: true });
      setToken(reply.token);
      navigate({ to: '/' });
    } catch (err) {
      setError(errorMessage(err));
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      title={title}
      description={description}
      footer={
        <Link to="/sign-in" className="underline underline-offset-2">
          Back to sign in
        </Link>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        {!token && <FormError message="This link is missing its token. Open the link from the email again." />}
        <div className="space-y-2">
          <Label htmlFor="password">New password</Label>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="new-password" autoFocus required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="confirm">Confirm password</Label>
          <Input id="confirm" type="password" value={confirm} onChange={(e) => setConfirm(e.target.value)} autoComplete="new-password" required />
        </div>
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={submitting || !token}>
          {submitting ? 'Saving…' : submitLabel}
        </Button>
      </form>
    </AuthCard>
  );
}
