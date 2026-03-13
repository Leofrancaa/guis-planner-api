import { Router, Response } from 'express';
import bcrypt from 'bcryptjs';
import { prisma } from '../server';
import { authenticateToken, isAdmin, AuthRequest } from '../middlewares/auth';

const router = Router();

// Protect all routes below with authentication and admin privileges
router.use(authenticateToken);
router.use(isAdmin);

// Get all users
router.get('/', async (req: AuthRequest, res: Response) => {
  try {
    const users = await prisma.user.findMany({
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        classGroup: {
          select: { id: true, name: true }
        },
        createdAt: true
      }
    });
    res.json(users);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

// Create a new Class Group (Turma)
router.post('/classes', async (req: AuthRequest, res: Response) => {
  try {
    const { name } = req.body;
    if (!name) return res.status(400).json({ error: 'Name is required' });

    const classGroup = await prisma.classGroup.create({
      data: { name }
    });
    
    res.status(201).json(classGroup);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Could not create Class Group' });
  }
});

// Create a new user (Student)
router.post('/', async (req: AuthRequest, res: Response) => {
  try {
    const { username, password, name, classGroupId } = req.body;

    if (!username || !password || !name) {
      return res.status(400).json({ error: 'Username, password, and name are required' });
    }

    const existingUser = await prisma.user.findUnique({ where: { username } });
    if (existingUser) {
      return res.status(400).json({ error: 'Username already in use' });
    }

    const hashedPassword = await bcrypt.hash(password, 10);

    const data: any = {
      username,
      password: hashedPassword,
      name,
      role: 'STUDENT'
    };

    if (classGroupId) {
      data.classGroupId = classGroupId;
    }

    const newUser = await prisma.user.create({
      data,
      select: {
        id: true,
        username: true,
        name: true,
        role: true,
        classGroupId: true
      }
    });

    res.status(201).json(newUser);
  } catch (error) {
    console.error(error);
    res.status(500).json({ error: 'Internal server error' });
  }
});

export default router;
