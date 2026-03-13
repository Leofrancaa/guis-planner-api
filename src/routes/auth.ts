import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../server';
import { authenticateToken, AuthRequest } from '../middlewares/auth';
import { validate } from '../lib/validate';
import { loginSchema, registerSchema, edagSchema } from '../lib/zod-schemas';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_token_here_change_in_production';

const USER_SELECT = {
  id: true, username: true, name: true, role: true, password: true,
  classGroupId: true, plan: true, premiumUntil: true, institutionId: true,
  edag: true, points: true, hasReceivedLeaderBonus: true,
} as const;

function isValidUsername(username: string): boolean {
  return /^[a-záàâãéèêíïóôõúüç][a-záàâãéèêíïóôõúüç0-9]*\.[a-záàâãéèêíïóôõúüç][a-záàâãéèêíïóôõúüç0-9]*$/.test(username);
}

type UserRow = {
  id: string; username: string; name: string; role: any;
  classGroupId?: string | null; plan: any; premiumUntil?: Date | null;
  institutionId?: string | null; edag?: number | null; points: number;
  hasReceivedLeaderBonus: boolean;
};

function buildUserPayload(user: UserRow) {
  return {
    id:                    user.id,
    username:              user.username,
    name:                  user.name,
    role:                  user.role,
    classGroupId:          user.classGroupId ?? null,
    plan:                  user.plan,
    premiumUntil:          user.premiumUntil instanceof Date
                             ? user.premiumUntil.toISOString()
                             : user.premiumUntil ?? null,
    institutionId:         user.institutionId ?? null,
    edag:                  user.edag ?? null,
    points:                user.points,
    hasReceivedLeaderBonus: user.hasReceivedLeaderBonus,
  };
}

function buildToken(user: { id: string; role: any; classGroupId?: string | null; plan: any; premiumUntil?: Date | null | string }) {
  return jwt.sign(
    {
      userId:       user.id,
      role:         user.role,
      classGroupId: user.classGroupId ?? null,
      plan:         user.plan,
      premiumUntil: user.premiumUntil instanceof Date
                      ? user.premiumUntil.toISOString()
                      : user.premiumUntil ?? null,
    },
    JWT_SECRET,
    { expiresIn: '7d' }
  );
}

// POST /api/auth/login
router.post('/login', validate(loginSchema), async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    const user = await prisma.user.findUnique({
      where:  { username },
      select: USER_SELECT,
    });
    if (!user) return res.status(401).json({ error: 'Credenciais inválidas.' });

    if (String(user.role) === 'BANNED') {
      return res.status(403).json({ error: 'Sua conta foi suspensa. Entre em contato com o suporte.' });
    }

    const valid = await bcrypt.compare(password, user.password);
    if (!valid) return res.status(401).json({ error: 'Credenciais inválidas.' });

    const token = buildToken(user);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _pw, ...userWithoutPassword } = user;
    res.json({ token, user: buildUserPayload(userWithoutPassword as UserRow) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// GET /api/auth/classes  (legacy)
router.get('/classes', async (_req: Request, res: Response) => {
  try {
    const classes = await prisma.classGroup.findMany({ select: { id: true, name: true } });
    res.json(classes);
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// POST /api/auth/register
router.post('/register', validate(registerSchema), async (req: Request, res: Response) => {
  try {
    const { name, username, password, institutionId } = req.body;

    if (username.endsWith('.admin')) {
      return res.status(400).json({ error: 'Esse nome de usuário não está disponível.' });
    }

    if (!isValidUsername(username)) {
      return res.status(400).json({ error: 'Usuário deve estar no formato nome.sobrenome (letras e ponto).' });
    }

    const existing = await prisma.user.findUnique({ where: { username } });
    if (existing) return res.status(409).json({ error: 'Esse usuário já está em uso.' });

    const institution = await (prisma as any).institution.findUnique({ where: { id: institutionId } });
    if (!institution) return res.status(400).json({ error: 'Instituição não encontrada.' });

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username,
        password: hashedPassword,
        name,
        role: 'STUDENT',
        plan: 'FREE' as any,
        institutionId,
        termsAcceptedAt: new Date(),
      } as any,
      select: USER_SELECT,
    });

    const token = buildToken(user as any);
    // eslint-disable-next-line @typescript-eslint/no-unused-vars
    const { password: _pw, ...userWithoutPassword } = user as any;
    res.status(201).json({ token, user: buildUserPayload(userWithoutPassword as UserRow) });
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

// PUT /api/auth/edag
router.put('/edag', authenticateToken, validate(edagSchema), async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { edag } = req.body;

    const user = await prisma.user.update({
      where:  { id: userId },
      data:   { edag: edag ?? null },
      select: {
        id: true, username: true, name: true, role: true, classGroupId: true,
        edag: true, plan: true, premiumUntil: true, institutionId: true,
        points: true, hasReceivedLeaderBonus: true,
      } as any,
    });

    res.json(buildUserPayload(user as any));
  } catch (err) {
    console.error(err);
    res.status(500).json({ error: 'Erro interno.' });
  }
});

export default router;
