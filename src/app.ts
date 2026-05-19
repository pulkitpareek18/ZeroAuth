import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import cookieParser from 'cookie-parser';
import path from 'path';
import { config } from './config';
import { errorHandler, notFoundHandler } from './middleware/error-handler';
import { hostRouter } from './middleware/host-router';
import { logger } from './services/logger';

// Legacy API routes (internal / backward compatible)
import healthRoutes from './routes/health';
import authRoutes from './routes/auth';
import samlRoutes from './routes/saml';
import oidcRoutes from './routes/oidc';
import zkpRoutes from './routes/zkp';
import adminRoutes from './routes/admin';
import leadsRoutes from './routes/leads';

// Hosted Platform routes
import v1Routes from './routes/v1';
import consoleRoutes from './routes/console';

export function createApp() {
  const app = express();

  // Behind reverse proxy (Caddy/Nginx/Cloudflare) in production
  if (config.trustProxy) {
    app.set('trust proxy', 1);
  }

  // Security middleware
  app.use(helmet({
    contentSecurityPolicy: {
      directives: {
        defaultSrc: ["'self'"],
        scriptSrc: ["'self'", "'unsafe-inline'"],
        styleSrc: ["'self'", "'unsafe-inline'", 'https://fonts.googleapis.com'],
        fontSrc: ["'self'", 'https://fonts.gstatic.com'],
        imgSrc: ["'self'", 'data:'],
      },
    },
  }));

  app.use(cors({
    origin: config.corsOrigins,
    credentials: true,
  }));

  app.use(rateLimit({
    windowMs: config.rateLimit.windowMs,
    max: config.rateLimit.maxRequests,
    standardHeaders: true,
    legacyHeaders: false,
    message: { error: 'Too many requests, please try again later' },
  }));

  app.use(express.json({ limit: '1mb' }));
  app.use(express.urlencoded({ extended: true }));
  app.use(cookieParser());

  // Request logging
  app.use((req, _res, next) => {
    logger.debug(`${req.method} ${req.path}`);
    next();
  });

  // ═══════════════════════════════════════════════════════════
  // Hosted API — versioned, API-key authenticated
  // ═══════════════════════════════════════════════════════════
  app.use('/v1', v1Routes);

  // Developer Console — account management, API keys, usage
  app.use('/api/console', consoleRoutes);

  // ═══════════════════════════════════════════════════════════
  // Legacy API routes (backward-compatible, internal use)
  // ═══════════════════════════════════════════════════════════
  app.use('/api/health', healthRoutes);
  app.use('/api/auth', authRoutes);
  app.use('/api/auth/saml', samlRoutes);
  app.use('/api/auth/oidc', oidcRoutes);
  app.use('/api/auth/zkp', zkpRoutes);
  app.use('/api/admin', adminRoutes);
  app.use('/api/leads', leadsRoutes);

  // Host-aware gate. Anything on api.zeroauth.dev that didn't match an
  // API route stops here (JSON 404) instead of being served the
  // landing-page index.html by the static handlers below.
  app.use(hostRouter);

  // Serve React dashboard in production
  const dashboardPath = path.join(__dirname, '..', 'dashboard', 'dist');
  app.use('/dashboard', express.static(dashboardPath));
  app.get('/dashboard*', (_req, res) => {
    res.sendFile(path.join(dashboardPath, 'index.html'));
  });

  // Serve Docusaurus documentation
  const docsPath = path.join(__dirname, '..', 'website', 'build');
  app.use('/docs', express.static(docsPath));
  app.get('/docs/*', (_req, res) => {
    res.sendFile(path.join(docsPath, 'index.html'));
  });

  // Serve landing page and static assets
  const publicPath = path.join(__dirname, '..', 'public');
  app.use(express.static(publicPath));
  app.get('/', (_req, res) => {
    res.sendFile(path.join(publicPath, 'index.html'));
  });

  // Error handling
  app.use(notFoundHandler);
  app.use(errorHandler);

  return app;
}
