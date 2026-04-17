import * as grpc from '@grpc/grpc-js';
import { createTRPCClient } from '@trpc/client';
import superjson from 'superjson';
import { grpcLink } from '../../src/index.js';
import { type OrderServiceRouter } from './order-service.contract.js';
import { startOrderService } from './order-service.js';
import { ORDER_SERVICE_ADDRESS, USER_SERVICE_ADDRESS } from './shared.js';
import { startUserService } from './user-service.js';

async function main() {
  console.log('Starting user-service on', USER_SERVICE_ADDRESS);
  const userService = await startUserService();

  console.log('Starting order-service on', ORDER_SERVICE_ADDRESS);
  const orderService = await startOrderService({
    userServiceAddress: userService.address,
  });

  const transportClient = new grpc.Client(
    orderService.address,
    grpc.credentials.createInsecure(),
  );

  const orderClient = createTRPCClient<OrderServiceRouter>({
    links: [
      grpcLink({
        address: orderService.address,
        credentials: grpc.credentials.createInsecure(),
        client: transportClient,
        transformer: superjson,
        metadata() {
          return {
            'x-caller-service': 'demo-client',
          };
        },
      }),
    ],
  });

  try {
    const summary = await orderClient.orderSummaryById.query(
      { orderId: 'order_1' },
      {
        context: {
          grpcMetadata: {
            'x-request-id': 'demo-request-001',
          },
          grpcCallOptions: {
            deadline: new Date(Date.now() + 1_000),
          },
        },
      },
    );

    console.log('\norderSummaryById response:\n');
    console.log(JSON.stringify(summary, null, 2));
  } finally {
    transportClient.close();
    await orderService.close();
    await userService.close();
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
