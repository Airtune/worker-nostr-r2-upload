import { nip26, nip98, Event } from 'npm:airtune-nostr-tools-development';
import { sha256 } from 'npm:@noble/hashes@1.3.1/sha256'; // use same dependency as nostr-tools
import { bytesToHex } from 'npm:@noble/hashes@1.3.1/utils';

import type { WorkerEnv } from './worker_env.d.ts';

const hexKeyPattern = /^[0-9A-Fa-f]{64}$/;

type Role = "admin" | "user" | "banned";

// Check requests for a pre-shared secret
const get_auth_event = async (request: Request): Promise<Event | undefined> => {
	const auth_token = request.headers.get('Authorization');
	let event;
	try {
		event = await nip98.unpackEventFromToken(auth_token);
	} catch (error) {
        console.error(error);
		return undefined;
	}

	const pubkey = event.pubkey;
	if (typeof(pubkey) !== 'string' || !pubkey.match(hexKeyPattern)) {
		return undefined;
	}

	try {
		const valid = await nip98.validateEvent(event);
        if (valid) {
            return event;
        } else {
            return undefined;
        }
	} catch (error) {
        console.error(error);
		return undefined;
	}
};

const is_publisher = (file_metadata_event: Event, auth_event: Event) => {
    const publisher = file_metadata_event.pubkey;
    return typeof(publisher) === 'string' && publisher === auth_event.pubkey;
}

const is_delegator = (file_metadata_event: Event, auth_event: Event) => {
    const delegator = nip26.getDelegator(file_metadata_event)
    return typeof(delegator) === 'string' && delegator === auth_event.pubkey; 
}

const get_delete_permission = async (env: WorkerEnv, auth_event: Event, file_sha256_hex: string): Promise<boolean> => {
    const pubkey = auth_event.pubkey;
	const role: Role | undefined = await env.BANBOORU_PUBKEY_ROLE_KV.get(pubkey) as Role;
    if (role === "banned") {
        return false;
    } else if (role === "admin") {
        return true;
    }

    const file_metadata_json_object = await env.BANBOORU_BUCKET.get(`${file_sha256_hex}.metadata.json`);
    const file_metadata_event = await file_metadata_json_object?.json() as Event;

    return file_metadata_event && (
        is_publisher(file_metadata_event, auth_event) ||
        is_delegator(file_metadata_event, auth_event)
    );
}

const get_put_permission = async (env: WorkerEnv, auth_event: Event): Promise<boolean> => {
    const pubkey = auth_event.pubkey;
	const role: Role | undefined = await env.BANBOORU_PUBKEY_ROLE_KV.get(pubkey) as Role;
    return ["admin", "user"].includes(role);
}

export default {
	async fetch(request: Request, env: WorkerEnv, _ctx: any): Promise<Response> {
		const url = new URL(request.url);

        if (!url.pathname.startsWith('/file/')) {
            return new Response('Not Found.', { status: 404 }); // 404 Not Found
        }

        const path_file_sha256_hex = url.pathname.slice(6);
        if (!path_file_sha256_hex.match(/^[A-Fa-f0-9]{64}$/)) {
            return new Response('/file/<FILE-SHA-256> could not validate SHA-256', { status: 400 }); // 400 Bad Request
        }

		// GET /file/<SHA-256>
		if (request.method === "GET") {
			const object = await env.BANBOORU_BUCKET.get(path_file_sha256_hex);
			if (object === null) {
				return new Response('Object Not Found', { status: 404 });
			}
			const headers = new Headers();
			object.writeHttpMetadata(headers);
			headers.set('etag', object.httpEtag);
			return new Response(object.body, { headers });
		}

		// PUT /file/<SHA-256>
		if (request.method === "PUT") {
			const auth_event: Event = await get_auth_event(request);
			if (!auth_event) {
				return new Response('Unauthorized.', { status: 401 }); // 401 Unauthorized
			}

            const has_put_permission: boolean = await get_put_permission(env, auth_event);
            if (!has_put_permission) {
				return new Response('Unauthorized.', { status: 401 }); // 401 Unauthorized
			}

            /*
            // This may be a faster solution than below but I'm not sure if it works with deno or not.
			// Source: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/#usage
			let file_sha256_hex;
			try {
				// Fetch from origin
				const res = await fetch(request);
				if (!res.body) {
					return new Response('body missing', { status: 400 }); // 400 Bad Request
				}
				// Create a SHA-256 digest stream and pipe the body into it
				const digestStream = new crypto.DigestStream("SHA-256");
				res.body.pipeTo(digestStream);
				// Get the final result
				const digest = await digestStream.digest;
				// Turn it into a hex string
				file_sha256_hex = [...new Uint8Array(digest)]
					.map(b => b.toString(16).padStart(2, '0'))
					.join('');
			} catch (error) {
                console.error(error);
				return new Response('error generating sha256 hash', { status: 500 }); // 500 Internal Server Error
			}
            */
            let file_sha256_hex;
			try {
				const res = await fetch(request);
				if (!res.body) {
					return new Response('body missing', { status: 400 }); // 400 Bad Request
				}
                const bodyArrayBuffer = await res.arrayBuffer();
                const bodyUint8Array = new Uint8Array(bodyArrayBuffer);
                const sha256Uint8Array = sha256(bodyUint8Array);
                file_sha256_hex = bytesToHex(sha256Uint8Array);
			} catch (error) {
                console.error(error);
				return new Response('error generating sha256 hash', { status: 500 }); // 500 Internal Server Error
			}

            if (file_sha256_hex !== path_file_sha256_hex) {
                return new Response('mismatch between generated sha-256 hash and path /file/<SHA-256>', { status: 400 }); // 400 Bad Request
            }
			
			try {
				await env.BANBOORU_BUCKET.put(file_sha256_hex, request.body);
			} catch (error) {
                console.error(error);
				return new Response('error putting object in bucket', { status: 500 }); // 500 Internal Server Error
			}
			
			return new Response(`PUT: ${file_sha256_hex}`, { status: 200 }) // 200 OK
		}

        // DELETE /file/<SHA-256>
		if (request.method === "DELETE") {
			const auth_event: Event = await get_auth_event(request);
			if (!auth_event) {
				return new Response('Unauthorized.', { status: 401 }); // 401 Unauthorized
			}

            const has_delete_permission: boolean = await get_delete_permission(env, auth_event, path_file_sha256_hex);
            if (!has_delete_permission) {
				return new Response('Unauthorized.', { status: 401 }); // 401 Unauthorized
			}
			
			try {
				await env.BANBOORU_BUCKET.delete(path_file_sha256_hex);
			} catch (error) {
                console.error(error);
				return new Response('error deleting object in bucket', { status: 500 }); // 500 Internal Server Error
			}
			
			return new Response(`DELETE: ${path_file_sha256_hex}`, { status: 200 }) // 200 OK
		}

		return new Response('Not Found.', { status: 404 }); // 404 Not Found
	},
};
