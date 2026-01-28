import "dotenv/config";
import express from "express";
import cors from "cors";
import { db } from "./db.js";
import { v4 as uuidv4 } from "uuid";

// Swagger (OpenAPI)
import swaggerUi from 'swagger-ui-express';
import swaggerDocument from './swagger.js';

// LLM (Groq)
import { getGroqChatCompletion } from "./groq.js";

// RAG en mémoire
import { loadDocument } from "./documentStore.js";
import { getRelevantContext } from "./rag.js";

// Utilitaire Telegram
async function sendTelegramSummary(sessionId, summaryText) {
    const token = process.env.TELEGRAM_BOT_TOKEN;
    const chatId = process.env.TELEGRAM_TECH_CHAT_ID;
    if (!token || !chatId) {
        console.warn('Telegram non configuré (TELEGRAM_BOT_TOKEN / TELEGRAM_TECH_CHAT_ID manquants).');
        return;
    }

    // Ensure fetch is available (Node 18+ has global fetch). If not, try dynamic import of node-fetch.
    let _fetch = global.fetch;
    if (typeof _fetch !== 'function') {
        try {
            const mod = await import('node-fetch');
            _fetch = mod.default || mod;
        } catch (e) {
            console.warn('fetch non disponible et node-fetch introuvable, impossible d\'envoyer Telegram:', e?.message || e);
            return;
        }
    }

    try {
        const url = `https://api.telegram.org/bot${token}/sendMessage`;
        const body = {
            chat_id: chatId,
            text: `Nouvelle mise en relation (session ${sessionId})\n\n${summaryText}`,
            parse_mode: 'Markdown'
        };
        const resp = await _fetch(url, {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify(body)
        });
        if (!resp.ok) {
            const txt = await resp.text().catch(() => '');
            console.warn('Telegram API responded with non-OK:', resp.status, txt);
        }
    } catch (e) {
        console.error('Échec envoi Telegram :', e?.message || e);
    }
}

// Utilitaire d'échappement Markdown simple
function escapeMarkdown(text) {
    if (!text) return '';
    return text.replace(/([_*\[\]()~`>#+\-=|{}.!])/g, '\\$1');
}

const app = express();

app.use(cors());
app.use(express.json());

// Serve swagger UI and raw spec
app.use('/api-docs', swaggerUi.serve, swaggerUi.setup(swaggerDocument));
app.get('/api-docs.json', (req, res) => res.json(swaggerDocument));

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
        console.log(sessionId, message)
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

        // Vérifier si un technicien est connecté à la session : si oui, ne pas appeler le LLM
        try {
            const [sessRows] = await db.query(
                "SELECT technician_connected FROM chat_sessions WHERE id = ?",
                [sessionId]
            );
            const sessionInfo = sessRows[0];
            if (sessionInfo && sessionInfo.technician_connected) {
                const forwardedMsg = "Votre message a été transmis au technicien. Le LLM est désactivé pendant la session de support. Un technicien va répondre sous peu.";
                await db.query(
                    "INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)",
                    [sessionId, forwardedMsg]
                );
                return res.json({ answer: forwardedMsg, forwarded: true });
            }
        } catch (e) {
            // Si la colonne n'existe pas ou erreur DB, on continue normalement (éviter de bloquer).
            console.warn('Impossible de vérifier technician_connected :', e?.message || e);
        }

        // 3. Récupération de l'historique de la session pour garder le contexte
        const [messagesRows] = await db.query(
            "SELECT role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
            [sessionId]
        );

        // Construire un historique lisible (limiter la taille pour éviter des prompts trop longs)
        const MAX_HISTORY_CHARS = 4000;
        let conversation = messagesRows
            .map((m) => `${m.role.toUpperCase()}: ${m.content}`)
            .join('\n');
        if (conversation.length > MAX_HISTORY_CHARS) {
            // garder la fin de l'historique (messages les plus récents)
            conversation = conversation.slice(-MAX_HISTORY_CHARS);
            // préfixer pour indiquer que l'historique a été tronqué
            conversation = "... historique tronqué ...\n" + conversation;
        }

        // Récupération du contexte (RAG en mémoire) utilisée pour la décision LLM
        const context = getRelevantContext(message);

        // 4. Détection d'une mise en relation au support (assistant a proposé le support) et réponse positive de l'utilisateur
        // Cherche le dernier message assistant (utile pour le contexte décisionnel)
        let lastAssistantMessage = null;
        for (let i = messagesRows.length - 1; i >= 0; i--) {
            if (messagesRows[i].role === 'assistant') {
                lastAssistantMessage = messagesRows[i].content;
                break;
            }
        }

        // 4. DÉCISION via LLM : demander au LLM d'analyser l'historique et le message courant
        // Le LLM doit répondre strictement en JSON : {"connect": true|false, "reason": "..."}
        const decisionPrompt = `
        Vous êtes un assistant système chargé de décider si l'utilisateur doit être mis en relation avec le support technique.
        Répondez STRICTEMENT par un objet JSON valide sur une seule ligne avec les clés :
          - connect : true ou false
          - reason : une courte justification
        
        Principe : basez-vous uniquement sur le CONTEXTE et l'HISTORIQUE fournis ci-dessous.
        
        CONTEXTE:
        ${context}
        
        HISTORIQUE_CONVERSATION:
        ${conversation}
        
        DERNIER_MESSAGE_ASSISTANT:
        ${lastAssistantMessage || ''}
        
        MESSAGE_UTILISATEUR:
        ${message}
        
        Do not add any extra text. Only return the JSON.
        `.trim();

        let shouldConnectSupport = false;
        let decisionObj = null;
        let decisionText = '';
        try {
            const decisionResp = await getGroqChatCompletion(decisionPrompt);
            decisionText = decisionResp.choices[0]?.message?.content?.trim() || '';

            // Essayer de parser le JSON renvoyé par le LLM
            try {
                const obj = JSON.parse(decisionText);
                decisionObj = obj;
                shouldConnectSupport = Boolean(obj.connect);
            } catch (e) {
                // Si parsing échoue, fallback : heuristique simple
                const lowered = decisionText.toLowerCase();
                shouldConnectSupport = /true|oui|yes|connect|mettre en relation/.test(lowered);
                decisionObj = { connect: shouldConnectSupport, reason: 'fallback_parsing', raw: decisionText };
            }
        } catch (e) {
            // En cas d'échec LLM, ne pas mettre en relation automatiquement
            console.error('Erreur décision LLM :', e);
            shouldConnectSupport = false;
            decisionObj = { connect: false, reason: 'llm_error', error: String(e) };
        }

        // Enregistrer la décision dans la table d'audit (si existante)
        try {
            await db.query(
                "INSERT INTO chat_audit (session_id, event_type, payload) VALUES (?, 'decision_llm', ?)",
                [sessionId, JSON.stringify(decisionObj || { text: decisionText })]
            );
        } catch (e) {
            // Ne pas bloquer si la table n'existe pas
            console.warn('Impossible d\'enregistrer audit décision LLM :', e?.message || e);
        }

        if (shouldConnectSupport) {
            // Ne pas appeler le LLM pour la réponse entière : envoyer message de mise en relation
            const supportMsg = "Merci — nous allons vous mettre en relation avec le support technique. Veuillez patienter et ne quittez pas la page ; un technicien va vous contacter. Souhaitez-vous autre chose en attendant ?";

            await db.query(
                "INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)",
                [sessionId, supportMsg]
            );

            // Construire et envoyer un résumé de la conversation au technicien via Telegram (ne bloque pas le flux)
            try {
                const lastMessages = (messagesRows || []).slice(-30).map(m => {
                    const role = (m.role || 'unknown').toUpperCase();
                    const content = (m.content || '').replace(/\r?\n/g, ' ');
                    return `- ${role}: ${content}`;
                }).join('\n');

                const summary = `Historique (derniers messages):\n${lastMessages}\n\nMessage utilisateur récent:\n${message}`;

                // Limiter et échapper pour Telegram
                const limited = escapeMarkdown(summary).slice(0, 1500);
                // Envoi asynchrone
                sendTelegramSummary(sessionId, limited).catch(err => console.warn('Erreur sendTelegramSummary:', err));
            } catch (e) {
                console.warn('Erreur préparation résumé Telegram :', e?.message || e);
            }

            return res.json({ answer: supportMsg });
        }

        // 6. Prompt STRICT anti-hallucination en incluant l'historique de la conversation
        const prompt = `
        Tu es un assistant IT professionnel.
        
        Règles générales :
        - Tu dois répondre uniquement à partir des informations présentes dans le CONTEXTE.
        - Si la réponse à une question ne se trouve pas dans le CONTEXTE, trouves une reponses proches tout en lui proposant l'idee de e mettre en contact
        direct avec le support technique. s'il repond positivement un message lui disant de patienter et ne pas quitter la page qu'un technicien va le contacter.
        Exceptions autorisées :
        - Tu es autorisé à répondre normalement aux salutations (ex : Bonjour, Salut, Bonsoir).
        - Pour les salutations, tu peux répondre poliment sans utiliser le CONTEXTE.
        
        Fin de message :
        - Tu dois toujours terminer chaque réponse par une question demandant l’avis de l’utilisateur
          (ex : "Cela répond-il à votre question ?", "Souhaitez-vous des précisions ?", "Qu’en pensez-vous ?").
        
        Comportement :
        - Réponses claires, professionnelles et concises.
        - Aucune information ne doit être inventée.
        "

        CONTEXTE :
        ${context}

        HISTORIQUE_CONVERSATION :
        ${conversation}
        
        QUESTION :
        ${message}
        `.trim();


        const completion = await getGroqChatCompletion(prompt);
        const aiAnswer =
            completion.choices[0]?.message?.content ||
            "Je ne dispose pas de cette information dans la documentation.";

        // 8. Sauvegarde réponse assistant
        await db.query(
            "INSERT INTO chat_messages (session_id, role, content) VALUES (?, 'assistant', ?)",
            [sessionId, aiAnswer]
        );

        // 9. Réponse client
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
// Endpoints support / technicien
// =======================

// Technicien envoie un message (sera stocké et visible pour le client)
app.post("/api/support/message", async (req, res) => {
    const { sessionId, technicianId, message } = req.body || {};
    if (!sessionId || !technicianId || !message) {
        return res.status(400).json({ error: "Requête invalide" });
    }
    try {
        // Utiliser role='technician' et enregistrer agent_id dans metadata/agent_id
        await db.query(
            "INSERT INTO chat_messages (session_id, role, content, agent_id) VALUES (?, 'technician', ?, ?)",
            [sessionId, message, technicianId]
        );
        await db.query("UPDATE chat_sessions SET last_activity = NOW() WHERE id = ?", [sessionId]);
        return res.json({ ok: true });
    } catch (err) {
        console.error("Erreur /api/support/message :", err);
        return res.status(500).json({ error: "Erreur serveur" });
    }
});

// Endpoint utile pour récupérer les messages d'une session (frontend / technicien)
app.get("/api/session/messages", async (req, res) => {
    const sessionId = req.query.sessionId;
    if (!sessionId) {
        return res.status(400).json({ error: "sessionId manquant" });
    }
    try {
        const [rows] = await db.query(
            "SELECT id, session_id, role, content, agent_id, metadata, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
            [sessionId]
        );
        return res.json({ messages: rows });
    } catch (e) {
        console.error("Erreur /api/session/messages :", e);
        return res.status(500).json({ error: "Erreur serveur" });
    }
});

// =======================
// Endpoint de test : envoyer le résumé Telegram manuellement pour une session (utile pour tests)
app.post('/api/support/notify-summary', async (req, res) => {
    const { sessionId } = req.body || {};
    if (!sessionId) return res.status(400).json({ error: 'sessionId manquant' });

    try {
        const [rows] = await db.query(
            "SELECT role, content, created_at FROM chat_messages WHERE session_id = ? ORDER BY created_at ASC",
            [sessionId]
        );

        const lastMessages = (rows || []).slice(-30).map(m => {
            const role = (m.role || 'unknown').toUpperCase();
            const content = (m.content || '').replace(/\r?\n/g, ' ');
            return `- ${role}: ${content}`;
        }).join('\n');

        const summary = `Historique (derniers messages):\n${lastMessages}`;
        const limited = escapeMarkdown(summary).slice(0, 1500);
        await sendTelegramSummary(sessionId, limited);
        return res.json({ ok: true });
    } catch (e) {
        console.error('Erreur notify-summary :', e);
        return res.status(500).json({ error: 'erreur serveur' });
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
