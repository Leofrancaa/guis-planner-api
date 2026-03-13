import { Router, Response } from 'express';
import { prisma } from '../server';
import { authenticateToken, AuthRequest } from '../middlewares/auth';

const router = Router();
router.use(authenticateToken);

// GET Events for the current user
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const classGroupId = req.user!.classGroupId;

    const events = await prisma.event.findMany({
      where: {
        OR: [
          { classGroupId: classGroupId || undefined },
          { studentId: userId }
        ]
      },
      orderBy: { date: 'asc' }
    });

    res.json(events);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST Create a new Event
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { title, date, type, subjectId, scope } = req.body;
    const userId = req.user!.userId;
    const classGroupId = req.user!.classGroupId;

    if (!title || !date || !type || !scope) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (scope === 'CLASS' && !classGroupId) {
      return res.status(400).json({ error: 'User does not belong to a class group' });
    }

    const data: any = {
      title,
      date: new Date(date),
      type,
    };

    if (subjectId) data.subjectId = subjectId;

    if (scope === 'CLASS') {
      data.classGroupId = classGroupId;
    } else {
      data.studentId = userId;
    }

    const event = await prisma.event.create({ data });
    res.status(201).json(event);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT Update completion status
router.put('/:id/completion', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { completed } = req.body;

    const event = await prisma.event.update({
      where: { id },
      data: { completed }
    });

    res.json(event);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE Event
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.userId;
    const classGroupId = req.user!.classGroupId;

    const event = await prisma.event.findFirst({
      where: { id, OR: [{ studentId: userId }, { classGroupId: classGroupId || undefined }] }
    });

    if (!event) {
      return res.status(404).json({ error: 'Event not found' });
    }

    await prisma.event.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
