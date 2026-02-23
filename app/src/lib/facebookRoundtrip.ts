// SPDX-License-Identifier: BSD-3-Clause
// Copyright (c) 2026 Kyle Alexander Buan

const GRAPH_API_BASE_URL = 'https://graph.facebook.com/v24.0';
const PAGE_ACCESS_TOKEN_STORAGE_PREFIX = 'pxf.facebook.page_token.v1';

type GraphErrorResponse = {
    error?: {
        message?: string;
        code?: number;
        error_subcode?: number;
    };
};

type UploadedPhotoResponse = {
    id?: string;
};

type CreatedPostResponse = {
    id?: string;
};

type PhotoSourceResponse = {
    source?: string;
    images?: Array<{
        source?: string;
    }>;
};

type DeleteGraphObjectResponse = {
    success?: boolean;
};

type LongLivedUserTokenResponse = {
    access_token?: string;
    expires_in?: number;
    token_type?: string;
};

type ManagedPage = {
    id?: string;
    name?: string;
    access_token?: string;
    tasks?: string[];
};

type ManagedPagesResponse = {
    data?: ManagedPage[];
};

type CachedPageAccessToken = {
    token: string;
    cachedAt: number;
};

export type FacebookRoundtripImage = {
    name: string;
    blob: Blob;
};

export type FacebookRoundtripConfig = {
    pageId: string;
    pageAccessToken?: string;
    appId?: string;
    appSecret?: string;
    userAccessToken?: string;
    postMessage?: string;
    deleteAfterRoundtrip?: boolean;
    onProgress?: (message: string) => void;
};

class GraphApiError extends Error {
    status: number;
    code?: number;
    subcode?: number;

    constructor(message: string, status: number, code?: number, subcode?: number) {
        super(message);
        this.name = 'GraphApiError';
        this.status = status;
        this.code = code;
        this.subcode = subcode;
    }
}

function getExtensionFromMimeType(mimeType: string): string {
    const normalized = mimeType.toLowerCase();
    if (normalized.includes('jpeg') || normalized.includes('jpg')) return '.jpg';
    if (normalized.includes('png')) return '.png';
    if (normalized.includes('webp')) return '.webp';
    return '.img';
}

function buildOutputFilename(inputName: string, mimeType: string): string {
    const baseName = inputName.replace(/\.[^/.]+$/, '');
    return `${baseName}.facebook${getExtensionFromMimeType(mimeType)}`;
}

async function sleep(ms: number): Promise<void> {
    await new Promise(resolve => setTimeout(resolve, ms));
}

async function withRetry<T>(fn: () => Promise<T>, attempts: number, delayMs: number): Promise<T> {
    let lastError: unknown;

    for (let attempt = 1; attempt <= attempts; attempt++) {
        try {
            return await fn();
        } catch (error) {
            lastError = error;
            if (attempt < attempts) {
                await sleep(delayMs);
            }
        }
    }

    throw lastError instanceof Error ? lastError : new Error('Retry failed.');
}

function getTokenCacheKey(pageId: string): string {
    return `${PAGE_ACCESS_TOKEN_STORAGE_PREFIX}.${pageId}`;
}

function readCachedPageAccessToken(pageId: string): string | null {
    if (typeof window === 'undefined') return null;
    try {
        const raw = window.localStorage.getItem(getTokenCacheKey(pageId));
        if (!raw) return null;

        const parsed = JSON.parse(raw) as CachedPageAccessToken;
        if (typeof parsed.token !== 'string' || parsed.token.trim().length === 0) {
            window.localStorage.removeItem(getTokenCacheKey(pageId));
            return null;
        }

        return parsed.token;
    } catch {
        return null;
    }
}

function writeCachedPageAccessToken(pageId: string, token: string): void {
    if (typeof window === 'undefined') return;
    try {
        const payload: CachedPageAccessToken = {
            token,
            cachedAt: Date.now()
        };
        window.localStorage.setItem(getTokenCacheKey(pageId), JSON.stringify(payload));
    } catch {
        // Ignore storage failures
    }
}

function clearCachedPageAccessToken(pageId: string): void {
    if (typeof window === 'undefined') return;
    try {
        window.localStorage.removeItem(getTokenCacheKey(pageId));
    } catch {
        // Ignore storage failures
    }
}

function canUseAppCredentialFlow(config: FacebookRoundtripConfig): boolean {
    return Boolean(config.appId?.trim() && config.appSecret?.trim() && config.userAccessToken?.trim());
}

function isAuthTokenError(error: unknown): boolean {
    if (error instanceof GraphApiError) {
        if (error.code === 190 || error.code === 102) return true;
        return /access token|oauth/i.test(error.message);
    }
    if (error instanceof Error) {
        return /access token|oauth/i.test(error.message);
    }
    return false;
}

async function parseGraphError(
    response: Response
): Promise<{ message: string; code?: number; subcode?: number }> {
    let fallback = `Facebook Graph API request failed with HTTP ${response.status}.`;
    let code: number | undefined;
    let subcode: number | undefined;
    try {
        const body = (await response.json()) as GraphErrorResponse;
        const message = body.error?.message;
        code = body.error?.code;
        subcode = body.error?.error_subcode;
        if (message) {
            fallback = code ? `${message} (code ${code}${subcode ? `/${subcode}` : ''})` : message;
        }
    } catch {
        // Keep fallback message if the response body isn't JSON.
    }
    return {
        message: fallback,
        code,
        subcode
    };
}

async function requestGraphJson<T>(url: string, init: RequestInit): Promise<T> {
    const response = await fetch(url, init);
    if (!response.ok) {
        const parsedError = await parseGraphError(response);
        throw new GraphApiError(
            parsedError.message,
            response.status,
            parsedError.code,
            parsedError.subcode
        );
    }
    return (await response.json()) as T;
}

async function exchangeLongLivedUserAccessToken(
    appId: string,
    appSecret: string,
    userAccessToken: string,
): Promise<string> {
    const query = new URLSearchParams({
        grant_type: 'fb_exchange_token',
        client_id: appId,
        client_secret: appSecret,
        fb_exchange_token: userAccessToken
    });

    const payload = await requestGraphJson<LongLivedUserTokenResponse>(
        `${GRAPH_API_BASE_URL}/oauth/access_token?${query.toString()}`,
        {
            method: 'GET'
        }
    );

    if (!payload.access_token) {
        throw new Error('Facebook did not return a long-lived user access token.');
    }

    return payload.access_token;
}

async function getPageAccessTokenFromUserAccessToken(
    pageId: string,
    userAccessToken: string
): Promise<string> {
    const query = new URLSearchParams({
        fields: 'id,name,access_token,tasks',
        access_token: userAccessToken
    });

    const payload = await requestGraphJson<ManagedPagesResponse>(
        `${GRAPH_API_BASE_URL}/me/accounts?${query.toString()}`,
        {
            method: 'GET'
        }
    );

    const matchingPage = payload.data?.find(page => page.id === pageId);
    if (!matchingPage) {
        throw new Error(`No managed page matched page ID "${pageId}".`);
    }

    if (!matchingPage.access_token) {
        throw new Error(`Facebook did not return an access token for page "${pageId}".`);
    }

    return matchingPage.access_token;
}

async function resolvePageAccessToken(config: FacebookRoundtripConfig): Promise<string> {
    return await resolvePageAccessTokenWithOptions(config, { forceRefresh: false });
}

async function resolvePageAccessTokenWithOptions(
    config: FacebookRoundtripConfig,
    options: { forceRefresh: boolean }
): Promise<string> {
    const pageId = config.pageId.trim();
    const forceRefresh = options.forceRefresh;
    const existingPageAccessToken = config.pageAccessToken?.trim();

    if (!forceRefresh) {
        const cachedPageToken = readCachedPageAccessToken(pageId);
        if (cachedPageToken) {
            return cachedPageToken;
        }
    }

    if (existingPageAccessToken && !forceRefresh) {
        writeCachedPageAccessToken(pageId, existingPageAccessToken);
        return existingPageAccessToken;
    }

    if (!canUseAppCredentialFlow(config)) {
        if (existingPageAccessToken) {
            writeCachedPageAccessToken(pageId, existingPageAccessToken);
            return existingPageAccessToken;
        }
        throw new Error(
            'Facebook credentials are missing. Provide PAGE_ACCESS_TOKEN or APP_ID + APP_SECRET + USER_ACCESS_TOKEN.'
        );
    }

    const appId = config.appId?.trim();
    const appSecret = config.appSecret?.trim();
    const userAccessToken = config.userAccessToken?.trim();

    if (!appId || !appSecret || !userAccessToken) {
        throw new Error(
            'Facebook credentials are missing. Provide PAGE_ACCESS_TOKEN or APP_ID + APP_SECRET + USER_ACCESS_TOKEN.'
        );
    }

    config.onProgress?.('Refreshing Facebook user token...');
    const longLivedUserAccessToken = await exchangeLongLivedUserAccessToken(
        appId,
        appSecret,
        userAccessToken
    );

    config.onProgress?.('Resolving Facebook page access token...');
    const resolvedPageAccessToken = await getPageAccessTokenFromUserAccessToken(
        config.pageId,
        longLivedUserAccessToken
    );
    writeCachedPageAccessToken(pageId, resolvedPageAccessToken);
    return resolvedPageAccessToken;
}

async function uploadPhoto(
    pageId: string,
    pageAccessToken: string,
    image: FacebookRoundtripImage,
): Promise<string> {
    const formData = new FormData();
    formData.set('source', image.blob, image.name);
    formData.set('published', 'false');
    formData.set('access_token', pageAccessToken);

    const payload = await requestGraphJson<UploadedPhotoResponse>(
        `${GRAPH_API_BASE_URL}/${encodeURIComponent(pageId)}/photos`,
        {
            method: 'POST',
            body: formData
        }
    );

    if (!payload.id) {
        throw new Error('Facebook did not return a photo ID after upload.');
    }

    return payload.id;
}

async function createPost(
    pageId: string,
    pageAccessToken: string,
    photoIds: string[],
    postMessage: string
): Promise<string> {
    const formData = new FormData();
    formData.set('access_token', pageAccessToken);
    formData.set('published', 'false');
    formData.set('message', postMessage);

    photoIds.forEach((photoId, index) => {
        formData.set(`attached_media[${index}]`, JSON.stringify({ media_fbid: photoId }));
    });

    const payload = await requestGraphJson<CreatedPostResponse>(
        `${GRAPH_API_BASE_URL}/${encodeURIComponent(pageId)}/feed`,
        {
            method: 'POST',
            body: formData
        }
    );

    if (!payload.id) {
        throw new Error('Facebook did not return a post ID after creating the post.');
    }

    return payload.id;
}

async function getPhotoSourceUrl(photoId: string, pageAccessToken: string): Promise<string> {
    const query = new URLSearchParams({
        fields: 'source,images',
        access_token: pageAccessToken
    });

    const payload = await requestGraphJson<PhotoSourceResponse>(
        `${GRAPH_API_BASE_URL}/${encodeURIComponent(photoId)}?${query.toString()}`,
        {
            method: 'GET'
        }
    );

    const source = payload.source ?? payload.images?.[0]?.source;
    if (!source) {
        throw new Error(`Facebook did not provide a source URL for photo ${photoId}.`);
    }

    return source;
}

async function downloadPhoto(photoUrl: string): Promise<Blob> {
    const response = await fetch(photoUrl);
    if (!response.ok) {
        throw new Error(`Failed to download Facebook transcoded image (HTTP ${response.status}).`);
    }

    const blob = await response.blob();
    if (blob.size === 0) {
        throw new Error('Facebook returned an empty image payload.');
    }
    return blob;
}

async function deleteGraphObject(objectId: string, pageAccessToken: string): Promise<void> {
    const query = new URLSearchParams({
        access_token: pageAccessToken
    });

    const payload = await requestGraphJson<DeleteGraphObjectResponse>(
        `${GRAPH_API_BASE_URL}/${encodeURIComponent(objectId)}?${query.toString()}`,
        {
            method: 'DELETE'
        }
    );

    if (payload.success !== true) {
        throw new Error(`Facebook did not confirm deletion for object ${objectId}.`);
    }
}

async function runRoundtripWithToken(
    images: FacebookRoundtripImage[],
    pageId: string,
    pageAccessToken: string,
    postMessage: string,
    deleteAfterRoundtrip: boolean,
    onProgress?: (message: string) => void
): Promise<File[]> {
    const uploadedPhotoIds: string[] = [];
    let createdPostId: string | null = null;

    try {
        for (let index = 0; index < images.length; index++) {
            onProgress?.(`Uploading ${index + 1}/${images.length} to Facebook...`);
            const uploadedPhotoId = await uploadPhoto(pageId, pageAccessToken, images[index]);
            uploadedPhotoIds.push(uploadedPhotoId);
        }

        onProgress?.('Creating Facebook post...');
        createdPostId = await createPost(pageId, pageAccessToken, uploadedPhotoIds, postMessage);

        const downloadedFiles: File[] = [];
        for (let index = 0; index < uploadedPhotoIds.length; index++) {
            onProgress?.(`Downloading ${index + 1}/${uploadedPhotoIds.length} transcoded image(s)...`);
            const photoId = uploadedPhotoIds[index];

            const sourceUrl = await withRetry(
                () => getPhotoSourceUrl(photoId, pageAccessToken),
                5,
                1200
            );

            const blob = await withRetry(
                () => downloadPhoto(sourceUrl),
                5,
                1200
            );

            const fileName = buildOutputFilename(images[index].name, blob.type || 'image/jpeg');
            downloadedFiles.push(new File([blob], fileName, { type: blob.type || 'image/jpeg' }));
        }

        return downloadedFiles;
    } finally {
        if (deleteAfterRoundtrip) {
            onProgress?.('Cleaning up Facebook post...');

            const cleanupTasks: Promise<void>[] = [];
            if (createdPostId) cleanupTasks.push(deleteGraphObject(createdPostId, pageAccessToken));
            uploadedPhotoIds.forEach(photoId => {
                cleanupTasks.push(deleteGraphObject(photoId, pageAccessToken));
            });

            const cleanupResults = await Promise.allSettled(cleanupTasks);
            const failures = cleanupResults.filter(result => result.status === 'rejected');
            if (failures.length > 0) {
                console.warn(`Facebook cleanup failed for ${failures.length} object(s).`);
            }
        }
    }
}

export async function transcodeViaFacebook(
    images: FacebookRoundtripImage[],
    config: FacebookRoundtripConfig
): Promise<File[]> {
    const pageId = config.pageId.trim();
    const postMessage = config.postMessage?.trim() || 'PXF benchmark transcode';
    const deleteAfterRoundtrip = config.deleteAfterRoundtrip ?? true;

    if (!pageId) {
        throw new Error('Facebook page ID is not configured.');
    }
    if (images.length === 0) {
        throw new Error('No images available for Facebook transcoding.');
    }
    let pageAccessToken = await resolvePageAccessToken(config);

    try {
        return await runRoundtripWithToken(
            images,
            pageId,
            pageAccessToken,
            postMessage,
            deleteAfterRoundtrip,
            config.onProgress
        );
    } catch (error) {
        if (!isAuthTokenError(error) || !canUseAppCredentialFlow(config)) {
            throw error;
        }

        clearCachedPageAccessToken(pageId);
        config.onProgress?.('Facebook token expired. Refreshing token...');
        pageAccessToken = await resolvePageAccessTokenWithOptions(config, { forceRefresh: true });
        return await runRoundtripWithToken(
            images,
            pageId,
            pageAccessToken,
            postMessage,
            deleteAfterRoundtrip,
            config.onProgress
        );
    }
}
