'use client';

import Link from 'next/link';
import { signOut } from 'next-auth/react';

export default function AuthToolbar({ user }) {
  return (
    <div className="auth-toolbar">
      <div className="auth-user">
        <span className="auth-avatar">
          {(user?.name || user?.email || 'U')
            .slice(0, 1)
            .toUpperCase()}
        </span>
        <span className="auth-user-copy">
          <strong>
            {user?.name || 'Usuario autorizado'}
          </strong>
          <small>{user?.email}</small>
        </span>
      </div>

      {user?.role === 'admin' && (
        <Link className="auth-link" href="/admin/accesos">
          Accesos
        </Link>
      )}

      <button
        type="button"
        className="auth-signout"
        onClick={() => signOut({ redirectTo: '/login' })}
      >
        Salir
      </button>
    </div>
  );
}
