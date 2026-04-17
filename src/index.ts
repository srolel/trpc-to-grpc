export {
  addTRPCToGRPCServer,
  createGRPCCallHandler,
  createGRPCService,
  type GRPCContextFactoryOptions,
  type GRPCResponseMetadataOptions,
  type GRPCServerOptions,
} from './server.js';
export {
  grpcLink,
  type GRPCLinkOperationContext,
  type GRPCLinkOptions,
} from './link.js';
export {
  TRPC_GRPC_CALL_METHOD,
  TRPC_GRPC_SERVICE_DEFINITION,
  TRPC_GRPC_SERVICE_NAME,
  type GRPCCallRequest,
  type GRPCCallResponse,
  type MetadataInit,
  type UnaryProcedureType,
} from './shared.js';
