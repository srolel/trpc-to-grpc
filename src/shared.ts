import * as grpc from '@grpc/grpc-js';
import type {
  CombinedDataTransformer,
  DataTransformerOptions,
} from '@trpc/server/unstable-core-do-not-import';

export const TRPC_GRPC_SERVICE_NAME = 'trpc.transport.v1.TRPCTransport';
export const TRPC_GRPC_CALL_METHOD = `/${TRPC_GRPC_SERVICE_NAME}/Call`;

export type MaybePromise<T> = T | Promise<T>;
export type UnaryProcedureType = 'query' | 'mutation';

export interface GRPCCallRequest {
  path: string;
  type: UnaryProcedureType;
  input?: unknown;
}

export interface GRPCCallResponse {
  response: unknown;
}

export type MetadataInit =
  | grpc.Metadata
  | Record<string, grpc.MetadataValue | grpc.MetadataValue[] | undefined>;

export function getTransformer(
  transformer?: DataTransformerOptions,
): CombinedDataTransformer {
  if (!transformer) {
    return {
      input: {
        serialize: (value) => value,
        deserialize: (value) => value,
      },
      output: {
        serialize: (value) => value,
        deserialize: (value) => value,
      },
    };
  }

  if ('input' in transformer) {
    return transformer;
  }

  return {
    input: transformer,
    output: transformer,
  };
}

export function serializeJsonMessage<T extends object>(value: T): Buffer {
  return Buffer.from(JSON.stringify(value), 'utf8');
}

export function deserializeJsonMessage<T>(value: Buffer): T {
  return JSON.parse(value.toString('utf8')) as T;
}

export function mergeMetadata(
  target: grpc.Metadata,
  init?: MetadataInit,
): grpc.Metadata {
  if (!init) {
    return target;
  }

  if (init instanceof grpc.Metadata) {
    target.merge(init);
    return target;
  }

  for (const [key, value] of Object.entries(init)) {
    if (value === undefined) {
      continue;
    }

    const values = Array.isArray(value) ? value : [value];
    for (const entry of values) {
      target.add(key, entry);
    }
  }

  return target;
}

export function createMetadata(init?: MetadataInit): grpc.Metadata {
  return mergeMetadata(new grpc.Metadata(), init);
}

export function isAsyncIterable(value: unknown): value is AsyncIterable<unknown> {
  return (
    typeof value === 'object' &&
    value !== null &&
    Symbol.asyncIterator in value &&
    typeof (value as AsyncIterable<unknown>)[Symbol.asyncIterator] === 'function'
  );
}

export function isUnaryProcedureType(value: unknown): value is UnaryProcedureType {
  return value === 'query' || value === 'mutation';
}

export const TRPC_GRPC_SERVICE_DEFINITION: grpc.ServiceDefinition = {
  Call: {
    path: TRPC_GRPC_CALL_METHOD,
    requestStream: false,
    responseStream: false,
    requestSerialize: serializeJsonMessage<GRPCCallRequest>,
    requestDeserialize: deserializeJsonMessage<GRPCCallRequest>,
    responseSerialize: serializeJsonMessage<GRPCCallResponse>,
    responseDeserialize: deserializeJsonMessage<GRPCCallResponse>,
    originalName: 'Call',
  },
};
