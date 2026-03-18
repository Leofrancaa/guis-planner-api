import { Router, Response } from 'express';
import { prisma } from '../server';
import { authenticateToken, AuthRequest } from '../middlewares/auth';

const router = Router();
router.use(authenticateToken);

// GET Events — personal + enrolled subject events + class group events
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Get user's enrolled subjectIds
    const enrollments = await prisma.enrollment.findMany({
      where:  { userId },
      select: { subjectId: true },
    });
    const enrolledSubjectIds = enrollments.map(e => e.subjectId);

    // Get user's class group memberships
    const memberships = await prisma.classGroupMember.findMany({
      where:  { userId },
      select: { classGroupId: true },
    });
    const classGroupIds = memberships.map(m => m.classGroupId);

    const events = await prisma.event.findMany({
      where: {
        OR: [
          { studentId: userId },
          { subjectId: { in: enrolledSubjectIds } },
          { classGroupId: { in: classGroupIds } },
        ],
      },
      orderBy: { date: 'asc' },
    });

    res.json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// POST Create a new Event
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { title, date, type, subjectId, scope, gradeLabel } = req.body;
    const userId = req.user!.userId;

    if (!title || !date || !type) {
      return res.status(400).json({ error: 'Campos obrigatórios: title, date, type.' });
    }

    // If gradeLabel + subjectId, check uniqueness
    if (gradeLabel && subjectId) {
      const existing = await prisma.event.findFirst({
        where: { subjectId, gradeLabel },
      });
      if (existing) {
        return res.status(409).json({
          error: `Já existe um evento vinculado a "${gradeLabel}" nesta matéria: "${existing.title}".`,
        });
      }
    }

    // Determine classGroupId from DB when scope is CLASS
    let classGroupId: string | null = null;
    if (scope === 'CLASS') {
      if (subjectId) {
        // Use the subject's classGroupId
        const subject = await prisma.subject.findUnique({
          where:  { id: subjectId },
          select: { classGroupId: true },
        });
        classGroupId = subject?.classGroupId ?? null;
      }
      if (!classGroupId) {
        // Fallback: user's most recent leader membership
        const membership = await prisma.classGroupMember.findFirst({
          where:   { userId },
          orderBy: { joinedAt: 'desc' },
          select:  { classGroupId: true },
        });
        classGroupId = membership?.classGroupId ?? null;
      }
    }

    const data: Record<string, unknown> = {
      title,
      date: new Date(date),
      type,
    };

    if (subjectId) data.subjectId = subjectId;
    if (gradeLabel) data.gradeLabel = gradeLabel;

    if (scope === 'CLASS' && classGroupId) {
      data.classGroupId = classGroupId;
    } else {
      data.studentId = userId;
    }

    const event = await prisma.event.create({ data });
    res.status(201).json(event);
  } catch (error: unknown) {
    console.error(error);
    const msg = error instanceof Error ? error.message : '';
    if (msg.includes('unique') || msg.includes('Unique') || (error as any)?.code === 'P2002') {
      return res.status(409).json({ error: 'Já existe um evento com esse vínculo de nota nesta matéria.' });
    }
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// PUT Update completion status
router.put('/:id/completion', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { completed } = req.body;
    const event = await prisma.event.update({ where: { id }, data: { completed } });
    res.json(event);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// DELETE Event
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.userId;

    // Get memberships for authorization check
    const memberships = await prisma.classGroupMember.findMany({
      where:  { userId },
      select: { classGroupId: true },
    });
    const classGroupIds = memberships.map(m => m.classGroupId);

    const event = await prisma.event.findFirst({
      where: {
        id,
        OR: [
          { studentId: userId },
          { classGroupId: { in: classGroupIds } },
        ],
      },
    });

    if (!event) return res.status(404).json({ error: 'Evento não encontrado.' });

    await prisma.event.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

export default router;
