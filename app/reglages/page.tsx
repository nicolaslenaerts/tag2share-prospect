import { redirect } from "next/navigation";

/**
 * L'identité d'expédition se saisissait ici, dans une table séparée qui
 * primait sur la configuration de la marque. Depuis que celle-ci vit en base
 * et s'édite dans /marques, les deux écrans se contredisaient : on pouvait
 * saisir une adresse d'envoi sans effet, masquée par l'autre.
 *
 * Tout est désormais dans la fiche de la marque, qui affiche aussi ce qui
 * s'appliquera réellement et permet de lever une surcharge héritée. Cette
 * redirection garde les liens et les signets existants opérants.
 */
export default function ReglagesPage() {
  redirect("/marques");
}
