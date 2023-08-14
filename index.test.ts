import { assertEquals } from "https://deno.land/std@0.198.0/assert/mod.ts";
import { describe, it } from "https://deno.land/std@0.198.0/testing/bdd.ts";
import { stub, assertSpyCallAsync } from "https://deno.land/std@0.198.0/testing/mock.ts";

import index from './index.ts'
import { WorkerEnv } from "./worker_env.d.ts";
import { ModuleWorkerContext, R2Bucket, KVNamespace, R2Object, R2ObjectBody, R2GetOptions } from './deps.ts';


describe("index.ts", () => {
    describe('HEAD /file/:hash', () => {
        it('should fail if the hash does not look valid', async () => {
            // Act
            const request = new Request('https://example.com/file/not-a-hash', { method: 'HEAD' })
            const response = await index.fetch(request, new MockWorkerEnv, new MockModuleWorkerContext)
            
            // Assert
            assertEquals(response.status, 404)
            assertEquals(await response.text(), 'Not Found: invalid SHA256 hash \'not-a-hash\'')
        })
        it('should fail if no matching object exist in R2', async () => {
            // Arrange
            const hash = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
            const env = new MockWorkerEnv
            
            // Act
            const request = new Request(`https://example.com/file/${hash}`, { method: 'HEAD' })
            const response = await index.fetch(request, env, new MockModuleWorkerContext)
            
            // Assert
            assertEquals(response.status, 404)
            assertEquals(await response.text(), 'Not Found')
        })
        it('should return the body, http data and etag from stored R2 object', async () => {
            // Arrange
            const hash = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
            const object = { httpEtag: 'http-etag-from-object' } as R2Object
            stub(object, 'writeHttpMetadata', (headers) => headers.set('x-http-medadata', 'http-metadata-from-object'))
            const env = new MockWorkerEnv
            const headStub = stub(env.BANBOORU_BUCKET, 'head', () => Promise.resolve(object))
            
            // Act
            const request = new Request(`https://example.com/file/${hash}`, { method: 'HEAD' })
            const response = await index.fetch(request, env, new MockModuleWorkerContext)
            
            // Assert
            assertEquals(response.status, 200)
            assertEquals(response.body, null)
            assertEquals(response.headers.get('etag'), 'http-etag-from-object')
            assertEquals(response.headers.get('x-http-medadata'), 'http-metadata-from-object')
            assertSpyCallAsync(headStub, 0, { args: [hash] })
        })
    })
    describe('GET /file/:hash', () => {
        it('should fail if the hash does not look valid', async () => {
            // Act
            const request = new Request('https://example.com/file/not-a-hash')
            const response = await index.fetch(request, new MockWorkerEnv, new MockModuleWorkerContext)
            
            // Assert
            assertEquals(response.status, 404)
            assertEquals(await response.text(), 'Not Found: invalid SHA256 hash \'not-a-hash\'')
        })
        it('should fail if no matching object exist in R2', async () => {
            // Arrange
            const hash = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
            const env = new MockWorkerEnv
            
            // Act
            const request = new Request(`https://example.com/file/${hash}`)
            const response = await index.fetch(request, env, new MockModuleWorkerContext)
            
            // Assert
            assertEquals(response.status, 404)
            assertEquals(await response.text(), 'Not Found')
        })
        it('should return the body, http data and etag from stored R2 object', async () => {
            // Arrange
            const hash = "1234567890abcdef1234567890abcdef1234567890abcdef1234567890abcdef"
            const body = ReadableStream.from([new Uint8Array()])
            const object = {
                body,
                httpEtag: 'http-etag-from-object'
            } as R2ObjectBody
            stub(object, 'writeHttpMetadata', (headers) => headers.set('x-http-medadata', 'http-metadata-from-object'))
            const env = new MockWorkerEnv
            const getStub = stub(env.BANBOORU_BUCKET, 'get', () => Promise.resolve(object))
            
            // Act
            const request = new Request(`https://example.com/file/${hash}`)
            const response = await index.fetch(request, env, new MockModuleWorkerContext)
            
            // Assert
            assertEquals(response.status, 200)
            assertEquals(response.body, body)
            assertEquals(response.headers.get('etag'), 'http-etag-from-object')
            assertEquals(response.headers.get('x-http-medadata'), 'http-metadata-from-object')
            assertSpyCallAsync(getStub, 0, { args: [hash] as any })
        })
    })
})

class MockWorkerEnv implements WorkerEnv {
    BANBOORU_BUCKET: R2Bucket = {
        head(_k: string) { return Promise.resolve(null) },
        get(_k: string, _o?: R2GetOptions) { return Promise.resolve(null) }
    } as R2Bucket
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