import { Suppressions } from "@/components/Suppressions";
import { AppHeader } from "@/components/AppHeader";

export const metadata = { title: "Liste de suppression" };

export default function SuppressionsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <AppHeader
        subtitle="Liste de suppression"
        links={[{ href: "/", label: "← Prospection" }]}
      />
      <Suppressions />
    </div>
  );
}
