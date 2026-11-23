// The few Node APIs the tests use (the project deliberately has no @types/node).
declare module 'node:child_process' {
  export function execFileSync(file: string, args: string[], options: { encoding: 'utf8' }): string
}
declare module 'node:fs' {
  export function mkdtempSync(prefix: string): string
  export function mkdirSync(path: string, options?: { recursive?: boolean }): void
  export function rmSync(path: string, options?: { recursive?: boolean; force?: boolean }): void
  export function writeFileSync(path: string, data: string): void
}
declare module 'node:os' {
  export function tmpdir(): string
}
declare module 'node:path' {
  export function join(...parts: string[]): string
}
declare module 'node:zlib' {
  export function crc32(data: Uint8Array): number
}
declare const process: { execPath: string; cwd(): string }
