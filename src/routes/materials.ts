import { Router, Response, Request } from 'express';
import { prisma } from '../server';
import { authenticateToken, AuthRequest } from '../middlewares/auth';
import { checkPremium } from '../middlewares/checkPremium';
import { validate } from '../lib/validate';
import { materialMetaSchema } from '../lib/zod-schemas';

const router = Router();
router.use(authenticateToken, checkPremium);

// POST /api/materials — upload new material
router.post('/', validate(materialMetaSchema), async (req: AuthRequest, res: Response) => {
  try {
    const uploaderId = req.user!.userId;
    const { institutionId, course, subjectName, professor, semester, type, subjectId } = req.body;

    // For MVP: fileUrl is provided as a direct URL in the body (Vercel Blob integration can be added later)
    // The client uploads directly to Vercel Blob and sends the resulting URL
    const { fileUrl } = req.body;
    if (!fileUrl || typeof fileUrl !== 'string') {
      return res.status(400).json({ error: 'fileUrl é obrigatório.' });
    }

    const institution = await prisma.institution.findUnique({ where: { id: institutionId } });
    if (!institution) return res.status(400).json({ error: 'Instituição não encontrada.' });

    const material = await prisma.material.create({
      data: {
        uploaderId,
        institutionId,
        course,
        subjectName,
        professor,
        semester,
        type,
        fileUrl,
        subjectId: subjectId ?? null,
        status: 'PENDING',
      },
    });

    res.status(201).json(material);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/materials — browse approved materials from same institution
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const user = await prisma.user.findUnique({ where: { id: userId }, select: { institutionId: true } });

    const { course, professor, semester, type, subjectId, page = '1', limit = '20' } = req.query as Record<string, string>;
    const skip = (parseInt(page) - 1) * parseInt(limit);

    const where: any = { status: 'APPROVED' };
    if (req.user!.role !== 'ADMIN' && user?.institutionId) {
      where.institutionId = user.institutionId;
    }
    if (course)     where.course     = { contains: course,    mode: 'insensitive' };
    if (professor)  where.professor  = { contains: professor, mode: 'insensitive' };
    if (semester)   where.semester   = semester;
    if (type)       where.type       = type;
    if (subjectId)  where.subjectId  = subjectId;

    const [materials, total] = await Promise.all([
      prisma.material.findMany({
        where,
        include: { uploader: { select: { id: true, name: true } }, institution: { select: { name: true } } },
        orderBy: { createdAt: 'desc' },
        skip,
        take: parseInt(limit),
      }),
      prisma.material.count({ where }),
    ]);

    res.json({ materials, total, page: parseInt(page), limit: parseInt(limit) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/materials/:id
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const material = await prisma.material.findUnique({
      where:   { id: req.params.id as string },
      include: {
        uploader:    { select: { id: true, name: true } },
        institution: { select: { name: true } },
        subject:     { select: { name: true } },
      },
    });
    if (!material || (material.status !== 'APPROVED' && req.user!.role !== 'ADMIN')) {
      return res.status(404).json({ error: 'Material não encontrado.' });
    }
    res.json(material);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

export default router;
