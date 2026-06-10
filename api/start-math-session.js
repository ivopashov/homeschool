const { generateMathBatch } = require("../math-generator");
const { getDayPlanByDate, getYesterdaySessions, saveSession } = require("../db");
const crypto = require("crypto");

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const planDate = String(request.body?.planDate || new Date().toISOString().slice(0, 10));
  const plan = await getDayPlanByDate(planDate);
  if (!plan) {
    response.status(400).json({ error: `No day plan saved for ${planDate}` });
    return;
  }

  const session = {
    id: crypto.randomUUID(),
    createdAt: new Date().toISOString(),
    status: "active",
    currentBatchNumber: 1,
    breakMinutes: plan.breakMinutes || 5,
    dayPlanId: plan.id,
    planDate: plan.planDate,
    batches: [],
  };
  const generated = await generateMathBatch({
    plan,
    session,
    history: await getYesterdaySessions(),
    batchNumber: 1,
  });

  session.batches.push({
    id: crypto.randomUUID(),
    batchNumber: 1,
    title: generated.title,
    brief: generated.brief,
    questions: generated.questions,
    answers: Array(generated.questions.length).fill(null),
    createdAt: new Date().toISOString(),
  });

  await saveSession(session);
  response.status(200).json({ session });
};
