import { Request, Response, NextFunction } from 'express';
import jwt from 'jsonwebtoken';

const JWT_SECRET = process.env.JWT_SECRET || 'your_super_secret_jwt_token_here_change_in_production';

export interface AuthRequest extends Request {
  user?: {
    userId: string;
    role: "ADMIN" | "STUDENT";
    classGroupId?: string;
  };
}

export const authenticateToken = (req: AuthRequest, res: Response, next: NextFunction) => {
  const authHeader = req.headers['authorization'];
  const token = authHeader && authHeader.split(' ')[1];

  if (!token) return res.status(401).json({ error: 'Access denied. No token provided.' });

  jwt.verify(token, JWT_SECRET, (err, decoded) => {
    if (err) return res.status(403).json({ error: 'Invalid or expired token.' });
    req.user = decoded as { userId: string; role: "ADMIN" | "STUDENT"; classGroupId?: string };
    next();
  });
};

export const isAdmin = (req: AuthRequest, res: Response, next: NextFunction) => {
  if (req.user?.role !== 'ADMIN') {
    return res.status(403).json({ error: 'Access denied. Requires Admin privileges.' });
  }
  next();
};
