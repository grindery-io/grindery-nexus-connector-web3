import { URL } from "node:url";
import * as jose from "jose";
import { getJwtTools, TypedJWTPayload } from "grindery-nexus-common-utils";

const ISSUER = "urn:grindery:web3-driver";

const jwtTools = getJwtTools(ISSUER);
jwtTools.getPublicJwk().catch((e) => {
  console.error("Failed to initialize keys:", e);
  process.exit(1);
});

const { encryptJWT, decryptJWT, signJWT, verifyJWT, getPublicJwk, typedCipher, typedToken, hmac } = jwtTools;
export { encryptJWT, decryptJWT, signJWT, verifyJWT, getPublicJwk, typedCipher, typedToken, hmac };

type AccessTokenExtra =
  | {
      _?: never;
    }
  | {
      workspace: string;
      role: "admin" | "user";
    };
export type TAccessToken = TypedJWTPayload<AccessTokenExtra>;

const ORCHESTRATOR_KEY = jose.createRemoteJWKSet(
  new URL(process.env.ORCHESTRATOR_PUBLIC_KEY || "https://orchestrator.grindery.org/oauth/jwks")
);
export async function parseUserAccessToken(token: string): Promise<TAccessToken> {
  const { payload } = await jose.jwtVerify(token, ORCHESTRATOR_KEY, {
    issuer: "urn:grindery:orchestrator",
    audience: "urn:grindery:access-token:v1",
  });
  return payload;
}
