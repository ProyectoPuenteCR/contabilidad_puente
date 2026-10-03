import './globals.css';

export const metadata = {
  title: 'Contabilidad | Proyecto Puente',
  description: 'Sistema de gestión contable de Proyecto Puente',
};

export default function RootLayout({ children }) {
  return (
    <html lang="es">
      <body>{children}</body>
    </html>
  );
}
