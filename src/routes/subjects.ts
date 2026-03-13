import { Router, Response } from 'express';
import { prisma } from '../server';
import { authenticateToken, AuthRequest } from '../middlewares/auth';
import { validate } from '../lib/validate';
import {
  createSubjectSchema, updateSubjectSchema, trackingSchema,
  enrollmentStatusSchema, subjectClassStatusSchema, gradeConfigSchema,
} from '../lib/zod-schemas';

const router = Router();
router.use(authenticateToken);

// ─── GET subjects ─────────────────────────────────────────────────────────────
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;

    // Find all class group IDs the user belongs to
    const memberships = await prisma.classGroupMember.findMany({
      where: { userId },
      select: { classGroupId: true }
    });
    const classGroupIds = memberships.map(m => m.classGroupId);

    const subjects = await prisma.subject.findMany({
      where: {
        OR: [
          { classGroupId: { in: classGroupIds } },
          { studentId: userId },
          { enrollments: { some: { userId } } },
        ],
      },
      include: {
        studentSubjects: { where: { userId } },
        enrollments:     { where: { userId }, include: { gradeConfigs: { orderBy: { order: 'asc' } } } },
        classGroup:      { select: { id: true, name: true } },
      },
    });

    res.json(subjects);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── POST create subject ──────────────────────────────────────────────────────
router.post('/', validate(createSubjectSchema), async (req: AuthRequest, res: Response) => {
  try {
    const { name, professor, color, hours, code, classGroupId: bodyClassGroupId, scope } = req.body;
    const userId = req.user!.userId;

    let classGroupId = bodyClassGroupId || req.user!.classGroupId || null;

    if (scope === 'CLASS') {
      if (!classGroupId) return res.status(400).json({ error: 'classGroupId é obrigatório para matérias de turma.' });

      // Must be leader of the class group
      const membership = await prisma.classGroupMember.findUnique({
        where: { userId_classGroupId: { userId, classGroupId } },
      });
      if (membership?.role !== 'LEADER' && req.user!.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Apenas o líder pode criar matérias na turma.' });
      }

      // Check duplicate
      const existing = await prisma.subject.findFirst({ where: { name, classGroupId } });
      if (existing) return res.status(409).json({ error: 'Matéria já existe nesta turma.' });
    }

    const data: any = { name, professor: professor || '', color: color || '#0ea5e9', hours, code: code ?? null };
    if (scope === 'CLASS') {
      data.classGroupId = classGroupId;
    } else {
      data.studentId = userId;
    }

    const subject = await prisma.subject.create({ data });
    res.status(201).json(subject);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── POST enroll in subject ───────────────────────────────────────────────────
router.post('/:id/enroll', async (req: AuthRequest, res: Response) => {
  try {
    const userId    = req.user!.userId;
    const subjectId = req.params.id as string;

    const subject = await prisma.subject.findUnique({
      where:   { id: subjectId },
      include: { classGroup: true },
    });
    if (!subject) return res.status(404).json({ error: 'Matéria não encontrada.' });

    if (subject.classStatus === 'COMPLETED') {
      return res.status(400).json({ error: 'Esta matéria já foi concluída. Não é possível se matricular.' });
    }

    if (subject.classGroupId) {
      const membership = await prisma.classGroupMember.findUnique({
        where: { userId_classGroupId: { userId, classGroupId: subject.classGroupId } },
      });
      if (!membership && req.user!.role !== 'ADMIN') {
        return res.status(403).json({ error: 'Você precisa ser membro da turma para se matricular.' });
      }
    }

    const enrollment = await prisma.enrollment.upsert({
      where:  { userId_subjectId: { userId, subjectId } },
      update: {},
      create: { userId, subjectId, status: 'ENROLLED' },
    });

    // Backward compat: also create StudentSubject
    await prisma.studentSubject.upsert({
      where:  { userId_subjectId: { userId, subjectId } },
      update: {},
      create: { userId, subjectId },
    });

    res.status(201).json(enrollment);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── PUT enrollment status (student sets own status) ─────────────────────────
router.put('/:id/enrollment-status', validate(enrollmentStatusSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId    = req.user!.userId;
    const subjectId = req.params.id as string;
    const { status } = req.body;

    const enrollment = await prisma.enrollment.findUnique({
      where: { userId_subjectId: { userId, subjectId } },
    });
    if (!enrollment) return res.status(404).json({ error: 'Matrícula não encontrada.' });

    if (['APPROVED', 'FAILED'].includes(status)) {
      const gradeConfigs = await prisma.gradeConfig.findMany({ where: { enrollmentId: enrollment.id } });
      if (gradeConfigs.length === 0) {
        return res.status(400).json({ error: 'Configure suas notas antes de finalizar a situação.' });
      }
    }

    const updated = await prisma.enrollment.update({
      where: { userId_subjectId: { userId, subjectId } },
      data:  { status },
    });

    // Sync to StudentSubject for backwards compat
    await prisma.studentSubject.update({
      where: { userId_subjectId: { userId, subjectId } },
      data:  { enrollmentStatus: status },
    }).catch(() => {});

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── PUT class-level status (leader/admin) ────────────────────────────────────
router.put('/:id/status', validate(subjectClassStatusSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId    = req.user!.userId;
    const subjectId = req.params.id as string;
    const { classStatus } = req.body;

    const subject = await prisma.subject.findUnique({ where: { id: subjectId } });
    if (!subject) return res.status(404).json({ error: 'Matéria não encontrada.' });

    if (req.user!.role !== 'ADMIN' && subject.classGroupId) {
      const membership = await prisma.classGroupMember.findUnique({
        where: { userId_classGroupId: { userId, classGroupId: subject.classGroupId } },
      });
      if (membership?.role !== 'LEADER') {
        return res.status(403).json({ error: 'Apenas o líder pode alterar o status da matéria.' });
      }
    }

    const updated = await prisma.subject.update({ where: { id: subjectId }, data: { classStatus } });
    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── GET grade config ─────────────────────────────────────────────────────────
router.get('/:id/grade-config', async (req: AuthRequest, res: Response) => {
  try {
    const userId    = req.user!.userId;
    const subjectId = req.params.id as string;

    const enrollment = await prisma.enrollment.findUnique({
      where:   { userId_subjectId: { userId, subjectId } },
      include: { gradeConfigs: { orderBy: { order: 'asc' } } },
    });

    const configs = (enrollment as any)?.gradeConfigs ?? [];

    // Calculate current average and needed grade
    const graded   = configs.filter((c: any) => c.grade !== null);
    const ungraded = configs.filter((c: any) => c.grade === null);

    const gradedWeightSum = graded.reduce((sum: number, c: any) => sum + c.weight, 0);
    const gradedScore     = graded.reduce((sum: number, c: any) => sum + (c.grade! * c.weight / 100), 0);
    const currentAverage  = gradedWeightSum > 0
      ? Math.round((gradedScore / gradedWeightSum) * gradedWeightSum * 10) / 10
      : null;

    let neededForPass: number | null = null;
    if (ungraded.length > 0) {
      const ungradedWeight = ungraded.reduce((sum: number, c: any) => sum + c.weight, 0);
      const needed = (7.0 - gradedScore) / (ungradedWeight / 100);
      neededForPass = needed > 10 ? null : Math.max(0, Math.round(needed * 10) / 10);
    }

    res.json({ configs, currentAverage, neededForPass });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── PUT grade config ─────────────────────────────────────────────────────────
router.put('/:id/grade-config', validate(gradeConfigSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId    = req.user!.userId;
    const subjectId = req.params.id as string;
    const { configs } = req.body;

    let enrollment = await prisma.enrollment.findUnique({
      where: { userId_subjectId: { userId, subjectId } },
    });
    if (!enrollment) {
      enrollment = await prisma.enrollment.create({ data: { userId, subjectId, status: 'ENROLLED' } });
    }

    // Replace all grade configs
    await prisma.gradeConfig.deleteMany({ where: { enrollmentId: enrollment.id } });
    await prisma.gradeConfig.createMany({
      data: configs.map((c: any) => ({
        enrollmentId: enrollment!.id,
        userId,
        label:  c.label,
        weight: c.weight,
        order:  c.order,
        grade:  c.grade ?? null,
      })),
    });

    const updated = await prisma.gradeConfig.findMany({
      where:   { enrollmentId: enrollment.id },
      orderBy: { order: 'asc' },
    });

    res.json({ configs: updated });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── PUT tracking (legacy: av1/av2/av3/absences) ─────────────────────────────
router.put('/:subjectId/tracking', validate(trackingSchema), async (req: AuthRequest, res: Response) => {
  try {
    const subjectId = req.params.subjectId as string;
    const userId    = req.user!.userId;
    const { absences, av1, av2, av3 } = req.body;

    const tracking = await prisma.studentSubject.upsert({
      where:  { userId_subjectId: { userId, subjectId } },
      update: {
        absences: absences !== undefined ? absences : undefined,
        av1:      av1 !== undefined ? av1 : undefined,
        av2:      av2 !== undefined ? av2 : undefined,
        av3:      av3 !== undefined ? av3 : undefined,
      },
      create: { userId, subjectId, absences: absences || 0, av1: av1 ?? null, av2: av2 ?? null, av3: av3 ?? null },
    });

    res.json(tracking);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── PUT update subject ───────────────────────────────────────────────────────
router.put('/:id', validate(updateSubjectSchema), async (req: AuthRequest, res: Response) => {
  try {
    const id       = req.params.id as string;
    const userId   = req.user!.userId;
    const { name, professor, color, hours, code } = req.body;

    const subject = await prisma.subject.findFirst({
      where: { id, OR: [{ studentId: userId }, { classGroupId: req.user!.classGroupId || undefined }, { enrollments: { some: { userId } } }] },
    });
    if (!subject) return res.status(404).json({ error: 'Matéria não encontrada.' });

    const updated = await prisma.subject.update({
      where: { id },
      data: {
        name:      name ?? subject.name,
        professor: professor ?? subject.professor,
        color:     color ?? subject.color,
        hours:     hours ?? subject.hours,
        code:      code !== undefined ? code : subject.code,
      },
      include: { studentSubjects: { where: { userId } } },
    });

    res.json(updated);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// ─── DELETE subject ───────────────────────────────────────────────────────────
router.delete('/:id', async (req: AuthRequest, res: Response) => {
  try {
    const id     = req.params.id as string;
    const userId = req.user!.userId;

    const subject = await prisma.subject.findFirst({
      where: { id, OR: [{ studentId: userId }, { classGroupId: req.user!.classGroupId || undefined }] },
    });
    if (!subject) return res.status(404).json({ error: 'Matéria não encontrada.' });

    await prisma.event.updateMany({ where: { subjectId: id }, data: { subjectId: null } });
    await prisma.subject.delete({ where: { id } });

    res.status(204).send();
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

export default router;
