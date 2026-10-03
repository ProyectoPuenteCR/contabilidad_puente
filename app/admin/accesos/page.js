import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '../../../auth';
import { isAuthConfigured } from '../../../lib/auth-config';
import AccessManager from '../../../components/access-manager';

export const dynamic = 'force-dynamic';

export default async function AccessPage() {
  if (!isAuthConfigured()) {
    redirect('/');
  }

  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  if (session.user.role !== 'admin') {
    redirect('/');
  }

  return (
    <main className="admin-page">
      <header className="admin-head">
        <div>
          <Link href="/" className="back-link">
            ← Volver a Contabilidad
          </Link>
          <h1>Seguridad y accesos</h1>
          <p>
            Administrá las cuentas de Google habilitadas y los
            mecanismos de recuperación.
          </p>
        </div>

        <div className="admin-identity">
          <strong>{session.user.name}</strong>
          <span>{session.user.email}</span>
        </div>
      </header>

      <AccessManager />
    </main>
  );
}
