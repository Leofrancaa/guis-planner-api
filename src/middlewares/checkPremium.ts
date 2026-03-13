import { Response, NextFunction } from 'express';
import { AuthRequest } from './auth';

/**
 * Middleware that blocks non-premium users.
 * Admins always pass through (they have implicit premium access).
 */
export const checkPremium = (req: AuthRequest, res: Response, next: NextFunction) => {
  const user = req.user!;

  // Admins always have full access
  if (user.role === 'ADMIN') return next();

  const isPremium =
    user.plan === 'PREMIUM' &&
    (user.premiumUntil === null || new Date(user.premiumUntil) > new Date());

  if (!isPremium) {
    return res.status(403).json({ error: 'Recurso exclusivo para usuários Premium.' });
  }

  next();
};
