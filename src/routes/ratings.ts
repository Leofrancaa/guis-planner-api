import { Router, Response } from 'express';
import { prisma } from '../server';
import { authenticateToken, AuthRequest } from '../middlewares/auth';
import { checkPremium } from '../middlewares/checkPremium';
import { validate } from '../lib/validate';
import { ratingSchema } from '../lib/zod-schemas';

const router = Router();
router.use(authenticateToken);

// POST /api/ratings — submit/update professor rating
router.post('/', checkPremium, validate(ratingSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { subjectId, professor, didatica, clareza, disponibilidade, pontualidade, dificuldade } = req.body;

    // Must be enrolled in the subject
    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_subjectId: { userId, subjectId } },
    });
    if (!enrollment) {
      return res.status(403).json({ error: 'Você precisa estar matriculado na matéria para avaliá-la.' });
    }

    const rating = await prisma.professorRating.upsert({
      where:  { userId_subjectId_professor: { userId, subjectId, professor } },
      update: { didatica, clareza, disponibilidade, pontualidade, dificuldade },
      create: { userId, subjectId, professor, didatica, clareza, disponibilidade, pontualidade, dificuldade },
    });

    res.json(rating);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/ratings/subject/:subjectId — aggregated ratings (premium only)
router.get('/subject/:subjectId', checkPremium, async (req: AuthRequest, res: Response) => {
  try {
    const userId    = req.user!.userId;
    const subjectId = req.params.subjectId as string;

    const subject = await prisma.subject.findUnique({
      where:   { id: subjectId },
      include: { classGroup: { include: { institution: true } } },
    });
    if (!subject) return res.status(404).json({ error: 'Matéria não encontrada.' });

    // Must be from same institution
    if (req.user!.role !== 'ADMIN') {
      const user = await prisma.user.findUnique({ where: { id: userId }, select: { institutionId: true } });
      if ((subject as any).classGroup?.institution?.id !== user?.institutionId) {
        return res.status(403).json({ error: 'Acesso restrito à sua instituição.' });
      }
    }

    const ratings = await prisma.professorRating.findMany({ where: { subjectId } });

    // Group by professor and compute averages
    const byProfessor: Record<string, typeof ratings> = {};
    for (const r of ratings) {
      if (!byProfessor[r.professor]) byProfessor[r.professor] = [];
      byProfessor[r.professor].push(r);
    }

    const result = Object.entries(byProfessor).map(([professor, list]) => {
      const avg = (field: keyof (typeof list)[0]) =>
        Math.round(list.reduce((sum, r) => sum + (r[field] as number), 0) / list.length * 10) / 10;

      return {
        professor,
        totalRatings:    list.length,
        avgDidatica:     avg('didatica'),
        avgClareza:      avg('clareza'),
        avgDisponibilidade: avg('disponibilidade'),
        avgPontualidade: avg('pontualidade'),
        avgDificuldade:  avg('dificuldade'),
      };
    });

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/ratings/institution — all ratings aggregated for user's institution
router.get('/institution', checkPremium, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Get user's institution
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { institutionId: true } });
    const institutionId = user?.institutionId;

    // Get all subjects from this institution's class groups
    const where = institutionId && req.user!.role !== 'ADMIN'
      ? { classGroup: { institutionId } }
      : {};

    const subjects = await prisma.subject.findMany({
      where,
      select: { id: true, name: true, professor: true, classGroup: { select: { name: true } } },
    });

    const subjectIds = subjects.map(s => s.id);
    const ratings = await prisma.professorRating.findMany({
      where: { subjectId: { in: subjectIds } },
    });

    // Group by subjectId+professor
    const grouped: Record<string, typeof ratings> = {};
    for (const r of ratings) {
      const key = `${r.subjectId}::${r.professor}`;
      if (!grouped[key]) grouped[key] = [];
      grouped[key].push(r);
    }

    const result = Object.entries(grouped).map(([key, list]) => {
      const [subjectId] = key.split('::');
      const subject = subjects.find(s => s.id === subjectId);
      const avg = (field: keyof (typeof list)[0]) =>
        Math.round(list.reduce((sum, r) => sum + (r[field] as number), 0) / list.length * 10) / 10;

      return {
        subjectId,
        subjectName:      subject?.name ?? '',
        professor:        list[0].professor,
        classGroupName:   subject?.classGroup?.name,
        totalRatings:     list.length,
        avgDidatica:      avg('didatica'),
        avgClareza:       avg('clareza'),
        avgDisponibilidade: avg('disponibilidade'),
        avgPontualidade:  avg('pontualidade'),
        avgDificuldade:   avg('dificuldade'),
      };
    });

    // Sort by most rated
    result.sort((a, b) => b.totalRatings - a.totalRatings);

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/ratings/my/:subjectId — user's own rating
router.get('/my/:subjectId', async (req: AuthRequest, res: Response) => {
  try {
    const userId    = req.user!.userId;
    const subjectId = req.params.subjectId as string;

    const ratings = await prisma.professorRating.findMany({
      where: { userId, subjectId },
    });
    res.json(ratings);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

export default router;
