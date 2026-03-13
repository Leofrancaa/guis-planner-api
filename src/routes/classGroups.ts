import { Router, Response } from 'express';
import { prisma } from '../server';
import { authenticateToken, AuthRequest } from '../middlewares/auth';
import { checkPremium } from '../middlewares/checkPremium';
import { validate } from '../lib/validate';
import { classGroupRequestSchema, reportUserSchema } from '../lib/zod-schemas';
import { createNotification, notifyAdmins } from '../lib/notify';

const router = Router();
router.use(authenticateToken);

// POST /api/class-groups — direct creation (no admin needed)
router.post('/', validate(classGroupRequestSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { name, institutionId } = req.body;
    const userId = req.user!.userId;

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { institutionId: true } });
    if (!user?.institutionId || user.institutionId !== institutionId) {
      return res.status(403).json({ error: 'Você só pode criar turmas para a sua instituição.' });
    }

    // Check if class already exists in this institution
    const existing = await prisma.classGroup.findFirst({
      where: { 
        name: name.trim(),
        institutionId: institutionId
      }
    });

    if (existing) {
      return res.status(409).json({ error: 'Já existe uma turma com este nome nesta instituição.' });
    }

    // Create the class group directly
    const group = await prisma.classGroup.create({
      data: {
        name: name.trim(),
        institutionId,
        leaderId: userId,
      }
    });

    // Add creator as LEADER
    await prisma.classGroupMember.create({
      data: { userId, classGroupId: group.id, role: 'LEADER' }
    });

    res.status(201).json(group);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno ao criar turma.' });
  }
});

// POST /api/class-groups/request — keep for backwards compat if needed, or remove later
router.post('/request', checkPremium, validate(classGroupRequestSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { name, institutionId } = req.body;
    const requesterId = req.user!.userId;

    // Verify institution matches user's institution (or admin can request for any)
    const user = await prisma.user.findUnique({ where: { id: requesterId }, select: { institutionId: true } });
    if (req.user!.role !== 'ADMIN' && user?.institutionId !== institutionId) {
      return res.status(403).json({ error: 'Você só pode solicitar turmas da sua instituição.' });
    }

    // Check for existing pending request
    const pending = await prisma.classGroupRequest.findFirst({
      where: { requesterId, status: 'PENDING' },
    });
    if (pending) {
      return res.status(409).json({ error: 'Você já tem uma solicitação de turma pendente.' });
    }

    const request = await prisma.classGroupRequest.create({
      data: { requesterId, name: name.trim(), institutionId, status: 'PENDING' },
    });

    await notifyAdmins({
      type:  'REPORT_RECEIVED',
      title: 'Nova solicitação de turma',
      body:  `Usuário solicitou criação da turma: "${name}"`,
      refId: request.id,
    });

    res.status(201).json(request);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/class-groups — list class groups from user's institution
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const user = await prisma.user.findUnique({
      where: { id: userId },
      select: { institutionId: true },
    });

    const where = user?.institutionId
      ? { institutionId: user.institutionId }
      : {};

    const groups = await prisma.classGroup.findMany({
      where,
      include: {
        leader:   { select: { id: true, name: true, username: true } },
        members:  { select: { userId: true, role: true } },
        _count:   { select: { members: true } },
      },
      orderBy: { createdAt: 'desc' },
    });

    const result = groups.map(g => ({
      id:           g.id,
      name:         g.name,
      institutionId: g.institutionId,
      leader:       g.leader,
      memberCount:  g._count.members,
      myRole:       g.members.find(m => m.userId === userId)?.role ?? null,
    }));

    res.json(result);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/class-groups/:id — single group detail
router.get('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id = req.params.id as string;
    const group = await prisma.classGroup.findUnique({
      where: { id },
      include: {
        leader:      { select: { id: true, name: true, username: true } },
        institution: { select: { id: true, name: true } },
        subjects:    { where: { classGroupId: id } },
        _count:      { select: { members: true } },
      },
    });
    if (!group) return res.status(404).json({ error: 'Turma não encontrada.' });
    res.json({ ...group, memberCount: (group as any)._count.members });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// POST /api/class-groups/:id/join
router.post('/:id/join', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const classGroupId = req.params.id as string;

    const group = await prisma.classGroup.findUnique({
      where: { id: classGroupId },
      select: { institutionId: true, leaderId: true },
    });
    if (!group) return res.status(404).json({ error: 'Turma não encontrada.' });

    const user = await prisma.user.findUnique({ where: { id: userId }, select: { institutionId: true } });
    if (req.user!.role !== 'ADMIN' && user?.institutionId !== group.institutionId) {
      return res.status(403).json({ error: 'Você só pode entrar em turmas da sua instituição.' });
    }

    const membership = await prisma.classGroupMember.upsert({
      where:  { userId_classGroupId: { userId, classGroupId } },
      update: {},
      create: { userId, classGroupId, role: 'MEMBER' },
    });

    // Notify the leader
    if (group.leaderId && group.leaderId !== userId) {
      const joiner = await prisma.user.findUnique({ where: { id: userId }, select: { name: true } });
      await createNotification({
        userId: group.leaderId,
        type:   'MEMBER_JOINED',
        title:  'Novo membro na turma',
        body:   `${joiner?.name ?? 'Um aluno'} entrou na sua turma.`,
        refId:  classGroupId,
      });
    }

    res.json(membership);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// DELETE /api/class-groups/:id/leave
router.delete('/:id/leave', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const classGroupId = req.params.id as string;

    const membership = await prisma.classGroupMember.findUnique({
      where: { userId_classGroupId: { userId, classGroupId } },
    });
    if (!membership) return res.status(404).json({ error: 'Você não é membro desta turma.' });
    if (membership.role === 'LEADER') {
      return res.status(400).json({ error: 'O líder não pode sair da própria turma.' });
    }

    await prisma.classGroupMember.delete({
      where: { userId_classGroupId: { userId, classGroupId } },
    });
    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/class-groups/:id/members
router.get('/:id/members', async (req: AuthRequest, res: Response) => {
  try {
    const members = await prisma.classGroupMember.findMany({
      where:   { classGroupId: req.params.id as string },
      include: { user: { select: { id: true, name: true, username: true } } },
      orderBy: { joinedAt: 'asc' },
    });
    res.json(members);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// POST /api/class-groups/:id/report — leader only
router.post('/:id/report', validate(reportUserSchema), async (req: AuthRequest, res: Response) => {
  try {
    const reporterId   = req.user!.userId;
    const classGroupId = req.params.id as string;
    const { reportedUserId, reason } = req.body;

    const leaderMembership = await prisma.classGroupMember.findUnique({
      where: { userId_classGroupId: { userId: reporterId, classGroupId } },
    });
    if (leaderMembership?.role !== 'LEADER' && req.user!.role !== 'ADMIN') {
      return res.status(403).json({ error: 'Apenas o líder da turma pode reportar membros.' });
    }

    const report = await prisma.report.create({
      data: { reporterId, reportedId: reportedUserId, classGroupId, reason, status: 'OPEN' },
    });

    await notifyAdmins({
      type:  'REPORT_RECEIVED',
      title: 'Novo reporte de usuário',
      body:  `Um líder de turma reportou um membro. Motivo: ${reason.slice(0, 80)}`,
      refId: report.id,
    });

    res.status(201).json(report);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

export default router;
