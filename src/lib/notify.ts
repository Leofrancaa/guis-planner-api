import { NotificationType, PrismaClient } from '@prisma/client';
import { prisma } from '../server';

interface NotifyParams {
  userId: string;
  type:   NotificationType;
  title:  string;
  body:   string;
  refId?: string;
}

export async function createNotification(params: NotifyParams) {
  return prisma.notification.create({ data: params });
}

export async function notifyMany(
  userIds: string[],
  params: Omit<NotifyParams, 'userId'>
) {
  if (userIds.length === 0) return;
  return prisma.notification.createMany({
    data: userIds.map(userId => ({ userId, ...params })),
    skipDuplicates: true,
  });
}

export async function notifyAdmins(params: Omit<NotifyParams, 'userId'>) {
  const admins = await prisma.user.findMany({
    where: { role: 'ADMIN' },
    select: { id: true },
  });
  return notifyMany(admins.map(a => a.id), params);
}
