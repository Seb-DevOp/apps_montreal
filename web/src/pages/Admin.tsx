/**
 * Console d'administration : rôles des invités et suivi des quotas Free Tier.
 */
import { useCallback, useEffect, useState } from 'react';
import { api } from '../lib/api';
import { useAuth } from '../contexts/AuthContext';

interface ManagedUser {
  uid: string;
  email: string | null;
  displayName: string | null;
  photoURL: string | null;
  role: 'admin' | 'guest' | 'blocked';
  lastSignIn: string | null;
}

interface Usage {
  storage: { files: number; totalMB: number; freeTierMB: number };
  documents: { posts: number; tasks: number; spots: number };
}

export function Admin(): JSX.Element {
  const { user } = useAuth();
  const [users, setUsers] = useState<ManagedUser[]>([]);
  const [usage, setUsage] = useState<Usage | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      const [userList, usageStats] = await Promise.all([
        api.get<{ users: ManagedUser[] }>('/admin/users'),
        api.get<Usage>('/admin/usage'),
      ]);
      setUsers(userList.users);
      setUsage(usageStats);
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Chargement impossible.');
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const setRole = async (uid: string, role: ManagedUser['role']) => {
    setBusy(uid);
    try {
      await api.post('/admin/role', { uid, role });
      setUsers((list) => list.map((u) => (u.uid === uid ? { ...u, role } : u)));
    } catch (caught) {
      setError(caught instanceof Error ? caught.message : 'Modification impossible.');
    } finally {
      setBusy(null);
    }
  };

  const storagePct = usage ? Math.round((usage.storage.totalMB / usage.storage.freeTierMB) * 100) : 0;

  return (
    <div className="space-y-4">
      {error && <p className="rounded-xl bg-maple/15 p-3 text-sm text-maple">{error}</p>}

      {usage && (
        <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
          <h3 className="text-xs uppercase tracking-wider text-frost/50">Quotas Free Tier</h3>

          <div className="mt-3 text-sm text-frost/70">
            Cloud Storage : {usage.storage.totalMB} Mo / {usage.storage.freeTierMB} Mo (
            {usage.storage.files} fichiers)
          </div>
          <div className="mt-1.5 h-2 overflow-hidden rounded-full bg-black/30">
            <div
              className={`h-full transition-all ${storagePct > 80 ? 'bg-maple' : 'bg-mint'}`}
              style={{ width: `${Math.min(100, storagePct)}%` }}
            />
          </div>

          <div className="mt-3 grid grid-cols-3 gap-2 text-center text-xs">
            {(
              [
                ['Photos', usage.documents.posts],
                ['Tâches', usage.documents.tasks],
                ['Spots', usage.documents.spots],
              ] as const
            ).map(([label, count]) => (
              <div key={label} className="rounded-xl bg-black/20 p-2">
                <div className="font-mono text-lg text-frost">{count}</div>
                <div className="text-frost/40">{label}</div>
              </div>
            ))}
          </div>
        </div>
      )}

      <div className="rounded-2xl border border-white/10 bg-white/5 p-4">
        <h3 className="text-xs uppercase tracking-wider text-frost/50">Comptes ({users.length})</h3>

        <ul className="mt-2 divide-y divide-white/5">
          {users.map((managed) => (
            <li key={managed.uid} className="flex items-center gap-3 py-3">
              {managed.photoURL ? (
                <img src={managed.photoURL} alt="" className="h-9 w-9 rounded-full" />
              ) : (
                <div className="flex h-9 w-9 items-center justify-center rounded-full bg-white/10 text-sm">
                  {(managed.displayName ?? managed.email ?? '?').charAt(0).toUpperCase()}
                </div>
              )}

              <div className="min-w-0 flex-1">
                <p className="truncate text-sm text-frost">{managed.displayName ?? managed.email}</p>
                <p className="truncate text-[11px] text-frost/40">
                  {managed.email}
                  {managed.lastSignIn &&
                    ` · vu le ${new Date(managed.lastSignIn).toLocaleDateString('fr-FR')}`}
                </p>
              </div>

              <select
                value={managed.role}
                disabled={busy === managed.uid || managed.uid === user?.uid}
                onChange={(event) => void setRole(managed.uid, event.target.value as ManagedUser['role'])}
                className="rounded-lg bg-black/30 px-2 py-1.5 text-xs text-frost outline-none disabled:opacity-40"
              >
                <option value="guest">Invité</option>
                <option value="admin">Admin</option>
                <option value="blocked">Bloqué</option>
              </select>
            </li>
          ))}
        </ul>

        <p className="mt-3 text-[11px] leading-relaxed text-frost/35">
          Un changement de rôle révoque les jetons existants : la personne concernée sera reconnectée
          avec ses nouveaux droits à sa prochaine action.
        </p>
      </div>
    </div>
  );
}
