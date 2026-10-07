import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import express from "express";

function loadEnvFile(envPath) {
  let raw = "";
  try {
    raw = readFileSync(envPath, "utf8");
  } catch {
    return;
  }

  for (const line of raw.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const separator = trimmed.indexOf("=");
    if (separator === -1) continue;
    const key = trimmed.slice(0, separator).trim();
    const value = trimmed.slice(separator + 1).trim();
    if (key && process.env[key] === undefined) process.env[key] = value;
  }
}

const backendDir = dirname(fileURLToPath(import.meta.url));
loadEnvFile(resolve(backendDir, ".env"));
loadEnvFile(resolve(backendDir, "../.env"));

const app = express();
const port = Number(process.env.PORT) || 3001;
const apiKey = process.env.GEMINI_API_KEY;
const model = process.env.GEMINI_MODEL || "gemini-3.8-flash";

app.use(express.json({ limit: "1mb" }));

app.use((req, res, next) => {
  res.setHeader("Access-Control-Allow-Origin", "*");
  res.setHeader("Access-Control-Allow-Headers", "Content-Type");
  res.setHeader("Access-Control-Allow-Methods", "POST, OPTIONS");
  if (req.method === "OPTIONS") {
    res.sendStatus(204);
    return;
  }
  next();
});

app.post("/api/rewrite", async (req, res) => {
  try {
    const text = req.body?.text;
    const instruction = req.body?.instruction;

    if (typeof text !== "string" || text.trim() === "") {
      res.status(400).json({ error: "text is required" });
      return;
    }
    if (typeof instruction !== "string" || instruction.trim() === "") {
      res.status(400).json({ error: "instruction is required" });
      return;
    }
    if (text.length > 20000) {
      res.status(400).json({ error: "text must be 20000 characters or fewer" });
      return;
    }
    if (instruction.length > 500) {
      res.status(400).json({ error: "instruction must be 500 characters or fewer" });
      return;
    }
    if (!apiKey) {
      res.status(500).json({ error: "GEMINI_API_KEY is not set" });
      return;
    }

    const prompt = [
      "Rewrite the text below so it follows the instruction.",
      "Return only the rewritten text. Do not add a title, quotes, or explanation.",
      "",
      `Instruction: ${instruction.trim()}`,
      "",
      "Text:",
      text,
    ].join("\n");

    const geminiResponse = await fetch(
      `https://generativelanguage.googleapis.com/v1beta/models/${model}:generateContent`,
      {
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "x-goog-api-key": apiKey,
        },
        body: JSON.stringify({
          contents: [{ role: "user", parts: [{ text: prompt }] }],
          generationConfig: { temperature: 0.8 },
        }),
      },
    );

    const data = await geminiResponse.json();

    if (!geminiResponse.ok) {
      const message = data?.error?.message || "Gemini request failed";
      res.status(502).json({ error: message });
      return;
    }

    const result = data?.candidates?.[0]?.content?.parts
      ?.map((part) => part.text || "")
      .join("")
      .trim();

    if (!result) {
      res.status(502).json({
        error: "Gemini returned no text",
        finishReason: data?.candidates?.[0]?.finishReason || null,
      });
      return;
    }

    res.json({ text: result });
  } catch {
    res.status(500).json({ error: "Rewrite failed" });
  }
});

app.listen(port, () => {
  console.log(`Rewrite API listening on http://localhost:${port}`);
});
