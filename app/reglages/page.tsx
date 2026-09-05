import { BrandSettings } from "@/components/BrandSettings";
import { AppHeader } from "@/components/AppHeader";

export const metadata = { title: "Réglages de la marque" };

export default function ReglagesPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <AppHeader
        subtitle="Réglages de la marque"
        links={[
          { href: "/marques", label: "Marques" },
          { href: "/", label: "← Prospection" },
        ]}
      />
      <BrandSettings />
    </div>
  );
}
