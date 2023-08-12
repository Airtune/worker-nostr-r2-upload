import type { KVNamespace, R2Bucket } from "./deps.ts";

export interface WorkerEnv {
	BANBOORU_BUCKET: R2Bucket
    BANBOORU_PUBKEY_ROLE_KV: KVNamespace

    PRIVATE_KEY: string
}
