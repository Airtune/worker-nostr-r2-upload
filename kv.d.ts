// source: https://raw.githubusercontent.com/skymethod/denoflare/v0.5.12/common/cloudflare_workers_types.d.ts
export interface KVGetOptions {
    // https://developers.cloudflare.com/workers/runtime-apis/kv#cache-ttl

    /** The cacheTtl parameter must be an integer that is greater than or equal to 60. 
     * 
     * It defines the length of time in seconds that a KV result is cached in the edge location that it is accessed from. 
     * This can be useful for reducing cold read latency on keys that are read relatively infrequently. 
     * It is especially useful if your data is write-once or write-rarely, but is not recommended if your data is updated often 
     * and you need to see updates shortly after they're written, because writes that happen from other edge locations 
     * won't be visible until the cached value expires.
     * 
     * The effective Cache TTL of an already cached item can be reduced by getting it again it with a lower cacheTtl. 
     * For example, if you did NAMESPACE.get(key, {cacheTtl: 86400}) but later realized that caching for 24 hours was too long, 
     * you could NAMESPACE.get(key, {cacheTtl: 300}) or even NAMESPACE.get(key) and it would check for newer data to respect 
     * the provided cacheTtl, which defaults to 60. */
    readonly cacheTtl?: number;
}

/** Many common uses of Workers KV involve writing keys that are only meant to be valid for a certain amount of time. 
 * 
 * Rather than requiring applications to remember to delete such data at the appropriate time, Workers KV offers the ability to create keys that automatically expire, 
 * either at a particular point in time or after a certain amount of time has passed since the key was last modified.
 * 
 * Once the expiration time of an expiring key is reached, it will be deleted from the system. After its deletion, attempts to read it will behave as if the key does not exist, 
 * and it will not count against the namespace’s storage usage for billing purposes. 
 * 
 * Note that expiration times of less than 60 seconds in the future or expiration TTLs of less than 60 seconds are not supported at this time. */
export interface KVPutOptions {

    /** Absolute expiration time specified in a number of seconds since the UNIX epoch. 
     * 
     * For example, if you wanted a key to expire at 12:00AM UTC on April 1, 2019, you would set the key’s expiration to 1554076800. */
    readonly expiration?: number;

    /** Expiration TTL (time to live), using a relative number of seconds from the current time. 
     * 
     * For example, if you wanted a key to expire 10 minutes after creating it, you would set its expiration TTL to 600. */
    readonly expirationTtl?: number;

    /** Metadata to associate with the key-value pair.
     * 
     * The serialized JSON representation of the metadata object must be no more than 1024 bytes in length. */
    readonly metadata?: Record<string, unknown>;
}

export interface KVListOptions {
    /** A prefix you can use to filter all keys. */
    readonly prefix?: string;

    /** The maximum number of keys returned. The default is 1000, which is the maximum. 
     * 
     * It is unlikely that you will want to change this default, but it is included for completeness. */
    readonly limit?: number;

    /** A string used for paginating responses. */
    readonly cursor?: string;
}

export interface KVListResultKey {
    /** The name of the key. */
    readonly name: string;

    /** The expiration value will only be returned if the key has an expiration, and will be in the absolute value form, even if it was set in the TTL form. */
    readonly expiration?: number;
    
    /** Metadata will only be returned if the given key has non-null associated metadata. */
    readonly metadata?: Record<string, unknown>;
}

export interface KVListResult {
    /** An array of objects describing each key.
     * 
     * Keys are always returned in lexicographically sorted order according to their UTF-8 bytes. */
    readonly keys: KVListResultKey[];
}

export interface KVListCompleteResult extends KVListResult {

    /** No more keys to fetch. */
    // deno-lint-ignore camelcase
    readonly list_complete: true;
}

export interface KVListIncompleteResult extends KVListResult {

    /** If list_complete is false, there are more keys to fetch. */
    // deno-lint-ignore camelcase
    readonly list_complete: false;

    /** Used in subsequent list call. */
    readonly cursor: string;
}

export interface KVValueAndMetadata<T> {
    readonly metadata: Record<string, unknown> | null;
    readonly value: T;
}

export interface KVNamespace {

    // https://developers.cloudflare.com/workers/runtime-apis/kv#writing-key-value-pairs

    /** Creates a new key-value pair, or updates the value for a particular key.
     * 
     * This method returns a Promise that you should await on in order to verify a successful update.
     * 
     * The maximum size of a value is 25MB.
     * 
     * Due to the eventually consistent nature of Workers KV, concurrent writes from different edge locations can end up up overwriting one another. 
     * It’s a common pattern to write data via Wrangler or the API but read the data from within a worker, avoiding this issue by issuing all writes from the same location. 
     * 
     * Writes are immediately visible to other requests in the same edge location, but can take up to 60 seconds to be visible in other parts of the world. 
     */
    put(key: string, value: string | ReadableStream | ArrayBuffer, opts?: KVPutOptions): Promise<void>;

    // https://developers.cloudflare.com/workers/runtime-apis/kv#reading-key-value-pairs

    /** Returns a promise you can await to get the value. 
     * 
     * If the key is not found, the promise will resolve with the literal value null.
     * 
     * Note that get may return stale values -- if a given key has recently been read in a given location, 
     * changes to the key made in other locations may take up to 60 seconds to be visible. 
     * 
     * The type parameter can be any of: 
     *  - "text": (default) a string
     *  - "json": an object decoded from a JSON string
     *  - "arrayBuffer": An ArrayBuffer instance.
     *  - "stream": A ReadableStream.
     * 
     * For simple values it often makes sense to use the default "text" type which provides you with your value as a string. 
     * For convenience a "json" type is also specified which will convert a JSON value into an object before returning it to you. 
     * For large values you can request a ReadableStream, and for binary values an ArrayBuffer.
     * 
     * For large values, the choice of type can have a noticeable effect on latency and CPU usage. 
     * For reference, the types can be ordered from fastest to slowest as "stream", "arrayBuffer", "text", and "json". */
    get(key: string, opts?: KVGetOptions | { type: 'text' }): Promise<string | null>;
    get(key: string, opts: KVGetOptions | { type: 'json' }): Promise<Record<string, unknown> | null>;
    get(key: string, opts: KVGetOptions | { type: 'arrayBuffer' }): Promise<ArrayBuffer | null>;
    get(key: string, opts: KVGetOptions | { type: 'stream' }): Promise<ReadableStream | null>;

    // https://developers.cloudflare.com/workers/runtime-apis/kv#metadata-1

    /** Gets the metadata associated with a key-value pair alongside its value.
     * 
     * If there’s no metadata associated with the requested key-value pair, null will be returned for metadata. */
    getWithMetadata(key: string, opts?: KVGetOptions | { type: 'text' }): Promise<KVValueAndMetadata<string> | null>;
    getWithMetadata(key: string, opts: KVGetOptions | { type: 'json' }): Promise<KVValueAndMetadata<Record<string, unknown>> | null>;
    getWithMetadata(key: string, opts: KVGetOptions | { type: 'arrayBuffer' }): Promise<KVValueAndMetadata<ArrayBuffer> | null>;
    getWithMetadata(key: string, opts: KVGetOptions | { type: 'stream' }): Promise<KVValueAndMetadata<ReadableStream> | null>;

    // https://developers.cloudflare.com/workers/runtime-apis/kv#deleting-key-value-pairs
    
    /** Removes the key and value from your namespace. 
     * 
     * As with any operations, it may take some time to see that the key has been deleted from various points at the edge.
     * 
     * This method returns a promise that you should await on in order to verify successful deletion. */
    delete(key: string): Promise<void>;

    // https://developers.cloudflare.com/workers/runtime-apis/kv#listing-keys

    /** List all of the keys that live in a given namespace.
     * 
     * Changes may take up to 60 seconds to be visible when listing keys.
     */
    list(opts?: KVListOptions): Promise<KVListCompleteResult | KVListIncompleteResult>;
}
