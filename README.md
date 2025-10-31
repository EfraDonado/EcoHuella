# Backend sencillo para EcoHuella

1. Copia `.env.example` a `.env` y ajusta los datos de tu base PostgreSQL.
2. Crea la base de datos (por ejemplo `CREATE DATABASE ecohuella;`).
3. Ejecuta el contenido de `db/schema.sql` para crear las tablas `users`, `user_points`, `user_challenges` y `user_rewards`.
4. Instala dependencias:
   ```bash
   npm install
   ```
5. Inicia la API:
   ```bash
   npm start
   ```

La API expone:
- `GET /api/health` para comprobar que todo va bien.
- `POST /api/users` para guardar un usuario (`name`, `email`, `password`).
- `POST /api/login` para iniciar sesión comparando correo y contraseña.
- `GET /api/users` para listar los usuarios guardados.
- `GET /api/progress?email=...` para recuperar puntos, retos completados y premios canjeados de un usuario.
- `POST /api/challenges/complete` con `{ email, challengeCode, points }` para registrar un reto superado.
- `POST /api/rewards/redeem` con `{ email, rewardCode, rewardName, cost }` para canjear un premio y descontar puntos.
