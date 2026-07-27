import { canonicalJson } from './canonicalize'
import { sha256Hex } from './hash'

export const CONTRIBUTION_PROTOCOL = 'hli-contribution-v1'
export const CONTRIBUTION_TOKEN_SCOPE = 'contributions:write'
export const CONTRIBUTION_REQUEST_MAX_AGE_MS = 5 * 60 * 1000

export type InstallationChallenge = {
  challengeKey: string
  nonce: string
  publicKeyId: string
  publicKey: string
  expiresAt: string
}

export type SignedRequestInput = {
  method: string
  path: string
  timestamp: string
  nonce: string
  body: unknown
}

export async function installationPublicKeyId(publicKey: string): Promise<string> {
  return sha256Hex(`${CONTRIBUTION_PROTOCOL}:installation-key:${publicKey}`)
}

export function activationSignaturePayload(challenge: InstallationChallenge): string {
  return canonicalJson({
    protocol: CONTRIBUTION_PROTOCOL,
    purpose: 'installation-activation',
    challengeKey: challenge.challengeKey,
    nonce: challenge.nonce,
    publicKeyId: challenge.publicKeyId,
    publicKey: challenge.publicKey,
    expiresAt: challenge.expiresAt,
  })
}

export async function signedRequestPayload(input: SignedRequestInput): Promise<string> {
  return canonicalJson({
    protocol: CONTRIBUTION_PROTOCOL,
    purpose: 'authenticated-request',
    method: input.method.toUpperCase(),
    path: input.path,
    timestamp: input.timestamp,
    nonce: input.nonce,
    bodyHash: await sha256Hex(canonicalJson(input.body)),
  })
}
