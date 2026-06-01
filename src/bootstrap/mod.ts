export {
  Server,
  DanetHttpAdapter,
  HttpAdapter,
  SwaggerDescription,
  setupWithSwagger,
  DanetDocumentBuilder,
  bootstrapServer,
  InjectValue,
  InjectFactory,
  InjectClass,
  BackendClient,
  createBackendClient,
  log,
  Logger,
  signToken,
  verifyToken,
  TokenError,
  createTokenAuthMiddleware,
  createMintUi,
  isLocalRequest,
  withBasePath,
  INTERNAL_REQUEST_HEADER,
} from "@foundation/mod-root.ts";
export type {
  LogLevel,
  RequestContext,
  TokenPayload,
  TokenAuthConfig,
  MintUiConfig,
  FetchHandler,
} from "@foundation/mod-root.ts";

export function safeStart(cb: () => Promise<void>): Promise<void> | undefined {
  if (import.meta.main) {
    return cb();
  }
}
