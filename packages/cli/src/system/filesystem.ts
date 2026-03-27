import { existsSync } from "node:fs";
import { mkdir, readFile, writeFile } from "node:fs/promises";

export interface IFileSystem {
  exists(path: string): boolean;
  mkdir(path: string): Promise<void>;
  read(path: string): Promise<string>;
  write(path: string, content: string): Promise<void>;
}

export const nodeFileSystem: IFileSystem = {
  exists(path: string): boolean {
    return existsSync(path);
  },
  async mkdir(path: string): Promise<void> {
    await mkdir(path, { recursive: true });
  },
  async read(path: string): Promise<string> {
    return readFile(path, "utf8");
  },
  async write(path: string, content: string): Promise<void> {
    await writeFile(path, content, "utf8");
  },
};
