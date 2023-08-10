// source: https://raw.githubusercontent.com/skymethod/denoflare/v0.5.12/common/cloudflare_workers_types.d.ts
export interface R2Bucket {
    head(key: string): Promise<R2Object | null>;
    get(key: string): Promise<R2ObjectBody | null>;
    get(key: string, options: R2GetOptions): Promise<R2ObjectBody | R2Object | null>;
    put(key: string, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob, options?: R2PutOptions): Promise<R2Object>;
    delete(keys: string | string[]): Promise<void>;
    list(options?: R2ListOptions): Promise<R2Objects>;
    createMultipartUpload(key: string, options?: R2MultipartOptions): Promise<R2MultipartUpload>;
    resumeMultipartUpload(key: string, uploadId: string): Promise<R2MultipartUpload>;
}

export interface R2MultipartOptions {
    readonly httpMetadata?: R2HTTPMetadata | Headers;
    readonly customMetadata?: Record<string, string>;
}

export interface R2MultipartUpload {
    readonly key: string;
    readonly uploadId: string;

    uploadPart(partNumber: number, value: ReadableStream | ArrayBuffer | ArrayBufferView | string | null | Blob): Promise<R2UploadedPart>;
    abort(): Promise<void>;
    complete(uploadedParts: R2UploadedPart[]): Promise<R2Object>;
}

export interface R2UploadedPart {
    readonly partNumber: number;
    readonly etag: string;
}

export interface R2Conditional {
    readonly etagMatches?: string;
    readonly etagDoesNotMatch?: string;
    readonly uploadedBefore?: Date;
    readonly uploadedAfter?: Date;
}

export interface R2GetOptions {
    readonly onlyIf?: R2Conditional | Headers;
    readonly range?: R2Range;
}

export interface R2HTTPMetadata {
    readonly contentType?: string;
    readonly contentLanguage?: string;
    readonly contentDisposition?: string;
    readonly contentEncoding?: string;
    readonly cacheControl?: string;
    readonly cacheExpiry?: Date;
}

export interface R2ListOptions {
    readonly limit?: number;
    readonly prefix?: string;
    readonly cursor?: string;
    readonly delimiter?: string;
    readonly startAfter?: string;
    readonly include?: ('httpMetadata' | 'customMetadata')[];
}

export interface R2Object {
    readonly key: string;
    readonly version: string;
    readonly size: number;
    readonly etag: string;
    readonly httpEtag: string;
    readonly checksums: R2Checksums;
    readonly uploaded: Date;
    readonly httpMetadata: R2HTTPMetadata;
    readonly customMetadata: Record<string, string>;
    readonly range?: R2Range;
    writeHttpMetadata(headers: Headers): void;
}

export interface R2Checksums {
    readonly md5?: ArrayBuffer;
    readonly sha1?: ArrayBuffer;
    readonly sha256?: ArrayBuffer;
    readonly sha384?: ArrayBuffer;
    readonly sha512?: ArrayBuffer;
}

export interface R2ObjectBody extends R2Object {
    readonly body: ReadableStream;
    readonly bodyUsed: boolean;
    arrayBuffer(): Promise<ArrayBuffer>;
    text(): Promise<string>;
    json<T>(): Promise<T>;
    blob(): Promise<Blob>;
}

export interface R2Objects {
    readonly objects: R2Object[];
    readonly truncated: boolean;
    readonly cursor?: string;
    readonly delimitedPrefixes: string[];
}

export interface R2PutOptions {
    readonly onlyIf?: R2Conditional | Headers;
    readonly httpMetadata?: R2HTTPMetadata | Headers;
    readonly customMetadata?: Record<string, string>;
    readonly md5?: ArrayBuffer | string; // hex if string
    readonly sha1?: ArrayBuffer | string;
    readonly sha256?: ArrayBuffer | string;
    readonly sha384?: ArrayBuffer | string;
    readonly sha512?: ArrayBuffer | string;
}

export type R2Range =
  | { offset: number; length?: number }
  | { offset?: number; length: number }
  | { suffix: number };
