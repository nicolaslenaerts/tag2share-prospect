/**
 * Google Places API (New) - Text Search.
 * Doc : https://developers.google.com/maps/documentation/places/web-service/text-search
 */
const API_KEY = process.env.GOOGLE_MAPS_API_KEY!;
const ENDPOINT = "https://places.googleapis.com/v1/places:searchText";

const FIELD_MASK = [
  "places.id",
  "places.displayName",
  "places.formattedAddress",
  "places.primaryTypeDisplayName",
  "places.types",
  "places.nationalPhoneNumber",
  "places.internationalPhoneNumber",
  "places.websiteUri",
  "places.rating",
  "places.userRatingCount",
  "places.addressComponents",
  "nextPageToken",
].join(",");

export type PlaceResult = {
  id: string;
  name: string;
  category?: string;
  address?: string;
  city?: string;
  country?: string;
  phone?: string;
  website?: string;
  rating?: number;
  reviewsCount?: number;
  raw: unknown;
};

export const COUNTRY_CODES: Record<string, string> = {
  Belgique: "BE",
  France: "FR",
};

function extractCity(addressComponents: any[] | undefined): string | undefined {
  if (!addressComponents) return undefined;
  const locality = addressComponents.find((c) =>
    c.types?.includes("locality")
  );
  const admin = addressComponents.find((c) =>
    c.types?.includes("administrative_area_level_2")
  );
  return locality?.longText || admin?.longText;
}

function extractCountry(addressComponents: any[] | undefined): string | undefined {
  if (!addressComponents) return undefined;
  return addressComponents.find((c) => c.types?.includes("country"))?.longText;
}

/**
 * Recherche textuelle de business.
 * @param query   ex: "salon de coiffure Bruxelles"
 * @param regionCode  "BE" | "FR" (biais régional)
 * @param maxResults  nombre max de résultats (pagination automatique, plafonné)
 */
export async function searchPlaces(
  query: string,
  regionCode?: string,
  maxResults = 20
): Promise<PlaceResult[]> {
  if (!API_KEY) throw new Error("GOOGLE_MAPS_API_KEY manquante.");

  const results: PlaceResult[] = [];
  let pageToken: string | undefined;

  while (results.length < maxResults) {
    const body: Record<string, unknown> = {
      textQuery: query,
      languageCode: "fr",
      pageSize: Math.min(20, maxResults - results.length),
    };
    if (regionCode) body.regionCode = regionCode;
    if (pageToken) body.pageToken = pageToken;

    const res = await fetch(ENDPOINT, {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "X-Goog-Api-Key": API_KEY,
        "X-Goog-FieldMask": FIELD_MASK,
      },
      body: JSON.stringify(body),
    });

    if (!res.ok) {
      const err = await res.text();
      throw new Error(`Places API ${res.status}: ${err}`);
    }

    const data = await res.json();
    const places = (data.places || []) as any[];
    for (const p of places) {
      results.push({
        id: p.id,
        name: p.displayName?.text || "Sans nom",
        category: p.primaryTypeDisplayName?.text,
        address: p.formattedAddress,
        city: extractCity(p.addressComponents),
        country: extractCountry(p.addressComponents),
        phone: p.internationalPhoneNumber || p.nationalPhoneNumber,
        website: p.websiteUri,
        rating: p.rating,
        reviewsCount: p.userRatingCount,
        raw: p,
      });
    }

    pageToken = data.nextPageToken;
    if (!pageToken || places.length === 0) break;
  }

  return results.slice(0, maxResults);
}
