import Link from 'next/link';
import { redirect } from 'next/navigation';
import { auth } from '../../../auth';
import { isAuthConfigured } from '../../../lib/auth-config';
import PlatformUsage from '../../../components/platform-usage';

export const dynamic = 'force-dynamic';

export default async function PlatformUsagePage() {
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
    <main className="admin-page platform-usage-admin">
      <header className="admin-head">
        <div>
          <Link href="/" className="back-link">
            ← Volver a Contabilidad
          </Link>
          <h1>Uso de plataforma</h1>
          <p>
            Accesos, actividad y capacidad de la base de datos.
            Vista exclusiva para administradores.
          </p>
        </div>

        <div className="admin-identity">
          <strong>{session.user.name}</strong>
          <span>{session.user.email}</span>
        </div>
      </header>

      <PlatformUsage />
    </main>
  );
}
