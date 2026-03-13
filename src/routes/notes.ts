import { Router, Response } from 'express';
import { prisma } from '../server';
import { authenticateToken, AuthRequest } from '../middlewares/auth';

const router = Router();
router.use(authenticateToken);

// GET Notes for current user
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const notes = await prisma.note.findMany({
      where: { studentId: userId },
      orderBy: { updatedAt: 'desc' }
    });
    res.json(notes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// POST Create Note
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { title, content, subjectId } = req.body;
    const userId = req.user!.userId;

    if (!title || !content || !subjectId) {
      return res.status(400).json({ error: 'Missing Required Fields' });
    }

    const note = await prisma.note.create({
      data: {
        title,
        content,
        subjectId,
        studentId: userId
      }
    });

    res.status(201).json(note);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// PUT Update Note
router.put('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.userId;
    const { title, content, subjectId } = req.body;

    if (!title || !content) {
      return res.status(400).json({ error: 'Title and content are required' });
    }

    const note = await prisma.note.findFirst({ where: { id, studentId: userId } });
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }

    const updated = await prisma.note.update({
      where: { id },
      data: { title, content, subjectId: subjectId || note.subjectId }
    });

    res.json(updated);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// DELETE Note
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const userId = req.user!.userId;

    const note = await prisma.note.findFirst({ where: { id, studentId: userId } });
    if (!note) {
      return res.status(404).json({ error: 'Note not found' });
    }

    await prisma.note.delete({ where: { id } });
    res.status(204).send();
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
