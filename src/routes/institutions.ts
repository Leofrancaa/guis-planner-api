import { Router, Request, Response } from 'express';
import { prisma } from '../server';

const router = Router();

// GET /api/institutions — public, no auth required
router.get('/', async (_req: Request, res: Response) => {
  try {
    const institutions = await prisma.institution.findMany({
      select: { id: true, name: true },
      orderBy: { name: 'asc' },
    });
    res.json(institutions);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

export default router;
