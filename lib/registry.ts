/**
 * Recherche d'informations légales sur les registres officiels :
 * - 🇧🇪 Belgique : VIES (service TVA officiel UE) → raison sociale + adresse
 * - 🇫🇷 France   : API « Recherche d'entreprises » (annuaire-entreprises.data.gouv.fr)
 *                  → SIREN, adresse du siège, dirigeants, activité
 *
 * Aucune clé API requise. Tous les appels sont bornés en temps et ne lèvent
 * jamais : en cas d'échec/timeout, on renvoie null.
 */

export type RegistryInfo = {
  source: "vies" | "recherche-entreprises";
  name?: string;
  address?: string;
  vat_number?: string;
  company_number?: string; // n° d'entreprise BE (BCE) ou SIREN FR
  activity?: string;
  directors?: string[];
  website?: string; // si le registre expose un site (peut relancer le scraping)
};

export type CompanyIds = {
  /** N° d'entreprise BE (10 chiffres) ou SIREN FR (9 chiffres). */
  companyNumber?: string;
  /** TVA normalisée, ex. "BE0123456789" / "FR12123456789". */
  vatNumber?: string;
  country?: "BE" | "FR";
};

function fetchJson<T>(url: string, ms: number, init?: RequestInit): Promise<T | null> {
  return new Promise((resolve) => {
    const controller = new AbortController();
    const t = setTimeout(() => {
      controller.abort();
      resolve(null);
    }, ms);
    fetch(url, { ...init, signal: controller.signal })
      .then(async (res) => {
        clearTimeout(t);
        if (!res.ok) return resolve(null);
        resolve((await res.json()) as T);
      })
      .catch(() => {
        clearTimeout(t);
        resolve(null);
      });
  });
}

// ---------------------------------------------------------------------------
// Validation des numéros (checksums) pour écarter les faux positifs.
// ---------------------------------------------------------------------------

/** N° d'entreprise belge : 10 chiffres, contrôle mod 97 sur les 8 premiers. */
function isValidBe(num: string): boolean {
  if (!/^\d{10}$/.test(num)) return false;
  if (!/^[01]/.test(num)) return false;
  const base = parseInt(num.slice(0, 8), 10);
  const check = parseInt(num.slice(8), 10);
  return 97 - (base % 97) === check;
}

/** SIREN français : 9 chiffres, contrôle de Luhn. */
function isValidSiren(num: string): boolean {
  if (!/^\d{9}$/.test(num)) return false;
  let sum = 0;
  for (let i = 0; i < 9; i++) {
    let d = parseInt(num[i], 10);
    // Luhn appliqué de droite à gauche ; en SIREN on double les rangs pairs (0-indexés impairs).
    if (i % 2 === 1) {
      d *= 2;
      if (d > 9) d -= 9;
    }
    sum += d;
  }
  return sum % 10 === 0;
}

// ---------------------------------------------------------------------------
// Extraction des identifiants depuis le texte d'un site.
// ---------------------------------------------------------------------------

const KEYWORD_RE =
  /(tva|t\.v\.a|btw|bce|kbo|num[ée]ro d['’ ]?entreprise|ondernemingsnummer|siren|siret|rcs|n°\s*tva|vat)/i;

/**
 * Cherche n° d'entreprise / TVA dans le texte. On ne retient que les nombres
 * valides (checksum) et, pour les suites de chiffres « nues », ceux situés à
 * proximité d'un mot-clé légal — afin d'éviter de confondre avec un téléphone.
 */
export function extractCompanyIds(text: string, country?: string): CompanyIds {
  const cc: "BE" | "FR" | undefined =
    country === "Belgique" || country === "BE"
      ? "BE"
      : country === "France" || country === "FR"
      ? "FR"
      : undefined;

  const ids: CompanyIds = { country: cc };

  // 1) TVA préfixée par le code pays = haute confiance, où qu'elle soit.
  const vatBe = text.match(/\bBE\s*([01][\s.]?\d{3}[\s.]?\d{3}[\s.]?\d{3})\b/i);
  if (vatBe) {
    const digits = vatBe[1].replace(/\D/g, "");
    if (isValidBe(digits)) {
      ids.vatNumber = "BE" + digits;
      ids.companyNumber = digits;
      ids.country = ids.country || "BE";
    }
  }
  const vatFr = text.match(/\bFR\s*([0-9A-Z]{2})\s?(\d{3}[\s.]?\d{3}[\s.]?\d{3})\b/i);
  if (vatFr) {
    const siren = vatFr[2].replace(/\D/g, "");
    if (isValidSiren(siren)) {
      ids.vatNumber = "FR" + vatFr[1] + siren;
      ids.companyNumber = siren;
      ids.country = ids.country || "FR";
    }
  }

  // 2) Suites de chiffres proches d'un mot-clé (BCE/SIREN/SIRET…).
  if (!ids.companyNumber) {
    // Fenêtres de ~60 caractères après chaque mot-clé.
    const windows: string[] = [];
    const kwGlobal = new RegExp(KEYWORD_RE.source, "gi");
    let m: RegExpExecArray | null;
    while ((m = kwGlobal.exec(text))) {
      windows.push(text.slice(m.index, m.index + 80));
    }
    for (const w of windows) {
      // BE : 10 chiffres
      const be = w.match(/\b([01][\s.]?\d{3}[\s.]?\d{3}[\s.]?\d{3})\b/);
      if (be) {
        const d = be[1].replace(/\D/g, "");
        if (isValidBe(d)) {
          ids.companyNumber = d;
          ids.vatNumber = ids.vatNumber || "BE" + d;
          ids.country = ids.country || "BE";
          break;
        }
      }
      // FR : SIRET (14) -> on garde le SIREN ; sinon SIREN (9)
      const siret = w.match(/\b(\d{3}[\s.]?\d{3}[\s.]?\d{3}[\s.]?\d{5})\b/);
      if (siret) {
        const d = siret[1].replace(/\D/g, "");
        if (isValidSiren(d.slice(0, 9))) {
          ids.companyNumber = d.slice(0, 9);
          ids.country = ids.country || "FR";
          break;
        }
      }
      const siren = w.match(/\b(\d{3}[\s.]?\d{3}[\s.]?\d{3})\b/);
      if (siren) {
        const d = siren[1].replace(/\D/g, "");
        if (isValidSiren(d)) {
          ids.companyNumber = d;
          ids.country = ids.country || "FR";
          break;
        }
      }
    }
  }

  return ids;
}

// ---------------------------------------------------------------------------
// Lookups registres.
// ---------------------------------------------------------------------------

/** Belgique : valide la TVA via VIES et récupère nom + adresse officiels. */
export async function lookupVies(
  companyNumber: string,
  ms = 4000
): Promise<RegistryInfo | null> {
  const num = companyNumber.replace(/\D/g, "");
  if (!isValidBe(num)) return null;
  const data = await fetchJson<{
    valid?: boolean;
    name?: string;
    address?: string;
  }>("https://ec.europa.eu/taxation_customs/vies/rest-api/check-vat-number", ms, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ countryCode: "BE", vatNumber: num }),
  });
  if (!data?.valid) return null;
  const address = data.address
    ? data.address.replace(/\n/g, ", ").replace(/\s+/g, " ").trim()
    : undefined;
  return {
    source: "vies",
    name: data.name && data.name !== "---" ? data.name : undefined,
    address,
    vat_number: "BE" + num,
    company_number: num,
  };
}

/**
 * France : API Recherche d'entreprises. Par SIREN si connu, sinon recherche
 * plein-texte (nom + ville) en repli.
 */
export async function lookupFrance(
  opts: { siren?: string; name?: string; city?: string },
  ms = 4000
): Promise<RegistryInfo | null> {
  const params = new URLSearchParams({ page: "1", per_page: "1" });
  if (opts.siren && isValidSiren(opts.siren)) {
    params.set("q", opts.siren);
  } else if (opts.name) {
    params.set("q", [opts.name, opts.city].filter(Boolean).join(" "));
  } else {
    return null;
  }
  const data = await fetchJson<{ results?: any[] }>(
    `https://recherche-entreprises.api.gouv.fr/search?${params.toString()}`,
    ms
  );
  const r = data?.results?.[0];
  if (!r) return null;

  const siege = r.siege || {};
  const address: string | undefined =
    siege.adresse ||
    siege.geo_adresse ||
    [
      [siege.numero_voie, siege.type_voie, siege.libelle_voie]
        .filter(Boolean)
        .join(" "),
      [siege.code_postal, siege.libelle_commune].filter(Boolean).join(" "),
    ]
      .filter(Boolean)
      .join(", ") ||
    undefined;

  const directors: string[] = Array.isArray(r.dirigeants)
    ? r.dirigeants
        .map((d: any) => {
          const who =
            d.denomination ||
            [d.prenoms, d.nom].filter(Boolean).join(" ").trim();
          if (!who) return "";
          return d.qualite ? `${who} (${d.qualite})` : who;
        })
        .filter(Boolean)
        .slice(0, 5)
    : [];

  return {
    source: "recherche-entreprises",
    name: r.nom_complet || r.nom_raison_sociale,
    address: address && address.trim() ? address.trim() : undefined,
    company_number: r.siren,
    activity: r.libelle_activite_principale || r.activite_principale,
    directors: directors.length ? directors : undefined,
  };
}
