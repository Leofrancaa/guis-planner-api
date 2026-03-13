import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_token_here_change_in_production';

export interface AuthRequest extends Request {
  user?: {
    userId:      string;
    role:        'ADMIN' | 'STUDENT' | 'BANNED';
    classGroupId?: string;
    plan:        'FREE' | 'PREMIUM';
    premiumUntil: string | null;
  };
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Acesso negado. Token não fornecido.' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Token inválido ou expirado.' });
    const payload = decoded as {
      userId: string;
      role: 'ADMIN' | 'STUDENT' | 'BANNED';
      classGroupId?: string;
      plan: 'FREE' | 'PREMIUM';
      premiumUntil: string | null;
    };

    // Banned users cannot access any protected route
    if (payload.role === 'BANNED') {
      return res.status(403).json({ error: 'Sua conta foi suspensa. Entre em contato com o suporte.' });
    }

    req.user = payload;
    next();
  });
};

export const isAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Acesso negado. Requer privilégios de Admin.' });
  }
  next();
};
