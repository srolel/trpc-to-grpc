import * as grpc from '@grpc/grpc-js';
import { createTRPCClient } from '@trpc/client';
import superjson from 'superjson';
import { addTRPCToGRPCServer, grpcLink } from '../../src/index.js';
import { createOrderServiceRouter, type OrderServiceRouter } from './order-service.contract.js';
import {
  ORDER_SERVICE_ADDRESS,
  USER_SERVICE_ADDRESS,
  bindGRPCServer,
  isMainModule,
  readFirstStringMetadata,
  shutdownGRPCServer,
} from './shared.js';
import type { UserServiceRouter } from './user-service.contract.js';

export interface RunningOrderService {
  address: string;
  port: number;
  close: () => Promise<void>;
}

export async function startOrderService(opts?: {
  address?: string;
  userServiceAddress?: string;
}): Promise<RunningOrderService> {
  const address = opts?.address ?? ORDER_SERVICE_ADDRESS;
  const userServiceAddress = opts?.userServiceAddress ?? USER_SERVICE_ADDRESS;

  const upstreamTransportClient = new grpc.Client(
    userServiceAddress,
    grpc.credentials.createInsecure(),
  );

  const userServiceClient = createTRPCClient<UserServiceRouter>({
    links: [
      grpcLink({
        address: userServiceAddress,
        credentials: grpc.credentials.createInsecure(),
        client: upstreamTransportClient,
        transformer: superjson,
        metadata() {
          return {
            'x-caller-service': 'order-service',
          };
        },
        callOptions() {
          return {
            deadline: new Date(Date.now() + 1_000),
          };
        },
      }),
    ],
  });

  const router: OrderServiceRouter = createOrderServiceRouter({
    async getUserById(input, context) {
      return await userServiceClient.userById.query(input, {
        context: {
          grpcMetadata: {
            'x-request-id': context.requestId ?? 'missing-request-id',
          },
        },
      });
    },
  });

  const server = new grpc.Server();

  addTRPCToGRPCServer(server, {
    router,
    createContext({ metadata }) {
      return {
        requestId: readFirstStringMetadata(metadata, 'x-request-id'),
      };
    },
  });

  const port = await bindGRPCServer(server, address);

  return {
    address,
    port,
    async close() {
      upstreamTransportClient.close();
      await shutdownGRPCServer(server);
    },
  };
}

if (isMainModule(import.meta.url)) {
  const service = await startOrderService();
  console.log(`[order-service] listening on ${service.address}`);

  const shutdown = async () => {
    console.log('[order-service] shutting down');
    await service.close();
    process.exit(0);
  };

  process.once('SIGINT', () => {
    void shutdown();
  });
  process.once('SIGTERM', () => {
    void shutdown();
  });
}
