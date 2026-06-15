import { GoogleGenerativeAI } from "@google/generative-ai";

const apiKey = process.env.GEMINI_API_KEY!;
const modelName = process.env.GEMINI_MODEL || "gemini-2.5-flash";

export function geminiModel() {
  if (!apiKey) throw new Error("GEMINI_API_KEY manquante.");
  const genAI = new GoogleGenerativeAI(apiKey);
  return genAI.getGenerativeModel({ model: modelName });
}

/** Appelle Gemini et tente de parser un JSON depuis la réponse. */
export async function geminiJSON<T = unknown>(prompt: string): Promise<T> {
  const model = geminiModel();
  const result = await model.generateContent(prompt);
  const text = result.response.text();
  const cleaned = text
    .replace(/^```(?:json)?/i, "")
    .replace(/```$/i, "")
    .trim();
  // Extrait le premier bloc JSON ({...} ou [...]) si du texte entoure la réponse.
  const match = cleaned.match(/[[{][\s\S]*[\]}]/);
  const jsonStr = match ? match[0] : cleaned;
  return JSON.parse(jsonStr) as T;
}
