import { Suppressions } from "@/components/Suppressions";

export const metadata = { title: "Liste de suppression - Tag2Share" };

export default function SuppressionsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand font-bold text-white">
          T2
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Tag2Share - Prospection</h1>
          <p className="text-sm text-gray-500">Liste de suppression</p>
        </div>
      </header>
      <Suppressions />
    </div>
  );
}
