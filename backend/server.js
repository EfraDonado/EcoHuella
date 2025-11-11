// servidor principal y dependencias
const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

// Configuración del pool de conexiones a PostgreSQL.
// Las variables vienen de .env (PGHOST, PGPORT, PGUSER, PGPASSWORD, PGDATABASE, PGSSLMODE)
const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE,
  ssl: process.env.PGSSLMODE ? { rejectUnauthorized: false } : false
});

// apartado: manejo de errores del pool (cliente idle)
pool.on('error', (err) => {
  console.error('Error inesperado en cliente idle del pool:', err);
});

app.use(cors());
app.use(express.json());

// apartado: registro de cada petición (logger)
app.use((req, res, next) => {
  console.log(`${new Date().toISOString()} ${req.method} ${req.originalUrl}`);
  next();
});

// Devuelve puntos, retos y premios juntos para que el frontend los muestre sin trabajo extra.
async function loadProgress(client, userId) {
  // apartado: consulta user_points
  const pointsResult = await client.query(
    'SELECT total_points, updated_at FROM user_points WHERE user_id = $1 LIMIT 1',
    [userId]
  );

  // apartado: consulta user_challenges
  const challengesResult = await client.query(
    `SELECT challenge_code AS code, points, completed_at
     FROM user_challenges
     WHERE user_id = $1
     ORDER BY completed_at DESC`,
    [userId]
  );

  // apartado: consulta user_rewards
  const rewardsResult = await client.query(
    `SELECT reward_code AS code, reward_name AS name, cost, redeemed_at
     FROM user_rewards
     WHERE user_id = $1
     ORDER BY redeemed_at DESC`,
    [userId]
  );

  const pointsRow = pointsResult.rows[0] || null;

  return {
    points: pointsRow ? pointsRow.total_points : 0,
    updatedAt: pointsRow ? pointsRow.updated_at : null,
    challenges: challengesResult.rows,
    rewards: rewardsResult.rows
  };
}

const DEFAULT_CALC_HISTORY_LIMIT = 6;

async function findUserByEmail(email) {
  const result = await pool.query(
    'SELECT id, name, email FROM users WHERE email = $1 LIMIT 1',
    [email]
  );
  return result.rows[0] || null;
}

function parseJSONColumn(value) {
  if (value === null || value === undefined) return null;
  if (typeof value === 'string') {
    try {
      return JSON.parse(value);
    } catch (err) {
      console.warn('No se pudo parsear columna JSON:', err);
      return null;
    }
  }
  return value;
}

function mapCalculationRow(row) {
  return {
    id: row.id,
    score: row.score,
    badge: row.badge,
    title: row.title,
    description: row.description,
    metaPercent: row.meta_percent,
    inputs: parseJSONColumn(row.inputs) || {},
    breakdown: parseJSONColumn(row.breakdown) || [],
    focusAreas: parseJSONColumn(row.focus_areas) || [],
    dateISO: row.created_at ? row.created_at.toISOString() : null
  };
}

function clampNumber(value, min, max) {
  const numeric = Number(value);
  if (!Number.isFinite(numeric)) return min;
  const rounded = Math.round(numeric);
  return Math.max(min, Math.min(max, rounded));
}

function sanitizeInputs(inputs = {}) {
  return {
    energia: clampNumber(inputs.energia, 0, 10),
    transporte: clampNumber(inputs.transporte, 0, 10),
    alimentacion: clampNumber(inputs.alimentacion, 0, 10),
    residuos: clampNumber(inputs.residuos, 0, 10),
    consumo: clampNumber(inputs.consumo, 0, 10)
  };
}

function sanitizeBreakdown(breakdown = []) {
  return breakdown.map(item => {
    const numericWeight = Number(item.weight);
    return {
      id: item.id ? String(item.id) : '',
      label: item.label ? String(item.label) : '',
      points: clampNumber(item.points, 0, 100),
      value: clampNumber(item.value, 0, 10),
      weight: Number.isFinite(numericWeight) ? numericWeight : 0
    };
  });
}

function sanitizeFocusAreas(list = []) {
  return list.map(item => ({
    title: item.title ? String(item.title).slice(0, 120) : '',
    action: item.action ? String(item.action).slice(0, 240) : ''
  }));
}

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'API operativa' });
});

app.post('/api/users', async (req, res) => {
  const { name, email, password } = req.body;
  // apartado: datos para crear usuario

  if (!name || !email || !password) {
    return res.status(400).json({ error: 'Por favor envía nombre, correo y contraseña.' });
  }

  try {
    const nuevoUsuario = await pool.query(
      `INSERT INTO users (name, email, password)
       VALUES ($1, $2, $3)
       RETURNING id, name, email, created_at`,
      [name, email, password]
    );

    const user = nuevoUsuario.rows[0];

  // apartado: registro en logs de usuario creado (sin contraseña)
  console.log('Usuario creado:', { id: user.id, name: user.name, email: user.email });

    await pool.query(
      `INSERT INTO user_points (user_id, total_points)
       VALUES ($1, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.id]
    );

    res.status(201).json(user);
  } catch (error) {
    // apartado de error para fallo al guardar usuario
    console.error('Error guardando usuario:', error);

    // apartado de error para correo ya registrado
    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ese correo ya está registrado.' });
    }

    // apartado de error general: no se pudo guardar
    res.status(500).json({ error: 'No se pudo guardar el usuario.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;
  // apartado: datos para login

  if (!email || !password) {
    return res.status(400).json({ error: 'Envía tu correo y contraseña.' });
  }

  try {
    const resultado = await pool.query(
      'SELECT id, name, email, password FROM users WHERE email = $1 LIMIT 1',
      [email]
    );

    if (resultado.rowCount === 0) {
      // apartado de error para usuario no encontrado
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const user = resultado.rows[0];

    // apartado de error para contraseña incorrecta
    if (user.password !== password) {
      return res.status(401).json({ error: 'Contraseña incorrecta.' });
    }

    await pool.query(
      `INSERT INTO user_points (user_id, total_points)
       VALUES ($1, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.id]
    );

    res.json({ id: user.id, name: user.name, email: user.email });
  } catch (error) {
    // apartado de error para fallo al iniciar sesión
    console.error('Error iniciando sesión:', error);
    res.status(500).json({ error: 'No se pudo iniciar sesión.' });
  }
});

app.get('/api/users', async (req, res) => {
  try {
    const usuarios = await pool.query(
      'SELECT id, name, email, created_at FROM users ORDER BY created_at DESC'
    );
    res.json(usuarios.rows);
  } catch (error) {
    console.error('Error consultando usuarios:', error);
    res.status(500).json({ error: 'No se pudieron obtener los usuarios.' });
  }
});

app.get('/api/progress', async (req, res) => {
  const { email } = req.query;
  // apartado: obtener progreso (param: email)

  if (!email) {
    return res.status(400).json({ error: 'Envía el correo del usuario.' });
  }

  try {
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    await pool.query(
      `INSERT INTO user_points (user_id, total_points)
       VALUES ($1, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.id]
    );

    const progress = await loadProgress(pool, user.id);

    res.json({ user, progress });
  } catch (error) {
    // apartado de error para fallo al obtener progreso
    console.error('Error obteniendo progreso:', error);
    res.status(500).json({ error: 'No se pudo obtener el progreso.' });
  }
});

app.get('/api/footprint/history', async (req, res) => {
  const { email, limit } = req.query;

  if (!email) {
    return res.status(400).json({ error: 'Envía el correo del usuario.' });
  }

  const safeLimit = Math.min(Math.max(parseInt(limit, 10) || DEFAULT_CALC_HISTORY_LIMIT, 1), 25);

  try {
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const historyResult = await pool.query(
      `SELECT id, score, badge, title, description, meta_percent, inputs, breakdown, focus_areas, created_at
       FROM user_calculations
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [user.id, safeLimit]
    );

    res.json({
      user,
      history: historyResult.rows.map(mapCalculationRow)
    });
  } catch (error) {
    console.error('Error obteniendo historial de huella:', error);
    res.status(500).json({ error: 'No se pudo obtener el historial.' });
  }
});

app.post('/api/footprint', async (req, res) => {
  const {
    email,
    score,
    badge,
    title,
    description,
    metaPercent,
    inputs,
    breakdown,
    focusAreas
  } = req.body;

  if (!email || typeof score !== 'number' || !badge || !title || !description || typeof metaPercent !== 'number') {
    return res.status(400).json({ error: 'Envía correo, puntaje, nivel, título, descripción y meta.' });
  }

  if (!inputs || typeof inputs !== 'object' || !Array.isArray(breakdown) || !Array.isArray(focusAreas)) {
    return res.status(400).json({ error: 'La estructura del cálculo es inválida.' });
  }

  try {
    const user = await findUserByEmail(email);
    if (!user) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const sanitizedScore = Math.max(0, Math.min(100, Math.round(score)));
    const sanitizedMeta = Math.max(0, Math.min(100, Math.round(metaPercent)));
    const safeInputs = sanitizeInputs(inputs);
    const safeBreakdown = sanitizeBreakdown(breakdown);
    const safeFocusAreas = sanitizeFocusAreas(focusAreas);

    const insertResult = await pool.query(
      `INSERT INTO user_calculations (user_id, score, badge, title, description, meta_percent, inputs, breakdown, focus_areas)
       VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
       RETURNING id, score, badge, title, description, meta_percent, inputs, breakdown, focus_areas, created_at`,
      [
        user.id,
        sanitizedScore,
        badge,
        title,
        description,
        sanitizedMeta,
        JSON.stringify(safeInputs),
        JSON.stringify(safeBreakdown),
        JSON.stringify(safeFocusAreas)
      ]
    );

    const historyResult = await pool.query(
      `SELECT id, score, badge, title, description, meta_percent, inputs, breakdown, focus_areas, created_at
       FROM user_calculations
       WHERE user_id = $1
       ORDER BY created_at DESC
       LIMIT $2`,
      [user.id, DEFAULT_CALC_HISTORY_LIMIT]
    );

    res.status(201).json({
      calculation: mapCalculationRow(insertResult.rows[0]),
      history: historyResult.rows.map(mapCalculationRow)
    });
  } catch (error) {
    console.error('Error guardando cálculo:', error);
    res.status(500).json({ error: 'No se pudo guardar el cálculo.' });
  }
});

app.post('/api/challenges/complete', async (req, res) => {
  const { email, challengeCode, points } = req.body;
  // apartado: completar reto (datos recibidos)

  if (!email || !challengeCode || typeof points !== 'number') {
    return res.status(400).json({ error: 'Envía correo, código del reto y puntos.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      'SELECT id, name, email FROM users WHERE email = $1 LIMIT 1',
      [email]
    );

    // apartado de error para usuario no encontrado
    if (userResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO user_points (user_id, total_points)
       VALUES ($1, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.id]
    );

    const challengeResult = await client.query(
      `INSERT INTO user_challenges (user_id, challenge_code, points)
       VALUES ($1, $2, $3)
       ON CONFLICT (user_id, challenge_code) DO NOTHING
       RETURNING id, challenge_code AS code, points, completed_at`,
      [user.id, challengeCode, points]
    );

    // apartado: caso reto ya completado
    if (challengeResult.rowCount === 0) {
      await client.query('ROLLBACK');
      const progress = await loadProgress(pool, user.id);
      return res.status(200).json({
        alreadyCompleted: true,
        message: 'Ese reto ya estaba completado.',
        progress
      });
    }

    const pointsResult = await client.query(
      `UPDATE user_points
       SET total_points = total_points + $1,
           updated_at = NOW()
       WHERE user_id = $2
       RETURNING total_points`,
      [points, user.id]
    );

    await client.query('COMMIT');

    const progress = await loadProgress(pool, user.id);

    res.status(201).json({
      challenge: challengeResult.rows[0],
      totalPoints: pointsResult.rows[0].total_points,
      progress
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error revirtiendo la transacción:', rollbackError);
    }
    // apartado de error para fallo registrando reto
    console.error('Error registrando reto:', error);
    res.status(500).json({ error: 'No se pudo registrar el reto.' });
  } finally {
    client.release();
  }
});

app.post('/api/rewards/redeem', async (req, res) => {
  const { email, rewardCode, rewardName, cost } = req.body;
  // apartado: canjear premio (datos recibidos)

  if (!email || !rewardCode || !rewardName || typeof cost !== 'number') {
    return res.status(400).json({ error: 'Envía correo, código, nombre del premio y costo.' });
  }

  const client = await pool.connect();

  try {
    await client.query('BEGIN');

    const userResult = await client.query(
      'SELECT id, name, email FROM users WHERE email = $1 LIMIT 1',
      [email]
    );

    // apartado de error para usuario no encontrado
    if (userResult.rowCount === 0) {
      await client.query('ROLLBACK');
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const user = userResult.rows[0];

    await client.query(
      `INSERT INTO user_points (user_id, total_points)
       VALUES ($1, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.id]
    );

    const puntosActuales = await client.query(
      'SELECT total_points FROM user_points WHERE user_id = $1 LIMIT 1',
      [user.id]
    );

    const totalDisponible = puntosActuales.rows[0]
      ? puntosActuales.rows[0].total_points
      : 0;

    // apartado de error: puntos insuficientes
    if (totalDisponible < cost) {
      await client.query('ROLLBACK');
      const progress = await loadProgress(pool, user.id);
      return res.status(400).json({
        error: 'No tienes suficientes puntos para canjear este premio.',
        progress
      });
    }

    const rewardResult = await client.query(
      `INSERT INTO user_rewards (user_id, reward_code, reward_name, cost)
       VALUES ($1, $2, $3, $4)
       RETURNING id, reward_code AS code, reward_name AS name, cost, redeemed_at`,
      [user.id, rewardCode, rewardName, cost]
    );

    const pointsResult = await client.query(
      `UPDATE user_points
       SET total_points = total_points - $1,
           updated_at = NOW()
       WHERE user_id = $2
       RETURNING total_points`,
      [cost, user.id]
    );

    await client.query('COMMIT');

    const progress = await loadProgress(pool, user.id);

    res.status(201).json({
      reward: rewardResult.rows[0],
      totalPoints: pointsResult.rows[0].total_points,
      progress
    });
  } catch (error) {
    try {
      await client.query('ROLLBACK');
    } catch (rollbackError) {
      console.error('Error revirtiendo la transacción:', rollbackError);
    }
    // apartado de error para fallo canjeando premio
    console.error('Error canjeando premio:', error);
    res.status(500).json({ error: 'No se pudo canjear el premio.' });
  } finally {
    client.release();
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
