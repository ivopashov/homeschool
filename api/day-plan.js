const { getDayPlanByDate, getDayPlans, saveDayPlan } = require("../db");

module.exports = async function handler(request, response) {
  if (request.method === "GET") {
    const url = new URL(request.url || "/api/day-plan", "http://localhost");
    const planDate = url.searchParams.get("date");
    if (planDate) {
      response.status(200).json({ plan: await getDayPlanByDate(planDate) });
      return;
    }
    response.status(200).json({ plans: await getDayPlans(30) });
    return;
  }

  if (request.method !== "POST") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }

  const body = request.body || {};
  const plan = await saveDayPlan({
    planDate: String(body.planDate || ""),
    instructions: String(body.instructions || ""),
    samples: String(body.samples || ""),
    imageDataUrl: String(body.imageDataUrl || ""),
    breakMinutes: Number(body.breakMinutes || 5),
  });

  response.status(200).json({ plan });
};
