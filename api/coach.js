export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    response.status(204).end();
    return;
  }

  const body = request.body || {};
  const prompt = [
    "You are Coach Nia, a concise learning coach for a 9-year-old bilingual Bulgarian/English boy.",
    "Give one friendly, specific sentence of feedback. No emojis. Do not solve the task for him.",
    `Mission: ${body.mission}`,
    `Subject: ${body.subject}`,
    `Score: ${body.passed}/${body.total}`,
  ].join("\n");

  try {
    const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${apiKey}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
        input: prompt,
        max_output_tokens: 80,
      }),
    });

    if (!openaiResponse.ok) {
      response.status(204).end();
      return;
    }

    const data = await openaiResponse.json();
    const feedback =
      data.output_text ||
      data.output?.flatMap((item) => item.content || []).find((item) => item.text)?.text ||
      "";

    response.status(200).json({ feedback });
  } catch {
    response.status(204).end();
  }
}
