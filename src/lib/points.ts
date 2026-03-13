import { MaterialType } from '@prisma/client';
import { prisma } from '../server';
import { addMonths } from './dateUtils';

export const MATERIAL_POINTS: Record<MaterialType, number> = {
  EXAM:          10,
  EXERCISE_LIST:  5,
  SUMMARY:        3,
};

const POINTS_FOR_PREMIUM = 100;
const POINTS_PREMIUM_MONTHS = 2;

/**
 * Credits points for a validated material upload.
 * If the user reaches 100 points, automatically grants 2 months of premium
 * and deducts the 100 points from their balance.
 */
export async function grantMaterialPoints(userId: string, type: MaterialType): Promise<void> {
  const pts = MATERIAL_POINTS[type];

  const updated = await prisma.user.update({
    where: { id: userId },
    data: { points: { increment: pts } },
    select: { points: true, plan: true, premiumUntil: true },
  });

  if (updated.points >= POINTS_FOR_PREMIUM) {
    const now = new Date();
    const currentEnd = updated.premiumUntil && updated.premiumUntil > now
      ? updated.premiumUntil
      : now;

    await prisma.user.update({
      where: { id: userId },
      data: {
        points:      { decrement: POINTS_FOR_PREMIUM },
        plan:        'PREMIUM',
        premiumUntil: addMonths(currentEnd, POINTS_PREMIUM_MONTHS),
      },
    });
  }
}
