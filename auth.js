import NextAuth from 'next-auth';
import Google from 'next-auth/providers/google';
import Credentials from 'next-auth/providers/credentials';
import { getAdminEmail, isAuthConfigured } from './lib/auth-config';
import {
  isAllowedGoogleEmail,
  normalizeEmail,
  verifyEmergencyCode,
} from './lib/access-store';

const providers = [];

if (process.env.AUTH_GOOGLE_ID && process.env.AUTH_GOOGLE_SECRET) {
  providers.push(Google);
}

providers.push(
  Credentials({
    id: 'emergency',
    name: 'Código de emergencia',
    credentials: {
      code: {
        label: 'Código de emergencia',
        type: 'password',
      },
    },
    async authorize(credentials, request) {
      const valid = await verifyEmergencyCode(credentials?.code, request);
      if (!valid) return null;

      const email = getAdminEmail();

      return {
        id: 'emergency-admin',
        email,
        name: 'Administrador Proyecto Puente',
      };
    },
  })
);

export const {
  handlers,
  auth,
  signIn,
  signOut,
} = NextAuth({
  secret:
    process.env.AUTH_SECRET ||
    'setup-mode-only-change-this-before-enabling-auth',
  trustHost: true,
  session: {
    strategy: 'jwt',
    maxAge: 12 * 60 * 60,
  },
  pages: {
    signIn: '/login',
    error: '/login',
  },
  providers,
  callbacks: {
    async signIn({ user, account, profile }) {
      if (account?.provider === 'emergency') {
        return normalizeEmail(user?.email) === getAdminEmail();
      }

      if (account?.provider === 'google') {
        if (profile?.email_verified !== true) return false;
        return isAllowedGoogleEmail(user?.email);
      }

      return false;
    },
    async jwt({ token, user, account }) {
      if (user?.email) {
        token.email = normalizeEmail(user.email);
        token.role =
          normalizeEmail(user.email) === getAdminEmail()
            ? 'admin'
            : 'user';
      }

      if (account?.provider) {
        token.authMethod = account.provider;
      }

      return token;
    },
    async session({ session, token }) {
      if (session?.user) {
        session.user.email = token.email || session.user.email;
        session.user.role = token.role || 'user';
        session.user.authMethod = token.authMethod || 'google';
      }

      return session;
    },
  },
});

export { isAuthConfigured };
