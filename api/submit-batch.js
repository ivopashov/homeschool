const { getSession, saveSession } = require("../db");

module.exports = async function handler(request, response) {
  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = request.body || {};
  const session = await getSession(body.sessionId);
  if (!session) {
    response.status(404).json({ error: "Session not found" });
    return;
  }

  const batch = session.batches.find((item) => item.batchNumber === Number(body.batchNumber));
  if (!batch) {
    response.status(404).json({ error: "Batch not found" });
    return;
  }

  batch.answers = Array.isArray(body.answers) ? body.answers : batch.answers;
  batch.submittedAt = new Date().toISOString();

  if (batch.batchNumber >= 3) {
    session.status = "complete";
  } else {
    session.status = "break";
  }

  await saveSession(session);
  response.status(200).json({ session });
};
