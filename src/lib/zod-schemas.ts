import { z } from 'zod';

// ─── Reusable primitives ──────────────────────────────────────────────────────

const shortStr = z.string().trim().min(1).max(255);
const uuidStr   = z.string().uuid();
const optUuid   = z.string().uuid().optional().nullable();

// ─── Auth ─────────────────────────────────────────────────────────────────────

export const loginSchema = z.object({
  username: shortStr.toLowerCase(),
  password: z.string().min(1),
});

export const registerSchema = z.object({
  name:          shortStr,
  username:      shortStr.toLowerCase(),
  password:      z.string().min(8, 'A senha deve ter pelo menos 8 caracteres'),
  institutionId: uuidStr,
  termsAccepted: z.literal(true).refine(v => v === true, {
    message: 'Você deve aceitar os termos de uso para continuar.',
  }),
});

export const edagSchema = z.object({
  edag: z.number().min(0).max(10).nullable(),
});

// ─── Subjects ─────────────────────────────────────────────────────────────────

export const createSubjectSchema = z.object({
  name:        shortStr,
  professor:   shortStr,
  color:       z.string().trim().min(1).max(50),
  hours:       z.number().int().positive(),
  code:        z.string().trim().max(50).optional().nullable(),
  classGroupId: optUuid,
  scope:       z.enum(['CLASS', 'INDIVIDUAL']).default('INDIVIDUAL'),
});

export const updateSubjectSchema = z.object({
  name:      shortStr.optional(),
  professor: shortStr.optional(),
  color:     z.string().trim().max(50).optional(),
  hours:     z.number().int().positive().optional(),
  code:      z.string().trim().max(50).optional().nullable(),
});

export const trackingSchema = z.object({
  absences: z.number().int().min(0).optional(),
  av1:      z.number().min(0).max(10).nullable().optional(),
  av2:      z.number().min(0).max(10).nullable().optional(),
  av3:      z.number().min(0).max(10).nullable().optional(),
});

export const enrollmentStatusSchema = z.object({
  status: z.enum(['ENROLLED', 'APPROVED', 'FAILED', 'LOCKED']),
});

export const subjectClassStatusSchema = z.object({
  classStatus: z.enum(['ACTIVE', 'COMPLETED']),
});

export const gradeConfigSchema = z.object({
  configs: z.array(z.object({
    label:  shortStr,
    weight: z.number().min(0.01).max(100),
    order:  z.number().int().min(0),
    grade:  z.number().min(0).max(10).nullable().optional(),
  })).nonempty(),
}).refine(
  (data) => {
    const total = data.configs.reduce((sum, c) => sum + c.weight, 0);
    return Math.abs(total - 100) < 0.01;
  },
  { message: 'A soma dos pesos deve ser igual a 100%.' }
);

// ─── Events ───────────────────────────────────────────────────────────────────

export const createEventSchema = z.object({
  title:       shortStr,
  date:        z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)),
  type:        z.enum(['exam', 'assignment', 'class', 'other']),
  subjectId:   optUuid,
  classGroupId: optUuid,
  scope:       z.enum(['CLASS', 'INDIVIDUAL']).default('INDIVIDUAL'),
});

// ─── Notes ────────────────────────────────────────────────────────────────────

export const createNoteSchema = z.object({
  title:     shortStr,
  content:   z.string().trim().min(1).max(10000),
  subjectId: uuidStr,
});

export const updateNoteSchema = z.object({
  title:     shortStr.optional(),
  content:   z.string().trim().min(1).max(10000).optional(),
  subjectId: uuidStr.optional(),
});

// ─── ClassGroups ──────────────────────────────────────────────────────────────

export const classGroupRequestSchema = z.object({
  name:          shortStr.regex(
    /^.+\s*-\s*.+\s*-\s*.+$/,
    'Formato obrigatório: Curso - Semestre - Turno'
  ),
  institutionId: uuidStr,
});

export const reportUserSchema = z.object({
  reportedUserId: uuidStr,
  reason:         z.string().trim().min(10).max(1000),
});

// ─── Ratings ──────────────────────────────────────────────────────────────────

export const ratingSchema = z.object({
  subjectId:       uuidStr,
  professor:       shortStr,
  didatica:        z.number().int().min(1).max(5),
  clareza:         z.number().int().min(1).max(5),
  disponibilidade: z.number().int().min(1).max(4),
  pontualidade:    z.number().int().min(1).max(4),
  dificuldade:     z.number().int().min(1).max(5),
});

// ─── Materials ────────────────────────────────────────────────────────────────

export const materialMetaSchema = z.object({
  institutionId: uuidStr,
  course:        shortStr,
  subjectName:   shortStr,
  professor:     shortStr,
  semester:      z.string().trim().regex(/^\d{4}\.\d$/, 'Formato: 2024.1'),
  type:          z.enum(['EXAM', 'EXERCISE_LIST', 'SUMMARY']),
  subjectId:     optUuid,
});

// ─── Study Events ─────────────────────────────────────────────────────────────

export const studyEventSchema = z.object({
  subjectId:    uuidStr,
  classGroupId: uuidStr,
  date:         z.string().datetime({ offset: true }).or(z.string().regex(/^\d{4}-\d{2}-\d{2}/)),
  method:       z.enum(['DISCORD', 'MEET', 'ZOOM', 'PRESENCIAL']),
  link:         z.string().url().optional().nullable(),
});

// ─── Admin ────────────────────────────────────────────────────────────────────

export const adminSetPlanSchema = z.object({
  plan:        z.enum(['FREE', 'PREMIUM']),
  premiumUntil: z.string().datetime().optional().nullable(),
});

export const adminRejectSchema = z.object({
  adminNote: z.string().trim().max(500).optional(),
});
