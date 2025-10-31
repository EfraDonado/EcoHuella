const express = require('express');
const cors = require('cors');
const { Pool } = require('pg');
require('dotenv').config();

const app = express();
const PORT = process.env.PORT || 4000;

const pool = new Pool({
  host: process.env.PGHOST,
  port: process.env.PGPORT,
  user: process.env.PGUSER,
  password: process.env.PGPASSWORD,
  database: process.env.PGDATABASE
});

app.use(cors());
app.use(express.json());

// Devuelve puntos, retos y premios juntos para que el frontend los muestre sin trabajo extra.
async function loadProgress(client, userId) {
  const pointsResult = await client.query(
    'SELECT total_points, updated_at FROM user_points WHERE user_id = $1 LIMIT 1',
    [userId]
  );

  const challengesResult = await client.query(
    `SELECT challenge_code AS code, points, completed_at
     FROM user_challenges
     WHERE user_id = $1
     ORDER BY completed_at DESC`,
    [userId]
  );

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

app.get('/api/health', (req, res) => {
  res.json({ ok: true, message: 'API operativa' });
});

app.post('/api/users', async (req, res) => {
  const { name, email, password } = req.body;

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

    await pool.query(
      `INSERT INTO user_points (user_id, total_points)
       VALUES ($1, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.id]
    );

    res.status(201).json(user);
  } catch (error) {
    console.error('Error guardando usuario:', error);

    if (error.code === '23505') {
      return res.status(409).json({ error: 'Ese correo ya está registrado.' });
    }

    res.status(500).json({ error: 'No se pudo guardar el usuario.' });
  }
});

app.post('/api/login', async (req, res) => {
  const { email, password } = req.body;

  if (!email || !password) {
    return res.status(400).json({ error: 'Envía tu correo y contraseña.' });
  }

  try {
    const resultado = await pool.query(
      'SELECT id, name, email, password FROM users WHERE email = $1 LIMIT 1',
      [email]
    );

    if (resultado.rowCount === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const user = resultado.rows[0];

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

  if (!email) {
    return res.status(400).json({ error: 'Envía el correo del usuario.' });
  }

  try {
    const userResult = await pool.query(
      'SELECT id, name, email FROM users WHERE email = $1 LIMIT 1',
      [email]
    );

    if (userResult.rowCount === 0) {
      return res.status(404).json({ error: 'Usuario no encontrado.' });
    }

    const user = userResult.rows[0];

    await pool.query(
      `INSERT INTO user_points (user_id, total_points)
       VALUES ($1, 0)
       ON CONFLICT (user_id) DO NOTHING`,
      [user.id]
    );

    const progress = await loadProgress(pool, user.id);

    res.json({ user, progress });
  } catch (error) {
    console.error('Error obteniendo progreso:', error);
    res.status(500).json({ error: 'No se pudo obtener el progreso.' });
  }
});

app.post('/api/challenges/complete', async (req, res) => {
  const { email, challengeCode, points } = req.body;

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
    console.error('Error registrando reto:', error);
    res.status(500).json({ error: 'No se pudo registrar el reto.' });
  } finally {
    client.release();
  }
});

app.post('/api/rewards/redeem', async (req, res) => {
  const { email, rewardCode, rewardName, cost } = req.body;

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
    console.error('Error canjeando premio:', error);
    res.status(500).json({ error: 'No se pudo canjear el premio.' });
  } finally {
    client.release();
  }
});

app.listen(PORT, () => {
  console.log(`Servidor escuchando en http://localhost:${PORT}`);
});
