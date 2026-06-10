function buildGenerationContext({ plan, session, history, batchNumber }) {
  const previousBatches = session?.batches || [];
  const previousPrompts = previousBatches.flatMap((batch) => batch.questions.map((question) => question.prompt));
  return {
    parentInstructions: plan.instructions,
    pastedExamples: plan.samples,
    hasUploadedImage: Boolean(plan.imageDataUrl),
    previousPrompts,
    yesterday: summarizeSessions(history),
    previousBatches: previousBatches.map((batch) => ({
      batchNumber: batch.batchNumber,
      questions: batch.questions.map((question, index) => ({
        prompt: question.prompt,
        correctAnswer: question.answer,
        explanation: question.explanation,
        childAnswer: batch.answers[index]?.choice || null,
        isCorrect: batch.answers[index]?.isCorrect || false,
      })),
    })),
    batchNumber,
  };
}

async function generateMathBatch({ plan, session, history, batchNumber }) {
  const context = buildGenerationContext({ plan, session, history, batchNumber });
  if (process.env.OPENAI_API_KEY) {
    try {
      return await generateWithOpenAI(context, plan, batchNumber);
    } catch {
      return generateFallbackBatch(context, batchNumber);
    }
  }
  return generateFallbackBatch(context, batchNumber);
}

async function generateWithOpenAI(context, plan, batchNumber) {
  const system = [
    "You generate adaptive math practice for a 9-year-old child.",
    "Parent instructions are the highest-priority learning target. Follow them closely unless they are unsafe or impossible.",
    "Pasted example problems and uploaded images define the desired style, topic, and difficulty. Imitate the pattern without copying exact questions.",
    "Return only valid JSON matching the requested shape.",
    "Generate exactly 10 multiple-choice questions.",
    "Each question needs prompt, 4 choices, answer, explanation, and optional visual.",
    "The answer must exactly match one choice.",
    "Do not repeat any question from previousPrompts, previousBatches, yesterday, pasted examples, or the current batch.",
    "Do not make near-duplicates by changing only numbers or wording; vary the operation, context, or reasoning step.",
    "Every now and then include a visual counting problem by setting visual to {\"type\":\"triangles\",\"count\": number}.",
    "Use previous wrong answers to target weak spots. If previous work was strong, increase difficulty slightly.",
  ].join("\n");

  const userPayload = {
    context,
    requiredShape: {
      title: "string",
      brief: "string",
      questions: [
        {
          prompt: "string",
          choices: ["string", "string", "string", "string"],
          answer: "string matching one choice",
          explanation: "short child-friendly explanation",
          visual: "optional object, for example { type: 'triangles', count: 6 }",
        },
      ],
    },
  };

  const input = [
    { role: "system", content: system },
    {
      role: "user",
      content: [
        { type: "input_text", text: JSON.stringify(userPayload) },
        ...(plan.imageDataUrl ? [{ type: "input_image", image_url: plan.imageDataUrl }] : []),
      ],
    },
  ];

  const response = await fetch("https://api.openai.com/v1/responses", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${process.env.OPENAI_API_KEY}`,
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      model: process.env.OPENAI_MODEL || "gpt-4.1-mini",
      input,
      text: { format: { type: "json_object" } },
      max_output_tokens: 2200,
    }),
  });

  if (!response.ok) throw new Error("OpenAI request failed");
  const data = await response.json();
  const text =
    data.output_text ||
    data.output?.flatMap((item) => item.content || []).find((item) => item.text)?.text ||
    "";
  return normalizeBatch(JSON.parse(text), batchNumber);
}

function generateFallbackBatch(context, batchNumber) {
  const wrongCount = context.previousBatches.flatMap((batch) => batch.questions).filter((question) => !question.isCorrect).length;
  const base = 8 + batchNumber * 3 + Math.max(0, 3 - wrongCount);
  const questions = [];

  for (let index = 0; index < 10; index += 1) {
    if (index === 4 && batchNumber % 2 === 1) {
      questions.push(makeVisualQuestion(5 + batchNumber));
      continue;
    }
    const a = base + index;
    const b = 2 + ((index + batchNumber) % 6);
    const games = batchNumber + 3 + index;
    if (index % 3 === 0) questions.push(makeChoiceQuestion(`What is ${a} + ${b * 3}?`, a + b * 3, "Add the second number carefully."));
    else if (index % 3 === 1) questions.push(makeChoiceQuestion(`Konstantin wins ${b} points in each of ${games} tennis games. How many points is that?`, b * games, "Equal groups means multiplication."));
    else questions.push(makeChoiceQuestion(`What is half of ${a * 2}?`, a, "Half means split into two equal parts."));
  }

  return {
    title: `Math Batch ${batchNumber}`,
    brief: "Generated from the parent plan and saved previous answers.",
    questions,
  };
}

function makeVisualQuestion(count) {
  return {
    prompt: "How many triangles are in the picture?",
    choices: shuffle([count, count + 1, Math.max(1, count - 1), count + 2].map(String)),
    answer: String(count),
    explanation: "Count each triangle once from left to right.",
    visual: { type: "triangles", count },
  };
}

function makeChoiceQuestion(prompt, answer, explanation) {
  const choices = shuffle([answer, answer + 2, Math.max(0, answer - 2), answer + 5].map(String));
  return { prompt, choices, answer: String(answer), explanation };
}

function normalizeBatch(batch, batchNumber) {
  const seen = new Set();
  const questions = Array.isArray(batch.questions)
    ? batch.questions.map(normalizeQuestion).filter((question) => {
        if (!question) return false;
        const key = question.prompt.toLowerCase().replace(/\d+/g, "#").replace(/\s+/g, " ").trim();
        if (seen.has(key)) return false;
        seen.add(key);
        return true;
      }).slice(0, 10)
    : [];
  while (questions.length < 10) {
    questions.push(makeChoiceQuestion(`What is ${questions.length + 8} + ${batchNumber + 4}?`, questions.length + 8 + batchNumber + 4, "Add the two numbers."));
  }
  return {
    title: batch.title || `Math Batch ${batchNumber}`,
    brief: batch.brief || "Generated math practice.",
    questions,
  };
}

function normalizeQuestion(question) {
  if (!question?.prompt || !Array.isArray(question.choices) || question.answer === undefined) return null;
  const answer = String(question.answer);
  const choices = [...new Set([answer, ...question.choices.map(String)])].slice(0, 4);
  while (choices.length < 4) choices.push(String(Number(answer) + choices.length + 1));
  return {
    prompt: String(question.prompt),
    choices: shuffle(choices),
    answer,
    explanation: question.explanation ? String(question.explanation) : "Work through the problem one step at a time.",
    visual: question.visual?.type === "triangles" ? { type: "triangles", count: Number(question.visual.count || answer) } : undefined,
  };
}

function summarizeSessions(sessions) {
  return sessions.map((session) => ({
    createdAt: session.createdAt,
    batches: session.batches.map((batch) => ({
      batchNumber: batch.batchNumber,
      correct: batch.answers.filter((answer) => answer?.isCorrect).length,
      total: batch.answers.filter(Boolean).length,
      missed: batch.questions
        .map((question, index) => ({ question, answer: batch.answers[index] }))
        .filter((item) => item.answer && !item.answer.isCorrect)
        .map((item) => ({
          prompt: item.question.prompt,
          correctAnswer: item.question.answer,
          childAnswer: item.answer.choice,
        })),
    })),
  }));
}

function shuffle(items) {
  return items
    .map((item) => ({ item, sort: Math.random() }))
    .sort((a, b) => a.sort - b.sort)
    .map(({ item }) => item);
}

module.exports = { generateMathBatch };
