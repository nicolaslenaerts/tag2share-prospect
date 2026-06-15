import type { Metadata } from "next";
import "./globals.css";

export const metadata: Metadata = {
  title: "Tag2Share - Prospection",
  description: "Trouver et contacter des business pour les objets connectés Tag2Share",
};

export default function RootLayout({
  children,
}: Readonly<{ children: React.ReactNode }>) {
  return (
    <html lang="fr">
      <body className="font-sans min-h-screen">{children}</body>
    </html>
  );
}
