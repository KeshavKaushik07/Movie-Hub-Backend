import cookieParser from 'cookie-parser';
import cors from 'cors';
import express from 'express';
import helmet from 'helmet';
import env from './config/env.js';
import { API_PREFIX } from './config/constant.js';
import routes from './routes/index.js';
import { apiLimiter, sanitizeInput, securityHeaders } from './middleware/security.middleware.js';
import { errorHandler, notFound } from './middleware/error.middleware.js';

const app = express();
app.disable('x-powered-by');
if (env.isProd) app.set('trust proxy', 1);

app.use(helmet());
app.use(securityHeaders);
app.use(
  cors({
    origin: (origin, callback) => {
      if (!origin || !env.isProd || env.origins.includes(origin)) {
        return callback(null, true);
      }
      return callback(null, env.origins[0]);
    },
    credentials: true,
  }),
);
app.use(express.json({ limit: '100kb' }));
app.use(cookieParser());
app.use(sanitizeInput);

app.use(API_PREFIX, apiLimiter, routes);
app.use(notFound);
app.use(errorHandler);

export default app;
