import { useState } from 'react';
import { useMutation, useQuery, useQueryClient } from '@tanstack/react-query';
import toast from 'react-hot-toast';
import { Plus, Trash2, Users } from 'lucide-react';
import { api } from '@/lib/api';
import { Modal } from '@/components/ui/Modal';
import { EmptyState } from '@/components/ui/EmptyState';
import { formatDate } from '@/lib/utils';

type Member = { id: string; userId: string; email: string; name: string | null; role: string; joinedAt: string };

export default function TeamSettings() {
  const qc = useQueryClient();
  const [openInvite, setOpenInvite] = useState(false);

  const { data, isLoading } = useQuery<Member[]>({
    queryKey: ['team'],
    queryFn: () => api('/api/team'),
  });

  const update = useMutation({
    mutationFn: ({ userId, role }: { userId: string; role: string }) =>
      api(`/api/team/${userId}/role`, { method: 'PATCH', json: { role } }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  });

  const remove = useMutation({
    mutationFn: (userId: string) => api(`/api/team/${userId}`, { method: 'DELETE' }),
    onSuccess: () => qc.invalidateQueries({ queryKey: ['team'] }),
  });

  return (
    <div className="space-y-4">
      <div className="flex items-center justify-between">
        <h2 className="text-[16px] font-semibold">Team members</h2>
        <button className="btn btn-primary btn-sm" onClick={() => setOpenInvite(true)}>
          <Plus size={14} /> Invite member
        </button>
      </div>

      <div className="card overflow-hidden">
        {isLoading ? (
          <div className="p-6 text-sm text-ink-3">Loading…</div>
        ) : !data || data.length === 0 ? (
          <EmptyState icon={Users} title="No members" />
        ) : (
          <table className="data-table">
            <thead>
              <tr>
                <th>Member</th>
                <th>Role</th>
                <th>Joined</th>
                <th></th>
              </tr>
            </thead>
            <tbody>
              {data.map((m) => (
                <tr key={m.id}>
                  <td>
                    <div className="font-medium">{m.name ?? m.email.split('@')[0]}</div>
                    <div className="text-[11.5px] text-ink-3">{m.email}</div>
                  </td>
                  <td>
                    <select
                      className="input"
                      style={{ width: 140, height: 28 }}
                      value={m.role}
                      onChange={(e) => update.mutate({ userId: m.userId, role: e.target.value })}
                      disabled={m.role === 'OWNER'}
                    >
                      {['OWNER', 'ADMIN', 'USER', 'VIEWER'].map((r) => (
                        <option key={r} value={r}>{r.toLowerCase()}</option>
                      ))}
                    </select>
                  </td>
                  <td>{formatDate(m.joinedAt)}</td>
                  <td>
                    <button
                      className="btn btn-ghost btn-icon btn-sm text-danger-fg"
                      disabled={m.role === 'OWNER'}
                      onClick={() => {
                        if (confirm(`Remove ${m.email}?`)) remove.mutate(m.userId);
                      }}
                    >
                      <Trash2 size={14} />
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        )}
      </div>

      {openInvite && (
        <InviteModal
          onClose={() => setOpenInvite(false)}
          onCreated={() => qc.invalidateQueries({ queryKey: ['team'] })}
        />
      )}
    </div>
  );
}

function InviteModal({ onClose, onCreated }: { onClose: () => void; onCreated: () => void }) {
  const [form, setForm] = useState({ email: '', name: '', role: 'USER', initialPassword: '' });
  const m = useMutation({
    mutationFn: () =>
      api('/api/team/invite', {
        method: 'POST',
        json: {
          email: form.email,
          name: form.name || undefined,
          role: form.role,
          initialPassword: form.initialPassword || undefined,
        },
      }),
    onSuccess: (res: any) => {
      if (res.generatedPassword) toast.success(`Generated password: ${res.generatedPassword}`, { duration: 12000 });
      else toast.success('Invited');
      onCreated();
      onClose();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <Modal
      open
      onClose={onClose}
      title="Invite member"
      footer={
        <>
          <button className="btn btn-ghost btn-sm" onClick={onClose}>Cancel</button>
          <button className="btn btn-primary btn-sm" disabled={!form.email || m.isPending} onClick={() => m.mutate()}>
            {m.isPending ? 'Inviting…' : 'Invite'}
          </button>
        </>
      }
    >
      <div className="space-y-3">
        <div>
          <label className="label">Email</label>
          <input className="input" value={form.email} onChange={(e) => setForm({ ...form, email: e.target.value })} />
        </div>
        <div>
          <label className="label">Name (optional)</label>
          <input className="input" value={form.name} onChange={(e) => setForm({ ...form, name: e.target.value })} />
        </div>
        <div>
          <label className="label">Role</label>
          <select className="input" value={form.role} onChange={(e) => setForm({ ...form, role: e.target.value })}>
            <option value="ADMIN">Admin</option>
            <option value="USER">User</option>
            <option value="VIEWER">Viewer</option>
          </select>
        </div>
        <div>
          <label className="label">Initial password (optional)</label>
          <input
            className="input"
            value={form.initialPassword}
            onChange={(e) => setForm({ ...form, initialPassword: e.target.value })}
            placeholder="Leave empty to auto-generate"
          />
        </div>
      </div>
    </Modal>
  );
}
