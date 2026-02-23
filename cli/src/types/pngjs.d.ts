/**
 * Type declarations for pngjs library
 * Just because it doesn't have official TypeScript types
 */
declare module 'pngjs' {
    export interface PNG {
        width: number;
        height: number;
        data: Buffer;
        parse(buffer: Buffer, callback: (error: Error | null, data: any) => void): void;
    }

    export class PNG {
        constructor(options?: { width?: number; height?: number });
        width: number;
        height: number;
        data: Buffer;
        parse(buffer: Buffer, callback: (error: Error | null, data: any) => void): void;

        static sync: {
            write(png: PNG): Buffer;
        };
    }

    const pngjs: {
        PNG: typeof PNG;
    };

    export default pngjs;
}
