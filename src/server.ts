import * as grpc from '@grpc/grpc-js';
import {
  TRPCError,
  callTRPCProcedure,
  getTRPCErrorFromUnknown,
  getTRPCErrorShape,
  transformTRPCResponse,
  type AnyTRPCRouter,
  type inferRouterContext,
} from '@trpc/server';
import type { ErrorHandlerOptions } from '@trpc/server/unstable-core-do-not-import';
import {
  TRPC_GRPC_SERVICE_DEFINITION,
  createMetadata,
  getTransformer,
  isAsyncIterable,
  isUnaryProcedureType,
  type GRPCCallRequest,
  type GRPCCallResponse,
  type MaybePromise,
  type MetadataInit,
  type UnaryProcedureType,
} from './shared.js';

export interface GRPCContextFactoryOptions {
  call: grpc.ServerUnaryCall<GRPCCallRequest, GRPCCallResponse>;
  metadata: grpc.Metadata;
  request: GRPCCallRequest;
  path: string;
  type: UnaryProcedureType;
  signal: AbortSignal;
}

export interface GRPCResponseMetadataOptions<TRouter extends AnyTRPCRouter> {
  call: grpc.ServerUnaryCall<GRPCCallRequest, GRPCCallResponse>;
  request: GRPCCallRequest;
  ctx: inferRouterContext<TRouter> | undefined;
  input: unknown;
  result?: unknown;
  error?: TRPCError;
}

export interface GRPCServerOptions<TRouter extends AnyTRPCRouter> {
  router: TRouter;
  createContext?: (
    opts: GRPCContextFactoryOptions,
  ) => MaybePromise<inferRouterContext<TRouter>>;
  onError?: (opts: ErrorHandlerOptions<inferRouterContext<TRouter>>) => void;
  responseMetadata?: (
    opts: GRPCResponseMetadataOptions<TRouter>,
  ) => MaybePromise<MetadataInit | undefined>;
}

async function maybeSendResponseMetadata<TRouter extends AnyTRPCRouter>(opts: {
  call: grpc.ServerUnaryCall<GRPCCallRequest, GRPCCallResponse>;
  request: GRPCCallRequest;
  ctx: inferRouterContext<TRouter> | undefined;
  input: unknown;
  result?: unknown;
  error?: TRPCError;
  responseMetadata?: GRPCServerOptions<TRouter>['responseMetadata'];
}) {
  if (!opts.responseMetadata) {
    return;
  }

  const metadataInit = await opts.responseMetadata({
    call: opts.call,
    request: opts.request,
    ctx: opts.ctx,
    input: opts.input,
    result: opts.result,
    error: opts.error,
  });

  if (!metadataInit) {
    return;
  }

  opts.call.sendMetadata(createMetadata(metadataInit));
}

export function createGRPCCallHandler<TRouter extends AnyTRPCRouter>(
  opts: GRPCServerOptions<TRouter>,
): grpc.handleUnaryCall<GRPCCallRequest, GRPCCallResponse> {
  const config = opts.router._def._config;
  const transformer = getTransformer(config.transformer);

  return (call, callback) => {
    const abortController = new AbortController();
    const onCancelled = () => {
      if (!abortController.signal.aborted) {
        abortController.abort(new Error('The gRPC request was cancelled'));
      }
    };

    call.on('cancelled', onCancelled);

    let ctx: inferRouterContext<TRouter> | undefined;
    let input: unknown;

    void (async () => {
      try {
        const request = call.request;

        if (!isUnaryProcedureType(request.type)) {
          throw new TRPCError({
            code: 'METHOD_NOT_SUPPORTED',
            message: `Unsupported tRPC procedure type \"${String(request.type)}\"`,
          });
        }

        input = transformer.input.deserialize(request.input);
        ctx = opts.createContext
          ? await opts.createContext({
              call,
              metadata: call.metadata,
              request,
              path: request.path,
              type: request.type,
              signal: abortController.signal,
            })
          : (undefined as inferRouterContext<TRouter>);

        const result = await callTRPCProcedure({
          router: opts.router,
          path: request.path,
          getRawInput: async () => input,
          ctx,
          type: request.type,
          signal: abortController.signal,
          batchIndex: 0,
        });

        if (isAsyncIterable(result)) {
          throw new TRPCError({
            code: 'METHOD_NOT_SUPPORTED',
            message:
              'The gRPC transport currently supports unary query and mutation procedures only.',
          });
        }

        await maybeSendResponseMetadata({
          call,
          request,
          ctx,
          input,
          result,
          responseMetadata: opts.responseMetadata,
        });

        callback(null, {
          response: transformTRPCResponse(config, {
            result: {
              type: 'data',
              data: result,
            },
          }),
        });
      } catch (cause) {
        const request = call.request;
        const error = getTRPCErrorFromUnknown(cause);
        const procedureType = isUnaryProcedureType(request.type)
          ? request.type
          : ('unknown' as const);

        if (isUnaryProcedureType(request.type)) {
          opts.onError?.({
            ctx,
            error,
            input,
            path: request.path,
            type: request.type,
          });
        }

        await maybeSendResponseMetadata({
          call,
          request,
          ctx,
          input,
          error,
          responseMetadata: opts.responseMetadata,
        });

        callback(null, {
          response: transformTRPCResponse(config, {
            error: getTRPCErrorShape({
              config,
              ctx,
              error,
              input,
              path: request.path,
              type: procedureType,
            }),
          }),
        });
      } finally {
        call.removeListener('cancelled', onCancelled);
      }
    })().catch((cause) => {
      callback({
        name: 'TRPCGRPCTransportError',
        message:
          cause instanceof Error ? cause.message : 'Unknown gRPC transport failure',
        code: grpc.status.INTERNAL,
      });
    });
  };
}

export function createGRPCService<TRouter extends AnyTRPCRouter>(
  opts: GRPCServerOptions<TRouter>,
): grpc.UntypedServiceImplementation {
  return {
    Call: createGRPCCallHandler(opts),
  };
}

export function addTRPCToGRPCServer<TRouter extends AnyTRPCRouter>(
  server: grpc.Server,
  opts: GRPCServerOptions<TRouter>,
): grpc.Server {
  server.addService(TRPC_GRPC_SERVICE_DEFINITION, createGRPCService(opts));
  return server;
}
