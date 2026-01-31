import express, { type NextFunction, type Request, type Response } from 'express';
import path from 'node:path';
import dotenv from 'dotenv';

import showVersion from './src/middlewares/headerMiddleware';
import pixivRoutes from './src/routes/pixivRoutes';

dotenv.config();

const app = express();
const PORT = process.env.PORT ? Number(process.env.PORT) : 3000;
const HOST = process.env.HOST || '127.0.0.1';

app.set('view engine', 'ejs');
app.set('views', path.join(__dirname, 'views'));

// Routes
app.use('/', showVersion, pixivRoutes);

// Error handling middleware
app.use((err: unknown, req: Request, res: Response, _next: NextFunction) => {
  console.error(err);
  res.status(500).send('Internal Server Error');
});

// Start the server
if (require.main === module) {
  app.listen(PORT, HOST, () => {
    console.log(`Server is running on ${HOST}:${PORT}`);
  });
}

export default app;
