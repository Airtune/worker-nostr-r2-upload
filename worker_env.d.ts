import type { KVNamespace } from "./kv.d.ts";
import type { R2Bucket } from "./r2.d.ts";

export interface WorkerEnv {
	BANBOORU_BUCKET: R2Bucket
    BANBOORU_PUBKEY_ROLE_KV: KVNamespace
}
