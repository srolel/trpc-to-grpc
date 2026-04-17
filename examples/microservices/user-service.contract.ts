import { TRPCError, initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { z } from 'zod';

export interface UserServiceContext {
  requestId: string | null;
  callerService: string | null;
}

const t = initTRPC.context<UserServiceContext>().create({
  transformer: superjson,
});

const users = {
  user_1: {
    id: 'user_1',
    name: 'Ada Lovelace',
    tier: 'enterprise',
  },
  user_2: {
    id: 'user_2',
    name: 'Grace Hopper',
    tier: 'pro',
  },
} as const;

export const userServiceRouter = t.router({
  userById: t.procedure
    .input(
      z.object({
        id: z.string(),
      }),
    )
    .query(({ input, ctx }) => {
      const user = users[input.id as keyof typeof users];

      if (!user) {
        throw new TRPCError({
          code: 'NOT_FOUND',
          message: `No user found for id ${input.id}`,
        });
      }

      return {
        ...user,
        requestId: ctx.requestId,
        callerService: ctx.callerService,
        fetchedAt: new Date('2024-01-01T00:00:00.000Z'),
      };
    }),
});

export type UserServiceRouter = typeof userServiceRouter;
