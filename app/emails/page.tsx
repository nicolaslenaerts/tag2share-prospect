import { EmailLog } from "@/components/EmailLog";
import { AppHeader } from "@/components/AppHeader";

export const metadata = { title: "Emails envoyés" };

export default function EmailsPage() {
  return (
    <div className="mx-auto max-w-6xl px-4 py-8">
      <AppHeader subtitle="Emails envoyés" links={[{ href: "/", label: "← Prospection" }]} />
      <EmailLog />
    </div>
  );
}
