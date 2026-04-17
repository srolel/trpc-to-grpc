# trpc-grpc

Use gRPC as the transport for tRPC when one service calls another.

This package gives you:

- a **tRPC client link**: `grpcLink(...)`
- a **gRPC server adapter**: `addTRPCToGRPCServer(...)`
- a tiny generic wire protocol in `proto/trpc.transport.v1.proto`

It keeps the normal tRPC developer experience and type inference, but swaps the network hop from HTTP to gRPC for service-to-service calls.

## What this is

This is **tRPC over gRPC**, not protobuf-first API generation.

That means:

- your source of truth is still the **tRPC router**
- your services still use **tRPC client types**
- the gRPC payload is a generic envelope carrying serialized tRPC input/output
- **queries and mutations** are supported today
- **subscriptions are not implemented yet**

If you want native protobuf messages per procedure, you'd build a codegen layer on top of this.

## Install

```bash
npm install @grpc/grpc-js @trpc/client @trpc/server
npm install trpc-grpc
```

## Server

```ts
import * as grpc from '@grpc/grpc-js';
import { initTRPC } from '@trpc/server';
import superjson from 'superjson';
import { addTRPCToGRPCServer } from 'trpc-grpc';

const t = initTRPC
  .context<{ authHeader: string | null }>()
  .create({ transformer: superjson });

export const appRouter = t.router({
  userById: t.procedure
    .input((value: unknown) => {
      if (!value || typeof value !== 'object' || !("id" in value)) {
        throw new Error('Invalid input');
      }
      return value as { id: string };
    })
    .query(({ input, ctx }) => {
      return {
        id: input.id,
        name: 'Ada Lovelace',
        authHeader: ctx.authHeader,
        createdAt: new Date('2024-01-01T00:00:00.000Z'),
      };
    }),
});

const server = new grpc.Server();

addTRPCToGRPCServer(server, {
  router: appRouter,
  createContext({ metadata }) {
    const auth = metadata.get('authorization')[0];

    return {
      authHeader: typeof auth === 'string' ? auth : null,
    };
  },
});

await new Promise<number>((resolve, reject) => {
  server.bindAsync(
    '0.0.0.0:50051',
    grpc.ServerCredentials.createInsecure(),
    (error, port) => {
      if (error) {
        reject(error);
        return;
      }
      resolve(port);
    },
  );
});
```

## Client

```ts
import * as grpc from '@grpc/grpc-js';
import { createTRPCClient } from '@trpc/client';
import superjson from 'superjson';
import { grpcLink } from 'trpc-grpc';
import type { appRouter } from './user-service';

type AppRouter = typeof appRouter;

const client = createTRPCClient<AppRouter>({
  links: [
    grpcLink({
      address: 'users.internal:50051',
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

const user = await client.userById.query({ id: 'user_123' }, {
  context: {
    grpcMetadata: {
      'x-trace-id': 'trace-123',
    },
    grpcCallOptions: {
      deadline: Date.now() + 1_000,
    },
  },
});
```

## Microservice example

A runnable two-service example lives in `examples/microservices`:

- `user-service` exposes `userById`
- `order-service` exposes `orderSummaryById`
- `order-service` calls `user-service` over gRPC using `grpcLink(...)`

Run it with:

```bash
npm install
npm run example:microservices
```

See `examples/microservices/README.md` for the file layout and separate service commands.

## API

### `grpcLink(options)`

Client-side terminating tRPC link.

Options:

- `address`: gRPC target, e.g. `users.internal:50051`
- `credentials`: `grpc.ChannelCredentials`
- `client?`: reuse an existing `grpc.Client`
- `clientOptions?`: extra `@grpc/grpc-js` client options
- `metadata?`: static metadata or `(opts) => metadata`
- `callOptions?`: static call options or `(opts) => callOptions`
- `transformer?`: same tRPC transformer you use on the server, e.g. `superjson`
- `methodPath?`: override the gRPC method path if needed

Per-call overrides live in `context`:

```ts
{
  grpcMetadata?: grpc.Metadata | Record<string, string | Buffer | Array<string | Buffer>>;
  grpcCallOptions?: grpc.CallOptions;
}
```

### `addTRPCToGRPCServer(server, options)`

Registers the generic `TRPCTransport.Call` unary RPC on an existing `grpc.Server`.

Options:

- `router`: your tRPC router
- `createContext?`: build tRPC context from gRPC request metadata/call info
- `onError?`: tRPC-style error hook
- `responseMetadata?`: optionally send initial gRPC response metadata

## Wire protocol

See `proto/trpc.transport.v1.proto` for the logical contract.

Today, the package uses a manual gRPC service definition and JSON-encodes the tRPC envelope instead of protobuf-serializing per-field messages.

The payload is intentionally generic:

- request: `path`, `type`, serialized `input`
- response: serialized tRPC success/error envelope

That keeps the package router-driven and avoids separate protobuf generation for every procedure.

## Current limitations

- unary only
- no subscriptions
- no protobuf-per-procedure codegen
- optimized for **TypeScript tRPC services talking to other TypeScript tRPC services**

## Local development

```bash
npm install
npm run typecheck
npm test
npm run build
```
