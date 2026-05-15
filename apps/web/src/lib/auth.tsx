import { createContext, useCallback, useContext, useEffect, useState } from 'react';
import { api, getToken, getWorkspaceId, setToken, setWorkspaceId } from './api';

export type Workspace = { id: string; slug: string; name: string; role?: string; plan?: string };
export type User = { id: string; email: string; name?: string | null; avatarUrl?: string | null };

type AuthState = {
  user: User | null;
  workspace: Workspace | null;
  workspaces: Workspace[];
  loading: boolean;
};

type AuthApi = AuthState & {
  signIn: (email: string, password: string) => Promise<void>;
  signUp: (params: { email: string; password: string; name?: string; workspaceName?: string }) => Promise<void>;
  signOut: () => void;
  switchWorkspace: (id: string) => void;
  refresh: () => Promise<void>;
};

const AuthContext = createContext<AuthApi | null>(null);

export function AuthProvider({ children }: { children: React.ReactNode }) {
  const [state, setState] = useState<AuthState>({
    user: null,
    workspace: null,
    workspaces: [],
    loading: true,
  });

  const refresh = useCallback(async () => {
    if (!getToken()) {
      setState({ user: null, workspace: null, workspaces: [], loading: false });
      return;
    }
    try {
      const data = await api<{ user: User; workspaces: Workspace[] }>('/api/me');
      const activeId = getWorkspaceId();
      const active =
        data.workspaces.find((w) => w.id === activeId) ?? data.workspaces[0] ?? null;
      if (active) setWorkspaceId(active.id);
      setState({ user: data.user, workspace: active, workspaces: data.workspaces, loading: false });
    } catch {
      setToken(null);
      setWorkspaceId(null);
      setState({ user: null, workspace: null, workspaces: [], loading: false });
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const signIn = useCallback(async (email: string, password: string) => {
    const res = await api<{ token: string; user: User; workspace: Workspace | null }>(
      '/api/auth/sign-in',
      { method: 'POST', json: { email, password } },
    );
    setToken(res.token);
    if (res.workspace) setWorkspaceId(res.workspace.id);
    await refresh();
  }, [refresh]);

  const signUp = useCallback(
    async (params: { email: string; password: string; name?: string; workspaceName?: string }) => {
      const res = await api<{ token: string; user: User; workspace: Workspace }>('/api/auth/sign-up', {
        method: 'POST',
        json: params,
      });
      setToken(res.token);
      setWorkspaceId(res.workspace.id);
      await refresh();
    },
    [refresh],
  );

  const signOut = useCallback(() => {
    setToken(null);
    setWorkspaceId(null);
    setState({ user: null, workspace: null, workspaces: [], loading: false });
  }, []);

  const switchWorkspace = useCallback(
    (id: string) => {
      setWorkspaceId(id);
      refresh();
    },
    [refresh],
  );

  return (
    <AuthContext.Provider value={{ ...state, signIn, signUp, signOut, switchWorkspace, refresh }}>
      {children}
    </AuthContext.Provider>
  );
}

export function useAuth() {
  const ctx = useContext(AuthContext);
  if (!ctx) throw new Error('useAuth must be inside AuthProvider');
  return ctx;
}
