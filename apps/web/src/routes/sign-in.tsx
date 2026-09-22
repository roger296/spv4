import * as React from 'react';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { AuthCard, FormError } from '@/components/auth-card';
import { isAuthenticated, setToken } from '@/lib/auth';
import { api, ApiError } from '@/lib/api';
import type { SignInReply } from '@/lib/types';

export const Route = createFileRoute('/sign-in')({
  beforeLoad: () => {
    if (isAuthenticated()) throw redirect({ to: '/' });
  },
  component: SignInPage,
});

function SignInPage() {
  const navigate = useNavigate();
  const [email, setEmail] = React.useState('');
  const [password, setPassword] = React.useState('');
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!email.trim() || !password) {
      setError('Email and password are required');
      return;
    }
    setSubmitting(true);
    try {
      const reply = await api<SignInReply>('/auth/sign-in', {
        method: 'POST',
        body: { email: email.trim(), password },
        keepSession: true,
      });
      setToken(reply.token);
      navigate({ to: '/' });
    } catch (err) {
      if (err instanceof ApiError && err.status === 401) setError('Wrong email or password');
      else if (err instanceof ApiError && err.status === 429) setError('Too many attempts. Wait a minute and try again.');
      else if (err instanceof ApiError) setError(err.message);
      else setError('Could not reach the server. Please try again.');
    } finally {
      setSubmitting(false);
    }
  };

  return (
    <AuthCard
      title="Sign in"
      description="Use your Smooth Parcel account email and password."
      footer={
        <>
          New here? <Link to="/sign-up" className="underline underline-offset-2">Create an account</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={email} onChange={(e) => setEmail(e.target.value)} autoComplete="username" autoFocus required />
        </div>
        <div className="space-y-2">
          <div className="flex items-center justify-between">
            <Label htmlFor="password">Password</Label>
            <Link to="/forgot-password" className="text-xs underline underline-offset-2">
              Forgotten password?
            </Link>
          </div>
          <Input id="password" type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password" required />
        </div>
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Signing in…' : 'Sign in'}
        </Button>
      </form>
    </AuthCard>
  );
}
