export const DEFAULT_ADMIN_EMAIL = 'brechasdigitales@proyecto-puente.org';

export function getAdminEmail() {
  return String(process.env.AUTH_ADMIN_EMAIL || DEFAULT_ADMIN_EMAIL)
    .trim()
    .toLowerCase();
}

export function isAuthConfigured() {
  return Boolean(
    process.env.AUTH_SECRET &&
    process.env.AUTH_GOOGLE_ID &&
    process.env.AUTH_GOOGLE_SECRET
  );
}
