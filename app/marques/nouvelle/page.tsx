import { AppHeader } from "@/components/AppHeader";
import { BrandEditor } from "@/components/BrandEditor";

export const metadata = { title: "Nouvelle marque" };

/**
 * Segment statique déclaré AVANT [slug] : Next.js lui donne la priorité, donc
 * « nouvelle » ne peut pas être confondu avec un slug de marque. Le slug est
 * par ailleurs réservé côté serveur (lib/brands/store.ts).
 */
export default function NouvelleMarquePage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <AppHeader subtitle="Nouvelle marque" links={[{ href: "/marques", label: "← Marques" }]} />
      <BrandEditor />
    </div>
  );
}
