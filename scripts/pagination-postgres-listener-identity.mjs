import path from "node:path";

const WINDOWS_PATH = /^[A-Za-z]:[\\/]/;

function pathApiFor(value) {
  return WINDOWS_PATH.test(value) || path.sep === "\\" ? path.win32 : path;
}

function isInside(pathApi, parent, candidate) {
  const relative = pathApi.relative(parent, candidate);
  return relative !== "" && relative !== ".." && !relative.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(relative);
}

function pathsOverlap(pathApi, left, right) {
  return left.toLowerCase() === right.toLowerCase()
    || isInside(pathApi, left, right)
    || isInside(pathApi, right, left);
}

export function assertTemporaryPostgresRoot({
  tempRoot,
  protectedDataDirectory = "C:\\Program Files\\PostgreSQL\\18\\data",
}) {
  if ([tempRoot, protectedDataDirectory]
    .some((value) => typeof value !== "string" || value.trim() === "")) {
    throw new Error("PostgreSQL temporary root is incomplete; refusing cluster creation.");
  }
  const pathApi = pathApiFor(tempRoot);
  const root = pathApi.resolve(tempRoot);
  const protectedDirectory = pathApi.resolve(protectedDataDirectory);
  if (pathsOverlap(pathApi, root, protectedDirectory)) {
    throw new Error("PostgreSQL temporary root overlaps the protected Windows service data directory; refusing cluster creation.");
  }
  return true;
}

/**
 * Fails closed unless PostgreSQL reports the exact data directory this runner
 * initialized, and that directory is unique beneath its owned temp directory.
 */
export function assertTemporaryPostgresLayout({
  tempRoot,
  runDirectory,
  dataDirectory,
  protectedDataDirectory = "C:\\Program Files\\PostgreSQL\\18\\data",
}) {
  if ([tempRoot, runDirectory, dataDirectory, protectedDataDirectory]
    .some((value) => typeof value !== "string" || value.trim() === "")) {
    throw new Error("PostgreSQL listener identity is incomplete; refusing setup SQL.");
  }

  const pathApi = pathApiFor(tempRoot);
  const root = pathApi.resolve(tempRoot);
  const ownedRunDirectory = pathApi.resolve(runDirectory);
  const expectedDataDirectory = pathApi.resolve(dataDirectory);
  const protectedDirectory = pathApi.resolve(protectedDataDirectory);

  assertTemporaryPostgresRoot({ tempRoot, protectedDataDirectory });

  if (!isInside(pathApi, root, ownedRunDirectory)) {
    throw new Error("PostgreSQL runner directory is outside its temporary root; refusing setup SQL.");
  }
  if (!isInside(pathApi, ownedRunDirectory, expectedDataDirectory)) {
    throw new Error("PostgreSQL data directory is outside the runner-owned directory; refusing setup SQL.");
  }
  if (pathsOverlap(pathApi, ownedRunDirectory, protectedDirectory)) {
    throw new Error("PostgreSQL temporary directory overlaps the protected Windows service data directory; refusing setup SQL.");
  }

  return { pathApi, expectedDataDirectory };
}

export function assertTemporaryPostgresListenerIdentity(options) {
  const { reportedDataDirectory } = options;
  if (typeof reportedDataDirectory !== "string" || reportedDataDirectory.trim() === "") {
    throw new Error("PostgreSQL listener identity is incomplete; refusing setup SQL.");
  }
  const { pathApi, expectedDataDirectory } = assertTemporaryPostgresLayout(options);
  const actualDataDirectory = pathApi.resolve(reportedDataDirectory.trim());
  if (actualDataDirectory.toLowerCase() !== expectedDataDirectory.toLowerCase()) {
    throw new Error("PostgreSQL listener data directory does not match the spawned temporary cluster; refusing setup SQL.");
  }

  return true;
}
