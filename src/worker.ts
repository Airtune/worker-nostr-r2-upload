/**
 * Welcome to Cloudflare Workers! This is your first worker.
 *
 * - Run `npm run dev` in your terminal to start a development server
 * - Open a browser tab at http://localhost:8787/ to see your worker in action
 * - Run `npm run deploy` to publish your worker
 *
 * Learn more at https://developers.cloudflare.com/workers/
 */

import { nip98 } from 'nostr-tools';

interface WorkerENV extends Env {
	BANBOORU_BUCKET: {
		put: Function,
		get: Function
	}
}

const hexKeyPattern = /^[0-9A-Fa-f]{64}$/;

// Check requests for a pre-shared secret
const isAuthorized = async (env: WorkerENV, request: Request, method: string): Promise<boolean> => {
	const auth_token = request.headers.get('Authorization');
	let event;
	try {
		event = await nip98.unpackEventFromToken(auth_token);
	} catch (error) {
		return false;
	}

	const pubkey = event.pubkey;
	if (typeof(pubkey) !== 'string' || !pubkey.match(hexKeyPattern)) {
		return false;
	}

	// TODO: Check pubkey against KV for permissions
	/*
	const isAdmin = env.BANBOORU_ADMIN_PUBKEY_KV.get(pubkey);
	const isBlocked = env.BANBOORU_BLOCKED_PUBKEY_KV.get(pubkey);
	if (method === "DELETE") {
		if (cached_event.pubkey === event.pubkey || isAdmin) {
			
		}
	} else if (method === "PUT") {

	}
	*/

	try {
		const valid = await nip98.validateEvent(event);
		return valid;
	} catch (error) {
		return false;
	}
};

export default {
	async fetch(request: Request, env: WorkerENV, ctx: ExecutionContext): Promise<Response> {
		const url = new URL(request.url);

		// GET /file/<SHA-256>
		if (url.pathname.startsWith('/file/')) {
			if (request.method !== "GET") {
				return new Response('GET is the only allowed method for /file/<FILE-SHA-256>', { status: 405 }); // 405 Method Not Allowed
			}

			const file_sha256 = url.pathname.slice(6);
			if (!file_sha256.match(/^[A-Fa-f0-9]{64}$/)) {
				return new Response('GET /file/<FILE-SHA-256> could not validate SHA-256', { status: 400 }); // 400 Bad Request
			}

			const object = await env.BANBOORU_BUCKET.get(file_sha256);
			if (object === null) {
				return new Response('Object Not Found', { status: 404 });
			}

			const headers = new Headers();
			object.writeHttpMetadata(headers);
			headers.set('etag', object.httpEtag);

			return new Response(object.body, { headers });
		}

		// PUT /upload
		if (url.pathname.startsWith('/upload/')) {
			if (request.method !== "PUT") {
				return new Response('PUT is the only allowed method for /upload/', { status: 405 }); // 405 Method Not Allowed
			}

			const authorized = await isAuthorized(env, request, "PUT");
			if (!authorized) {
				return new Response('Unauthorized.', { status: 401 }); // 401 Unauthorized
			}

			// Source: https://developers.cloudflare.com/workers/runtime-apis/web-crypto/#usage
			let sha256HexString;
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
				sha256HexString = [...new Uint8Array(digest)]
					.map(b => b.toString(16).padStart(2, '0'))
					.join('');
			} catch (error) {
				return new Response('error generating sha256 hash for body', { status: 500 }); // 500 Internal Server Error
			}
			
			try {
				await env.BANBOORU_BUCKET.put(sha256HexString, request.body);
			} catch (error) {
				return new Response('error putting object in bucket', { status: 500 }); // 500 Internal Server Error
			}
			
			return new Response(sha256HexString, { status: 200 }) // 200 OK
		}
		return new Response('Not Found.', { status: 404 }); // 404 Not Found
	},
};
