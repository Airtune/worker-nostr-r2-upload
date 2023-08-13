import { assertEquals } from "https://deno.land/std@0.198.0/assert/mod.ts";
import { describe, it } from "https://deno.land/std@0.198.0/testing/bdd.ts";

import index from './index.ts'
import { WorkerEnv } from "./worker_env.d.ts";
import { ModuleWorkerContext, R2Bucket,KVNamespace } from './deps.ts';


describe("index.ts", () => {
    describe('GET /file/:hash', () => {
        it('should fail if the hash does not look valid', async () => {
            const request = new Request('https://example.com/file/not-a-hash')
            const response = await index.fetch(request, new MockWorkerEnv, new MockModuleWorkerContext)
            assertEquals(response.status, 400)
            assertEquals(await response.text(), 'Invalid SHA256 hash: not-a-hash')

        })
    })
})

class MockWorkerEnv implements WorkerEnv {
    BANBOORU_BUCKET: R2Bucket = {} as R2Bucket
    BANBOORU_PUBKEY_ROLE_KV: KVNamespace = {} as KVNamespace
    PRIVATE_KEY = " private_key"    
}

class MockModuleWorkerContext implements ModuleWorkerContext {
    passThroughOnException(): void {
        throw new Error("Method not implemented.");
    }
    waitUntil(_promise: Promise<unknown>): void {
        throw new Error("Method not implemented.");
    }
}