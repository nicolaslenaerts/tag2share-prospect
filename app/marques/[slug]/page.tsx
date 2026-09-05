import { AppHeader } from "@/components/AppHeader";
import { BrandEditor } from "@/components/BrandEditor";

export const metadata = { title: "Modifier la marque" };

export default async function MarquePage({
  params,
}: {
  params: Promise<{ slug: string }>;
}) {
  const { slug } = await params;
  return (
    <div className="mx-auto max-w-4xl px-4 py-8">
      <AppHeader subtitle={`Marque : ${slug}`} links={[{ href: "/marques", label: "← Marques" }]} />
      <BrandEditor slug={slug} />
    </div>
  );
}
