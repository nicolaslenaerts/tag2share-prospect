/**
 * Peut-on ENVOYER DE VRAIS EMAILS sous cette marque ?
 *
 * Une marque créée dans l'interface naît inactive. Tout fonctionne déjà -
 * segments, rédaction IA, aperçu, emails de test - sauf l'envoi réel, qui
 * reste bloqué tant qu'on n'a pas basculé l'interrupteur dans /marques.
 *
 * Ce module dit ce qui empêche encore cette bascule. Deux niveaux :
 *   - BLOQUANT  : l'activation est refusée par l'API. Ce sont les conditions
 *     dont le non-respect produit soit un échec d'envoi en série, soit un
 *     email parti sous une identité que personne n'a choisie.
 *   - AVERTISSEMENT : affiché, jamais bloquant. Ce sont des symptômes de
 *     mauvaise configuration qui n'empêchent pas un envoi correct.
 *
 * La distinction compte : un blocage de trop et l'outil devient increvable au
 * mauvais sens du terme - on finit par activer « en force » sans lire.
 *
 * Client-safe : fonctions pures sur des données déjà résolues, pour que le
 * formulaire affiche exactement ce que l'API vérifiera.
 */
import type { BrandConfig } from "./types";
import { normalizeDomain } from "./schema";

/**
 * Ce que l'on sait de l'identité d'expédition EFFECTIVE (résolue par
 * lib/brand-sender.ts : base → env → code).
 */
export type SenderFacts = {
  fromEmail: string;
  replyTo: string;
  testEmail?: string;
  /** D'où vient l'adresse d'envoi retenue. */
  fromSource: "settings" | "env" | "code";
};

export type Readiness = {
  /** Vrai si aucun blocage : la marque peut être activée. */
  ok: boolean;
  blockers: string[];
  warnings: string[];
};

/** Partie domaine d'une adresse email, normalisée. */
function emailDomain(address: string): string {
  const at = (address || "").lastIndexOf("@");
  return at === -1 ? "" : normalizeDomain(address.slice(at + 1));
}

/** `a.exemple.com` appartient à `exemple.com`. */
function isSubdomainOf(host: string, parent: string): boolean {
  return host === parent || host.endsWith("." + parent);
}

/**
 * Diagnostic complet. `sender` est l'identité résolue ; l'omettre (marque pas
 * encore enregistrée) ne teste que ce qui dépend de la configuration seule.
 */
export function brandReadiness(brand: BrandConfig, sender?: SenderFacts): Readiness {
  const blockers: string[] = [];
  const warnings: string[] = [];

  // Défensif : le schéma l'impose déjà, mais une ligne écrite avant un
  // durcissement du schéma pourrait passer au travers, et un envoi sans
  // produit rendrait des tokens {{product_*}} vides chez un vrai prospect.
  if (brand.products.length === 0) {
    blockers.push("Le catalogue est vide : ajoutez au moins un produit.");
  }

  if (!brand.ai.positioning.trim() || !brand.ai.signature.trim()) {
    blockers.push(
      "Le positionnement et la signature sont nécessaires : l'IA rédige à partir d'eux."
    );
  }

  if (sender) {
    // Le vrai garde-fou. Le défaut du code d'une marque créée dans l'interface
    // n'est qu'un texte saisi dans un formulaire : rien ne garantit que ce
    // domaine soit vérifié chez Resend. Exiger une saisie dans /reglages force
    // le passage par l'écran qui le rappelle.
    if (sender.fromSource !== "settings") {
      blockers.push(
        "L'adresse d'envoi n'a pas été confirmée dans Réglages. Le domaine doit y être saisi une fois vérifié chez Resend."
      );
    }
    if (!sender.testEmail) {
      blockers.push(
        "Aucune adresse de test : renseignez-la dans Réglages et envoyez-vous un email avant d'écrire à de vrais prospects."
      );
    }

    // Non bloquant : une marque peut légitimement envoyer depuis un domaine
    // d'envoi dédié (reach.exemple.com) absent de la liste UTM.
    const from = emailDomain(sender.fromEmail);
    if (from && brand.domains.length > 0 && !brand.domains.some((d) => isSubdomainOf(from, d))) {
      warnings.push(
        `L'adresse d'envoi (${from}) n'appartient à aucun domaine déclaré de la marque : les liens de l'email ne recevront pas de paramètres UTM.`
      );
    }
    const reply = emailDomain(sender.replyTo);
    if (reply && from && reply !== from) {
      warnings.push(
        `Les réponses arriveront sur un autre domaine (${reply}) que celui d'envoi (${from}). C'est courant, vérifiez que cette boîte est relevée.`
      );
    }
  }

  if (brand.domains.length === 0) {
    warnings.push("Aucun domaine déclaré : aucun lien de l'email ne sera suivi en UTM.");
  }

  // Le lien de désinscription est le seul lien de l'email hébergé par l'outil.
  // S'il pointe vers le domaine d'une autre marque, le destinataire voit une
  // enseigne qu'il ne connaît pas et les filtres anti-spam le remarquent aussi.
  if (!brand.appUrl?.trim()) {
    warnings.push(
      "Aucune URL publique propre à la marque : le lien de désinscription utilisera le domaine commun (APP_URL)."
    );
  } else if (sender) {
    const app = normalizeDomain(brand.appUrl);
    const from = emailDomain(sender.fromEmail);
    if (app && from && !isSubdomainOf(app, from) && !isSubdomainOf(from, app)) {
      const root = brand.domains.find((d) => isSubdomainOf(app, d));
      if (!root) {
        warnings.push(
          `L'URL publique (${app}) n'est apparentée ni au domaine d'envoi (${from}) ni aux domaines déclarés : le lien de désinscription paraîtra étranger à la marque.`
        );
      }
    }
  }

  return { ok: blockers.length === 0, blockers, warnings };
}
