import express from 'express';
import cors from 'cors';
import helmet from 'helmet';
import rateLimit from 'express-rate-limit';
import dotenv from 'dotenv';
import { PrismaClient } from '@prisma/client';

dotenv.config();

export const prisma = new PrismaClient();
const app = express();

// Security Middlewares
app.use(helmet());
const rawFrontendUrl = process.env.FRONTEND_URL || 'http://localhost:3000';
const normalizedFrontend = rawFrontendUrl.startsWith('http') ? rawFrontendUrl.replace(/\/$/, '') : `https://${rawFrontendUrl.replace(/\/$/, '')}`;

const allowedOrigins = [
  normalizedFrontend,
  'http://localhost:3001',
  'http://localhost:3000',
];
app.use(cors({
  origin: (origin, callback) => {
    if (!origin || allowedOrigins.includes(origin)) return callback(null, true);
    console.warn(`Blocked by CORS: ${origin}`);
    callback(new Error('Not allowed by CORS'));
  },
  credentials: true
}));

const limiter = rateLimit({
  windowMs: 15 * 60 * 1000, // 15 minutes
  max: 100, // Limit each IP to 100 requests per `window` (here, per 15 minutes)
  standardHeaders: true,
  legacyHeaders: false,
});
app.use('/api', limiter);

// Parsing
app.use(express.json());

// Basic health check
app.get('/health', (req, res) => {
  res.status(200).json({ status: 'ok', timestamp: new Date() });
});

// Import Routes
import authRoutes from './routes/auth';
import adminRoutes from './routes/admin';
import subjectsRoutes from './routes/subjects';
import eventsRoutes from './routes/events';
import notesRoutes from './routes/notes';
import pushRoutes, { webpush } from './routes/push';

app.use('/api/auth', authRoutes);
app.use('/api/admin/users', adminRoutes);
app.use('/api/subjects', subjectsRoutes);
app.use('/api/events', eventsRoutes);
app.use('/api/notes', notesRoutes);
app.use('/api/push', pushRoutes);

const PORT = process.env.PORT || 4000;

const EVENT_TYPE_LABELS: Record<string, string> = {
  exam: 'Prova',
  assignment: 'Tarefa',
  class: 'Aula',
  other: 'Evento',
};

function startOfDayUTC(date: Date): Date {
  const d = new Date(date);
  d.setUTCHours(0, 0, 0, 0);
  return d;
}

function addDays(date: Date, days: number): Date {
  const d = new Date(date);
  d.setDate(d.getDate() + days);
  return d;
}

async function sendEventNotifications() {
  const today = startOfDayUTC(new Date());
  const targets = [
    { days: 0, prefix: '🔔 Hoje' },
    { days: 1, prefix: '⏰ Amanhã' },
    { days: 7, prefix: '📅 Em 7 dias' },
  ];

  for (const { days, prefix } of targets) {
    const targetDate = addDays(today, days);
    const nextDay = addDays(targetDate, 1);

    const events = await prisma.event.findMany({
      where: {
        date: { gte: targetDate, lt: nextDay },
        completed: false,
      },
    });

    for (const event of events) {
      // Find subscriptions for users who own or share this event
      const whereUser = event.studentId
        ? { userId: event.studentId }
        : event.classGroupId
        ? { user: { classGroupId: event.classGroupId } }
        : null;

      if (!whereUser) continue;

      const subscriptions = await (prisma.pushSubscription as any).findMany({
        where: whereUser,
      });

      const typeLabel = EVENT_TYPE_LABELS[event.type] || event.type;
      const payload = JSON.stringify({
        title: `${prefix}: ${event.title}`,
        body: typeLabel,
      });

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

// In serverless (Vercel) the handler is exported above — no listen needed.
if (!process.env.VERCEL) {
  const cron = require('node-cron');
  app.listen(PORT, async () => {
    console.log(`Server is running on port ${PORT}`);
    // Ensure default class group exists
    try {
      await prisma.classGroup.upsert({
        where: { name: 'Computação 9° Semestre' },
        update: {},
        create: { name: 'Computação 9° Semestre' }
      });
    } catch (e) {
      console.error('Failed to seed class group:', e);
    }

    // Daily notification cron — 08:00 every day
    cron.schedule('0 8 * * *', () => {
      sendEventNotifications().catch(console.error);
    });
    console.log('Push notification cron scheduled (08:00 daily)');
  });
}
