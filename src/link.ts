import * as grpc from '@grpc/grpc-js';
import { TRPCClientError, type Operation, type TRPCLink } from '@trpc/client';
import { observable } from '@trpc/server/observable';
import {
  transformResult,
  type AnyRouter,
  type DataTransformerOptions,
} from '@trpc/server/unstable-core-do-not-import';
import {
  TRPC_GRPC_CALL_METHOD,
  createMetadata,
  getTransformer,
  mergeMetadata,
  type GRPCCallRequest,
  type GRPCCallResponse,
  type MetadataInit,
  type MaybePromise,
} from './shared.js';

export interface GRPCLinkOperationContext {
  grpcMetadata?: MetadataInit;
  grpcCallOptions?: grpc.CallOptions;
}

export interface GRPCLinkOptions<TRouter extends AnyRouter> {
  address: string;
  credentials: grpc.ChannelCredentials;
  client?: grpc.Client;
  clientOptions?: grpc.ClientOptions;
  metadata?:
    | MetadataInit
    | ((opts: { op: Operation }) => MaybePromise<MetadataInit | undefined>);
  callOptions?:
    | grpc.CallOptions
    | ((opts: { op: Operation }) => MaybePromise<grpc.CallOptions | undefined>);
  transformer?: DataTransformerOptions;
  methodPath?: string;
}

function getOperationContext(op: Operation): GRPCLinkOperationContext {
  return op.context as GRPCLinkOperationContext;
}

async function resolveMetadata(
  op: Operation,
  source?: GRPCLinkOptions<AnyRouter>['metadata'],
): Promise<grpc.Metadata> {
  const metadata = createMetadata();
  const resolvedSource =
    typeof source === 'function' ? await source({ op }) : source;

  mergeMetadata(metadata, resolvedSource);
  mergeMetadata(metadata, getOperationContext(op).grpcMetadata);

  return metadata;
}

async function resolveCallOptions(
  op: Operation,
  source?: GRPCLinkOptions<AnyRouter>['callOptions'],
): Promise<grpc.CallOptions> {
  const resolvedSource =
    typeof source === 'function' ? await source({ op }) : source;

  return {
    ...(resolvedSource ?? {}),
    ...(getOperationContext(op).grpcCallOptions ?? {}),
  };
}

export function grpcLink<TRouter extends AnyRouter>(
  opts: GRPCLinkOptions<TRouter>,
): TRPCLink<TRouter> {
  const transformer = getTransformer(opts.transformer);
  const client =
    opts.client ??
    new grpc.Client(opts.address, opts.credentials, opts.clientOptions);
  const methodPath = opts.methodPath ?? TRPC_GRPC_CALL_METHOD;

  return () => {
    return ({ op }) => {
      return observable((observer) => {
        const type = op.type;

        if (type === 'subscription') {
          observer.error(
            TRPCClientError.from(
              new Error(
                'Subscriptions are not supported by grpcLink yet. Use queries/mutations only.',
              ),
            ),
          );
          return () => {
            // noop
          };
        }

        let unaryCall: grpc.ClientUnaryCall | undefined;
        let responseMetadata: grpc.Metadata | undefined;
        let unsubscribed = false;

        const abortFromSignal = () => {
          unaryCall?.cancel();
        };

        if (op.signal) {
          if (op.signal.aborted) {
            abortFromSignal();
          } else {
            op.signal.addEventListener('abort', abortFromSignal, {
              once: true,
            });
          }
        }

        void (async () => {
          try {
            const metadata = await resolveMetadata(op, opts.metadata);
            const callOptions = await resolveCallOptions(op, opts.callOptions);

            if (unsubscribed) {
              return;
            }

            if (op.signal?.aborted) {
              observer.error(
                TRPCClientError.from(
                  op.signal.reason instanceof Error
                    ? op.signal.reason
                    : new Error('The gRPC request was aborted before it was sent.'),
                ),
              );
              return;
            }

            const request: GRPCCallRequest = {
              path: op.path,
              type,
              input: transformer.input.serialize(op.input),
            };

            unaryCall = client.makeUnaryRequest<GRPCCallRequest, GRPCCallResponse>(
              methodPath,
              (value) => Buffer.from(JSON.stringify(value), 'utf8'),
              (value) => JSON.parse(value.toString('utf8')) as GRPCCallResponse,
              request,
              metadata,
              callOptions,
              (cause, value) => {
                if (unsubscribed) {
                  return;
                }

                const meta = {
                  grpcMetadata: responseMetadata,
                  grpcPeer: unaryCall?.getPeer(),
                } satisfies Record<string, unknown>;

                if (cause) {
                  observer.error(TRPCClientError.from(cause, { meta }));
                  return;
                }

                const transformed = transformResult<TRouter, unknown>(
                  value?.response as Parameters<typeof transformResult<TRouter, unknown>>[0],
                  transformer.output,
                );

                if (!transformed.ok) {
                  observer.error(
                    TRPCClientError.from(transformed.error, {
                      meta,
                    }),
                  );
                  return;
                }

                observer.next({
                  context: {
                    grpcMetadata: responseMetadata,
                    grpcPeer: unaryCall?.getPeer(),
                  },
                  result: transformed.result,
                });
                observer.complete();
              },
            );

            unaryCall.on('metadata', (metadataChunk) => {
              responseMetadata = metadataChunk;
            });
          } catch (cause) {
            if (!unsubscribed) {
              observer.error(TRPCClientError.from(cause as Error));
            }
          }
        })();

        return () => {
          unsubscribed = true;
          if (op.signal) {
            op.signal.removeEventListener('abort', abortFromSignal);
          }
          unaryCall?.cancel();
        };
      });
    };
  };
}
