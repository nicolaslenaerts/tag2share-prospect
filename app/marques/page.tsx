import { AppHeader } from "@/components/AppHeader";
import { BrandList } from "@/components/BrandList";

export const metadata = { title: "Marques" };

export default function MarquesPage() {
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <AppHeader
        subtitle="Marques"
        links={[
          { href: "/", label: "← Prospection" },
        ]}
      />
      <BrandList />
    </div>
  );
}
