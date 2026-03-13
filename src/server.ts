import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

// ─── JWT secret validation ────────────────────────────────────────────────────
const JWT_SECRET = process.env.JWT_SECRET || '';
if (!process.env.VERCEL && JWT_SECRET.length < 32) {
  console.error('FATAL: JWT_SECRET must be at least 32 characters. Set it in your .env file.');
  process.exit(1);
}

export const prisma = new PrismaClient();

prisma.$connect().catch(err => {
  console.error('Failed to connect to database during init:', err);
});

const app = express();

// ─── Security: Helmet ─────────────────────────────────────────────────────────
app.use(helmet({
  contentSecurityPolicy: process.env.NODE_ENV === 'production'
    ? {
        directives: {
          defaultSrc: ["'self'"],
          scriptSrc:  ["'self'"],
          styleSrc:   ["'self'", "'unsafe-inline'"],
          imgSrc:     ["'self'", 'data:', 'blob:'],
          connectSrc: ["'self'"],
        },
      }
    : false,
  crossOriginEmbedderPolicy: false,
}));

// ─── CORS ─────────────────────────────────────────────────────────────────────
const allowedOrigins: (string | RegExp)[] = [
  'http://localhost:3000',
  'http://localhost:3001',
  /\.vercel\.app$/,
];
if (process.env.FRONTEND_URL) allowedOrigins.push(process.env.FRONTEND_URL);

app.use(cors({
  origin: allowedOrigins,
  credentials: true,
  methods: ['GET', 'POST', 'PUT', 'DELETE', 'OPTIONS'],
  allowedHeaders: ['Content-Type', 'Authorization'],
}));

// ─── Rate Limiters ────────────────────────────────────────────────────────────
const generalLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 100,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas requisições. Tente novamente em 15 minutos.' },
});

const authLimiter = rateLimit({
  windowMs: 15 * 60 * 1000,
  max: 10,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: 'Muitas tentativas de login. Tente novamente em 15 minutos.' },
});

app.use('/api', generalLimiter);

// ─── Parsing ──────────────────────────────────────────────────────────────────
app.use(express.json());

// ─── Health ───────────────────────────────────────────────────────────────────
app.get('/', (_req, res) => {
  res.status(200).json({ message: 'Guis Planner API is running', status: 'ok' });
});
app.get('/health', (_req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() });
});

// ─── Routes ───────────────────────────────────────────────────────────────────
import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import subjectsRoutes from './routes/subjects';
import eventsRoutes from './routes/events';
import notesRoutes from './routes/notes';
import pushRoutes from './routes/push';
import institutionsRoutes from './routes/institutions';
import classGroupsRoutes from './routes/classGroups';
import ratingsRoutes from './routes/ratings';
import materialsRoutes from './routes/materials';
import studyEventsRoutes from './routes/studyEvents';
import notificationsRoutes from './routes/notifications';

// Auth routes get the stricter rate limiter
app.use('/api/auth/login',    authLimiter);
app.use('/api/auth/register', authLimiter);

app.use('/api/auth',           authRoutes);
app.use('/api/admin',          adminRoutes);
app.use('/api/subjects',       subjectsRoutes);
app.use('/api/events',         eventsRoutes);
app.use('/api/notes',          notesRoutes);
app.use('/api/push',           pushRoutes);
app.use('/api/institutions',   institutionsRoutes);
app.use('/api/class-groups',   classGroupsRoutes);
app.use('/api/ratings',        ratingsRoutes);
app.use('/api/materials',      materialsRoutes);
app.use('/api/study-events',   studyEventsRoutes);
app.use('/api/notifications',  notificationsRoutes);

// ─── Push notifications helper ────────────────────────────────────────────────
import { startOfDayUTC, addDays } from './lib/dateUtils';

const EVENT_TYPE_LABELS: Record<string, string> = {
  exam: 'Prova', assignment: 'Tarefa', class: 'Aula', other: 'Evento',
};

async function sendEventNotifications() {
  const today = startOfDayUTC(new Date());
  const targets = [
    { days: 0, prefix: '🔔 Hoje' },
    { days: 1, prefix: '⏰ Amanhã' },
    { days: 7, prefix: '📅 Em 7 dias' },
  ];

  for (const { days, prefix } of targets) {
    const targetDate = addDays(today, days);
    const nextDay    = addDays(targetDate, 1);

    const events = await prisma.event.findMany({
      where: { date: { gte: targetDate, lt: nextDay }, completed: false },
    });

    for (const event of events) {
      const whereUser = event.studentId
        ? { userId: event.studentId }
        : event.classGroupId
        ? { user: { classGroupId: event.classGroupId } }
        : null;

      if (!whereUser) continue;

      const subscriptions = await (prisma.pushSubscription as any).findMany({ where: whereUser });
      const typeLabel = EVENT_TYPE_LABELS[event.type] || event.type;
      const payload = JSON.stringify({ title: `${prefix}: ${event.title}`, body: typeLabel });
      const webpushLib = require('web-push');

      for (const sub of subscriptions) {
        try {
          await webpushLib.sendNotification(
            { endpoint: sub.endpoint, keys: { p256dh: sub.p256dh, auth: sub.auth } },
            payload
          );
        } catch (err: any) {
          if (err.statusCode === 410 || err.statusCode === 404) {
            await prisma.pushSubscription.delete({ where: { id: sub.id } });
          }
        }
      }
    }
  }
}

export default app;

// ─── Local server (non-Vercel) ────────────────────────────────────────────────
if (!process.env.VERCEL) {
  const PORT = process.env.PORT || 4000;
  const cron = require('node-cron');

  app.listen(PORT, () => {
    console.log(`Server running on port ${PORT}`);
    cron.schedule('0 8 * * *', () => {
      sendEventNotifications().catch(console.error);
    });
    console.log('Push notification cron scheduled (08:00 daily)');
  });
}
