import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../server';
import { authenticateToken, isAdmin, AuthRequest } from '../middlewares/auth';
import { validate } from '../lib/validate';
import { adminSetPlanSchema, adminRejectSchema } from '../lib/zod-schemas';
import { createNotification, notifyAdmins } from '../lib/notify';
import { grantMaterialPoints } from '../lib/points';
import { addMonths } from '../lib/dateUtils';

const router = Router();
router.use(authenticateToken, isAdmin);

// ─── Users ────────────────────────────────────────────────────────────────────

router.get('/users', async (_req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true, username: true, name: true, role: true,
        plan: true, premiumUntil: true, points: true,
        institutionId: true, institution: { select: { name: true } },
        createdAt: true,
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(users);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// PUT /api/admin/users/:id/plan
router.put('/users/:id/plan', validate(adminSetPlanSchema), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { plan, premiumUntil } = req.body;
    const user = await prisma.user.update({
      where: { id },
      data: {
        plan,
        premiumUntil: premiumUntil ? new Date(premiumUntil) : plan === 'PREMIUM' ? null : null,
      },
      select: { id: true, username: true, name: true, plan: true, premiumUntil: true },
    });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// PUT /api/admin/users/:id/role
router.put('/users/:id/role', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { role } = req.body;
    if (!['ADMIN', 'STUDENT', 'BANNED'].includes(role)) {
      return res.status(400).json({ error: 'Role inválida.' });
    }
    const user = await prisma.user.update({
      where: { id },
      data:  { role },
      select: { id: true, username: true, name: true, role: true },
    });
    res.json(user);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── Class Group Requests ─────────────────────────────────────────────────────

router.get('/class-group-requests', async (req: AuthRequest, res: Response) => {
  try {
    const { status = 'PENDING' } = req.query as { status?: string };
    const requests = await prisma.classGroupRequest.findMany({
      where:   { status: status as any },
      include: {
        requester: {
          select: { id: true, name: true, username: true, hasReceivedLeaderBonus: true, plan: true },
        },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(requests);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.put('/class-group-requests/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const request = await prisma.classGroupRequest.findUnique({
      where:   { id },
      include: { requester: true },
    });
    if (!request) return res.status(404).json({ error: 'Solicitação não encontrada.' });
    if (request.status !== 'PENDING') {
      return res.status(400).json({ error: 'Solicitação já foi processada.' });
    }

    // Create the class group
    const group = await prisma.classGroup.create({
      data: {
        name:          request.name,
        institutionId: request.institutionId ?? undefined,
        leaderId:      request.requesterId,
      },
    });

    // Add leader as member
    await prisma.classGroupMember.create({
      data: { userId: request.requesterId, classGroupId: group.id, role: 'LEADER' },
    });

    // Grant 1 month premium if first approved turma
    const requester = (request as any).requester;
    if (!requester.hasReceivedLeaderBonus) {
      const now = new Date();
      const currentEnd = requester.premiumUntil && requester.premiumUntil > now
        ? requester.premiumUntil
        : now;
      await prisma.user.update({
        where: { id: request.requesterId },
        data: {
          plan:                  'PREMIUM',
          premiumUntil:          addMonths(currentEnd, 1),
          hasReceivedLeaderBonus: true,
        },
      });
    }

    // Update request status
    await prisma.classGroupRequest.update({
      where: { id },
      data:  { status: 'APPROVED' },
    });

    // Notify requester
    await createNotification({
      userId: request.requesterId,
      type:   'TURMA_APPROVED',
      title:  'Sua turma foi aprovada! 🎉',
      body:   `A turma "${request.name}" foi aprovada. Você agora é o líder!`,
      refId:  group.id,
    });

    res.json({ group, message: 'Turma aprovada com sucesso.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.put('/class-group-requests/:id/reject', validate(adminRejectSchema), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { adminNote } = req.body;
    const request = await prisma.classGroupRequest.findUnique({ where: { id } });
    if (!request) return res.status(404).json({ error: 'Solicitação não encontrada.' });

    await prisma.classGroupRequest.update({
      where: { id },
      data:  { status: 'REJECTED', adminNote: adminNote ?? null },
    });

    await createNotification({
      userId: request.requesterId,
      type:   'TURMA_REJECTED',
      title:  'Solicitação de turma recusada',
      body:   adminNote
        ? `Sua turma "${request.name}" foi recusada: ${adminNote}`
        : `Sua turma "${request.name}" foi recusada.`,
      refId:  request.id,
    });

    res.json({ message: 'Solicitação recusada.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── Materials Validation ─────────────────────────────────────────────────────

router.get('/materials', async (req: AuthRequest, res: Response) => {
  try {
    const { status = 'PENDING' } = req.query as { status?: string };
    const materials = await prisma.material.findMany({
      where:   { status: status as any },
      include: {
        uploader:    { select: { id: true, name: true } },
        institution: { select: { name: true } },
      },
      orderBy: { createdAt: 'asc' },
    });
    res.json(materials);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.put('/materials/:id/approve', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const material = await prisma.material.findUnique({ where: { id } });
    if (!material) return res.status(404).json({ error: 'Material não encontrado.' });

    await prisma.material.update({ where: { id }, data: { status: 'APPROVED' } });
    await grantMaterialPoints(material.uploaderId, material.type);

    const MATERIAL_LABELS: Record<string, string> = { EXAM: 'prova', EXERCISE_LIST: 'lista de exercícios', SUMMARY: 'resumo' };
    const { MATERIAL_POINTS } = await import('../lib/points');

    await createNotification({
      userId: material.uploaderId,
      type:   'MATERIAL_VALIDATED',
      title:  'Material aprovado! ✅',
      body:   `Seu ${MATERIAL_LABELS[material.type]} foi validado e você ganhou ${MATERIAL_POINTS[material.type]} pontos.`,
      refId:  material.id,
    });

    res.json({ message: 'Material aprovado.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.put('/materials/:id/reject', validate(adminRejectSchema), async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const { adminNote } = req.body;
    const material = await prisma.material.findUnique({ where: { id } });
    if (!material) return res.status(404).json({ error: 'Material não encontrado.' });

    await prisma.material.update({
      where: { id },
      data:  { status: 'REJECTED', adminNote: adminNote ?? null },
    });

    await createNotification({
      userId: material.uploaderId,
      type:   'MATERIAL_VALIDATED',
      title:  'Material recusado',
      body:   adminNote
        ? `Seu material foi recusado: ${adminNote}`
        : 'Seu material não atendeu aos critérios de validação.',
      refId:  material.id,
    });

    res.json({ message: 'Material recusado.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── Reports ──────────────────────────────────────────────────────────────────

router.get('/reports', async (req: AuthRequest, res: Response) => {
  try {
    const { status = 'OPEN' } = req.query as { status?: string };
    const reports = await prisma.report.findMany({
      where:   { status: status as any },
      include: {
        reporter:   { select: { id: true, name: true, username: true } },
        reported:   { select: { id: true, name: true, username: true } },
        classGroup: { select: { id: true, name: true } },
      },
      orderBy: { createdAt: 'desc' },
    });
    res.json(reports);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.put('/reports/:id/warn', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) return res.status(404).json({ error: 'Reporte não encontrado.' });

    const { adminNote } = req.body;
    await prisma.report.update({
      where: { id },
      data:  { status: 'WARNED', adminNote: adminNote ?? null },
    });
    res.json({ message: 'Advertência registrada.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.put('/reports/:id/remove', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) return res.status(404).json({ error: 'Reporte não encontrado.' });

    // Remove from class group
    await prisma.classGroupMember.deleteMany({
      where: { userId: report.reportedId, classGroupId: report.classGroupId },
    });
    await prisma.report.update({ where: { id }, data: { status: 'REMOVED' } });

    res.json({ message: 'Usuário removido da turma.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

router.put('/reports/:id/ban', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const report = await prisma.report.findUnique({ where: { id } });
    if (!report) return res.status(404).json({ error: 'Reporte não encontrado.' });

    await prisma.user.update({ where: { id: report.reportedId }, data: { role: 'BANNED' as any } });
    await prisma.report.update({ where: { id }, data: { status: 'BANNED' } });

    res.json({ message: 'Usuário banido.' });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── Institutions ─────────────────────────────────────────────────────────────

router.post('/institutions', async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.body;
    if (!name?.trim()) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const institution = await prisma.institution.create({ data: { name: name.trim() } });
    res.status(201).json(institution);
  } catch (err: any) {
    if (err.code === 'P2002') return res.status(409).json({ error: 'Instituição já existe.' });
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── Legacy endpoints (kept for backwards compat) ─────────────────────────────

router.get('/', async (_req: AuthRequest, res: Response) => {
  res.redirect('/api/admin/users');
});

router.post('/classes', async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Nome é obrigatório.' });
    const classGroup = await prisma.classGroup.create({ data: { name } });
    res.status(201).json(classGroup);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro ao criar turma.' });
  }
});

export default router;
