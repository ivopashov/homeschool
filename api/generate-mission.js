export default async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = request.body || {};
  const subject = String(body.subject || "math").toLowerCase();
  if (subject !== "math") {
    response.status(400).json({ error: "Only math generation is implemented right now." });
    return;
  }

  const difficulty = clamp(Number(body.difficulty || 5), 1, 10);
  const samples = String(body.samples || "").trim();

  if (!process.env.OPENAI_API_KEY) {
    response.status(200).json(generateFallbackMathMission(difficulty, samples));
    return;
  }

  try {
    const generated = await generateWithOpenAI(difficulty, samples, body.learner || {});
    response.status(200).json(generated);
  } catch {
    response.status(200).json(generateFallbackMathMission(difficulty, samples));
  }
}

async function generateWithOpenAI(difficulty, samples, learner) {
  const prompt = {
    role: "system",
    content:
      "Generate a JSON-only multiple-choice math mission for a 9-year-old. Keep it age appropriate, clear, and suitable for a web app. Every question must have exactly 4 choices and one answer that exactly matches one choice.",
  };
  const user = {
    role: "user",
    content: JSON.stringify({
      learner,
      difficulty,
      samples,
      requiredShape: {
        title: "string",
        detail: "short string",
        brief: "short instruction string",
        questions: [
          {
            prompt: "string",
            type: "choice",
            choices: ["string", "string", "string", "string"],
            answer: "string that exactly matches one choice",
            hint: "short hint shown after a wrong answer",
          },
        ],
      },
      rules: [
        "Return only valid JSON.",
        "Generate 6 multiple-choice questions.",
        "Use the pasted samples as style and topic inspiration, not as exact copies.",
        "Difficulty 1-3: arithmetic and simple patterns.",
        "Difficulty 4-6: fractions, multi-step word problems, patterns.",
        "Difficulty 7-10: harder fractions, percentages, ratios, tennis or money contexts.",
        "Avoid explanation/text-entry questions for now.",
      ],
    }),
  };

  const openaiResponse = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input: [prompt, user],
      text: { format: { type: "json_object" } },
      max_output_tokens: 900,
    }),
  });

  if (!openaiResponse.ok) throw new Error("OpenAI request failed");
  const data = await openaiResponse.json();
  const text =
    data.output_text ||
    data.output?.flatMap((item) => item.content || []).find((item) => item.text)?.text ||
    "";
  return normalizeMission(JSON.parse(text), difficulty);
}

function generateFallbackMathMission(difficulty, samples) {
  const sampleLines = samples
    .split(/\n+/)
    .map((line) => line.trim())
    .filter(Boolean);
  const context = sampleLines.some((line) => /tennis|leva|money|discount|percent/i.test(line)) ? "tennis and money" : "patterns and fractions";
  const n = 8 + difficulty;
  const multiplier = difficulty >= 7 ? 3 : 2;
  const percent = difficulty >= 7 ? 25 : difficulty >= 4 ? 20 : 10;
  const price = 40 + difficulty * 5;
  const discounted = price * (1 - percent / 100);

  return normalizeMission(
    {
      title: `Math Power Ladder D${difficulty}`,
      detail: `Generated ${context} practice based on parent difficulty ${difficulty}/10.`,
      brief: sampleLines.length
        ? "These problems are generated from the style of the examples pasted by the parent. Solve carefully and explain one answer."
        : "These problems are generated from the parent difficulty setting. Solve carefully and explain one answer.",
      questions: [
        makeChoiceQuestion(`What is ${multiplier}/4 of ${n * 4}?`, multiplier * n, "Split the whole into four equal groups first."),
        makeChoiceQuestion(`Continue the pattern: ${n}, ${n * 2}, ${n * 4}, ${n * 8}, __`, n * 16, "Find what happens from one number to the next."),
        makeChoiceQuestion(`A tennis lesson costs ${price} leva before a ${percent}% discount. What is the discounted price?`, discounted, "Find the discount amount, then subtract it."),
        makeChoiceQuestion(`Konstantin wins ${difficulty + 5} tennis points in each of 4 games. How many points is that?`, (difficulty + 5) * 4, "Equal groups usually means multiplication."),
        makeChoiceQuestion(`Which number is ${difficulty + 2} more than ${n * 3}?`, n * 3 + difficulty + 2, "Add the extra amount."),
        makeChoiceQuestion(`Half of a training session is ${20 + difficulty} minutes. How long is the full session?`, (20 + difficulty) * 2, "If half is known, double it."),
      ],
    },
    difficulty
  );
}

function normalizeMission(mission, difficulty) {
  const questions = Array.isArray(mission.questions) ? mission.questions.slice(0, 8) : [];
  return {
    title: mission.title || `Math Power Ladder D${difficulty}`,
    detail: mission.detail || `Generated math practice at difficulty ${difficulty}/10.`,
    brief: mission.brief || "Solve the problems and explain your reasoning.",
    questions: questions.map(normalizeQuestion).filter(Boolean),
  };
}

function normalizeQuestion(question) {
  const answer = question.answer === undefined ? question.answers?.[0] : question.answer;
  if (Array.isArray(question.choices) && answer !== undefined) {
    const answerText = String(answer);
    const choices = [...new Set([answerText, ...question.choices.map(String)])].slice(0, 4);
    while (choices.length < 4) choices.push(String(Number(answerText) + choices.length + 1));
    return {
      prompt: String(question.prompt || "Solve the problem."),
      type: "choice",
      choices: shuffle(choices),
      answer: answerText,
      hint: question.hint ? String(question.hint) : "Try the operation step by step.",
    };
  }
  return null;
}

function makeChoiceQuestion(prompt, answer, hint) {
  const formattedAnswer = formatNumber(answer);
  const numeric = Number(formattedAnswer);
  const rawChoices = Number.isFinite(numeric)
    ? [numeric, numeric + 2, Math.max(0, numeric - 2), Math.round(numeric * 1.25)]
    : [formattedAnswer];
  const choices = [...new Set(rawChoices.map(formatNumber))]
    .filter((choice) => choice !== "")
    .slice(0, 4);
  while (choices.length < 4) {
    choices.push(formatNumber(Number(formattedAnswer) + choices.length + 3));
  }
  return {
    prompt,
    type: "choice",
    choices: shuffle(choices),
    answer: formattedAnswer,
    hint,
  };
}

function shuffle(items) {
  return items
    .map((item) => ({ item, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ item }) => item);
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

function formatNumber(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return String(value);
  return Number.isInteger(number) ? String(number) : number.toFixed(2).replace(/\.?0+$/, "");
}
