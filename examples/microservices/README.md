# Microservice example

This example spins up two tRPC microservices that talk to each other over gRPC:

- `user-service` exposes `userById`
- `order-service` exposes `orderSummaryById`
- `order-service` calls `user-service` using `grpcLink(...)`

## Run the full demo

```bash
npm install
npm run example:microservices
```

## Run the services separately

Terminal 1:

```bash
npm run example:microservices:user
```

Terminal 2:

```bash
npm run example:microservices:order
```

Then point any tRPC client using `grpcLink(...)` at `127.0.0.1:50052`.
