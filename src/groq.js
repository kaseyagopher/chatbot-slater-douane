import Groq from "groq-sdk";

const groq = new Groq({ apiKey: process.env.GROQ_API_KEY });

export async function getGroqChatCompletion(prompt) {
    return groq.chat.completions.create({
        messages: [
            {
                role: "system",
                content: "Tu es un assistant IT professionnel. Réponds clairement et brièvement."
            },
            {
                role: "user",
                content: prompt,
            },
        ],
        model: "llama-3.3-70b-versatile", // Modèle performant et gratuit sur Groq
    });
}