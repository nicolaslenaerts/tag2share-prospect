"use client";
import { useState } from "react";
import { Segments } from "@/components/steps/Segments";
import { Search } from "@/components/steps/Search";
import { Prospects } from "@/components/steps/Prospects";
import { Campaign } from "@/components/steps/Campaign";
import { cn } from "@/components/ui";

const STEPS = [
  { n: 1, label: "Types de business", hint: "L'IA propose · vous validez" },
  { n: 2, label: "Recherche", hint: "Google Maps par pays" },
  { n: 3, label: "Prospects", hint: "Enrichir · email, contact, logo" },
  { n: 4, label: "Campagne email", hint: "Réviser · tester · envoyer" },
];

export default function Home() {
  const [step, setStep] = useState(1);

  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <header className="mb-8 flex items-center gap-3">
        <div className="flex h-10 w-10 items-center justify-center rounded-lg bg-brand text-white font-bold">
          T2
        </div>
        <div>
          <h1 className="text-xl font-bold text-gray-900">Tag2Share - Prospection</h1>
          <p className="text-sm text-gray-500">
            Trouver des business pour vos objets connectés (porte-clé, carte, présentoir)
          </p>
        </div>
      </header>

      <nav className="mb-8 grid grid-cols-2 gap-2 sm:grid-cols-4">
        {STEPS.map((s) => (
          <button
            key={s.n}
            onClick={() => setStep(s.n)}
            className={cn(
              "rounded-lg border p-3 text-left transition",
              step === s.n
                ? "border-brand bg-brand text-white"
                : "border-gray-200 bg-white hover:border-brand/50"
            )}
          >
            <div className="text-xs font-semibold opacity-70">Étape {s.n}</div>
            <div className="text-sm font-bold">{s.label}</div>
            <div className={cn("text-xs", step === s.n ? "opacity-80" : "text-gray-400")}>
              {s.hint}
            </div>
          </button>
        ))}
      </nav>

      <main>
        {step === 1 && <Segments onNext={() => setStep(2)} />}
        {step === 2 && <Search onNext={() => setStep(3)} />}
        {step === 3 && <Prospects onNext={() => setStep(4)} />}
        {step === 4 && <Campaign />}
      </main>
    </div>
  );
}
