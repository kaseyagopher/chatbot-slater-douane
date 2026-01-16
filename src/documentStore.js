import fs from "fs";
import { PDFParse } from "pdf-parse";

let documentChunks = [];

export async function loadDocument(path) {
    const buffer = fs.readFileSync(path);

    const parser = new PDFParse({
        data: buffer
    });

    const result = await parser.getText();
    await parser.destroy();

    const text = result.text.replace(/\s+/g, " ").trim();

    documentChunks = text.match(/.{1,800}/g) || [];

    console.log(`📄 Document chargé en mémoire (${documentChunks.length} chunks)`);
}

export function getDocumentChunks() {
    return documentChunks;
}
