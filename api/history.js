const { getSessions } = require("../db");

module.exports = async function handler(request, response) {
  if (request.method !== "GET") {
    response.status(405).json({ error: "Method not allowed" });
    return;
  }
  response.status(200).json({ sessions: await getSessions(12) });
};
