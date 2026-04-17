import * as grpc from '@grpc/grpc-js';
import { addTRPCToGRPCServer } from '../../src/index.js';
import {
  USER_SERVICE_ADDRESS,
  bindGRPCServer,
  isMainModule,
  readFirstStringMetadata,
  shutdownGRPCServer,
} from './shared.js';
import { userServiceRouter } from './user-service.contract.js';

export interface RunningUserService {
  address: string;
  port: number;
  close: () => Promise<void>;
}

export async function startUserService(
  address = USER_SERVICE_ADDRESS,
): Promise<RunningUserService> {
  const server = new grpc.Server();

  addTRPCToGRPCServer(server, {
    router: userServiceRouter,
    createContext({ metadata }) {
      return {
        requestId: readFirstStringMetadata(metadata, 'x-request-id'),
        callerService: readFirstStringMetadata(metadata, 'x-caller-service'),
      };
    },
  });

  const port = await bindGRPCServer(server, address);

  return {
    address,
    port,
    async close() {
      await shutdownGRPCServer(server);
    },
  };
}

if (isMainModule(import.meta.url)) {
  const service = await startUserService();
  console.log(`[user-service] listening on ${service.address}`);

  const shutdown = async () => {
    console.log('[user-service] shutting down');
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
