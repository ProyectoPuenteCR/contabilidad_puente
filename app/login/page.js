import { redirect } from 'next/navigation';
import { auth } from '../../auth';
import { isAuthConfigured } from '../../lib/auth-config';
import LoginPanel from '../../components/login-panel';

export const dynamic = 'force-dynamic';

export default async function LoginPage({ searchParams }) {
  const configured = isAuthConfigured();

  if (configured) {
    const session = await auth();

    if (session?.user) {
      redirect('/');
    }
  }

  const params = await searchParams;

  return (
    <LoginPanel
      authConfigured={configured}
      initialError={params?.error || ''}
    />
  );
}
