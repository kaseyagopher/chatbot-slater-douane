import "dotenv/config";
import express from "express";
import cors from "cors";
import { db } from "./db.js";
import { v4 as uuidv4 } from "uuid";

// LLM (Groq)
import { getGroqChatCompletion } from "./groq.js";

// RAG en mémoire
import { loadDocument } from "./documentStore.js";
import { getRelevantContext } from "./rag.js";

const app = express();

app.use(cors());
app.use(express.json());

// =======================
// Configuration session
// =======================
const SESSION_TIMEOUT_MINUTES =
    Number(process.env.SESSION_TIMEOUT_MINUTES) || 10;

function isSessionExpired(lastActivity) {
    const now = new Date();
    const diff = (now - new Date(lastActivity)) / 1000 / 60;
    return diff > SESSION_TIMEOUT_MINUTES;
}

// =======================
// Routes de base
// =======================
app.get("/", (req, res) => {
    res.json({ status: "API Chatbot opérationnelle" });
});

// =======================
// Création / récupération session
// =======================
app.post("/api/session", async (req, res) => {
    try {
        let sessionId = req.body?.sessionId;

        if (sessionId) {
            const [rows] = await db.query(
                "SELECT * FROM chat_sessions WHERE id = ?",
                [sessionId]
            );

            if (rows.length > 0) {
                const session = rows[0];

                if (!isSessionExpired(session.last_activity)) {
                    await db.query(
                        "UPDATE chat_sessions SET last_activity = NOW() WHERE id = ?",
                        [sessionId]
                    );
                    return res.json({ sessionId });
                }
            }
        }

        // Nouvelle session
        sessionId = uuidv4();
        await db.query(
            "INSERT INTO chat_sessions (id, created_at, last_activity) VALUES (?, NOW(), NOW())",
            [sessionId]
        );

        res.json({ sessionId });
    } catch (err) {
        console.error("Erreur /api/session :", err);
        res.status(500).json({ error: "Erreur serveur" });
    }
});

// =======================
// Chat principal (RAG + Groq)
// =======================
app.post("/api/chat", async (req, res) => {
    const { sessionId, message } = req.body || {};

    if (!sessionId || !message) {
        return res.status(400).json({ error: "Requête invalide" });
    }

    try {
        // 1. Vérifier session
        const [sessions] = await db.query(
            "SELECT * FROM chat_sessions WHERE id = ?",
            [sessionId]
        );

        if (
            sessions.length === 0 ||
            isSessionExpired(sessions[0].last_activity)
        ) {
            return res.status(440).json({ error: "Session expirée" });
        }

        // 2. Mettre à jour activité + sauvegarder message utilisateur
        await db.query(
            "UPDATE chat_sessions SET last_activity = NOW() WHERE id = ?",
            [sessionId]
        );

        await db.query(
            "INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'user', ?)",
            [sessionId, message]
        );

        // 3. Récupération du contexte (RAG en mémoire)
        const context = getRelevantContext(message);

        // 4. Prompt STRICT anti-hallucination
        const prompt = `
Tu es un assistant IT.
Tu dois répondre UNIQUEMENT avec les informations du CONTEXTE.
Si la réponse ne se trouve pas dans le CONTEXTE, réponds exactement :
"Je ne dispose pas de cette information dans la documentation."

CONTEXTE :
${context}

QUESTION :
${message}
    `.trim();

        // 5. Appel Groq
        const completion = await getGroqChatCompletion(prompt);
        const aiAnswer =
            completion.choices[0]?.message?.content ||
            "Je ne dispose pas de cette information dans la documentation.";

        // 6. Sauvegarde réponse assistant
        await db.query(
            "INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)",
            [sessionId, aiAnswer]
        );

        // 7. Réponse client
        res.json({ answer: aiAnswer });
    } catch (error) {
        console.error("Erreur /api/chat :", error);

        if (error?.status === 429) {
            return res.status(429).json({
                error: "Trop de requêtes. Veuillez patienter quelques secondes."
            });
        }

        res.status(500).json({ error: "Erreur interne du serveur" });
    }
});

// =======================
// Lancement serveur
// =======================
const PORT = process.env.PORT || 3000;

// Charger le document UNE SEULE FOIS au démarrage
await loadDocument("./docs/docment.pdf");

app.listen(PORT, () => {
    console.log(`🚀 API démarrée sur http://localhost:${PORT}`);
});
