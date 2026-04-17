import * as grpc from '@grpc/grpc-js';
import { resolve } from 'node:path';
import { pathToFileURL } from 'node:url';

export const USER_SERVICE_PORT = 50051;
export const ORDER_SERVICE_PORT = 50052;

export const USER_SERVICE_ADDRESS = `127.0.0.1:${USER_SERVICE_PORT}`;
export const ORDER_SERVICE_ADDRESS = `127.0.0.1:${ORDER_SERVICE_PORT}`;

export async function bindGRPCServer(
  server: grpc.Server,
  address: string,
): Promise<number> {
  return await new Promise<number>((resolvePromise, rejectPromise) => {
    server.bindAsync(
      address,
      grpc.ServerCredentials.createInsecure(),
      (error, port) => {
        if (error) {
          rejectPromise(error);
          return;
        }

        resolvePromise(port);
      },
    );
  });
}

export async function shutdownGRPCServer(server: grpc.Server): Promise<void> {
  await new Promise<void>((resolvePromise, rejectPromise) => {
    server.tryShutdown((error) => {
      if (error) {
        rejectPromise(error);
        return;
      }

      resolvePromise();
    });
  });
}

export function readFirstStringMetadata(
  metadata: grpc.Metadata,
  key: string,
): string | null {
  const value = metadata.get(key)[0];
  return typeof value === 'string' ? value : null;
}

export function isMainModule(importMetaUrl: string): boolean {
  const entry = process.argv[1];
  if (!entry) {
    return false;
  }

  return pathToFileURL(resolve(entry)).href === importMetaUrl;
}
