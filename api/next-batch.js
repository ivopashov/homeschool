const { generateMathBatch } = require("../math-generator");
const { getDayPlanByDate, getSession, getYesterdaySessions, saveSession } = require("../db");

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const session = await getSession(request.body?.sessionId);
  const plan = session ? await getDayPlanByDate(session.planDate) : null;
  if (!session || !plan) {
    response.status(404).json({ error: "Session or day plan not found" });
    return;
  }
  if (session.batches.length >= 3) {
    session.status = "complete";
    await saveSession(session);
    response.status(200).json({ session });
    return;
  }

  const batchNumber = session.batches.length + 1;
  const generated = await generateMathBatch({
    plan,
    session,
    history: await getYesterdaySessions(),
    batchNumber,
  });

  session.status = "active";
  session.currentBatchNumber = batchNumber;
  session.batches.push({
    id: crypto.randomUUID(),
    batchNumber,
    title: generated.title,
    brief: generated.brief,
    questions: generated.questions,
    answers: Array(generated.questions.length).fill(null),
    createdAt: new Date().toISOString(),
  });

  await saveSession(session);
  response.status(200).json({ session });
};
