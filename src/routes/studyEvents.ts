import { Router, Response } from 'express';
import { prisma } from '../server';
import { authenticateToken, AuthRequest } from '../middlewares/auth';
import { checkPremium } from '../middlewares/checkPremium';
import { validate } from '../lib/validate';
import { studyEventSchema } from '../lib/zod-schemas';
import { notifyMany } from '../lib/notify';

const router = Router();
router.use(authenticateToken);

// POST /api/study-events — premium only
router.post('/', checkPremium, validate(studyEventSchema), async (req: AuthRequest, res: Response) => {
  try {
    const creatorId = req.user!.userId;
    const { subjectId, classGroupId, date, method, link } = req.body;

    // Must be a member of the class group
    const membership = await prisma.classGroupMember.findUnique({
      where: { userId_classGroupId: { userId: creatorId, classGroupId } },
    });
    if (!membership && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Você precisa ser membro da turma para criar eventos.' });
    }

    const studyEvent = await prisma.studyEvent.create({
      data: { creatorId, subjectId, classGroupId, date: new Date(date), method, link: link ?? null },
      include: {
        creator: { select: { id: true, name: true } },
        subject: { select: { id: true, name: true } },
      },
    });

    // Notify all enrolled students in the subject
    const enrollments = await prisma.enrollment.findMany({
      where: { subjectId, status: 'ENROLLED' },
      select: { userId: true },
    });
    const userIds = enrollments.map(e => e.userId).filter(id => id !== creatorId);

    if (userIds.length > 0) {
      await notifyMany(userIds, {
        type:  'STUDY_EVENT_CREATED',
        title: `Novo evento de estudo: ${studyEvent.subject.name}`,
        body:  `${studyEvent.creator.name} criou uma sessão de estudo em ${method}.`,
        refId: studyEvent.id,
      });
    }

    res.status(201).json(studyEvent);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/study-events
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId      = req.user!.userId;
    const { classGroupId, subjectId } = req.query as Record<string, string>;

    const where: any = {};
    if (classGroupId) where.classGroupId = classGroupId;
    if (subjectId)    where.subjectId    = subjectId;

    // Limit to events in groups user is a member of (unless admin)
    if (req.user!.role !== 'ADMIN') {
      const memberships = await prisma.classGroupMember.findMany({
        where:  { userId },
        select: { classGroupId: true },
      });
      const memberGroupIds = memberships.map(m => m.classGroupId);
      where.classGroupId = classGroupId
        ? (memberGroupIds.includes(classGroupId) ? classGroupId : undefined)
        : { in: memberGroupIds };
    }

    const events = await prisma.studyEvent.findMany({
      where,
      include: {
        creator:  { select: { id: true, name: true } },
        subject:  { select: { id: true, name: true } },
        _count:   { select: { rsvps: true } },
        rsvps:    { where: { userId }, select: { id: true } },
      },
      orderBy: { date: 'asc' },
    });

    const result = events.map(e => ({
      ...e,
      rsvpCount: e._count.rsvps,
      userRsvpd: e.rsvps.length > 0,
      rsvps:     undefined,
      _count:    undefined,
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// POST /api/study-events/:id/rsvp
router.post('/:id/rsvp', async (req: AuthRequest, res: Response) => {
  try {
    const userId       = req.user!.userId;
    const studyEventId = req.params.id as string;

    await prisma.studyEventRsvp.upsert({
      where:  { userId_studyEventId: { userId, studyEventId } },
      update: {},
      create: { userId, studyEventId },
    });
    res.json({ rsvpd: true });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// DELETE /api/study-events/:id/rsvp
router.delete('/:id/rsvp', async (req: AuthRequest, res: Response) => {
  try {
    const userId       = req.user!.userId;
    const studyEventId = req.params.id as string;

    await prisma.studyEventRsvp.deleteMany({ where: { userId, studyEventId } });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/study-events/:id/rsvps
router.get('/:id/rsvps', async (req: AuthRequest, res: Response) => {
  try {
    const rsvps = await prisma.studyEventRsvp.findMany({
      where:   { studyEventId: req.params.id as string },
      include: { user: { select: { id: true, name: true, username: true } } },
    });
    res.json(rsvps);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

export default router;
