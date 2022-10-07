import { URL } from "node:url";
import * as jose from "jose";
import { TypedJWTPayload } from "grindery-nexus-common-utils";

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
