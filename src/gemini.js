import axios from "axios";

const GEMINI_URL =
    "https://generativelanguage.googleapis.com/v1beta/models/gemini-2.0-flash:generateContent";

export async function askGemini(prompt) {
    const response = await axios.post(
        GEMINI_URL,
        {
            contents: [
                {
                    parts: [{ text: prompt }]
                }
            ]
        },
        {
            params: {
                key: process.env.GEMINI_API_KEY
            }
        }
    );

    return response.data.candidates[0].content.parts[0].text;
}
