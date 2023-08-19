import {
  type Event,
  type EventTemplate,
  type HandlerContext,
  type MatchHandler,
  type ModuleWorkerContext,
  type R2Object,
  bytesToHex,
  finishEvent,
  getBlankEvent,
  nip26,
  nip98,
  router,
  validateEvent,
  verifySignature
} from './deps.ts'
import type { WorkerEnv } from "./worker_env.d.ts";

const hexKeyPattern = /^[0-9A-Fa-f]{64}$/;

type Role = "admin" | "user" | "banned";

/** NIP-94 File Metadata Event */
type FileMetadataEvent = Event & { kind: 1063 };

/**
 * File Metadata Event (kind 1063) is base64 encoded as the authorization header.
 * 
 * @returns Either a validated `kind 1063` event, or a object containing an error message.
 */
async function get_file_metadata_event(request: Request): Promise<FileMetadataEvent | { error: string }> {
  try {
    const token = request.headers.get('Authorization')
    if (!token) return { error: 'missing Authorization header' }
    const event: Event = (await nip98.unpackEventFromToken(token)) as Event;

    if (validateEvent(event) && event.kind === 1063 && verifySignature(event)) {
      return event as FileMetadataEvent;
    } else {
      return { error: 'Invalid nostr event.'}
    }
    
  } catch (error) {
    console.debug('Authentication failed for File Metadata Event (kind 1063)', error)
    if (error instanceof Error) {
      return { error: error.message }
    } else {
      return { error: error.toString() }
    }
  }
}

/**
 * Context for route handlers.
 */
type Context = {
  /** The bindings assigned to the Worker. */
  env: WorkerEnv
  /** The module worked context provider useful method. */
  workerContext: ModuleWorkerContext
}

/**
 * Context for authenticated route handlers. 
 */
type AuthContext = Context & {
  /** Verified `kind 1063` event from the request Authorization header. */
  fileMetadataEvent: FileMetadataEvent
  
  /** Details about the authenticated user. */
  user: {
    /** The user pubkey, same as `fileMetadataEvent.pubkey` */
    pubkey: string
    /** The user's role (as retrieved with `BANBOORU_PUBKEY_ROLE_KV.get(userId)` */
    role: Role | undefined
  }
}

/**
 * Authentication middleware. Requires a NIP-94 Authorization header. 
 */
function auth(next: MatchHandler<AuthContext>): MatchHandler<Context> {
  return async (request: Request, ctx: HandlerContext<Context>, params: Record<string, string>) => {
    const fileMetadataEvent: FileMetadataEvent | { error: string } = await get_file_metadata_event(request);
    if ("error" in fileMetadataEvent) {
      return new Response(`Unauthorized: ${fileMetadataEvent.error}`, { status: 401 });
    } else {
      return next(request, Object.assign(ctx, {
        fileMetadataEvent,
        user: {
          pubkey: fileMetadataEvent.pubkey,
          role: await ctx.env.BANBOORU_PUBKEY_ROLE_KV.get(fileMetadataEvent.pubkey) as Role | undefined
        }
      }), params)
    }
  }
}

/**
 * Handle extracting metadata from object and sending the `kind 1063` event.
 * 
 * @param request The request used to create the object.
 * @param object The object itself.
 * @param env The worker environment.
 */
async function handleMetadada(baseUrl: string, object: R2Object, env: WorkerEnv): Promise<void> {
  if(!object.checksums.sha256) {
    throw new Error("Failed to build file metadata: missing sha256 checksum.")
  }
  const fileMetadataEvent: EventTemplate<1063> = getBlankEvent(1063) // 1063 is NIP-94 event kind for file metadata
  fileMetadataEvent.tags.push(['url', `${baseUrl}/${object.key}`])
  fileMetadataEvent.tags.push(['m', object.httpMetadata.contentType || 'application/octet-stream'])
  fileMetadataEvent.tags.push(['x',  bytesToHex(new Uint8Array(object.checksums.sha256))])
  fileMetadataEvent.tags.push(['size', object.size.toString()])
  // TODO dim (image dimensions) requires reading image header bytes
  // TODO i (torrent infohash) and magnet (Magnet URI)- requires generating a .torrent file (which could be stored in the bucket too)
  // TODO blurhash - requires rendering the image
  const signedEvent = finishEvent(fileMetadataEvent, env.PRIVATE_KEY)
  await env.BANBOORU_BUCKET.put(`${object.key}.metadata.json`, JSON.stringify(signedEvent))

  // TODO Send `kind 1063` event to nostr relay(s)

  return
}

/**
 * Restricted access middleware. Requires a known public key with one of the specific `roles` from a base64 encoded File Metadata Event in the Authorization header.
 */
function restricted(roles: Role[], next: MatchHandler<AuthContext>): MatchHandler<Context> {
  return auth((request: Request, ctx: HandlerContext<AuthContext>, params: Record<string, string>) => {
    if(ctx.user.role && roles.includes(ctx.user.role)) {
      return next(request, ctx, params)
    } else {
      return new Response("Forbidden.", { status: 403 });
    }
  })
}

/**
 * Returns whether a specific user is the publisher of a nostr event.
 */
function isPublisher(pubkey: string, event: Event): boolean {
  return event.pubkey === pubkey;
}

/**
 * Returns whether a specific user delegated signature of a nostr event.
 */
function isDelegator(pubkey: string, event: Event): boolean {
  try {
    return nip26.getDelegator(event) === pubkey;
  } catch (error) {
    console.log('Failed to get NIP-26 delegator from event', event, error)
    return false
  }
}

const handler = router<Context>({
  'HEAD@/file/:hash': async function getFile(_req, { env }, params) {
    if(!params.hash.match(hexKeyPattern)) return new Response(`Not Found: invalid SHA256 hash '${params.hash}'`, { status: 404 });

    const object = await env.BANBOORU_BUCKET.head(params.hash);
    if (object === null) return new Response("Not Found", { status: 404 });
    
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    return new Response(null, { headers });
  },
  'GET@/file/:hash': async function getFile(_req, { env }, params) {
    if(!params.hash.match(hexKeyPattern)) return new Response(`Not Found: invalid SHA256 hash '${params.hash}'`, { status: 404 });

    const object = await env.BANBOORU_BUCKET.get(params.hash);
    if (object === null) return new Response("Not Found", { status: 404 });
    
    const headers = new Headers();
    object.writeHttpMetadata(headers);
    headers.set("etag", object.httpEtag);
    return new Response(object.body, { headers });
  },
  'PUT@/file/:hash': restricted(["admin", "user"], async function putFile(request, { env, fileMetadataEvent, workerContext }, params) {
    if(!params.hash.match(hexKeyPattern)) return new Response(`Invalid SHA256 hash: ${params.hash}`, { status: 400 });
    if(!request.body) return new Response("Missing body", { status: 400 });

    // We expect the SHA256 hash from the URL to match the one of the event in the Authorization header.
    const sha256Tag = fileMetadataEvent.tags.find((t: string[]) => t[0] === 'x');
    if (sha256Tag && typeof(sha256Tag[1]) === 'string' && sha256Tag[1].toUpperCase() !== params.hash.toUpperCase()) {
      return new Response(`Mismatch between event SHA256 hash (${sha256Tag[1]}) and url path SHA256 hash (${params.hash})`, { status: 400 });
    }
    try {
      if(await env.BANBOORU_BUCKET.head(params.hash)) {
        return new Response("Conflict", { status: 409 })
      }
      const object = await env.BANBOORU_BUCKET.put(params.hash, request.body, {
        // See https://developers.cloudflare.com/r2/api/workers/workers-api-reference/#r2putoptions
        // R2 will check the received data SHA-256 hash to confirm received object integrity and will fail if it does not.
        sha256: params.hash, // We expect the SHA256 hash from the URL to match the one of the request body (ie. the uploaded file).
        httpMetadata: {
          contentType: request.headers.get('content-type') || undefined,
          cacheControl: 'public, max-age=31536000, immutable' // let's client cache this for a year
        }
      });
      if (!object) {
        if(sha256Tag && sha256Tag[1]) { // The user signed the hash as part of the event. 
          return new Response(`Unauthorized: Invalid nostr event, SHA256 hash does not match file`, { status: 401 });
        } else {
          return new Response("Bad Request", { status: 400 })
        }
      }

      // Handle metadata without blocking the response.
      workerContext.waitUntil(handleMetadada(
        `https://${request.headers.get('host')}`,
          object,
          env
        ))

      return new Response(null, { status: 204 }) // Success response with no content.
    } catch (error) {
      console.log("Object PUT failed", error)
      return new Response('Server error', { status: 500 });
    }
  }),
  'DELETE@/file/:hash': restricted(["admin", "user"], async function deleteFile(_, { env, user }, params) {
    if(!params.hash.match(hexKeyPattern)) return new Response(`Invalid SHA256 hash: ${params.hash}`, { status: 400 });

    try {
      // Check that the file exists.
      const object = await env.BANBOORU_BUCKET.get(params.hash)
      if(!object) return new Response("Not Found", { status: 404 })

      // Retrieve the stored `kind 1063` event with the file metadata.
      const fileMetadataObject = await env.BANBOORU_BUCKET.get(`${params.hash}.metadata.json`)
      const fileMetadata: Event | null = fileMetadataObject ? (await fileMetadataObject.json()) as FileMetadataEvent : null
  
      // Either the user is admin, or the user signed the `kind 1063` event (possibly delegating the signature).
      if (user.role == 'admin' || (fileMetadata && (isPublisher(user.pubkey, fileMetadata) || isDelegator(user.pubkey, fileMetadata)))) {
          await Promise.all([
            env.BANBOORU_BUCKET.delete(params.hash),
            env.BANBOORU_BUCKET.delete(`${params.hash}.metadata.json`)
          ])
  
          // TODO Send delete nostr event to rely(s)

          return new Response(null, { status: 204 }) // Success response with no content.
        
      } else {
        return new Response("Forbidden.", { status: 403 });
      }
    } catch (error) {
      console.error("Object DEL failed", error);
      return new Response('Server error', { status: 500 });
    } 
  })
})

export default {
  fetch(request: Request, env: WorkerEnv, workerContext: ModuleWorkerContext) {
    // Faking ConnInfo localAddr and remoteAddr expected by rutt that we won't actually use.
    const localAddr = {
      transport: 'tcp' as const,
      hostname: request.headers.get('CF-Worker') || '',
      port: -1,
    }
    const remoteAddr = {
      transport: 'tcp' as const,
      hostname: request.headers.get('CF-Connecting-IP') || '',
      port: -1
    }
    
    return handler(request, { env, workerContext, localAddr, remoteAddr })
  }
};