'use client';

import Link from 'next/link';
import { signOut } from 'next-auth/react';

export default function AuthToolbar({ user }) {
  if (!user) return null;

  return (
    <div className="sidebar-auth">
      <div className="sidebar-auth-user">
        <span className="sidebar-auth-avatar">
          {(user?.name || user?.email || 'U')
            .slice(0, 1)
            .toUpperCase()}
        </span>

        <span className="sidebar-auth-copy">
          <strong>{user?.name || 'Usuario autorizado'}</strong>
          <small title={user?.email}>{user?.email}</small>
        </span>
      </div>

      <div className="sidebar-auth-actions">
        {user?.role === 'admin' && (
          <Link className="sidebar-auth-link" href="/admin/accesos">
            Accesos
          </Link>
        )}

        <button
          type="button"
          className="sidebar-auth-signout"
          onClick={() => signOut({ redirectTo: '/login' })}
        >
          Salir
        </button>
      </div>
    </div>
  );
}
