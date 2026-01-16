import { getDocumentChunks } from "./documentStore.js";

export function getRelevantContext(question) {
    const chunks = getDocumentChunks();

    const keywords = question
        .toLowerCase()
        .split(" ")
        .filter(w => w.length > 4);

    if (keywords.length === 0) return "";

    const scored = chunks.map(chunk => {
        let score = 0;
        for (const k of keywords) {
            if (chunk.toLowerCase().includes(k)) score++;
        }
        return { chunk, score };
    });

    return scored
        .filter(s => s.score > 0)
        .sort((a, b) => b.score - a.score)
        .slice(0, 5)
        .map(s => s.chunk)
        .join("\n---\n");
}
