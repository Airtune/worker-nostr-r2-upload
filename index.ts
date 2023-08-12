import { Event, EventKind, nip26, nip98, hexToBytes, getBlankEvent, finishEvent, router, HandlerContext, MatchHandler } from './deps.ts'
import type { WorkerEnv } from "./worker_env.d.ts";

const hexKeyPattern = /^[0-9A-Fa-f]{64}$/;

type Role = "admin" | "user" | "banned";

type AuthEvent = Event & { kind: EventKind.HttpAuth }

/**
 * Verify a request NIP-98 authorization.
 * 
 * @returns Either a validated `kind 27235` event, or a object containing an error message.
 */
async function get_auth_event(request: Request): Promise<AuthEvent | { error: string }> {
  try {
    const token = request.headers.get('Authorization')
    const event: AuthEnv = (await nip98.unpackEventFromToken(token)) as AuthEvent
    if (await nip98.validateEvent(event, request.url, request.method)) {
      return event
    } else {
      return { error: 'Invalid nostr event.'}
    }
    
  } catch (error) {
    console.debug('Failed NIP-98 authentication.', error)
    if (error instanceof Error) {
      return { error: error.message }
    } else {
      return { error: error.toString() }
    }
  }
}

/** A  WorkerEnv once the request as been authenticated (using NIP-98) */
type AuthEnv = WorkerEnv & {
  /** Verified `kind 27235` event from the request Authorization header. */
  authEvent: AuthEvent
  /** The user id, same as `authEvent.pubkey` */
  userId: string
  /** The user's role (as retrieved with `BANBOORU_PUBKEY_ROLE_KV.get(userId)`. */
  userRole: Promise<Role | undefined>
}

/**
 * Authentication middleware. Requires a NIP-94 Authorization header. 
 */
function auth(next: MatchHandler<AuthEnv>): MatchHandler<WorkerEnv> {
  return async (request: Request, env: HandlerContext<WorkerEnv>, params: Record<string, string>) => {
    const authEvent: AuthEvent | { error: string } = await get_auth_event(request);
    if (Object.hasOwn(authEvent, "error")) {
      // TODO: Return JSON body with error message.
      return new Response(`Unauthorized: ${authEvent.error}`, { status: 401 });
    } else {
      const userId = authEvent.pubkey
      const userRole = env.BANBOORU_PUBKEY_ROLE_KV.get(authEvent.pubkey) as Promise<Role | undefined>
      return next(request, { ...env, authEvent, userId, userRole }, params)
    }
  }
}

/**
 * Restricted access middleware. Requires a NIP-94 Authorization header from a known pubblic key with one of the specific `roles`.
 */
function restricted(roles: Role[], next: MatchHandler<AuthEnv>): MatchHandler<WorkerEnv> {
  return auth(async (request: Request, env: HandlerContext<AuthEnv>, params: Record<string, string>) => {
    const role = await env.userRole
    if(role && roles.includes(role)) {
      return next(request, env, params)
    } else {
      // TODO: Return JSON body with error message.
      return new Response("Forbidden.", { status: 403 });
    }
  })
}

export default {
  fetch: router<WorkerEnv>({
    'GET /file/:hash': async function getFile(_req, env, params) {
      if(!params.hash.match(hexKeyPattern)) return new Response(`Invalid SHA256 hash: ${params.hash}`, { status: 400 });
      const object = await env.BANBOORU_BUCKET.get(params.hash);
      if (object === null) {
        return new Response("Object Not Found", { status: 404 });
      }
      const headers = new Headers();
      object.writeHttpMetadata(headers);
      headers.set("etag", object.httpEtag);
      return new Response(object.body, { headers });
    },
    'PUT /file/:hash': restricted(["admin", "user"], async function putFile(request, env, params) {
      if(!params.hash.match(hexKeyPattern)) return new Response(`Invalid SHA256 hash: ${params.hash}`, { status: 400 });
      if(!request.body) return new Response("Missing body", { status: 400 });
  
      // We expect the SHA256 hash from the URL to match the one of the request body (ie. the uploaded file).
      // Per NIP-98 the authentication SHOULD include a SHA256 hash of the request body in a payload tag as hex (["payload", "<sha256-hex>"]).
      // We will validate that the actual payload hash match when uploading to R2.
      const payloadTag = env.authEvent.tags.find((t: string[]) => t[0] === 'payload')
      if(payloadTag && payloadTag[1] && payloadTag[1] != params.hash) {
        return new Response(`Unauthorized: Invalid nostr event, payload signature invalid`, { status: 401 });
      }
  
      try {
        if(await env.BANBOORU_BUCKET.head(params.hash)) {
          return new Response("Conflict", { status: 409 })
        }
        const object = await env.BANBOORU_BUCKET.put(params.hash, request.body, {
          // See https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#r2putoptions
          // R2 will check the received data SHA-256 hash to confirm received object integrity and will fail if it does not.
          sha256: hexToBytes(params.hash).buffer
        });
        if (!object) {
          if(payloadTag && payloadTag[1]) {
            return new Response(`Unauthorized: Invalid nostr event, payload signature invalid`, { status: 401 });
          } else {
            return new Response("Bad Request", { status: 400 })
          }
        }
  
        const metadataEvent: Event = getBlankEvent(1063)
        request.url
        metadataEvent.tags.push(['url', `${request.headers.get('x-forwarded-proto')}://${request.headers.get('host')}/file/${params.hash}`])
        metadataEvent.tags.pusg(['m', request.headers.get('content-type') || 'application/octet-stream'])
        metadataEvent.tags.push(['x', params.hash])
        metadataEvent.tags.push(['size', object.size])
        // TODO: image dimension - requires reading image header bytes
        // TODO: i and magnet URI - requires generatign a .torrent file
        // TODO: blurhash - requires rendering the image
  
        // TODO: NIP-26 delegation tag
        const signedMetadata = finishEvent(metadataEvent, env.PRIVATE_KEY)
        await env.BANBOORU_BUCKET.put(`${params.hash}.metadata.json`, JSON.stringify(signedMetadata))
  
        // TODO: Send signedMetadata to Nost relay(s)
  
        return new Response(null, { status: 204 }) // Success response with no content.
      } catch (error) {
        console.log("Object PUT failed", error)
        return new Response(`Server error`, { status: 500 });
      }
    }),
    'DELETE /file/:hash': restricted(["admin", "user"], async function deleteFile(_req, env, params) {
      if(!params.hash.match(hexKeyPattern)) return new Response(`Invalid SHA256 hash: ${params.hash}`, { status: 400 });
      const role = await env.userRole
      
      // Retrieve the stored `kind 1063` event for the file.
      const metadataObject = await env.BANBOORU_BUCKET.get(`${params.hahs}.metadata.json`)
      if (!metadataObject) {
        return new Response("Not Found", { status: 404 })
      }
      const metadata = await metadataObject.json() as Event
  
      // Either the user is admin, or the user signed the `kind 1063` event (possibly delegating the signature).
      if (role == 'admin' || env.userId == (nip26.getDelegator(metadata) || metadata.pubkey)) {
        try {
          await env.BANBOORU_BUCKET.delete(params.hash);
          await env.BANBOORU_BUCKET.delete(`${params.hahs}.metadata.json`);
  
          // TODO: Delete nostr event
  
          return new Response(null, { status: 204 })
        } catch (error) {
          console.error(error);
          return new Response("Error deleting object in bucket", { status: 500 }); // 500 Internal Server Error
        }
      } else {
        return new Response("Forbidden.", { status: 403 });
      } 
    })
  })
};
