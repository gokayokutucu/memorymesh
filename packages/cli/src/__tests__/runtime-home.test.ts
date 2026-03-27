import { joinFromHome, resolveUserHomeDir } from "../system/runtime-home";

describe("runtime home resolution", () => {
  it("resolves macOS home from HOME", () => {
    const home = resolveUserHomeDir("darwin", { HOME: "/Users/test" }, "");
    expect(home).toBe("/Users/test");
  });

  it("resolves Linux home from HOME", () => {
    const home = resolveUserHomeDir("linux", { HOME: "/home/test" }, "");
    expect(home).toBe("/home/test");
  });

  it("resolves Windows home from USERPROFILE", () => {
    const home = resolveUserHomeDir("win32", { USERPROFILE: "C:\\Users\\Test" }, "");
    expect(home).toBe("C:\\Users\\Test");
  });

  it("resolves Windows home from HOMEDRIVE and HOMEPATH", () => {
    const home = resolveUserHomeDir(
      "win32",
      { HOMEDRIVE: "C:", HOMEPATH: "\\Users\\Test" },
      ""
    );
    expect(home).toBe("C:\\Users\\Test");
  });

  it("prefers MEMORYMESH_HOME override", () => {
    const home = resolveUserHomeDir(
      "linux",
      { HOME: "/home/test", MEMORYMESH_HOME: "/tmp/custom-mm-home" },
      "/home/fallback"
    );
    expect(home).toBe("/tmp/custom-mm-home");
  });

  it("uses osHomeDir fallback on Linux when HOME is missing", () => {
    const home = resolveUserHomeDir("linux", {}, "/home/fallback");
    expect(home).toBe("/home/fallback");
  });

  it("throws clear error when home cannot be resolved", () => {
    expect(() => resolveUserHomeDir("linux", {}, "")).toThrow(
      "Unable to resolve user home directory"
    );
  });

  it("joins Windows-style paths safely", () => {
    const path = joinFromHome("C:\\Users\\Test", ".memorymesh", "config.json");
    expect(path).toBe("C:\\Users\\Test\\.memorymesh\\config.json");
  });

  it("joins POSIX-style paths safely", () => {
    const path = joinFromHome("/home/test", ".memorymesh", "config.json");
    expect(path).toBe("/home/test/.memorymesh/config.json");
  });
});

