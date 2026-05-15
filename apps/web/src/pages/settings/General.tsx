import { useState } from 'react';
import toast from 'react-hot-toast';
import { useMutation } from '@tanstack/react-query';
import { useAuth } from '@/lib/auth';
import { api } from '@/lib/api';

export default function GeneralSettings() {
  const { workspace, refresh } = useAuth();
  const [name, setName] = useState(workspace?.name ?? '');

  const save = useMutation({
    mutationFn: () =>
      api(`/api/workspaces/${workspace!.id}`, { method: 'PATCH', json: { name } }),
    onSuccess: () => {
      toast.success('Saved');
      refresh();
    },
    onError: (e: any) => toast.error(e.message),
  });

  return (
    <div className="card card-pad space-y-4">
      <div>
        <h2 className="text-[16px] font-semibold">Workspace</h2>
        <p className="text-[12.5px] text-ink-3">Workspace-wide settings visible to all members.</p>
      </div>
      <div>
        <label className="label">Workspace name</label>
        <input className="input" style={{ maxWidth: 360 }} value={name} onChange={(e) => setName(e.target.value)} />
      </div>
      <div>
        <label className="label">Workspace slug</label>
        <div className="mono rounded-sm border bg-surface-2 px-3 py-2 text-[12.5px]" style={{ borderColor: 'var(--border)', maxWidth: 360 }}>
          {workspace?.slug}
        </div>
      </div>
      <div>
        <label className="label">Plan</label>
        <div className="text-[13px]">{workspace?.plan ?? 'FREE'}</div>
      </div>
      <div className="pt-2">
        <button className="btn btn-primary btn-sm" onClick={() => save.mutate()} disabled={!name || save.isPending}>
          {save.isPending ? 'Saving…' : 'Save changes'}
        </button>
      </div>
    </div>
  );
}
