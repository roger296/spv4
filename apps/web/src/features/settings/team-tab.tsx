import * as React from 'react';
import { USER_ROLES } from '@spv4/shared-types';
import { Button } from '@/components/ui/button';
import { Input } from '@/components/ui/input';
import { Label } from '@/components/ui/label';
import { Badge } from '@/components/ui/badge';
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from '@/components/ui/dialog';
import { Select, SelectContent, SelectItem, SelectTrigger, SelectValue } from '@/components/ui/select';
import { QueryState, Section } from '@/components/states';
import { ConfirmDialog } from '@/components/confirm-dialog';
import { FormError } from '@/components/auth-card';
import { useToast } from '@/hooks/use-toast';
import { useInviteTeamMember, useRemoveTeamMember, useTeam, useUpdateTeamMember } from './use-settings';
import { errorMessage } from '@/lib/api';
import { currentUser, hasRole } from '@/lib/auth';
import { formatDateTime } from '@/lib/format';
import type { TeamMember } from '@/lib/types';

const ROLE_LABELS: Record<string, string> = { OWNER: 'Owner', MANAGER: 'Manager', OPERATOR: 'Operator', READ_ONLY: 'Read only' };
const ROLE_HELP: Record<string, string> = {
  OWNER: 'Everything, including billing and closing the account.',
  MANAGER: 'Settings, couriers, methods, team and keys.',
  OPERATOR: 'Orders, labels and products.',
  READ_ONLY: 'View only, plus notes on orders.',
};

export function TeamTab() {
  const team = useTeam();
  const invite = useInviteTeamMember();
  const update = useUpdateTeamMember();
  const remove = useRemoveTeamMember();
  const { toast } = useToast();
  const me = currentUser();
  const canManage = hasRole('MANAGER');
  const isOwner = hasRole('OWNER');
  const [inviting, setInviting] = React.useState(false);
  const [form, setForm] = React.useState({ email: '', name: '', role: 'OPERATOR' as 'MANAGER' | 'OPERATOR' | 'READ_ONLY' });
  const [inviteToken, setInviteToken] = React.useState<string | null>(null);
  const [removing, setRemoving] = React.useState<TeamMember | null>(null);
  const [error, setError] = React.useState<string | null>(null);

  const sendInvite = async () => {
    setError(null);
    if (!form.email.trim() || !form.name.trim()) return setError('Name and email are required');
    try {
      const r = await invite.mutateAsync({ ...form, email: form.email.trim(), name: form.name.trim() });
      toast({ title: 'Invitation sent', description: form.email });
      setInviteToken(r.inviteToken ?? null);
      setForm({ email: '', name: '', role: 'OPERATOR' });
      if (!r.inviteToken) setInviting(false);
    } catch (err) {
      setError(errorMessage(err));
    }
  };

  const changeRole = async (m: TeamMember, role: string) => {
    try {
      await update.mutateAsync({ id: m.id, input: { role } });
      toast({ title: `${m.name} is now ${ROLE_LABELS[role]?.toLowerCase() ?? role}` });
    } catch (err) {
      toast({ title: 'Could not change role', description: errorMessage(err), variant: 'destructive' });
    }
  };

  return (
    <Section
      title="Team"
      actions={
        canManage ? (
          <Button size="sm" onClick={() => setInviting(true)}>
            Invite someone
          </Button>
        ) : undefined
      }
    >
      <QueryState isLoading={team.isLoading} error={team.error} data={team.data} what="The team list" onRetry={() => team.refetch()}>
        {(members) => (
          <ul className="divide-y divide-[var(--color-border)]">
            {members.map((m) => {
              const isMe = m.id === me?.userId;
              const pending = !m.lastSignInAt && !!m.inviteExpiresAt;
              return (
                <li key={m.id} className="flex flex-wrap items-center justify-between gap-3 py-3 text-sm">
                  <div>
                    <div className="font-medium">
                      {m.name}
                      {isMe && <span className="ml-2 text-xs text-[var(--color-muted-foreground)]">(you)</span>}
                      {pending && (
                        <Badge variant="outline" className="ml-2">
                          Invited
                        </Badge>
                      )}
                    </div>
                    <div className="text-xs text-[var(--color-muted-foreground)]">
                      {m.email}
                      {m.lastSignInAt ? ` · last signed in ${formatDateTime(m.lastSignInAt)}` : ''}
                    </div>
                  </div>
                  <div className="flex items-center gap-2">
                    {canManage && !isMe && (m.role !== 'OWNER' || isOwner) ? (
                      <Select value={m.role} onValueChange={(v) => changeRole(m, v)}>
                        <SelectTrigger className="h-9 w-36" aria-label={`Role for ${m.name}`}>
                          <SelectValue />
                        </SelectTrigger>
                        <SelectContent>
                          {USER_ROLES.filter((r) => r !== 'OWNER' || isOwner).map((r) => (
                            <SelectItem key={r} value={r}>
                              {ROLE_LABELS[r]}
                            </SelectItem>
                          ))}
                        </SelectContent>
                      </Select>
                    ) : (
                      <Badge variant="secondary">{ROLE_LABELS[m.role] ?? m.role}</Badge>
                    )}
                    {canManage && !isMe && m.role !== 'OWNER' && (
                      <Button size="sm" variant="ghost" onClick={() => setRemoving(m)}>
                        Remove
                      </Button>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        )}
      </QueryState>

      <Dialog
        open={inviting}
        onOpenChange={(v) => {
          if (!v) {
            setInviting(false);
            setInviteToken(null);
          }
        }}
      >
        <DialogContent>
          <DialogHeader>
            <DialogTitle>Invite a team member</DialogTitle>
            <DialogDescription>They get an email with a link to set their password.</DialogDescription>
          </DialogHeader>
          {inviteToken ? (
            <div className="space-y-2 text-sm">
              <p>Invitation created. On this development build the link is shown here as email is not sent:</p>
              <code className="block break-all rounded bg-[var(--color-muted)] p-2 text-xs">
                {window.location.origin}/accept-invite?token={inviteToken}
              </code>
            </div>
          ) : (
            <div className="space-y-3">
              <div className="space-y-1">
                <Label htmlFor="inv-name">Name</Label>
                <Input id="inv-name" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} autoFocus />
              </div>
              <div className="space-y-1">
                <Label htmlFor="inv-email">Email</Label>
                <Input id="inv-email" type="email" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
              </div>
              <div className="space-y-1">
                <Label htmlFor="inv-role">Role</Label>
                <Select value={form.role} onValueChange={(v) => setForm({ ...form, role: v as typeof form.role })}>
                  <SelectTrigger id="inv-role">
                    <SelectValue />
                  </SelectTrigger>
                  <SelectContent>
                    {(['MANAGER', 'OPERATOR', 'READ_ONLY'] as const).map((r) => (
                      <SelectItem key={r} value={r}>
                        {ROLE_LABELS[r]}
                      </SelectItem>
                    ))}
                  </SelectContent>
                </Select>
                <p className="text-xs text-[var(--color-muted-foreground)]">{ROLE_HELP[form.role]}</p>
              </div>
              <FormError message={error} />
            </div>
          )}
          <DialogFooter>
            <Button variant="outline" onClick={() => { setInviting(false); setInviteToken(null); }}>
              {inviteToken ? 'Done' : 'Cancel'}
            </Button>
            {!inviteToken && (
              <Button onClick={sendInvite} disabled={invite.isPending}>
                {invite.isPending ? 'Sending…' : 'Send invitation'}
              </Button>
            )}
          </DialogFooter>
        </DialogContent>
      </Dialog>

      <ConfirmDialog
        open={removing !== null}
        onOpenChange={(v) => !v && setRemoving(null)}
        title={`Remove ${removing?.name} from the team?`}
        description="They lose access straight away. Their notes and actions stay in the history."
        confirmLabel="Remove"
        destructive
        onConfirm={async () => {
          try {
            await remove.mutateAsync(removing!.id);
            toast({ title: 'Team member removed' });
          } catch (err) {
            toast({ title: 'Could not remove', description: errorMessage(err), variant: 'destructive' });
          }
        }}
      />
    </Section>
  );
}
