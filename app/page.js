import { redirect } from 'next/navigation';
import { auth } from '../auth';
import { isAuthConfigured } from '../lib/auth-config';
import AccountingApp from '../components/accounting-app';

export const dynamic = 'force-dynamic';

export default async function Home() {
  const configured = isAuthConfigured();

  if (!configured) {
    return (
      <>
        <div className="setup-mode-banner">
          <strong>Modo de instalación</strong>
          <span>
            La autenticación todavía no está activa. Configure Google
            OAuth y AUTH_SECRET en Vercel para proteger el sistema.
          </span>
        </div>
        <AccountingApp />
      </>
    );
  }

  const session = await auth();

  if (!session?.user) {
    redirect('/login');
  }

  return <AccountingApp user={session.user} />;
}
