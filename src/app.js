import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import env from './config/env.js';
import { API_PREFIX } from './config/constant.js';
import routes from './routes/index.js';
import { apiLimiter, sanitizeInput } from './middleware/security.middleware.js';
import { errorHandler, notFound } from './middleware/error.middleware.js';

const app = express();
if (env.isProd) app.set('trust proxy', 1);

app.use(helmet());
app.use(cors({ origin: env.origins, credentials: true }));
app.use(express.json({ limit: '100kb' })); // Increased to 100kb to allow rich SuperAdmin movie/songs/boxOffice payloads
app.use(cookieParser());
app.use(sanitizeInput);

app.use(API_PREFIX, apiLimiter, routes);
app.use(notFound);
app.use(errorHandler);

export default app;
