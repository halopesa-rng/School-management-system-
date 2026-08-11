require("dotenv").config();

const express = require("express");
const cors = require("cors");
const path = require("path");
const bcrypt = require("bcryptjs");
const pool = require("./db");
const { verifyTelegramInitData, signAdmin, requireAdmin } = require("./auth");
const { startBot, notify } = require("./bot");

const app = express();
const PORT = process.env.PORT || 3000;

app.use(cors());
app.use(express.json({ limit: "1mb" }));
app.use(express.urlencoded({ extended: true }));
app.use(express.static(path.join(__dirname, "../client")));

app.get("/api/health", async (req, res) => {
  try {
    await pool.query("SELECT 1");
    res.json({ ok: true, service: "greenstar-school", time: new Date().toISOString() });
  } catch (e) {
    res.status(503).json({ ok: false, error: "Database unavailable" });
  }
});

async function getTelegramUser(req) {
  const user = verifyTelegramInitData(req.headers["x-telegram-init-data"] || "");
  if (!user || !user.id) return null;
  return user;
}

async function guardianStudents(telegramId) {
  const q = await pool.query(`
    SELECT s.* FROM students s
    JOIN guardians g ON g.id=s.guardian_id
    WHERE g.telegram_id=$1 AND s.status='active'
    ORDER BY s.full_name
  `, [telegramId]);
  return q.rows;
}

app.post("/api/auth/telegram", async (req, res) => {
  const user = verifyTelegramInitData(req.body.initData || req.headers["x-telegram-init-data"] || "");
  if (!user) return res.status(401).json({ error: "Invalid Telegram authentication data" });

  const q = await pool.query(
    `SELECT g.id,g.full_name,g.phone FROM guardians g WHERE g.telegram_id=$1`,
    [user.id]
  );
  if (!q.rowCount) {
    await pool.query(
      `INSERT INTO guardians(telegram_id,full_name) VALUES($1,$2) ON CONFLICT(telegram_id) DO NOTHING`,
      [user.id, [user.first_name, user.last_name].filter(Boolean).join(" ") || "Telegram Parent"]
    );
  }
  res.json({ user, linked: !!q.rowCount, message: q.rowCount ? "Authenticated" : "Account created; contact school to link your student." });
});

app.get("/api/me", async (req, res) => {
  const user = await getTelegramUser(req);
  if (!user) return res.status(401).json({ error: "Telegram authentication required" });
  const guardian = await pool.query(`SELECT id,full_name,phone FROM guardians WHERE telegram_id=$1`, [user.id]);
  const students = await guardianStudents(user.id);
  const announcements = (await pool.query(
    `SELECT id,title,body,audience,created_at FROM announcements WHERE published=true ORDER BY created_at DESC LIMIT 10`
  )).rows;
  res.json({ user, guardian: guardian.rows[0] || null, students, announcements });
});

app.get("/api/students", async (req, res) => {
  const user = await getTelegramUser(req);
  if (!user) return res.status(401).json({ error: "Telegram authentication required" });
  res.json(await guardianStudents(user.id));
});

async function ownedStudent(req, studentId) {
  const user = await getTelegramUser(req);
  if (!user) return null;
  const q = await pool.query(`
    SELECT s.* FROM students s JOIN guardians g ON g.id=s.guardian_id
    WHERE s.id=$1 AND g.telegram_id=$2
  `, [studentId, user.id]);
  return q.rows[0] || null;
}

app.get("/api/students/:id", async (req, res) => {
  const student = await ownedStudent(req, req.params.id);
  if (!student) return res.status(404).json({ error: "Student not found" });
  res.json(student);
});

app.get("/api/students/:id/results", async (req, res) => {
  const student = await ownedStudent(req, req.params.id);
  if (!student) return res.status(404).json({ error: "Student not found" });
  const q = await pool.query(
    `SELECT * FROM results WHERE student_id=$1 ORDER BY year DESC,term DESC,subject`,
    [student.id]
  );
  res.json(q.rows);
});

app.get("/api/students/:id/fees", async (req, res) => {
  const student = await ownedStudent(req, req.params.id);
  if (!student) return res.status(404).json({ error: "Student not found" });
  const q = await pool.query(
    `SELECT * FROM fee_records WHERE student_id=$1 ORDER BY year DESC,term DESC,payment_date DESC`,
    [student.id]
  );
  const totals = await pool.query(
    `SELECT COALESCE(SUM(amount_due),0) due, COALESCE(SUM(amount_paid),0) paid
     FROM fee_records WHERE student_id=$1`, [student.id]
  );
  res.json({ records: q.rows, totals: totals.rows[0] });
});

app.get("/api/students/:id/attendance", async (req, res) => {
  const student = await ownedStudent(req, req.params.id);
  if (!student) return res.status(404).json({ error: "Student not found" });
  const q = await pool.query(
    `SELECT * FROM attendance WHERE student_id=$1 ORDER BY attendance_date DESC LIMIT 100`,
    [student.id]
  );
  res.json(q.rows);
});

app.get("/api/students/:id/assignments", async (req, res) => {
  const student = await ownedStudent(req, req.params.id);
  if (!student) return res.status(404).json({ error: "Student not found" });
  const q = await pool.query(
    `SELECT * FROM assignments WHERE class_name=$1 ORDER BY due_date ASC NULLS LAST`,
    [student.class_name]
  );
  res.json(q.rows);
});

app.get("/api/announcements", async (req, res) => {
  const q = await pool.query(`SELECT * FROM announcements WHERE published=true ORDER BY created_at DESC LIMIT 50`);
  res.json(q.rows);
});

app.get("/api/teachers", async (req, res) => {
  const q = await pool.query(`SELECT id,full_name,subject,phone,email FROM teachers ORDER BY full_name`);
  res.json(q.rows);
});

// Admin
app.post("/api/admin/login", async (req, res) => {
  const { username, password } = req.body || {};
  const q = await pool.query(`SELECT * FROM admins WHERE username=$1`, [username]);
  if (!q.rowCount || !(await bcrypt.compare(password || "", q.rows[0].password_hash))) {
    return res.status(401).json({ error: "Invalid username or password" });
  }
  res.json({ token: signAdmin(q.rows[0]) });
});

app.get("/api/admin/students", requireAdmin, async (req, res) => {
  const q = await pool.query(`
    SELECT s.*,g.full_name AS guardian_name,g.telegram_id,g.phone AS guardian_phone
    FROM students s LEFT JOIN guardians g ON g.id=s.guardian_id
    ORDER BY s.full_name
  `);
  res.json(q.rows);
});

app.post("/api/admin/students", requireAdmin, async (req, res) => {
  const { admission_no, full_name, gender, date_of_birth, class_name, stream, telegram_id, guardian_name, guardian_phone } = req.body;
  let guardianId = null;
  if (telegram_id) {
    const g = await pool.query(
      `INSERT INTO guardians(telegram_id,full_name,phone) VALUES($1,$2,$3)
       ON CONFLICT(telegram_id) DO UPDATE SET full_name=EXCLUDED.full_name,phone=EXCLUDED.phone RETURNING id`,
      [telegram_id, guardian_name || "Parent", guardian_phone || null]
    );
    guardianId = g.rows[0].id;
  }
  const q = await pool.query(
    `INSERT INTO students(admission_no,full_name,gender,date_of_birth,class_name,stream,guardian_id)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [admission_no,full_name,gender||null,date_of_birth||null,class_name,stream||null,guardianId]
  );
  res.status(201).json(q.rows[0]);
});

app.put("/api/admin/students/:id", requireAdmin, async (req, res) => {
  const { full_name, gender, date_of_birth, class_name, stream, status } = req.body;
  const q = await pool.query(
    `UPDATE students SET full_name=COALESCE($1,full_name),gender=COALESCE($2,gender),
     date_of_birth=COALESCE($3,date_of_birth),class_name=COALESCE($4,class_name),
     stream=COALESCE($5,stream),status=COALESCE($6,status) WHERE id=$7 RETURNING *`,
    [full_name,gender,date_of_birth,class_name,stream,status,req.params.id]
  );
  if (!q.rowCount) return res.status(404).json({error:"Student not found"});
  res.json(q.rows[0]);
});

app.post("/api/admin/results", requireAdmin, async (req, res) => {
  const { student_id, term, year, subject, score, grade, teacher_comment } = req.body;
  const q = await pool.query(
    `INSERT INTO results(student_id,term,year,subject,score,grade,teacher_comment)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [student_id,term,year,subject,score,grade||null,teacher_comment||null]
  );
  res.status(201).json(q.rows[0]);
});

app.post("/api/admin/fees", requireAdmin, async (req, res) => {
  const { student_id,term,year,amount_due,amount_paid,reference,payment_date } = req.body;
  const q = await pool.query(
    `INSERT INTO fee_records(student_id,term,year,amount_due,amount_paid,reference,payment_date)
     VALUES($1,$2,$3,$4,$5,$6,$7) RETURNING *`,
    [student_id,term,year,amount_due||0,amount_paid||0,reference||null,payment_date||null]
  );
  res.status(201).json(q.rows[0]);
});

app.post("/api/admin/attendance", requireAdmin, async (req, res) => {
  const { student_id,attendance_date,status,remark } = req.body;
  const q = await pool.query(
    `INSERT INTO attendance(student_id,attendance_date,status,remark)
     VALUES($1,$2,$3,$4)
     ON CONFLICT(student_id,attendance_date)
     DO UPDATE SET status=EXCLUDED.status,remark=EXCLUDED.remark RETURNING *`,
    [student_id,attendance_date,status,remark||null]
  );
  res.json(q.rows[0]);
});

app.post("/api/admin/assignments", requireAdmin, async (req, res) => {
  const { class_name,subject,title,description,due_date } = req.body;
  const q = await pool.query(
    `INSERT INTO assignments(class_name,subject,title,description,due_date)
     VALUES($1,$2,$3,$4,$5) RETURNING *`,
    [class_name,subject,title,description||null,due_date||null]
  );
  res.status(201).json(q.rows[0]);
});

app.post("/api/admin/announcements", requireAdmin, async (req, res) => {
  const { title,body,audience,published } = req.body;
  const q = await pool.query(
    `INSERT INTO announcements(title,body,audience,published)
     VALUES($1,$2,$3,$4) RETURNING *`,
    [title,body,audience||"all",published !== false]
  );
  res.status(201).json(q.rows[0]);

  // Notification is intentionally best-effort; DB write is the source of truth.
  if (process.env.ADMIN_CHAT_ID) {
    notify(process.env.ADMIN_CHAT_ID, `Announcement published: ${title}`);
  }
});

app.get("*splat", (req, res) => {
  res.sendFile(path.join(__dirname, "../client/index.html"));
});

startBot();

app.listen(PORT, () => console.log(`Green Star server running on port ${PORT}`));
