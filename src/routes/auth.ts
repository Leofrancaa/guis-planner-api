import { Router, Request, Response } from 'express';
import bcrypt from 'bcryptjs';
import jwt from 'jsonwebtoken';
import { prisma } from '../server';
import { authenticateToken, AuthRequest } from '../middlewares/auth';

const router = Router();
const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_token_here_change_in_production';

// Validates nome.sobrenome format (supports accented characters)
function isValidUsername(username: string): boolean {
  return /^[a-záàâãéèêíïóôõúüç][a-záàâãéèêíïóôõúüç0-9]*\.[a-záàâãéèêíïóôõúüç][a-záàâãéèêíïóôõúüç0-9]*$/.test(username);
}

router.post('/login', async (req: Request, res: Response) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Usuário e senha são obrigatórios' });
    }

    const user = await prisma.user.findUnique({
      where: { username: username.toLowerCase() }
    });

    if (!user) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const validPassword = await bcrypt.compare(password, user.password);
    if (!validPassword) {
      return res.status(401).json({ error: 'Credenciais inválidas' });
    }

    const token = jwt.sign(
      { userId: user.id, role: user.role, classGroupId: user.classGroupId },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.json({
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        classGroupId: user.classGroupId
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.get('/classes', async (req: Request, res: Response) => {
  try {
    const classes = await prisma.classGroup.findMany({ select: { id: true, name: true } });
    res.json(classes);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.post('/register', async (req: Request, res: Response) => {
  try {
    const { name, username, password, classGroupId } = req.body;

    if (!name || !username || !password) {
      return res.status(400).json({ error: 'Nome, usuário e senha são obrigatórios' });
    }

    if (!isValidUsername(username.toLowerCase())) {
      return res.status(400).json({ error: 'Usuário deve estar no formato nome.sobrenome (apenas letras e ponto)' });
    }

    if (password.length < 6) {
      return res.status(400).json({ error: 'A senha deve ter pelo menos 6 caracteres' });
    }

    const existing = await prisma.user.findUnique({ where: { username: username.toLowerCase() } });
    if (existing) {
      return res.status(409).json({ error: 'Esse usuário já está em uso' });
    }

    if (classGroupId) {
      const classExists = await prisma.classGroup.findUnique({ where: { id: classGroupId } });
      if (!classExists) {
        return res.status(400).json({ error: 'Turma não encontrada' });
      }
    }

    const hashedPassword = await bcrypt.hash(password, 10);
    const user = await prisma.user.create({
      data: {
        username: username.toLowerCase(),
        password: hashedPassword,
        name,
        role: 'STUDENT',
        classGroupId: classGroupId || null
      }
    });

    const token = jwt.sign(
      { userId: user.id, role: user.role, classGroupId: user.classGroupId },
      JWT_SECRET,
      { expiresIn: '7d' }
    );

    res.status(201).json({
      token,
      user: {
        id: user.id,
        username: user.username,
        name: user.name,
        role: user.role,
        classGroupId: user.classGroupId
      }
    });
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

router.put('/edag', authenticateToken, async (req: AuthRequest, res: Response) => {
  try {
    const userId = req.user!.userId;
    const { edag } = req.body;

    const user = await prisma.user.update({
      where: { id: userId },
      data: { edag: edag !== undefined ? edag : null },
      select: { id: true, username: true, name: true, role: true, classGroupId: true, edag: true }
    });

    res.json(user);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
