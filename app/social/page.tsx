import { Suspense } from "react";
import { AppHeader } from "@/components/AppHeader";
import { SocialPlanner } from "@/components/social/SocialPlanner";

export const metadata = { title: "Réseaux sociaux" };

export default function SocialPage() {
  return (
    <div className="mx-auto max-w-7xl px-4 py-8">
      <AppHeader subtitle="Réseaux sociaux · programmation via Buffer" links={[{ href: "/", label: "← Prospection" }]} />
      {/* useSearchParams (lien « Ouvrir le post » des emails) exige une frontière Suspense. */}
      <Suspense>
        <SocialPlanner />
      </Suspense>
    </div>
  );
}
