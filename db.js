const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

const dbDir = path.join(__dirname, ".data");
const dbPath = path.join(dbDir, "db.json");

let sqlClientPromise;
let schemaReadyPromise;

async function getSql() {
  if (!process.env.DATABASE_URL) return null;
  if (!sqlClientPromise) {
    sqlClientPromise = import("@neondatabase/serverless").then(({ neon }) => neon(process.env.DATABASE_URL));
  }
  return sqlClientPromise;
}

async function ensureSchema() {
  const sql = await getSql();
  if (!sql) return;
  if (!schemaReadyPromise) {
    schemaReadyPromise = (async () => {
      await sql`
        create table if not exists day_plans (
          id text primary key,
          plan_date date not null unique,
          created_at timestamptz not null,
          updated_at timestamptz not null,
          instructions text not null,
          samples text not null,
          image_data_url text not null,
          break_minutes integer not null
        )
      `;
      await sql`
        create table if not exists math_sessions (
          id text primary key,
          created_at timestamptz not null,
          status text not null,
          current_batch_number integer not null,
          break_minutes integer not null,
          day_plan_id text not null,
          plan_date date not null,
          batches jsonb not null
        )
      `;
      await sql`alter table day_plans add column if not exists plan_date date`;
      await sql`alter table day_plans add column if not exists updated_at timestamptz`;
      await sql`alter table math_sessions add column if not exists plan_date date`;
      await sql`create unique index if not exists day_plans_plan_date_key on day_plans (plan_date)`;
    })();
  }
  await schemaReadyPromise;
}

function readLocalDb() {
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  if (!fs.existsSync(dbPath)) return { dayPlans: [], sessions: [] };
  try {
    return JSON.parse(fs.readFileSync(dbPath, "utf8"));
  } catch {
    return { dayPlans: [], sessions: [] };
  }
}

function writeLocalDb(db) {
  if (!fs.existsSync(dbDir)) fs.mkdirSync(dbDir, { recursive: true });
  fs.writeFileSync(dbPath, JSON.stringify(db, null, 2));
}

async function saveDayPlan(plan) {
  const now = new Date().toISOString();
  const record = {
    id: crypto.randomUUID(),
    planDate: normalizeDate(plan.planDate),
    createdAt: now,
    updatedAt: now,
    instructions: plan.instructions || "",
    samples: plan.samples || "",
    imageDataUrl: plan.imageDataUrl || "",
    breakMinutes: Number(plan.breakMinutes || 5),
  };

  const sql = await getSql();
  if (sql) {
    await ensureSchema();
    await sql`
      insert into day_plans (id, plan_date, created_at, updated_at, instructions, samples, image_data_url, break_minutes)
      values (${record.id}, ${record.planDate}, ${record.createdAt}, ${record.updatedAt}, ${record.instructions}, ${record.samples}, ${record.imageDataUrl}, ${record.breakMinutes})
      on conflict (plan_date) do update set
        updated_at = excluded.updated_at,
        instructions = excluded.instructions,
        samples = excluded.samples,
        image_data_url = excluded.image_data_url,
        break_minutes = excluded.break_minutes
    `;
    return getDayPlanByDate(record.planDate);
  }

  const db = readLocalDb();
  const index = db.dayPlans.findIndex((item) => item.planDate === record.planDate);
  if (index === -1) db.dayPlans.unshift(record);
  else db.dayPlans[index] = { ...db.dayPlans[index], ...record, id: db.dayPlans[index].id, createdAt: db.dayPlans[index].createdAt };
  writeLocalDb(db);
  return getDayPlanByDate(record.planDate);
}

async function getDayPlanByDate(planDate) {
  const normalized = normalizeDate(planDate);
  const sql = await getSql();
  if (sql) {
    await ensureSchema();
    const rows = await sql`
      select id, plan_date, created_at, updated_at, instructions, samples, image_data_url, break_minutes
      from day_plans
      where plan_date = ${normalized}
      limit 1
    `;
    return rows[0] ? mapDayPlan(rows[0]) : null;
  }

  return readLocalDb().dayPlans.find((plan) => plan.planDate === normalized) || null;
}

async function getDayPlans(limit = 30) {
  const sql = await getSql();
  if (sql) {
    await ensureSchema();
    const rows = await sql`
      select id, plan_date, created_at, updated_at, instructions, samples, image_data_url, break_minutes
      from day_plans
      order by plan_date desc
      limit ${limit}
    `;
    return rows.map(mapDayPlan);
  }

  return [...readLocalDb().dayPlans]
    .sort((a, b) => String(b.planDate).localeCompare(String(a.planDate)))
    .slice(0, limit);
}

async function getYesterdaySessions() {
  const since = new Date(Date.now() - 36 * 60 * 60 * 1000).toISOString();
  const sql = await getSql();
  if (sql) {
    await ensureSchema();
    const rows = await sql`
      select id, created_at, status, current_batch_number, break_minutes, day_plan_id, plan_date, batches
      from math_sessions
      where created_at >= ${since}
      order by created_at desc
      limit 3
    `;
    return rows.map(mapSession);
  }

  return readLocalDb()
    .sessions.filter((session) => new Date(session.createdAt).getTime() >= new Date(since).getTime())
    .slice(0, 3);
}

async function saveSession(session) {
  const sql = await getSql();
  if (sql) {
    await ensureSchema();
    await sql`
      insert into math_sessions (id, created_at, status, current_batch_number, break_minutes, day_plan_id, plan_date, batches)
      values (${session.id}, ${session.createdAt}, ${session.status}, ${session.currentBatchNumber}, ${session.breakMinutes}, ${session.dayPlanId}, ${session.planDate}, ${JSON.stringify(session.batches)})
      on conflict (id) do update set
        status = excluded.status,
        current_batch_number = excluded.current_batch_number,
        break_minutes = excluded.break_minutes,
        day_plan_id = excluded.day_plan_id,
        plan_date = excluded.plan_date,
        batches = excluded.batches
    `;
    return session;
  }

  const db = readLocalDb();
  const index = db.sessions.findIndex((item) => item.id === session.id);
  if (index === -1) db.sessions.unshift(session);
  else db.sessions[index] = session;
  writeLocalDb(db);
  return session;
}

async function getSession(id) {
  const sql = await getSql();
  if (sql) {
    await ensureSchema();
    const rows = await sql`
      select id, created_at, status, current_batch_number, break_minutes, day_plan_id, plan_date, batches
      from math_sessions
      where id = ${id}
      limit 1
    `;
    return rows[0] ? mapSession(rows[0]) : null;
  }

  return readLocalDb().sessions.find((session) => session.id === id) || null;
}

async function getSessions(limit = 10) {
  const sql = await getSql();
  if (sql) {
    await ensureSchema();
    const rows = await sql`
      select id, created_at, status, current_batch_number, break_minutes, day_plan_id, plan_date, batches
      from math_sessions
      order by created_at desc
      limit ${limit}
    `;
    return rows.map(mapSession);
  }

  return readLocalDb().sessions.slice(0, limit);
}

function mapDayPlan(row) {
  return {
    id: row.id,
    planDate: String(row.plan_date || row.planDate).slice(0, 10),
    createdAt: row.created_at || row.createdAt,
    updatedAt: row.updated_at || row.updatedAt,
    instructions: row.instructions,
    samples: row.samples,
    imageDataUrl: row.image_data_url || row.imageDataUrl || "",
    breakMinutes: row.break_minutes || row.breakMinutes,
  };
}

function mapSession(row) {
  return {
    id: row.id,
    createdAt: row.created_at || row.createdAt,
    status: row.status,
    currentBatchNumber: row.current_batch_number || row.currentBatchNumber,
    breakMinutes: row.break_minutes || row.breakMinutes,
    dayPlanId: row.day_plan_id || row.dayPlanId,
    planDate: String(row.plan_date || row.planDate).slice(0, 10),
    batches: Array.isArray(row.batches) ? row.batches : JSON.parse(row.batches || "[]"),
  };
}

function normalizeDate(value) {
  return String(value || new Date().toISOString().slice(0, 10)).slice(0, 10);
}

module.exports = {
  getDayPlanByDate,
  getDayPlans,
  getSession,
  getSessions,
  getYesterdaySessions,
  saveDayPlan,
  saveSession,
};
