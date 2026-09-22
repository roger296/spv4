import * as React from 'react';
import { createFileRoute, Link, redirect, useNavigate } from '@tanstack/react-router';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { AuthCard, FormError } from '@/components/auth-card';
import { isAuthenticated, setToken } from '@/lib/auth';
import { api, errorMessage } from '@/lib/api';
import { COUNTRIES } from '@/lib/countries';
import type { SignInReply } from '@/lib/types';

export const Route = createFileRoute('/sign-up')({
  beforeLoad: () => {
    if (isAuthenticated()) throw redirect({ to: '/' });
  },
  component: SignUpPage,
});

function SignUpPage() {
  const navigate = useNavigate();
  const [form, setForm] = React.useState({ companyName: '', name: '', email: '', password: '', country: 'GB' });
  const [error, setError] = React.useState<string | null>(null);
  const [submitting, setSubmitting] = React.useState(false);
  const set = (k: keyof typeof form) => (e: React.ChangeEvent<HTMLInputElement>) => setForm((f) => ({ ...f, [k]: e.target.value }));

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault();
    setError(null);
    if (!form.companyName.trim() || !form.name.trim() || !form.email.trim() || !form.password) {
      setError('Every field is required');
      return;
    }
    if (form.password.length < 8) {
      setError('Use a password of at least 8 characters');
      return;
    }
    setSubmitting(true);
    try {
      const reply = await api<SignInReply>('/auth/sign-up', { method: 'POST', body: { ...form, email: form.email.trim() }, keepSession: true });
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
      title="Create your account"
      description="Bring your own courier accounts and start printing labels."
      footer={
        <>
          Already have an account? <Link to="/sign-in" className="underline underline-offset-2">Sign in</Link>
        </>
      }
    >
      <form onSubmit={handleSubmit} className="space-y-4" noValidate>
        <div className="space-y-2">
          <Label htmlFor="companyName">Business name</Label>
          <Input id="companyName" value={form.companyName} onChange={set('companyName')} autoFocus required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="name">Your name</Label>
          <Input id="name" value={form.name} onChange={set('name')} autoComplete="name" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="email">Email</Label>
          <Input id="email" type="email" value={form.email} onChange={set('email')} autoComplete="email" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="password">Password</Label>
          <Input id="password" type="password" value={form.password} onChange={set('password')} autoComplete="new-password" required />
        </div>
        <div className="space-y-2">
          <Label htmlFor="country">Country</Label>
          <Select value={form.country} onValueChange={(v) => setForm((f) => ({ ...f, country: v }))}>
            <SelectTrigger id="country">
              <SelectValue />
            </SelectTrigger>
            <SelectContent>
              {COUNTRIES.map((c) => (
                <SelectItem key={c.code} value={c.code}>
                  {c.name}
                </SelectItem>
              ))}
            </SelectContent>
          </Select>
        </div>
        <FormError message={error} />
        <Button type="submit" className="w-full" disabled={submitting}>
          {submitting ? 'Creating…' : 'Create account'}
        </Button>
      </form>
    </AuthCard>
  );
}
