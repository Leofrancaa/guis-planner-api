import { Router, Response } from 'express';
import { prisma } from '../server';
import { authenticateToken, AuthRequest } from '../middlewares/auth';

const router = Router();
router.use(authenticateToken);

// GET Subjects for the current user (Class-wide + Individual)
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const classGroupId = req.user!.classGroupId;

    const subjects = await prisma.subject.findMany({
      where: {
        OR: [
          { classGroupId: classGroupId || undefined },
          { studentId: userId }
        ]
      },
      include: {
        studentSubjects: {
          where: { userId } // Get ONLY the grades/absences for this specific user
        }
      }
    });

    res.json(subjects);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST Create a new Subject
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { name, professor, color, hours, scope } = req.body;
    const userId = req.user!.userId;
    const classGroupId = req.user!.classGroupId;

    if (!name || !hours || !scope) {
      return res.status(400).json({ error: 'Missing required fields' });
    }

    if (scope === 'CLASS' && !classGroupId) {
      return res.status(400).json({ error: 'User does not belong to a class group' });
    }

    // Check for duplicates in the class if it's a class subject
    if (scope === 'CLASS') {
      const existing = await prisma.subject.findFirst({
        where: { name, classGroupId }
      });
      if (existing) {
        return res.status(400).json({ error: 'Subject already exists for this class' });
      }
    }

    const data: any = {
      name,
      professor: professor || '',
      color: color || '#0ea5e9',
      hours: parseInt(hours)
    };

    if (scope === 'CLASS') {
      data.classGroupId = classGroupId;
    } else {
      data.studentId = userId;
    }

    const subject = await prisma.subject.create({ data });
    res.status(201).json(subject);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT Update Grades and Absences (Upsert StudentSubject)
router.put('/:subjectId/tracking', async (req: AuthRequest, res: Response) => {
  try {
    const subjectId = req.params.subjectId as string;
    const userId = req.user!.userId;
    const { absences, av1, av2, av3 } = req.body;

    const tracking = await prisma.studentSubject.upsert({
      where: {
        userId_subjectId: { userId, subjectId }
      },
      update: {
        absences: absences !== undefined ? absences : undefined,
        av1: av1 !== undefined ? av1 : undefined,
        av2: av2 !== undefined ? av2 : undefined,
        av3: av3 !== undefined ? av3 : undefined,
      },
      create: {
        userId,
        subjectId,
        absences: absences || 0,
        av1: av1 || null,
        av2: av2 || null,
        av3: av3 || null,
      }
    });

    res.json(tracking);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT Update Subject details
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.userId;
    const classGroupId = req.user!.classGroupId;
    const { name, professor, color, hours } = req.body;

    if (!name || !hours) {
      return res.status(400).json({ error: 'Name and hours are required' });
    }

    const subject = await prisma.subject.findFirst({
      where: { id, OR: [{ studentId: userId }, { classGroupId: classGroupId || undefined }] }
    });

    if (!subject) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    const updated = await prisma.subject.update({
      where: { id },
      data: { name, professor: professor || '', color: color || '#0ea5e9', hours: parseInt(hours) },
      include: { studentSubjects: { where: { userId } } }
    });

    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE Subject
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.userId;
    const classGroupId = req.user!.classGroupId;

    const subject = await prisma.subject.findFirst({
      where: { id, OR: [{ studentId: userId }, { classGroupId: classGroupId || undefined }] }
    });

    if (!subject) {
      return res.status(404).json({ error: 'Subject not found' });
    }

    // Nullify subjectId on related events before deleting to avoid FK constraint
    await prisma.event.updateMany({ where: { subjectId: id }, data: { subjectId: null } });
    await prisma.subject.delete({ where: { id } });

    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
