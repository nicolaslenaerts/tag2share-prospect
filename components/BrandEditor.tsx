"use client";
import { useEffect, useMemo, useState } from "react";
import { useRouter } from "next/navigation";
import { api } from "@/lib/api";
import { Badge, Button, Card, Input, Spinner, Textarea } from "@/components/ui";
import { hexToRgb, rgbToHex, slugify, type FieldError } from "@/lib/brands/schema";
import type { BrandConfig } from "@/lib/brands/types";

/* ------------------------------------------------------------------ */
/* Forme du formulaire                                                 */
/* ------------------------------------------------------------------ */

/**
 * Le formulaire travaille sur des CHAÎNES, pas sur un BrandConfig.
 *
 * Un champ en cours de saisie passe forcément par des états invalides - une
 * liste de domaines à moitié tapée, un nombre vide - et forcer la forme finale
 * à chaque frappe reviendrait à corriger l'utilisateur pendant qu'il écrit. La
 * conversion se fait une fois, à l'enregistrement, et c'est le serveur qui
 * tranche (lib/brands/schema.ts) : une seule règle, pas deux à tenir d'accord.
 */
type ProductForm = {
  key: string;
  name: string;
  uiLabel: string;
  price: string;
  shopUrl: string;
  configUrl: string;
  description: string;
  pitch: string;
  aliases: string;
};

type SocialForm = { label: string; url: string };

type Form = {
  slug: string;
  name: string;
  tagline: string;
  domains: string;
  appUrl: string;
  shopUrl: string;
  colorHex: string;
  textColorHex: string;
  onBrandHex: string;
  logoUrl: string;
  logoAlt: string;
  logoWidth: string;
  monogram: string;
  layout: "classic" | "minimal";
  socials: SocialForm[];
  showProductsMore: boolean;
  fromName: string;
  from: string;
  replyTo: string;
  testEmail: string;
  identityName: string;
  identityAddress: string;
  identityContact: string;
  dailyCap: string;
  delayMs: string;
  subject: string;
  bodyTagline: string;
  body: string;
  products: ProductForm[];
  defaultProductKey: string;
  positioning: string;
  signature: string;
  forbidden: string;
};

const emptyProduct = (): ProductForm => ({
  key: "",
  name: "",
  uiLabel: "",
  price: "",
  shopUrl: "",
  configUrl: "",
  description: "",
  pitch: "",
  aliases: "",
});

/** Corps d'email de départ : les tokens de fusion sont déjà en place. */
const STARTER_BODY = `<p>Bonjour {{contact_name}},</p>

<p>Une phrase montrant que vous connaissez {{name}} et son contexte à {{city}}.</p>

<p>Pour {{name}}, je recommande le <strong>{{product_name}}</strong>.</p>

<p><a href="{{product_url}}">Découvrir {{product_name}}</a></p>

{{products_more}}

<p style="margin-top:24px;">Bien à vous,<br/><strong>Votre signature</strong></p>`;

const blankForm = (): Form => ({
  slug: "",
  name: "",
  tagline: "",
  domains: "",
  appUrl: "",
  shopUrl: "",
  colorHex: "#144a66",
  textColorHex: "",
  onBrandHex: "",
  logoUrl: "",
  logoAlt: "",
  logoWidth: "140",
  monogram: "",
  layout: "classic",
  socials: [],
  showProductsMore: true,
  fromName: "",
  from: "",
  replyTo: "",
  testEmail: "",
  identityName: "",
  identityAddress: "",
  identityContact: "",
  dailyCap: "20",
  delayMs: "1500",
  subject: "{{name}} : accroche courte",
  bodyTagline: "",
  body: STARTER_BODY,
  products: [emptyProduct()],
  defaultProductKey: "",
  positioning: "",
  signature: "",
  forbidden: "",
});

const lines = (v: string): string[] =>
  v
    .split(/[\n,]/)
    .map((s) => s.trim())
    .filter(Boolean);

/** BrandConfig existant → état de formulaire. */
function toForm(b: BrandConfig): Form {
  return {
    slug: b.slug,
    name: b.name,
    tagline: b.tagline ?? "",
    domains: (b.domains ?? []).join("\n"),
    appUrl: b.appUrl ?? "",
    shopUrl: b.shopUrl,
    colorHex: rgbToHex(b.theme.rgb),
    textColorHex: b.theme.textRgb ? rgbToHex(b.theme.textRgb) : "",
    onBrandHex: b.theme.onBrandHex ?? "",
    logoUrl: b.theme.logoUrl,
    logoAlt: b.theme.logoAlt,
    logoWidth: String(b.theme.logoWidth),
    monogram: b.theme.monogram,
    layout: b.email.layout,
    socials: (b.email.socials ?? []).map((s) => ({ label: s.label, url: s.url })),
    showProductsMore: b.email.showProductsMore !== false,
    fromName: b.sender.fromName ?? "",
    from: b.sender.from,
    replyTo: b.sender.replyTo,
    testEmail: b.sender.testEmail ?? "",
    identityName: b.sender.identity.name,
    identityAddress: b.sender.identity.address ?? "",
    identityContact: b.sender.identity.contact,
    dailyCap: String(b.sender.dailyCap),
    delayMs: String(b.sender.delayMs),
    subject: b.defaults.subject,
    bodyTagline: b.defaults.tagline ?? "",
    body: b.defaults.body,
    products: b.products.map((p) => ({
      key: p.key,
      name: p.name,
      uiLabel: p.uiLabel ?? "",
      price: p.price ?? "",
      shopUrl: p.shopUrl,
      configUrl: p.configUrl,
      description: p.description,
      pitch: p.pitch,
      aliases: (p.aliases ?? []).join(", "),
    })),
    defaultProductKey: b.defaultProductKey ?? "",
    positioning: b.ai.positioning,
    signature: b.ai.signature,
    forbidden: (b.ai.forbidden ?? []).join("\n"),
  };
}

/**
 * État de formulaire → charge utile JSON. Volontairement permissif : on
 * transmet ce qui a été saisi sans le corriger, et la validation autoritaire
 * a lieu côté serveur.
 */
function toPayload(f: Form): Record<string, unknown> {
  return {
    slug: f.slug,
    name: f.name,
    tagline: f.tagline,
    domains: lines(f.domains),
    appUrl: f.appUrl,
    shopUrl: f.shopUrl,
    theme: {
      rgb: f.colorHex,
      textRgb: f.textColorHex || undefined,
      onBrandHex: f.onBrandHex || undefined,
      logoUrl: f.logoUrl,
      logoAlt: f.logoAlt,
      logoWidth: Number(f.logoWidth),
      monogram: f.monogram,
    },
    email: {
      layout: f.layout,
      socials: f.socials,
      showProductsMore: f.showProductsMore,
    },
    sender: {
      fromName: f.fromName,
      from: f.from,
      replyTo: f.replyTo,
      testEmail: f.testEmail,
      identity: {
        name: f.identityName,
        address: f.identityAddress,
        contact: f.identityContact,
      },
      dailyCap: Number(f.dailyCap),
      delayMs: Number(f.delayMs),
    },
    defaults: { subject: f.subject, tagline: f.bodyTagline, body: f.body },
    products: f.products.map((p) => ({
      key: p.key,
      name: p.name,
      uiLabel: p.uiLabel,
      price: p.price,
      shopUrl: p.shopUrl,
      configUrl: p.configUrl,
      description: p.description,
      pitch: p.pitch,
      aliases: lines(p.aliases),
    })),
    defaultProductKey: f.defaultProductKey,
    ai: {
      positioning: f.positioning,
      signature: f.signature,
      forbidden: lines(f.forbidden),
    },
  };
}

/* ------------------------------------------------------------------ */
/* Briques d'affichage                                                 */
/* ------------------------------------------------------------------ */

function Section({
  title,
  hint,
  children,
  open,
}: {
  title: string;
  hint?: string;
  children: React.ReactNode;
  open?: boolean;
}) {
  return (
    <Card className="overflow-hidden">
      <details open={open}>
        <summary className="cursor-pointer list-none px-5 py-4 font-bold text-gray-900 marker:content-['']">
          {title}
          {hint && <span className="ml-2 text-xs font-normal text-gray-400">{hint}</span>}
        </summary>
        <div className="space-y-4 border-t border-gray-100 px-5 py-4">{children}</div>
      </details>
    </Card>
  );
}

function Field({
  label,
  hint,
  error,
  children,
}: {
  label: string;
  hint?: string;
  error?: string;
  children: React.ReactNode;
}) {
  return (
    <label className="block text-sm">
      <span className="mb-1 block font-medium text-gray-600">{label}</span>
      {children}
      {error ? (
        <span className="mt-1 block text-[11px] text-red-600">{error}</span>
      ) : (
        hint && <span className="mt-1 block text-[11px] text-gray-400">{hint}</span>
      )}
    </label>
  );
}

/* ------------------------------------------------------------------ */
/* Éditeur                                                             */
/* ------------------------------------------------------------------ */

type Loaded = {
  slug: string;
  editable: boolean;
  active: boolean;
  config: BrandConfig;
  usage: Record<string, number>;
  readiness: { ok: boolean; blockers: string[]; warnings: string[] } | null;
  webhookUrl: string | null;
};

/**
 * Création (slug absent) et édition d'une marque.
 *
 * Les marques déclarées en code sont affichées en LECTURE SEULE : les rendre
 * modifiables ici donnerait deux sources de vérité pour une même marque, dont
 * une invisible en revue de code.
 */
export function BrandEditor({ slug }: { slug?: string }) {
  const router = useRouter();
  const creating = !slug;

  const [form, setForm] = useState<Form>(blankForm);
  const [loaded, setLoaded] = useState<Loaded | null>(null);
  const [errors, setErrors] = useState<FieldError[]>([]);
  const [message, setMessage] = useState("");
  const [error, setError] = useState("");
  const [busy, setBusy] = useState(false);
  const [ready, setReady] = useState(creating);

  const set = <K extends keyof Form>(key: K, value: Form[K]) =>
    setForm((f) => ({ ...f, [key]: value }));

  const errorFor = useMemo(() => {
    const map = new Map<string, string>();
    for (const e of errors) if (!map.has(e.path)) map.set(e.path, e.message);
    return (path: string) => map.get(path);
  }, [errors]);

  useEffect(() => {
    if (creating) return;
    (async () => {
      try {
        const r = await api<Loaded>(`/api/brands/${slug}`);
        setLoaded(r);
        setForm(toForm(r.config));
      } catch (e) {
        setError((e as Error).message);
      } finally {
        setReady(true);
      }
    })();
  }, [slug, creating]);

  const readOnly = !creating && loaded !== null && !loaded.editable;

  async function save() {
    setBusy(true);
    setErrors([]);
    setMessage("");
    setError("");
    try {
      if (creating) {
        await api("/api/brands", { method: "POST", json: toPayload(form) });
        router.push(`/marques/${form.slug}`);
        return;
      }
      const r = await api<Loaded>(`/api/brands/${slug}`, {
        method: "PATCH",
        json: { config: toPayload(form) },
      });
      setLoaded((prev) => (prev ? { ...prev, ...r } : prev));
      setMessage("Marque enregistrée.");
    } catch (e) {
      // L'API renvoie les erreurs de champ agrégées dans son message ; on les
      // réaffiche telles quelles plutôt que de tenter de les redécouper.
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function toggleActive() {
    if (!loaded) return;
    setBusy(true);
    setError("");
    setMessage("");
    try {
      const r = await api<Loaded>(`/api/brands/${slug}`, {
        method: "PATCH",
        json: { active: !loaded.active },
      });
      setLoaded((prev) => (prev ? { ...prev, ...r } : prev));
      setMessage(r.active ? "Marque activée : les envois réels sont autorisés." : "Marque repassée en brouillon.");
    } catch (e) {
      setError((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  async function remove() {
    if (!confirm(`Supprimer définitivement la marque « ${form.name || slug} » ?`)) return;
    setBusy(true);
    setError("");
    try {
      await api(`/api/brands/${slug}`, { method: "DELETE" });
      router.push("/marques");
    } catch (e) {
      setError((e as Error).message);
      setBusy(false);
    }
  }

  if (!ready) {
    return <Card className="p-5">{error ? <p className="text-sm text-red-600">{error}</p> : <Spinner />}</Card>;
  }

  const disabled = readOnly || busy;

  return (
    <div className="space-y-4">
      {readOnly && (
        <Card className="border-amber-200 bg-amber-50 p-4 text-sm text-amber-800">
          Cette marque est déclarée dans le code (<code>lib/brands/{slug}.ts</code>). Elle est
          affichée ici en lecture seule : la modifier passe par le dépôt, pour qu&apos;elle reste
          versionnée et relue.
        </Card>
      )}

      {loaded && !readOnly && (
        <Card className="p-5">
          <div className="flex flex-wrap items-center gap-3">
            <h2 className="font-bold">
              {loaded.active ? "Envois réels autorisés" : "Marque en brouillon"}
            </h2>
            {loaded.active ? <Badge color="green">active</Badge> : <Badge color="amber">brouillon</Badge>}
            <Button
              className="ml-auto"
              variant={loaded.active ? "outline" : "primary"}
              onClick={toggleActive}
              disabled={busy || (!loaded.active && !(loaded.readiness?.ok ?? false))}
            >
              {busy ? <Spinner /> : loaded.active ? "Repasser en brouillon" : "Activer"}
            </Button>
          </div>
          <p className="mt-2 text-sm text-gray-500">
            En brouillon, tout fonctionne sauf l&apos;envoi à de vrais prospects : segments,
            rédaction par l&apos;IA et emails de test restent disponibles.
          </p>

          {loaded.readiness && loaded.readiness.blockers.length > 0 && (
            <ul className="mt-3 space-y-1 text-sm text-amber-700">
              {loaded.readiness.blockers.map((b) => (
                <li key={b}>· {b}</li>
              ))}
            </ul>
          )}
          {loaded.readiness && loaded.readiness.warnings.length > 0 && (
            <ul className="mt-3 space-y-1 text-xs text-gray-500">
              {loaded.readiness.warnings.map((w) => (
                <li key={w}>· {w}</li>
              ))}
            </ul>
          )}
          {loaded.webhookUrl && (
            <p className="mt-3 text-[11px] text-gray-400">
              Webhook à déclarer chez Resend : <code>{loaded.webhookUrl}</code>
            </p>
          )}
        </Card>
      )}

      <Section title="Identité" open>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom de la marque" error={errorFor("name")}>
            <Input
              value={form.name}
              disabled={disabled}
              onChange={(e) => {
                const name = e.target.value;
                setForm((f) => ({
                  ...f,
                  name,
                  // Le slug se déduit du nom tant qu'on crée et qu'il n'a pas
                  // été touché à la main. En édition il est figé : il est
                  // recopié dans toutes les données de la marque.
                  slug: creating && (f.slug === slugify(f.name) || !f.slug) ? slugify(name) : f.slug,
                  monogram: f.monogram || name.slice(0, 2).toUpperCase(),
                }));
              }}
              placeholder="Ma Nouvelle Marque"
            />
          </Field>
          <Field
            label="Identifiant (slug)"
            hint={
              creating
                ? "Minuscules, chiffres et tirets. Définitif : il est recopié dans les segments, campagnes et journaux d'envoi."
                : "Définitif : il est recopié dans les segments, campagnes et liens de désinscription déjà envoyés."
            }
            error={errorFor("slug")}
          >
            <Input
              value={form.slug}
              disabled={disabled || !creating}
              onChange={(e) => set("slug", slugify(e.target.value))}
              placeholder="ma-nouvelle-marque"
            />
          </Field>
          <Field label="Accroche de l'interface" hint="Sous-titre affiché sous le titre de l'app.">
            <Input
              value={form.tagline}
              disabled={disabled}
              onChange={(e) => set("tagline", e.target.value)}
              placeholder="Trouver des business pour la gamme..."
            />
          </Field>
          <Field label="Monogramme" hint="2 à 3 caractères, affichés dans l'en-tête." error={errorFor("theme.monogram")}>
            <Input
              value={form.monogram}
              disabled={disabled}
              maxLength={3}
              onChange={(e) => set("monogram", e.target.value.toUpperCase())}
              placeholder="MN"
            />
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-3">
          <Field label="Couleur de signature" hint="Boutons, bandeaux, filets." error={errorFor("theme.rgb")}>
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={hexToRgb(form.colorHex) ? form.colorHex : "#144a66"}
                disabled={disabled}
                onChange={(e) => set("colorHex", e.target.value)}
                className="h-9 w-12 shrink-0 cursor-pointer rounded border border-gray-300"
              />
              <Input value={form.colorHex} disabled={disabled} onChange={(e) => set("colorHex", e.target.value)} />
            </div>
          </Field>
          <Field
            label="Couleur du texte"
            hint="Obligatoire pour une marque claire : sa couleur de signature serait illisible en texte sur blanc."
            error={errorFor("theme.textRgb")}
          >
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={hexToRgb(form.textColorHex) ? form.textColorHex : form.colorHex}
                disabled={disabled}
                onChange={(e) => set("textColorHex", e.target.value)}
                className="h-9 w-12 shrink-0 cursor-pointer rounded border border-gray-300"
              />
              <Input
                value={form.textColorHex}
                disabled={disabled}
                onChange={(e) => set("textColorHex", e.target.value)}
                placeholder="(même que la signature)"
              />
            </div>
          </Field>
          <Field
            label="Texte posé sur la couleur"
            hint="Libellé de bouton. Blanc par défaut."
            error={errorFor("theme.onBrandHex")}
          >
            <div className="flex items-center gap-2">
              <input
                type="color"
                value={hexToRgb(form.onBrandHex) ? form.onBrandHex : "#ffffff"}
                disabled={disabled}
                onChange={(e) => set("onBrandHex", e.target.value)}
                className="h-9 w-12 shrink-0 cursor-pointer rounded border border-gray-300"
              />
              <Input
                value={form.onBrandHex}
                disabled={disabled}
                onChange={(e) => set("onBrandHex", e.target.value)}
                placeholder="#ffffff"
              />
            </div>
          </Field>
        </div>

        <div className="grid gap-4 sm:grid-cols-[2fr_1fr_1fr]">
          <Field label="URL du logo (email)" hint="Image hébergée publiquement." error={errorFor("theme.logoUrl")}>
            <Input value={form.logoUrl} disabled={disabled} onChange={(e) => set("logoUrl", e.target.value)} placeholder="https://exemple.com/logo-email.png" />
          </Field>
          <Field label="Texte alternatif" error={errorFor("theme.logoAlt")}>
            <Input value={form.logoAlt} disabled={disabled} onChange={(e) => set("logoAlt", e.target.value)} placeholder="Ma Nouvelle Marque" />
          </Field>
          <Field label="Largeur (px)" error={errorFor("theme.logoWidth")}>
            <Input type="number" value={form.logoWidth} disabled={disabled} onChange={(e) => set("logoWidth", e.target.value)} />
          </Field>
        </div>
      </Section>

      <Section title="Domaines et liens">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field
            label="Domaines de la marque"
            hint="Un par ligne. Seuls les liens vers ces domaines reçoivent les paramètres UTM."
            error={errorFor("domains")}
          >
            <Textarea rows={3} value={form.domains} disabled={disabled} onChange={(e) => set("domains", e.target.value)} placeholder={"exemple.com\nexemple.be"} />
          </Field>
          <div className="space-y-4">
            <Field
              label="URL publique de l'outil"
              hint="Domaine sur lequel sortent les liens de désinscription de cette marque. Il doit pointer vers ce même déploiement. Vide = domaine commun (APP_URL)."
              error={errorFor("appUrl")}
            >
              <Input value={form.appUrl} disabled={disabled} onChange={(e) => set("appUrl", e.target.value)} placeholder="https://marketing.exemple.com" />
            </Field>
            <Field label="Boutique (lien de repli)" error={errorFor("shopUrl")}>
              <Input value={form.shopUrl} disabled={disabled} onChange={(e) => set("shopUrl", e.target.value)} placeholder="https://exemple.com/boutique" />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Expédition" hint="valeurs par défaut, affinables dans Réglages">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Nom affiché de l'expéditeur">
            <Input value={form.fromName} disabled={disabled} onChange={(e) => set("fromName", e.target.value)} placeholder="Prénom de la marque" />
          </Field>
          <Field
            label="Adresse d'envoi"
            hint="Le domaine doit être vérifié chez Resend, sinon les envois échoueront."
            error={errorFor("sender.from")}
          >
            <Input value={form.from} disabled={disabled} onChange={(e) => set("from", e.target.value)} placeholder="contact@reach.exemple.com" />
          </Field>
          <Field label="Adresse de réponse" error={errorFor("sender.replyTo")}>
            <Input value={form.replyTo} disabled={disabled} onChange={(e) => set("replyTo", e.target.value)} placeholder="contact@exemple.com" />
          </Field>
          <Field label="Adresse de test" error={errorFor("sender.testEmail")}>
            <Input value={form.testEmail} disabled={disabled} onChange={(e) => set("testEmail", e.target.value)} placeholder="vous@exemple.com" />
          </Field>
          <Field label="Raison sociale (pied d'email)" hint="Exigence anti-spam : être identifiable." error={errorFor("sender.identity.name")}>
            <Input value={form.identityName} disabled={disabled} onChange={(e) => set("identityName", e.target.value)} placeholder="Ma Nouvelle Marque SRL" />
          </Field>
          <Field label="Contact (pied d'email)" error={errorFor("sender.identity.contact")}>
            <Input value={form.identityContact} disabled={disabled} onChange={(e) => set("identityContact", e.target.value)} placeholder="exemple.com" />
          </Field>
          <Field label="Adresse postale (facultative)">
            <Input value={form.identityAddress} disabled={disabled} onChange={(e) => set("identityAddress", e.target.value)} placeholder="Rue de l'Exemple 1, 1000 Bruxelles" />
          </Field>
          <div className="grid grid-cols-2 gap-4">
            <Field
              label="Plafond / jour"
              hint="0 = illimité. Un domaine neuf doit monter en charge lentement."
              error={errorFor("sender.dailyCap")}
            >
              <Input type="number" value={form.dailyCap} disabled={disabled} onChange={(e) => set("dailyCap", e.target.value)} />
            </Field>
            <Field label="Délai (ms)" error={errorFor("sender.delayMs")}>
              <Input type="number" value={form.delayMs} disabled={disabled} onChange={(e) => set("delayMs", e.target.value)} />
            </Field>
          </div>
        </div>
      </Section>

      <Section title="Email">
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Gabarit" hint="Deux mises en page disponibles (lib/email-layouts).">
            <select
              value={form.layout}
              disabled={disabled}
              onChange={(e) => set("layout", e.target.value as Form["layout"])}
              className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand"
            >
              <option value="classic">Classique</option>
              <option value="minimal">Minimal</option>
            </select>
          </Field>
          <Field label="Objet par défaut" error={errorFor("defaults.subject")}>
            <Input value={form.subject} disabled={disabled} onChange={(e) => set("subject", e.target.value)} />
          </Field>
          <Field label="Accroche sous le logo" hint="Vide = masquée.">
            <Input value={form.bodyTagline} disabled={disabled} onChange={(e) => set("bodyTagline", e.target.value)} />
          </Field>
          <label className="flex items-start gap-2 text-sm sm:pt-6">
            <input
              type="checkbox"
              checked={form.showProductsMore}
              disabled={disabled}
              onChange={(e) => set("showProductsMore", e.target.checked)}
              className="mt-1"
            />
            <span>
              <span className="font-medium text-gray-600">Proposer l&apos;encart « À découvrir aussi »</span>
              <span className="mt-1 block text-[11px] text-gray-400">
                À décocher si le catalogue est une grille de formules : afficher les paliers
                tarifaires sous un email de prospection amène le prix trop tôt.
              </span>
            </span>
          </label>
        </div>

        <Field
          label="Corps par défaut"
          hint="HTML. Tokens de fusion : {{name}}, {{contact_name}}, {{city}}, {{product_name}}, {{product_url}}, {{config_url}}, {{products_more}}."
          error={errorFor("defaults.body")}
        >
          <Textarea rows={12} value={form.body} disabled={disabled} onChange={(e) => set("body", e.target.value)} />
        </Field>

        <div>
          <div className="mb-2 flex items-center gap-2">
            <span className="text-sm font-medium text-gray-600">Réseaux sociaux (pied d&apos;email)</span>
            {!disabled && (
              <Button
                variant="ghost"
                className="ml-auto"
                onClick={() => set("socials", [...form.socials, { label: "", url: "" }])}
              >
                Ajouter
              </Button>
            )}
          </div>
          <div className="space-y-2">
            {form.socials.map((s, i) => (
              <div key={i} className="flex gap-2">
                <Input
                  value={s.label}
                  disabled={disabled}
                  placeholder="LinkedIn"
                  className="sm:w-40"
                  onChange={(e) =>
                    set(
                      "socials",
                      form.socials.map((x, j) => (j === i ? { ...x, label: e.target.value } : x))
                    )
                  }
                />
                <Input
                  value={s.url}
                  disabled={disabled}
                  placeholder="https://www.linkedin.com/company/exemple"
                  onChange={(e) =>
                    set(
                      "socials",
                      form.socials.map((x, j) => (j === i ? { ...x, url: e.target.value } : x))
                    )
                  }
                />
                {!disabled && (
                  <Button variant="ghost" onClick={() => set("socials", form.socials.filter((_, j) => j !== i))}>
                    ✕
                  </Button>
                )}
              </div>
            ))}
            {form.socials.length === 0 && <p className="text-xs text-gray-400">Aucun réseau social.</p>}
          </div>
        </div>
      </Section>

      <Section title={`Catalogue (${form.products.length})`}>
        <p className="text-sm text-gray-500">
          Chaque produit alimente les tokens <code>{"{{product_*}}"}</code> et le contexte des
          prompts IA. Le premier sert de repli quand aucun produit n&apos;est résolu.
        </p>
        {errorFor("products") && <p className="text-sm text-red-600">{errorFor("products")}</p>}

        <div className="space-y-3">
          {form.products.map((p, i) => {
            const upd = (patch: Partial<ProductForm>) =>
              set(
                "products",
                form.products.map((x, j) => (j === i ? { ...x, ...patch } : x))
              );
            return (
              <Card key={i} className="bg-gray-50 p-4">
                <div className="mb-3 flex items-center gap-2">
                  <span className="text-sm font-bold text-gray-700">
                    Produit {i + 1}
                    {i === 0 && <span className="ml-2 text-[11px] font-normal text-gray-400">repli par défaut</span>}
                  </span>
                  {!disabled && form.products.length > 1 && (
                    <Button
                      variant="ghost"
                      className="ml-auto"
                      onClick={() => set("products", form.products.filter((_, j) => j !== i))}
                    >
                      Retirer
                    </Button>
                  )}
                </div>
                <div className="grid gap-3 sm:grid-cols-2">
                  <Field
                    label="Clé"
                    hint="Stockée en base. Définitive une fois des emails envoyés."
                    error={errorFor(`products.${i}.key`)}
                  >
                    <Input
                      value={p.key}
                      disabled={disabled}
                      onChange={(e) => upd({ key: slugify(e.target.value) })}
                      placeholder="produit-a"
                    />
                  </Field>
                  <Field
                    label="Nom dans l'email"
                    hint="Lu dans une phrase : « Découvrir {{product_name}} »."
                    error={errorFor(`products.${i}.name`)}
                  >
                    <Input value={p.name} disabled={disabled} onChange={(e) => upd({ name: e.target.value })} placeholder="Produit A" />
                  </Field>
                  <Field label="Libellé dans l'interface" hint="Par défaut, le nom ci-dessus.">
                    <Input value={p.uiLabel} disabled={disabled} onChange={(e) => upd({ uiLabel: e.target.value })} />
                  </Field>
                  <Field label="Prix" hint="Facultatif : une offre globale n'en a pas.">
                    <Input value={p.price} disabled={disabled} onChange={(e) => upd({ price: e.target.value })} placeholder="19,90 €" />
                  </Field>
                  <Field label="Lien boutique" error={errorFor(`products.${i}.shopUrl`)}>
                    <Input value={p.shopUrl} disabled={disabled} onChange={(e) => upd({ shopUrl: e.target.value })} placeholder="https://exemple.com/boutique/produit-a" />
                  </Field>
                  <Field label="Lien configurateur" error={errorFor(`products.${i}.configUrl`)}>
                    <Input value={p.configUrl} disabled={disabled} onChange={(e) => upd({ configUrl: e.target.value })} placeholder="https://exemple.com/configurer/produit-a" />
                  </Field>
                  <Field label="Description" hint="Telle qu'utilisée par l'IA." error={errorFor(`products.${i}.description`)}>
                    <Textarea rows={2} value={p.description} disabled={disabled} onChange={(e) => upd({ description: e.target.value })} />
                  </Field>
                  <Field label="Accroche" hint="Le bénéfice principal, en une demi-phrase." error={errorFor(`products.${i}.pitch`)}>
                    <Textarea rows={2} value={p.pitch} disabled={disabled} onChange={(e) => upd({ pitch: e.target.value })} />
                  </Field>
                  <Field
                    label="Synonymes"
                    hint="Séparés par des virgules. Permettent de reconnaître ce produit dans une valeur saisie ou proposée par l'IA."
                  >
                    <Input value={p.aliases} disabled={disabled} onChange={(e) => upd({ aliases: e.target.value })} placeholder="a, produit a" />
                  </Field>
                </div>
              </Card>
            );
          })}
        </div>

        {!disabled && (
          <Button variant="outline" onClick={() => set("products", [...form.products, emptyProduct()])}>
            Ajouter un produit
          </Button>
        )}

        <Field
          label="Produit présélectionné dans l'interface"
          hint="Ne change pas le repli, qui reste le premier du catalogue."
          error={errorFor("defaultProductKey")}
        >
          <select
            value={form.defaultProductKey}
            disabled={disabled}
            onChange={(e) => set("defaultProductKey", e.target.value)}
            className="w-full rounded-lg border border-gray-300 px-3 py-2 text-sm outline-none focus:border-brand"
          >
            <option value="">(le premier du catalogue)</option>
            {form.products
              .filter((p) => p.key)
              .map((p) => (
                <option key={p.key} value={p.key}>
                  {p.uiLabel || p.name || p.key}
                </option>
              ))}
          </select>
        </Field>
      </Section>

      <Section title="Positionnement pour l'IA">
        <Field
          label="Positionnement"
          hint="Une à deux phrases : qui est la marque, ce qu'elle vend, son bénéfice clé. Injecté dans tous les prompts."
          error={errorFor("ai.positioning")}
        >
          <Textarea rows={3} value={form.positioning} disabled={disabled} onChange={(e) => set("positioning", e.target.value)} />
        </Field>
        <div className="grid gap-4 sm:grid-cols-2">
          <Field label="Signature imposée en fin d'email" error={errorFor("ai.signature")}>
            <Input value={form.signature} disabled={disabled} onChange={(e) => set("signature", e.target.value)} placeholder="L'équipe Ma Nouvelle Marque" />
          </Field>
          <Field
            label="Formulations interdites"
            hint="Une par ligne. Indispensable en secteur réglementé : une allégation inventée par l'IA engage l'entreprise."
          >
            <Textarea rows={4} value={form.forbidden} disabled={disabled} onChange={(e) => set("forbidden", e.target.value)} />
          </Field>
        </div>
      </Section>

      {!readOnly && (
        <Card className="flex flex-wrap items-center gap-3 p-5">
          <Button onClick={save} disabled={busy}>
            {busy ? <Spinner /> : creating ? "Créer la marque" : "Enregistrer"}
          </Button>
          {creating && (
            <span className="text-xs text-gray-400">
              Elle sera créée en brouillon : aucun envoi réel avant activation.
            </span>
          )}
          {message && <span className="text-sm text-brand-700">{message}</span>}
          {error && <span className="text-sm text-red-600">{error}</span>}

          {loaded && (
            <Button variant="danger" className="ml-auto" onClick={remove} disabled={busy}>
              Supprimer
            </Button>
          )}
        </Card>
      )}

      {loaded && Object.values(loaded.usage).some((n) => n > 0) && (
        <p className="text-[11px] text-gray-400">
          Données rattachées :{" "}
          {Object.entries(loaded.usage)
            .filter(([, n]) => n > 0)
            .map(([t, n]) => `${n} ${t}`)
            .join(", ")}
          . Tant qu&apos;il en reste, la suppression est refusée : désactivez la marque à la place.
        </p>
      )}
    </div>
  );
}
