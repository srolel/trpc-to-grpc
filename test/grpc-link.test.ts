import * as grpc from '@grpc/grpc-js';
import { createTRPCClient } from '@trpc/client';
import { TRPCError, initTRPC } from '@trpc/server';
import { afterAll, beforeAll, describe, expect, test } from 'vitest';
import { z } from 'zod';
import superjson from 'superjson';
import { addTRPCToGRPCServer, grpcLink } from '../src/index.js';

const t = initTRPC
  .context<{ authHeader: string | null; traceId: string | null }>()
  .create({ transformer: superjson });

const appRouter = t.router({
  hello: t.procedure
    .input(z.object({ name: z.string() }))
    .query(({ ctx, input }) => {
      return {
        message: `Hello ${input.name}`,
        authHeader: ctx.authHeader,
        traceId: ctx.traceId,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
      };
    }),
  secure: t.procedure.mutation(() => {
    throw new TRPCError({
      code: 'FORBIDDEN',
      message: 'Access denied',
    });
  }),
});

type AppRouter = typeof appRouter;

let server: grpc.Server;
let address: string;

beforeAll(async () => {
  server = new grpc.Server();

  addTRPCToGRPCServer(server, {
    router: appRouter,
    createContext({ metadata }) {
      const authValue = metadata.get('authorization')[0];
      const traceValue = metadata.get('x-trace-id')[0];

      return {
        authHeader: typeof authValue === 'string' ? authValue : null,
        traceId: typeof traceValue === 'string' ? traceValue : null,
      };
    },
  });

  const port = await new Promise<number>((resolve, reject) => {
    server.bindAsync(
      '127.0.0.1:0',
      grpc.ServerCredentials.createInsecure(),
      (error, boundPort) => {
        if (error) {
          reject(error);
          return;
        }
        resolve(boundPort);
      },
    );
  });

  address = `127.0.0.1:${port}`;
});

afterAll(async () => {
  await new Promise<void>((resolve) => {
    server.tryShutdown(() => resolve());
  });
});

function createClient() {
  const transportClient = new grpc.Client(
    address,
    grpc.credentials.createInsecure(),
  );

  const client = createTRPCClient<AppRouter>({
    links: [
      grpcLink({
        client: transportClient,
        address,
        credentials: grpc.credentials.createInsecure(),
        transformer: superjson,
        metadata() {
          return {
            authorization: 'Bearer service-token',
          };
        },
      }),
    ],
  });

  return {
    client,
    close() {
      transportClient.close();
    },
  };
}

describe('grpcLink', () => {
  test('round-trips queries over gRPC with metadata and transformers', async () => {
    const { client, close } = createClient();

    try {
      const result = await client.hello.query(
        { name: 'Ada' },
        {
          context: {
            grpcMetadata: {
              'x-trace-id': 'trace-123',
            },
          },
        },
      );

      expect(result).toEqual({
        message: 'Hello Ada',
        authHeader: 'Bearer service-token',
        traceId: 'trace-123',
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
      });
    } finally {
      close();
    }
  });

  test('maps tRPC errors back into TRPCClientError instances', async () => {
    const { client, close } = createClient();

    try {
      await expect(client.secure.mutate()).rejects.toMatchObject({
        message: 'Access denied',
        data: {
          code: 'FORBIDDEN',
          httpStatus: 403,
          path: 'secure',
        },
      });
    } finally {
      close();
    }
  });
});
